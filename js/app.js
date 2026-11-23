import { SUPABASE_URL } from './config.js';
import { esc, euro, priceRange, hour, dayLong, dayShort, isoDay } from './util.js';

const PROVA = new URLSearchParams(location.search).has('prova') || !SUPABASE_URL;
const api = PROVA ? await import('./fake.js') : await import('./api.js');

const $app = document.getElementById('app');
const S = {
  me: null,          // { user, profile }
  tab: 'book',       // 'book' | 'mine'
  authMode: 'login', // 'login' | 'signup'
  sel: {},           // scelte della prenotazione: shop, barber (null = chiunque), service, day, slot
  data: {},          // liste caricate: shops, barbers, services, slots, appts
  moving: null,      // appuntamento che si sta spostando
  done: null,        // appuntamento appena prenotato
  busy: false,
  error: '',
};

// ===== utilità =====
const days = () => Array.from({ length: 14 }, (_, i) => isoDay(new Date(Date.now() + i * 864e5)));
const dateOf = (day) => new Date(`${day}T12:00`);
function setError(e) { S.error = e?.message ?? String(e ?? ''); }
async function run(fn) {
  S.busy = true; S.error = ''; render();
  try { await fn(); } catch (e) { setError(e); }
  S.busy = false; render();
}

// ===== caricamento dati =====
async function loadSession() {
  S.me = await api.session();
  if (S.me && S.me.profile.role === 'client') {
    S.data.shops = await api.shops();
    if (S.data.shops.length === 1 && !S.sel.shop) await pickShop(S.data.shops[0].id);
  }
}
async function pickShop(id) {
  S.sel = { shop: S.data.shops.find((s) => s.id === id) };
  S.data.barbers = await api.barbers(id);
}
async function loadServices() {
  S.data.services = await api.serviceNames(S.sel.shop.id, S.sel.barber?.id);
}
async function loadSlots() {
  const rows = await api.slots(S.sel.shop.id, S.sel.day, S.sel.service.name, S.sel.barber?.id);
  // "chiunque": un solo pulsante per orario, col primo barbiere libero
  const seen = new Set();
  S.data.slots = rows.filter((r) => !seen.has(+r.starts_at) && seen.add(+r.starts_at));
}
async function loadAppts() { S.data.appts = await api.myAppointments(); }

// ===== schermate =====
function render() {
  let body;
  if (!S.me) body = viewLogin();
  else if (S.me.profile.role !== 'client') body = viewStaffSoon();
  else if (!S.me.profile.phone) body = viewPhone();
  else body = S.tab === 'mine' ? viewMine() : viewBook();
  $app.innerHTML = `
    ${PROVA ? `<div class="banner">Modalità prova: dati finti <button class="link" data-act="reset">ricomincia da capo</button></div>` : ''}
    <header class="top"><span class="logo">✂</span> Prenota il barbiere
      ${S.me ? `<button class="link right" data-act="logout">Esci</button>` : ''}</header>
    ${S.error ? `<p class="error" role="alert">${esc(S.error)}</p>` : ''}
    <main class="${S.busy ? 'busy' : ''}">${body}</main>
    ${S.me?.profile.role === 'client' && S.me.profile.phone ? `
      <nav class="tabs">
        <button data-act="tab" data-v="book" class="${S.tab === 'book' ? 'on' : ''}">Prenota</button>
        <button data-act="tab" data-v="mine" class="${S.tab === 'mine' ? 'on' : ''}">I miei appuntamenti</button>
      </nav>` : ''}`;
}

