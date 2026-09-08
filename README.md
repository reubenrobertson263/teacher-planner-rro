# FlowDesk V1 — Recovery / Go-Live Build

FlowDesk is a modular Node.js/Express + Prisma/PostgreSQL Teacher Operating System with a Vanilla JavaScript SPA frontend.

## Render deployment

Required environment variables:
- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — long random secret used by Express sessions
- `NODE_ENV=production`

Optional AI environment variables if users are not supplying their own key:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Render uses `render.yaml`, runs `npm run build`, then `npm start`.

## Recovery build notes

- Central SPA hydration is owned by `app.loadGlobalData()`.
- Router waits for hydration and a DOM paint boundary before controller initialisation.
- Arbor XLSX/JSZip processing runs in `public/js/arbor-worker.js` to keep the UI responsive.
- Arbor class strings are normalised to short codes such as `10a/En1`.
- Planbook, Timetable, Seating, Markbook, Task Notes, Name Trainer, Dashboard, AI Studio, Settings and Admin server contracts are present.
- Seating includes freeform desks/furniture, privacy dots, reseating tools, heatmap, projector timer, noise meter and random name picker.

## Go-live smoke test

After deployment, hard-refresh once and verify: login/register, Arbor import, pin a class, timetable save, Planbook day/week navigation, seating save/reseat/projector mode, Markbook grade save, Task Notes save, and AI Studio with a configured key.
