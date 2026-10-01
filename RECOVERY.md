# FlowDesk recovery — 1 October 2026

## Diagnosis

- The production service is `teacher-planner` (`srv-d9ut8e2jobas73bnuu90`), at https://teacher-planner-qoxn.onrender.com.
- Neon reached its free monthly compute allowance. The user confirmed the quota message; Render reported P1001. A read-only check succeeded on 1 October after the monthly boundary.
- The duplicate `flowdesk` service has no DATABASE_URL. It is not the recovery target.
- Main contains a literal `\vert{}\vert{}` in JavaScript, which prevents startup.
- Its build runs a destructive schema push. Its session dependency connects without handling startup rejection and polls the database every two minutes, preventing five-minute idle suspension while the service runs.
- Recent server edits removed ownership/validation checks that exist in the known-good baseline.

## Preserved baseline

`baseline/flowdesk-live-2026-09-15` still points to `857d1033925bcbb4eec4215e9911e2d3bdc62430`. Work is on `ai/flowdesk-triage`; the baseline is not modified. The Prisma schema is unchanged.

## Changed files

- `server.js`: syntax repair; restore original timetable, seating, lesson, note, markbook and task safeguards; injectable app for tests; explicit session regeneration/save; safe outage responses; database-free liveness and manual readiness endpoints; graceful shutdown. Restore Anthropic selection, route OpenRouter keys correctly, and respect saved slide structure while retaining the newer prompts.
- `lib/session-store.js`: compatible PostgreSQL-backed sessions without startup connections or idle polling. Expiry is checked on read; cleanup runs during normal session writes at most hourly.
- `lib/database.js`: validated connection configuration and bounded connection/pool timeouts.
- `public/js/app.js`, `public/index.html`: visible sign-in errors, bounded waits, session verification, correct logout errors, service-worker updates before login.
- `public/sw.js`: new cache version and network-first app assets; API data remains uncached; preserve offline assets and local teaching data.
- `package.json`, `package-lock.json`: deterministic installation, database-free build, bcrypt 6 (removes vulnerable installer dependencies while retaining bcrypt hashes), test and read-only database-check commands.
- `render.yaml`: identify the existing production service; retain free plan and database-free health path. Existing services may require their dashboard settings to be checked separately.
- `scripts/check-syntax.js`, `scripts/check-database.js`, `test/*`, `.github/workflows/checks.yml`: checks and regression tests.
- `.gitignore`: keep dependencies, credentials and logs out of source control.
- `README.md`, `RECOVERY.md`: deployment and recovery instructions.

## Deploy the existing service

1. Review the repair PR and checks before merging. Both Render services currently auto-deploy `main`; the duplicate will remain unconfigured unless explicitly configured separately.
2. Keep the production database and existing private SESSION_SECRET. Set DATABASE_URL privately in Render to the existing Neon connection string. Never commit it. The old public fallback secret is now rejected: configure a real random secret if one is not already set. Changing it signs users out once.
3. Use build command `npm run build` and start command `npm start`. The build installs the lockfile, generates Prisma Client and checks all JavaScript. It does not connect to or change the database. Use `/api/health` for Render probes; do not continuously poll `/api/ready` or the database.
4. Merge the tested PR to `main` only with production approval. Auto-deploy starts automatically; do not trigger a second deploy.
5. Confirm the deployment is live. Check `/api/health` and, once, `/api/ready`. Sign in with the existing account, refresh, and verify classes, timetable, planbook, seating, marks and tasks. Check an ordinary save and reload. AI calls require an existing provider key and may incur provider charges; no paid AI call is part of the recovery tests.
6. Refresh the page to load the new service worker. Do not clear IndexedDB or offline teaching data.

## Database safety and free operation

No schema change is required by this repair. Never run `db push --accept-data-loss`, reset, seed, or create an empty replacement database for this recovery. Future schema changes need a backed-up database, a reviewed migration and a staging rehearsal. This repository has no migration history: do not blindly introduce `migrate deploy` against the existing database without baselining it first.

Keep Neon scale-to-zero enabled and inspect Usage for the current allowance. Removing the two-minute polling reduces idle compute consumption; it does not guarantee that all usage fits the free allowance. A quota-suspended database cannot be restored by changing frontend code. Neon retains data and resumes compute when the next allowance begins, subject to the actual project status. No upgrade or new paid resource is included.

## Rollback

Use Render's rollback to the preserved successful deployment, not a fresh build of the baseline (its build contains the unsafe schema push). No migration is applied by this repair. Keep the private SESSION_SECRET and the same database. The replacement session store uses the existing Session records and cookie format.

## Validation limits

Automated HTTP tests use an isolated database substitute and real Express session middleware/bcrypt; frontend tests exercise error handling and session confirmation. The existing Neon connectivity and authentication tables were checked read-only. A read-only Prisma schema comparison found no differences. The existing production browser session successfully opened Planbook with timetable data on 1 October. These checks do not substitute for a fresh sign-in and lesson-data save/reload after deploying the repair.
