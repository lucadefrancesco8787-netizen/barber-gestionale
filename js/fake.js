// Modalità prova (?prova): dati finti salvati nel browser, stesse funzioni di api.js.
// shortcut: orari calcolati nel fuso del computer (non del negozio); va bene solo per provare.
import { groupServices } from './util.js';

const KEY = 'barber-prova';
const MIN = 60000;
const id = () => crypto.randomUUID();

function seed() {
  const hours = [];
  for (const b of ['b1', 'b2', 'b3']) for (let d = 2; d <= 6; d++) // martedì-sabato, pausa 13-14
    hours.push({ barber_id: b, weekday: d, start: '09:00', end: '13:00' }, { barber_id: b, weekday: d, start: '14:00', end: '19:00' });
  return {
    shops: [
      { id: 's1', name: 'Barberia Centro', address: 'Via Roma 1' },
      { id: 's2', name: 'Barberia Stazione', address: 'Piazza Garibaldi 5' },
    ],
    barbers: [
      { id: 'b1', shop_id: 's1', display_name: 'Mario', cancel_limit_hours: 2 },
      { id: 'b2', shop_id: 's1', display_name: 'Luigi', cancel_limit_hours: 2 },
      { id: 'b3', shop_id: 's2', display_name: 'Toni', cancel_limit_hours: 2 },
    ],
    services: [
      { id: 'v1', barber_id: 'b1', name: 'Taglio', duration_min: 30, price_cents: 1500 },
      { id: 'v2', barber_id: 'b1', name: 'Barba', duration_min: 20, price_cents: 800 },
      { id: 'v3', barber_id: 'b1', name: 'Taglio + Barba', duration_min: 45, price_cents: 2000 },
      { id: 'v4', barber_id: 'b2', name: 'Taglio', duration_min: 30, price_cents: 1800 },
      { id: 'v5', barber_id: 'b2', name: 'Barba', duration_min: 20, price_cents: 1000 },
      { id: 'v6', barber_id: 'b3', name: 'Taglio', duration_min: 30, price_cents: 1500 },
    ],
    hours,
    timeOff: [],
    appointments: [],
    profile: { id: 'u1', role: 'client', full_name: 'Cliente Prova', phone: '' },
    loggedIn: false,
  };
}

let db;
try { db = JSON.parse(localStorage.getItem(KEY)) ?? seed(); } catch { db = seed(); }
for (const a of db.appointments) { a.starts_at = new Date(a.starts_at); a.ends_at = new Date(a.ends_at); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* prova senza memoria */ } };
let listener = () => {};

export function reset() { db = seed(); save(); }

export async function session() {
  return db.loggedIn ? { user: { id: db.profile.id, email: 'prova@esempio.it' }, profile: db.profile } : null;
}
export const onAuthChange = (fn) => { listener = fn; };
export async function signIn() { db.loggedIn = true; save(); listener(); }
export async function signUp(full_name, phone) { Object.assign(db.profile, { full_name, phone }); return signIn(); }
export const signInGoogle = signIn;
export async function signOut() { db.loggedIn = false; save(); listener(); }
export async function updateProfile(_id, fields) { Object.assign(db.profile, fields); save(); }

export async function shops() { return db.shops; }
export async function barbers(shopId) { return db.barbers.filter((b) => b.shop_id === shopId); }
export async function serviceNames(shopId, barberId) {
  const ids = new Set(db.barbers.filter((b) => b.shop_id === shopId && (!barberId || b.id === barberId)).map((b) => b.id));
  return groupServices(db.services.filter((s) => ids.has(s.barber_id)));
}

const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const busy = (barberId, start, end, skipId) =>
  db.appointments.some((a) => a.barber_id === barberId && a.id !== skipId && ['booked', 'done'].includes(a.status) && overlaps(start, end, a.starts_at, a.ends_at))
  || db.timeOff.some((t) => t.barber_id === barberId && overlaps(start, end, new Date(t.starts_at), new Date(t.ends_at)));
const isoDow = (day) => ((new Date(`${day}T12:00`).getDay() + 6) % 7) + 1;

export async function slots(shopId, day, serviceName, barberId) {
  const out = [];
  for (const b of await barbers(shopId)) {
    if (barberId && b.id !== barberId) continue;
    const sv = db.services.find((s) => s.barber_id === b.id && s.name.toLowerCase() === serviceName.toLowerCase());
    if (!sv) continue;
    for (const h of db.hours.filter((h) => h.barber_id === b.id && h.weekday === isoDow(day))) {
      const end = new Date(`${day}T${h.end}`);
      for (let t = new Date(`${day}T${h.start}`); +t + sv.duration_min * MIN <= +end; t = new Date(+t + 15 * MIN)) {
        const tEnd = new Date(+t + sv.duration_min * MIN);
        if (t > new Date() && !busy(b.id, t, tEnd))
          out.push({ barber_id: b.id, barber_name: b.display_name, service_id: sv.id, starts_at: t, price_cents: sv.price_cents });
      }
    }
  }
  return out.sort((a, b) => a.starts_at - b.starts_at || a.barber_name.localeCompare(b.barber_name));
}

export async function book(serviceId, startsAt) {
  const sv = db.services.find((s) => s.id === serviceId);
  const b = db.barbers.find((x) => x.id === sv.barber_id);
  const ends = new Date(+startsAt + sv.duration_min * MIN);
  if (busy(b.id, startsAt, ends)) throw new Error('Orario non più disponibile');
  const a = { id: id(), shop_id: b.shop_id, barber_id: b.id, service_id: sv.id, service_name: sv.name, price_cents: sv.price_cents,
    starts_at: new Date(startsAt), ends_at: ends, status: 'booked' };
  db.appointments.push(a); save();
  return a;
}

export async function myAppointments() {
  return db.appointments.map((a) => {
    const b = db.barbers.find((x) => x.id === a.barber_id);
    const s = db.shops.find((x) => x.id === a.shop_id);
    return { ...a, barber_name: b.display_name, cancel_limit_hours: b.cancel_limit_hours, shop_name: s.name, shop_address: s.address };
  }).sort((a, b) => b.starts_at - a.starts_at);
}

function checkChange(a) {
  if (a.status !== 'booked') throw new Error('Appuntamento non modificabile');
  const limit = db.barbers.find((b) => b.id === a.barber_id).cancel_limit_hours;
  if (a.starts_at - new Date() < limit * 60 * MIN) throw new Error('Troppo tardi: chiama il negozio');
}
export async function cancel(apptId) {
  const a = db.appointments.find((x) => x.id === apptId);
  checkChange(a);
  a.status = 'cancelled'; save();
  return a;
}
export async function reschedule(apptId, startsAt) {
  const a = db.appointments.find((x) => x.id === apptId);
  checkChange(a);
  const ends = new Date(+startsAt + (a.ends_at - a.starts_at));
  if (busy(a.barber_id, startsAt, ends, a.id)) throw new Error('Orario non più disponibile');
  a.starts_at = new Date(startsAt); a.ends_at = ends; save();
  return a;
}
