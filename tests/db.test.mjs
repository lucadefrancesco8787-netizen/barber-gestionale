// Prova le regole del database su un Postgres locale (PGlite), senza Supabase.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const db = new PGlite({ extensions: { btree_gist } });

// utenti di prova
const U = {
  admin: '00000000-0000-0000-0000-000000000001',
  owner1: '00000000-0000-0000-0000-000000000011',
  owner2: '00000000-0000-0000-0000-000000000012',
  barb1: '00000000-0000-0000-0000-000000000021',
  barb2: '00000000-0000-0000-0000-000000000022',
  barb3: '00000000-0000-0000-0000-000000000023', // altra organizzazione
  cli1: '00000000-0000-0000-0000-000000000031',
  cli2: '00000000-0000-0000-0000-000000000032',
};
const ORG1 = '10000000-0000-0000-0000-000000000001', ORG2 = '10000000-0000-0000-0000-000000000002';
const SHOP1 = '20000000-0000-0000-0000-000000000001', SHOP2 = '20000000-0000-0000-0000-000000000002';
const B1 = '30000000-0000-0000-0000-000000000001', B2 = '30000000-0000-0000-0000-000000000002', B3 = '30000000-0000-0000-0000-000000000003';
const S1 = '40000000-0000-0000-0000-000000000001', S2 = '40000000-0000-0000-0000-000000000002', S3 = '40000000-0000-0000-0000-000000000003';

// esegue una query come un certo utente, con le regole di accesso attive
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await tx.exec('set local role authenticated');
    return (await tx.query(sql, params)).rows;
  });
}
const fails = (p, msg) => assert.rejects(p, (e) => (msg ? e.message.includes(msg) : true) || assert.fail(e.message));

// un giorno fra 3 giorni, alle ore indicate (ora italiana)
const at = (hhmm, days = 3) => `((current_date + ${days}) + time '${hhmm}') at time zone 'Europe/Rome'`;
const ts = async (hhmm, days) => (await db.query(`select ${at(hhmm, days)} as t`)).rows[0].t;

before(async () => {
  await db.exec(file('./supabase-stub.sql'));
  await db.exec(file('../supabase/migrations/001_schema.sql'));
  for (const [k, id] of Object.entries(U))
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, `${k}@prova.it`, { full_name: k }]);
  await db.exec(`
    update profiles set role = 'superadmin' where id = '${U.admin}';
    insert into organizations (id, name) values ('${ORG1}', 'Org Uno'), ('${ORG2}', 'Org Due');
    update profiles set role = 'owner', org_id = '${ORG1}' where id = '${U.owner1}';
    update profiles set role = 'owner', org_id = '${ORG2}' where id = '${U.owner2}';
    update profiles set role = 'barber', org_id = '${ORG1}' where id in ('${U.barb1}', '${U.barb2}');
    update profiles set role = 'barber', org_id = '${ORG2}' where id = '${U.barb3}';
    insert into shops (id, org_id, name) values ('${SHOP1}', '${ORG1}', 'Sede Uno'), ('${SHOP2}', '${ORG2}', 'Sede Due');
    insert into barbers (id, profile_id, shop_id, display_name) values
      ('${B1}', '${U.barb1}', '${SHOP1}', 'Mario'), ('${B2}', '${U.barb2}', '${SHOP1}', 'Luigi'),
      ('${B3}', '${U.barb3}', '${SHOP2}', 'Peach');
    insert into services (id, barber_id, name, duration_min, price_cents) values
      ('${S1}', '${B1}', 'Taglio', 30, 1500), ('${S2}', '${B2}', 'Taglio', 30, 1800), ('${S3}', '${B3}', 'Taglio', 30, 2000);
    insert into working_hours (barber_id, weekday, start_time, end_time)
      select b, d, '09:00', '19:00' from unnest(array['${B1}','${B2}','${B3}']::uuid[]) b, generate_series(1,7) d;
  `);
});

test('il cliente prenota e lo stesso orario non si può prendere due volte', async () => {
  const t = await ts('10:00');
  const [a] = await as(U.cli1, 'select * from book($1, $2)', [S1, t]);
  assert.equal(a.status, 'booked');
  assert.equal(a.price_cents, 1500);
  await fails(as(U.cli2, 'select * from book($1, $2)', [S1, t]), 'non più disponibile');
  // sovrapposto di un quarto d'ora: rifiutato lo stesso
  await fails(as(U.cli2, 'select * from book($1, $2)', [S1, await ts('10:15')]), 'non più disponibile');
});

test('"chiunque": alle 10 resta libero solo Luigi', async () => {
  const rows = await as(U.cli2, `select * from available_slots($1, current_date + 3, 'taglio')`, [SHOP1]);
  const t10 = (await ts('10:00')).getTime();
  assert.deepEqual(rows.filter((r) => r.starts_at.getTime() === t10).map((r) => r.barber_name), ['Luigi']);
  assert.ok(rows.some((r) => r.barber_name === 'Mario'));
  assert.ok(rows.every((r) => r.barber_name !== 'Peach'), 'altre sedi escluse');
});

test('fuori orario o in ferie non si prenota', async () => {
  await fails(as(U.cli1, 'select * from book($1, $2)', [S2, await ts('20:00')]), 'Orario non disponibile');
  await db.query(`insert into time_off (barber_id, starts_at, ends_at) values ($1, ${at('12:00')}, ${at('14:00')})`, [B2]);
  await fails(as(U.cli1, 'select * from book($1, $2)', [S2, await ts('12:30')]), 'Orario non disponibile');
  const free = await as(U.cli1, `select * from available_slots($1, current_date + 3, 'Taglio', $2)`, [SHOP1, B2]);
  const t1230 = (await ts('12:30')).getTime();
  assert.ok(!free.some((r) => r.starts_at.getTime() === t1230));
});

