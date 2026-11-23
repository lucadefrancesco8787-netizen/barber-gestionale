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

Stato: passo 1 fatto (repository + struttura). Prossimo: passo 2, migrazione 001.
Repository: https://github.com/lucadefrancesco8787-netizen/barber-gestionale
