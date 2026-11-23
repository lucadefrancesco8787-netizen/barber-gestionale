# barber-gestionale

Gestionale per negozi di barbiere: sito + app installabile (PWA).

- **Cliente**: prenota (sede, barbiere o "chiunque", servizio, orario), annulla/sposta fino a 2 ore prima.
- **Barbiere**: agenda, clienti (ultima visita, da quanto non viene, ultimo trattamento, note), promemoria WhatsApp.
- **Titolare**: vede e modifica tutto nelle sue sedi.
- **Super amministratore**: crea titolari e negozi.

Tecnologia: HTML/JS semplice (nessuna build) + Supabase (login, database) + Netlify (hosting). Costo zero.

## Avvio in locale
1. Copia `.env.example` in `.env` e metti le chiavi Supabase.
2. `npx serve .` e apri `http://localhost:3000/?prova` (dati finti, niente Supabase).

## Test del database
`npm install` e poi `npm test`: provano le regole (prenotazioni, annullamenti, chi vede cosa) su un database locale.

## Da un altro computer
`git clone <url del repository>` e poi segui "Avvio in locale".
