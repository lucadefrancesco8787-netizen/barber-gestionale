// Collegamento al database vero (Supabase). Stesse funzioni di fake.js.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { groupServices } from './util.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export async function session() {
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const profile = ok(await sb.from('profiles').select('*').eq('id', user.id).single());
  return { user, profile };
}
export const onAuthChange = (fn) => sb.auth.onAuthStateChange(() => fn());

export async function signIn(email, password) {
  ok(await sb.auth.signInWithPassword({ email, password }));
}
// ritorna true se serve confermare l'email prima di entrare
export async function signUp(full_name, phone, email, password) {
  const data = ok(await sb.auth.signUp({ email, password, options: { data: { full_name, phone } } }));
  return !data.session;
}
export async function signInGoogle() {
  ok(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }));
}
export async function signOut() { await sb.auth.signOut(); }

export async function updateProfile(id, fields) {
  ok(await sb.from('profiles').update(fields).eq('id', id));
}

export async function shops() {
  return ok(await sb.from('shops').select('id, name, address').order('name'));
}
export async function barbers(shopId) {
  return ok(await sb.from('barbers').select('id, display_name').eq('shop_id', shopId).eq('active', true).order('display_name'));
}
// servizi offerti in una sede (o da un barbiere), raggruppati per nome
export async function serviceNames(shopId, barberId) {
  let q = sb.from('services').select('name, duration_min, price_cents, barbers!inner(shop_id, active)')
    .eq('active', true).eq('barbers.shop_id', shopId).eq('barbers.active', true);
  if (barberId) q = q.eq('barber_id', barberId);
  return groupServices(ok(await q));
}
export async function slots(shopId, day, serviceName, barberId) {
  const rows = ok(await sb.rpc('available_slots', { p_shop: shopId, p_day: day, p_service_name: serviceName, p_barber: barberId ?? null }));
  return rows.map((r) => ({ ...r, starts_at: new Date(r.starts_at) }));
}
export async function book(serviceId, startsAt) {
  return ok(await sb.rpc('book', { p_service: serviceId, p_start: startsAt.toISOString() }));
}
export async function myAppointments() {
  const rows = ok(await sb.from('appointments')
    .select('id, shop_id, barber_id, service_name, price_cents, starts_at, ends_at, status, barbers(display_name, cancel_limit_hours), shops(name, address)')
    .order('starts_at', { ascending: false }));
  return rows.map((r) => ({
    ...r, starts_at: new Date(r.starts_at), ends_at: new Date(r.ends_at),
    barber_name: r.barbers?.display_name, cancel_limit_hours: r.barbers?.cancel_limit_hours,
    shop_name: r.shops?.name, shop_address: r.shops?.address,
  }));
}
export async function cancel(id) { return ok(await sb.rpc('cancel_appointment', { p_id: id })); }
export async function reschedule(id, startsAt) {
  return ok(await sb.rpc('reschedule_appointment', { p_id: id, p_start: startsAt.toISOString() }));
}
