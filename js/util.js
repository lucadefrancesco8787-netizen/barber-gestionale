import { TIMEZONE } from './config.js';

// testo sicuro da mettere nell'HTML
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const euro = (cents) => (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
export const priceRange = (s) => (s.min_price === s.max_price ? euro(s.min_price) : `da ${euro(s.min_price)}`);

const fmt = (opts) => new Intl.DateTimeFormat('it-IT', { timeZone: TIMEZONE, ...opts });
export const hour = (d) => fmt({ hour: '2-digit', minute: '2-digit' }).format(d);
export const dayLong = (d) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d);
export const dayShort = (d) => fmt({ weekday: 'short', day: 'numeric' }).format(d);
// giorno come 'YYYY-MM-DD' nel fuso del negozio
export const isoDay = (d) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('/').reverse().join('-');

// stesso nome = stesso servizio, anche fra barbieri diversi (per "chiunque")
export function groupServices(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.name.toLowerCase();
    const g = by.get(k) ?? { name: r.name, duration_min: r.duration_min, min_price: r.price_cents, max_price: r.price_cents };
    g.min_price = Math.min(g.min_price, r.price_cents);
    g.max_price = Math.max(g.max_price, r.price_cents);
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}
