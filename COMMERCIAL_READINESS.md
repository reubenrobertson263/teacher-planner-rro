# FlowDesk commercial readiness audit

Date: 21 October 2026. Baseline: main 6689fc77b630f4e8a47d6cf24a9099f177e0c886.

## Decision

Suitable for a controlled pilot after the reliability fixes and acceptance checks. Not yet ready for an unrestricted paid school launch. This audit is a source review, automated regression run, limited live HTTP checks, and inspection of available Render metrics. It is not a penetration test, full accessibility assessment, load test, or compliance certification.

## Measured evidence

- Render returned two memory samples on 20 October: about 113-124 MiB against a 512 MiB limit (22-24%). These samples do not establish peak usage or capacity.
- The requested CPU, HTTP request count and p95 latency series returned no data. User adoption, conversion, retention, failure rates and sustained response-time targets cannot currently be established.
- No error-labelled logs were returned for the requested 14-21 October window. This does not prove absence of application errors.
- One sequential public HTTP sample: health 817 ms; database readiness 3354 ms; home 302 ms; Hub 338 ms; Name Trainer 611 ms. All returned 200. Network and service/database wakeup may contribute. These are individual observations, not p95 or load-test results.
- The public login screen rendered in the browser. No authenticated browser session was available for a full teacher journey.
- Both teacher-planner and flowdesk auto-deploy from main. Browser-local data is separate for their different origins. Select one canonical service before launch; do not delete the duplicate without confirming its users and data.

## Fixes in this release

- Calendar preferences now use the calendar endpoint, report server failures, and update local state only after success. Empty holidays remain empty; the server rejects impossible dates.
- Offline queue append and completion removal use atomic IndexedDB updates. New edits are retained during a flush; failed requests stop subsequent queued edits overtaking them. Browsers supporting Web Locks coordinate flushes across tabs. A server failure queues a request only once.
- Room names are escaped before inserting them into settings HTML.
- Login and registration have bounded, per-process throttling and smaller request bodies. Cross-origin browser writes are rejected. Security headers protect framing and content interpretation.
- Administrator-only /api/admin/metrics provides request counts, errors and approximate duration buckets without recording request bodies, pupil names, identifiers or query strings. Metrics reset on restart and exclude browser/network time; this is a foundation, not persistent analytics.
- The dashboard labels its existing AI request counter as requests rather than invented hours saved.
- Service-worker cache version is advanced for the changed client files. No features or database records are removed; no schema migration or paid service is required.

## Remaining launch gates, in priority order

### Sprint 1: school access and data protection

Implement school tenancy, invitations and staff roles, verified email/password recovery, explicit administrator provisioning and step-up checks for destructive administration. Existing ownership checks are useful but are not a complete school permissions system. Encrypt stored AI credentials with managed key rotation. Replace broad pre-authentication body allowances with route-specific limits. Review every rich-text and import boundary and expand access-isolation tests.

Document which data stays in a browser, which reaches the server and which goes to an AI provider. Add account export/deletion, retention controls, privacy information and the appropriate school/provider agreements and approvals. Keeping use private is not a substitute for these controls. Establish backup ownership, recovery objectives and a tested restore procedure before relying on pupil records.

Acceptance: separate schools cannot access each other's data; staff can recover access; leaving staff can be revoked; a backup is restored to an isolated environment successfully.

### Sprint 2: reliable storage and efficient loading

Add server-side idempotency and version conflict handling for offline edits, visible failed-queue recovery, and tests covering account switches and multiple tabs. The current fix does not resolve every older offline edit versus newer online edit conflict. Sync browser-only Hub/Trainer data where the product promises cross-device use, while preserving local-only mode. The shared all-staff roster is not implemented by the standalone local importer.

Measure page-level payloads and timings on school devices, then lazy-load presentation/spreadsheet libraries, load only data needed by each screen, paginate large records and add compression. Current startup loads several datasets, including class/student data. Do not increase hosting spend before measuring the bottleneck.

Acceptance: defined small/large school datasets, no lost or duplicate edits, clear recovery after outages, and recorded mobile/desktop performance budgets.

### Sprint 3: finish and validate the teaching workflows

Lesson Workshop needs visual comparison tests using representative decks: images, layouts, five reusable phase backgrounds, repeated phases, notes, overflow and exported PowerPoint fidelity. Source-design preservation does not guarantee AI adaptation of every picture or diagram. Verify multi-deck adaptation explicitly before promising it.

Complete the marking workspace, evidence-linked suggestions, teacher approval, annotations and URS workflow. Teams import/return without Azure remains an integration design task, not a delivered capability. Agree a school-approved data route before implementation.

Validate Planbook weekly readability on laptop/tablet and browser zoom, keyboard navigation, screen-reader labels and touch targets. A visual redesign alone cannot establish accessibility.

Acceptance: a teacher completes planning, adaptation/export and approved marking journeys end to end with representative fixtures; no unsupported functionality is advertised.

### Sprint 4: operations and commercial launch

Add persistent privacy-conscious operational measurements, alerting, external health checks, deployment identification, staging and rollback/restore drills. The current rate limiter and metrics are per-process and need shared infrastructure before horizontal scaling.

Render describes free instances as unsuitable for production applications: they sleep after inactivity and have workspace allowances. Keep the current free setup for the pilot; choose an always-on hosting/database budget before promising school availability. No upgrade is authorised or performed by this audit. Source: https://render.com/docs/free

Add onboarding, pricing/entitlements, billing/cancellation if charging, support and incident procedures, product terms, a canonical domain and a clear feature list. Run a limited staff pilot and resolve observed blockers before opening sales.

Acceptance: tested recovery and rollback, an agreed uptime/support target, measured pilot completion rates, and a clear data-handling and commercial offer.

## Validation and deployment

Local syntax checks, Prisma client generation and 35 automated tests pass, including calendar failure handling, queue concurrency/order, throttling, origin rejection, metric redaction and administrator authorization. Local dependencies were installed with pnpm because npm was unavailable; its generated lockfile is intentionally excluded. GitHub CI must validate the canonical npm lock with build, tests and the production dependency audit before merge.

Merge the reviewed branch only after CI succeeds. Existing Render auto-deploy handles the release. Verify both service deployment results, /api/health, /api/ready, security headers, unauthenticated metrics rejection and the updated service worker. Then verify a real teacher's calendar save/reload and offline edit/reconnect in a controlled session. Retain the known-good baseline 857d1033925bcbb4eec4215e9911e2d3bdc62430.

No new telemetry service receives pupil data. No high-volume load was sent to production. No database migration, wipe or paid upgrade was performed.
