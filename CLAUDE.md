# barber-gestionale — note per Claude

L'utente è un principiante: spiega in modo semplice, senza termini tecnici. Rispondi in italiano.

Piano approvato: `C:\Users\lucad\.claude\plans\temporal-rolling-hamster-of-7adefc0e-ae9b-48b7-bcbd-8cd4d9135c64.md`. Riassunto:
- PWA statica (JS semplice, nessuna build) + Supabase (login email/Google, Postgres, RLS) + Netlify. Costo zero.
- Ruoli: superadmin (l'utente) → owner (titolare, più sedi) → barber → client. I titolari sono isolati tra loro.
- Ogni barbiere decide i suoi servizi, prezzi, durate e orari. Il titolare può modificare tutto.
- Il cliente prenota sede → barbiere o "chiunque" → servizio → orario; può annullare/spostare fino a 2 ore prima (limite per barbiere). Si paga in negozio.
- Il barbiere inserisce a mano anche i clienti senza app. Scheda cliente: ultima visita, giorni passati, ultimo trattamento, storico, note.
- Orari: settimana fissa con pause + ferie/ore bloccate.
- Promemoria del giorno prima: per ora un pulsante che apre WhatsApp (wa.me) col testo pronto. Il WhatsApp automatico arriva dopo (`appointments.reminder_sent_at`).
- Sovrapposizioni impedite nel database (exclusion constraint btree_gist). Le regole stanno nelle RPC lato server.

Stato: passo 2 fatto. `supabase/migrations/001_schema.sql` (tabelle, RLS, RPC book/staff_book/cancel/reschedule/available_slots, vista customer_stats) è testata in locale con PGlite: `npm test` (tests/db.test.mjs, tests/supabase-stub.sql imita auth.uid()/ruoli di Supabase). Non è ancora su Supabase.
Passo 3 fatto: app del cliente (login email/Google, telefono obbligatorio, prenotazione sede → barbiere/chiunque → servizio → giorno/orario → conferma, i miei appuntamenti, sposta, annulla).
File: `index.html`, `styles.css`, `js/app.js` (schermate + azioni), `js/api.js` (Supabase), `js/fake.js` (modalità prova, stesse funzioni, dati in localStorage), `js/util.js`, `js/config.js` (chiavi pubbliche Supabase; se sono vuote parte la modalità prova).
Prova in locale: `python -m http.server 8790` → http://127.0.0.1:8790/?prova. Il test end-to-end usa Chrome headless via CDP (lo script era nello scratchpad della sessione, non nel repository).
Prossimo: passo 4, schermate del barbiere (agenda, appuntamento a mano, clienti, scheda, promemoria WhatsApp).
Attenzione RLS: customers e appointments si leggono a vicenda solo tramite le funzioni security definer is_my_customer / served_by_me (altrimenti si ha una ricorsione infinita).
Repository: https://github.com/lucadefrancesco8787-netizen/barber-gestionale