function viewLogin() {
  if (PROVA) return `
    <section class="card center">
      <h1>Benvenuto</h1>
      <p>Questa è una prova: nessun dato vero, nessuna email.</p>
      <button class="primary" data-act="prova-login">Entra come cliente</button>
    </section>`;
  const signup = S.authMode === 'signup';
  return `
    <section class="card">
      <h1>${signup ? 'Crea il tuo account' : 'Accedi'}</h1>
      <form data-form="${signup ? 'signup' : 'login'}">
        ${signup ? `
          <label>Nome e cognome<input name="name" required autocomplete="name"></label>
          <label>Telefono (per il promemoria)<input name="phone" type="tel" required autocomplete="tel"></label>` : ''}
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" required minlength="6"
          autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        <button class="primary" type="submit">${signup ? 'Registrati' : 'Entra'}</button>
      </form>
      <button class="google" data-act="google">Continua con Google</button>
      <p class="center">${signup ? 'Hai già un account?' : 'Prima volta?'}
        <button class="link" data-act="auth-mode">${signup ? 'Accedi' : 'Registrati'}</button></p>
    </section>`;
}

function viewPhone() {
  return `
    <section class="card">
      <h1>Ultimo passo</h1>
      <p>Lasciaci il tuo numero: ti ricordiamo l'appuntamento il giorno prima.</p>
      <form data-form="phone">
        <label>Telefono<input name="phone" type="tel" required autocomplete="tel"></label>
        <button class="primary" type="submit">Salva</button>
      </form>
    </section>`;
}

function viewStaffSoon() {
  return `<section class="card center"><h1>Ciao ${esc(S.me.profile.full_name)}</h1>
    <p>La tua area (agenda e clienti) arriva nel prossimo passo.</p></section>`;
}

function back(to) { return `<button class="link back" data-act="back" data-v="${to}">‹ Indietro</button>`; }

function viewBook() {
  const { sel, data } = S;
  if (S.done) {
    const a = S.done;
    return `<section class="card center">
      <div class="big">✓</div><h1>${S.moving === 'done' ? 'Appuntamento spostato' : 'Prenotato!'}</h1>
      <p><b>${esc(a.service_name)}</b> con <b>${esc(a.barber_name)}</b><br>${esc(dayLong(a.starts_at))} alle ${hour(a.starts_at)}</p>
      <p>Paghi in negozio: ${euro(a.price_cents)}</p>
      <button class="primary" data-act="tab" data-v="mine">I miei appuntamenti</button>
      <button class="link" data-act="new">Prenota un altro</button></section>`;
  }
  const head = S.moving ? `<p class="note">Stai spostando: <b>${esc(S.moving.service_name)}</b> con ${esc(S.moving.barber_name)},
      ${esc(dayLong(S.moving.starts_at))} alle ${hour(S.moving.starts_at)} <button class="link" data-act="stop-move">annulla</button></p>` : '';

  if (!sel.shop) return `<section><h2>Scegli il negozio</h2>
    ${(data.shops ?? []).map((s) => `<button class="item" data-act="shop" data-v="${s.id}"><b>${esc(s.name)}</b><small>${esc(s.address)}</small></button>`).join('')
      || '<p>Nessun negozio disponibile.</p>'}</section>`;

  if (sel.barber === undefined) return `<section>
    ${data.shops.length > 1 ? back('shop') : ''}<h2>Con chi?</h2><p class="muted">${esc(sel.shop.name)}</p>
    <button class="item" data-act="barber" data-v=""><b>Chiunque</b><small>Il primo barbiere libero</small></button>
    ${data.barbers.map((b) => `<button class="item" data-act="barber" data-v="${b.id}"><b>${esc(b.display_name)}</b></button>`).join('')}
  </section>`;

  if (!sel.service) return `<section>${back('barber')}<h2>Cosa facciamo?</h2>
    <p class="muted">${sel.barber ? esc(sel.barber.display_name) : 'Chiunque'} · ${esc(sel.shop.name)}</p>
    ${(data.services ?? []).map((s, i) => `<button class="item row" data-act="service" data-v="${i}">
      <span><b>${esc(s.name)}</b><small>${s.duration_min} min</small></span><span class="price">${priceRange(s)}</span></button>`).join('')
      || '<p>Nessun servizio disponibile.</p>'}</section>`;

  if (!sel.slot) return `<section>${S.moving ? head : back('service')}<h2>Quando?</h2>
    <p class="muted">${esc(sel.service.name)} · ${sel.barber ? esc(sel.barber.display_name) : 'Chiunque'}</p>
    <div class="days">${days().map((d) => `<button data-act="day" data-v="${d}" class="${d === sel.day ? 'on' : ''}">${esc(dayShort(dateOf(d)))}</button>`).join('')}</div>
    ${!sel.day ? '<p class="muted">Scegli un giorno.</p>'
      : !data.slots ? '<p class="muted">Cerco gli orari liberi…</p>'
      : data.slots.length ? `<div class="slots">${data.slots.map((s, i) => `<button data-act="slot" data-v="${i}">${hour(s.starts_at)}</button>`).join('')}</div>`
      : '<p class="muted">Nessun orario libero in questo giorno.</p>'}
  </section>`;

  const s = sel.slot;
  return `<section class="card">${back('slot')}<h2>${S.moving ? 'Confermi il nuovo orario?' : 'Confermi?'}</h2>
    <dl class="summary">
      <dt>Servizio</dt><dd>${esc(sel.service.name)}</dd>
      <dt>Barbiere</dt><dd>${esc(s.barber_name)}</dd>
      <dt>Quando</dt><dd>${esc(dayLong(s.starts_at))} alle ${hour(s.starts_at)}</dd>
      <dt>Dove</dt><dd>${esc(sel.shop.name)}${sel.shop.address ? `, ${esc(sel.shop.address)}` : ''}</dd>
      <dt>Prezzo</dt><dd>${euro(s.price_cents)} <small>(paghi in negozio)</small></dd>
    </dl>
    <button class="primary" data-act="confirm" ${S.busy ? 'disabled' : ''}>${S.moving ? 'Sposta appuntamento' : 'Prenota'}</button>
  </section>`;
}

