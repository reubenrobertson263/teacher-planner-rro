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

Render runs `npm run build`, then `npm start`. The build installs the lockfile, generates Prisma Client and checks JavaScript without modifying the database. Use `/api/health` for liveness; `/api/ready` is a manual database diagnostic and must not be continuously polled on the free plan.

Run `npm test` for recovery regression tests and `npm run db:check` for a read-only database check. A private `SESSION_SECRET` is required; the old public fallback is rejected.

See [RECOVERY.md](RECOVERY.md) for the preserved baseline, changed files, free-plan diagnosis, deployment steps and rollback instructions. This repair makes no schema changes. Future migrations must be reviewed and baselined against the existing database before use.

## Recovery build notes

- Central SPA hydration is owned by `app.loadGlobalData()`.
- Router waits for hydration and a DOM paint boundary before controller initialisation.
- Arbor XLSX/JSZip processing runs in `public/js/arbor-worker.js` to keep the UI responsive.
- Arbor class strings are normalised to short codes such as `10a/En1`.
- Planbook, Timetable, Seating, Markbook, Task Notes, Name Trainer, Dashboard, AI Studio, Settings and Admin server contracts are present.
- Seating includes freeform desks/furniture, privacy dots, reseating tools, heatmap, projector timer, noise meter and random name picker.

## Go-live smoke test

After deployment, hard-refresh once and verify: login/register, Arbor import, pin a class, timetable save, Planbook day/week navigation, seating save/reseat/projector mode, Markbook grade save, Task Notes save, and AI Studio with a configured key.