test('annullare: il cliente fino a 2 ore prima, il barbiere sempre', async () => {
  const [{ id: cust }] = (await db.query(`select id from customers where profile_id = $1`, [U.cli1])).rows;
  const [{ id }] = (await db.query(`insert into appointments (shop_id, barber_id, customer_id, service_name, price_cents, starts_at, ends_at)
    values ($1, $2, $3, 'Taglio', 1500, now() + interval '1 hour', now() + interval '90 minutes') returning id`, [SHOP1, B1, cust])).rows;
  await fails(as(U.cli1, 'select * from cancel_appointment($1)', [id]), 'Troppo tardi');
  await fails(as(U.cli2, 'select * from cancel_appointment($1)', [id]), 'Non permesso');
  const [a] = await as(U.barb1, 'select * from cancel_appointment($1)', [id]);
  assert.equal(a.status, 'cancelled');
});

test('il cliente sposta il suo appuntamento in un orario libero', async () => {
  const [a] = await as(U.cli2, 'select * from book($1, $2)', [S2, await ts('15:00')]);
  const [b] = await as(U.cli2, 'select * from reschedule_appointment($1, $2)', [a.id, await ts('16:00')]);
  assert.equal(b.starts_at.getTime(), (await ts('16:00')).getTime());
  await fails(as(U.cli2, 'select * from reschedule_appointment($1, $2)', [a.id, await ts('22:00')]), 'Orario non disponibile');
});

test('ognuno vede solo quello che deve', async () => {
  const count = async (uid, sql = 'select count(*)::int n from appointments') => (await as(uid, sql))[0].n;
  const mine1 = await count(U.cli1);
  assert.ok(mine1 >= 1);
  const otherCli = await as(U.cli2, 'select c.profile_id from appointments a join customers c on c.id = a.customer_id');
  assert.ok(otherCli.every((r) => r.profile_id === U.cli2), 'il cliente vede solo i suoi');
  assert.ok((await as(U.barb2, 'select barber_id from appointments')).every((r) => r.barber_id === B2), 'il barbiere vede solo i suoi');
  assert.equal(await count(U.owner1), (await db.query(`select count(*)::int n from appointments where shop_id = $1`, [SHOP1])).rows[0].n);
  assert.equal(await count(U.owner2), 0, 'un altro titolare non vede niente');
  assert.equal(await count(U.owner2, 'select count(*)::int n from customers'), 0);
  assert.equal(await count(U.barb3, 'select count(*)::int n from customer_stats'), 0);
  assert.equal(await count(U.admin), (await db.query('select count(*)::int n from appointments')).rows[0].n);
});

test('niente scorciatoie: il cliente non scrive appuntamenti né si cambia il ruolo', async () => {
  await fails(as(U.cli1, `insert into appointments (shop_id, barber_id, customer_id, service_name, price_cents, starts_at, ends_at)
    select $1, $2, id, 'x', 0, now() + interval '1 day', now() + interval '25 hours' from customers limit 1`, [SHOP1, B1]));
  await fails(as(U.cli1, `update profiles set role = 'superadmin' where id = $1`, [U.cli1]));
  await as(U.cli1, `update profiles set phone = '333' where id = $1`, [U.cli1]);
  assert.equal((await db.query('select phone from profiles where id = $1', [U.cli1])).rows[0].phone, '333');
  // un barbiere non si sposta in una sede di un altro titolare
  await fails(as(U.barb1, `update barbers set shop_id = $1 where id = $2`, [SHOP2, B1]));
  // un titolare non tocca i servizi di un altro
  assert.equal((await as(U.owner2, `update services set price_cents = 1 where id = $1 returning id`, [S1])).length, 0);
});

test('appuntamento a mano e scheda cliente', async () => {
  const [a] = await as(U.barb1, 'select * from staff_book($1, $2, null, $3, $4)', [S1, await ts('21:00'), 'Gino Rossi', '3331112222']);
  assert.equal(a.source, 'manual');
  await fails(as(U.barb3, 'select * from staff_book($1, $2, null, $3)', [S1, await ts('08:00'), 'X']), 'Non permesso');
  // visita fatta 10 giorni fa
  await db.query(`insert into appointments (shop_id, barber_id, customer_id, service_name, price_cents, starts_at, ends_at, status)
    values ($1, $2, $3, 'Barba', 800, now() - interval '10 days', now() - interval '10 days' + interval '20 minutes', 'done')`,
    [SHOP1, B1, a.customer_id]);
  const [s] = await as(U.barb1, 'select * from customer_stats where id = $1', [a.customer_id]);
  assert.equal(s.full_name, 'Gino Rossi');
  assert.equal(s.days_since, 10);
  assert.equal(s.last_service, 'Barba');
  assert.equal(Number(s.visits), 1);
  assert.ok(s.next_appointment);
  assert.equal((await as(U.barb2, 'select * from customer_stats where id = $1', [a.customer_id])).length, 0);
  await as(U.barb1, `update customers set notes = 'sfumatura bassa' where id = $1`, [a.customer_id]);
  assert.equal((await as(U.owner1, 'select notes from customers where id = $1', [a.customer_id]))[0].notes, 'sfumatura bassa');
});