function viewMine() {
  const all = S.data.appts;
  if (!all) return '<p class="muted">Carico…</p>';
  const now = new Date();
  const next = all.filter((a) => a.status === 'booked' && a.starts_at > now).reverse();
  const past = all.filter((a) => !next.includes(a)).slice(0, 20);
  const label = { booked: 'Prenotato', cancelled: 'Annullato', done: 'Fatto', no_show: 'Non presentato' };
  const card = (a, future) => {
    const late = a.starts_at - now < a.cancel_limit_hours * 3600e3;
    return `<article class="appt ${a.status}">
      <b>${esc(a.service_name)}</b> con ${esc(a.barber_name)}
      <div>${esc(dayLong(a.starts_at))} alle ${hour(a.starts_at)}</div>
      <small>${esc(a.shop_name)} · ${euro(a.price_cents)}${future ? '' : ` · ${label[a.status] ?? a.status}`}</small>
      ${future ? (late
        ? `<p class="muted">Per cambiarlo ormai devi chiamare il negozio.</p>`
        : `<div class="actions"><button data-act="move" data-v="${a.id}">Sposta</button>
           <button class="danger" data-act="cancel" data-v="${a.id}">Annulla</button></div>`) : ''}
    </article>`;
  };
  return `<section><h2>Prossimi</h2>${next.map((a) => card(a, true)).join('') || '<p class="muted">Nessun appuntamento in programma.</p>'}</section>
    ${past.length ? `<section><h2>Passati</h2>${past.map((a) => card(a, false)).join('')}</section>` : ''}`;
}

// ===== azioni =====
const actions = {
  'prova-login': () => run(() => api.signIn()),
  reset: () => { api.reset(); location.reload(); },
  logout: () => run(async () => { S.sel = {}; S.data = {}; S.tab = 'book'; S.moving = null; S.done = null; await api.signOut(); }),
  'auth-mode': () => { S.authMode = S.authMode === 'login' ? 'signup' : 'login'; S.error = ''; render(); },
  google: () => run(() => api.signInGoogle()),
  tab: (v) => { S.tab = v; S.done = null; if (S.moving === 'done') S.moving = null;
    if (v === 'mine') run(loadAppts); else render(); },
  new: () => { S.done = null; S.moving = null; S.sel = { shop: S.sel.shop }; render(); },
  shop: (v) => run(() => pickShop(v)),
  barber: (v) => run(async () => { S.sel.barber = v ? S.data.barbers.find((b) => b.id === v) : null; await loadServices(); }),
  service: (v) => { S.sel.service = S.data.services[v]; S.sel.day = null; S.data.slots = null; render(); },
  day: (v) => { S.sel.day = v; S.data.slots = null; run(loadSlots); },
  slot: (v) => { S.sel.slot = S.data.slots[v]; render(); },
  back: (v) => {
    if (v === 'shop') S.sel = {};
    if (v === 'barber') { delete S.sel.barber; delete S.sel.service; }
    if (v === 'service') { delete S.sel.service; delete S.sel.day; }
    if (v === 'slot') { delete S.sel.slot; return run(loadSlots); }
    render();
  },
  confirm: () => run(async () => {
    const s = S.sel.slot;
    try {
      const a = S.moving ? await api.reschedule(S.moving.id, s.starts_at) : await api.book(s.service_id, s.starts_at);
      S.done = { ...a, starts_at: new Date(a.starts_at), service_name: S.sel.service.name, barber_name: s.barber_name, price_cents: S.moving ? S.moving.price_cents : s.price_cents };
      if (S.moving) S.moving = 'done';
      S.sel = { shop: S.sel.shop };
    } catch (e) {
      delete S.sel.slot; await loadSlots(); throw e; // orario appena preso: mostra quelli ancora liberi
    }
  }),
  cancel: (v) => {
    const a = S.data.appts.find((x) => x.id === v);
    if (!confirm(`Annullare ${a.service_name} di ${dayLong(a.starts_at)} alle ${hour(a.starts_at)}?`)) return;
    run(async () => { await api.cancel(v); await loadAppts(); });
  },
  move: (v) => run(async () => {
    const a = S.data.appts.find((x) => x.id === v);
    S.moving = a; S.tab = 'book'; S.done = null;
    S.sel = { shop: S.data.shops.find((s) => s.id === a.shop_id) };
    S.data.barbers = await api.barbers(a.shop_id);
    S.sel.barber = S.data.barbers.find((b) => b.id === a.barber_id);
    S.sel.service = (await api.serviceNames(a.shop_id, a.barber_id)).find((s) => s.name.toLowerCase() === a.service_name.toLowerCase())
      ?? { name: a.service_name };
    S.sel.day = isoDay(a.starts_at); S.data.slots = null;
    await loadSlots();
  }),
  'stop-move': () => { S.moving = null; S.sel = { shop: S.sel.shop }; S.tab = 'mine'; run(loadAppts); },
};

const forms = {
  login: (f) => run(() => api.signIn(f.email, f.password)),
  signup: (f) => run(async () => {
    const needsConfirm = await api.signUp(f.name.trim(), f.phone.trim(), f.email, f.password);
    if (needsConfirm) { S.authMode = 'login'; throw new Error('Ti abbiamo mandato un\'email: apri il link per confermare, poi accedi.'); }
  }),
  phone: (f) => run(async () => { await api.updateProfile(S.me.profile.id, { phone: f.phone.trim() }); S.me.profile.phone = f.phone.trim(); }),
};

$app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || S.busy) return;
  actions[b.dataset.act]?.(b.dataset.v);
});
$app.addEventListener('submit', (e) => {
  e.preventDefault();
  if (S.busy) return;
  forms[e.target.dataset.form]?.(Object.fromEntries(new FormData(e.target)));
});

// ogni accesso/uscita ricarica la sessione (setTimeout: Supabase non vuole chiamate dentro l'evento)
api.onAuthChange(() => setTimeout(() => run(loadSession)));
render();
run(loadSession);
