# Lesson Studio sprint

## What is ready

AI Studio now starts with Lesson Workshop. Import a PPTX, review the extracted text, add new information, then generate or manually edit a BCHS lesson. The existing slide generator, toolkit and marking tools remain available below it.

- PPTX text and speaker notes, in presentation order; up to 25 MB, 120 source slides and 60,000 source characters. ZIP expansion and XML reads have limits. No original files are uploaded: only the reviewed text is sent when the teacher chooses AI generation or saves a cloud version.
- BCHS profile: Retrieve, Learning Intentions, Explicit Instruction, Green Zone and Review; adjustable 20–120 minute brief, default 60. Microsoft Teams, Support/Core/Challenge, modelling, AfL, knowledge intentions, skills, success criteria and keywords.
- Source references, lesson scope and follow-on suggestions; worksheet and separate teacher answers. Curriculum alignment remains a teacher review step, not an assertion that OCR criteria were checked online.
- Editable slide titles, bodies, phases, timings, notes and references; add, duplicate, remove and reorder; pupil preview.
- Automatic local draft, account-private saved versions, JSON backup and restore. Saving a version never overwrites the previous one.
- Editable PowerPoint, printed worksheet/PDF and separate teacher copy/PDF. Custom background from Settings remains supported. Long bodies continue onto additional slides.
- Manual copy-prompt/paste-JSON workflow for use with an existing AI chat. Import/edit/export makes no paid API call. Automatic generation uses the teacher's configured provider and its allowance; no new paid services are provisioned.

## Limits and next sprint

This is a source-to-lesson workflow, not a claim of full Chalkie parity. Import does not reproduce original images, charts, diagrams, animations or slide masters. Image-only slides need descriptions. Existing PPT files must be saved as PPTX. PDF and Word source import are not included yet.

The R069 planning structure came from the user's Enterprise Marketing Curriculum thread. An actual BCHS/Samsara reference PPTX is still needed to implement and visually compare exact layouts. The next sprint should use one approved R067/R069 source deck and a finished exemplar as acceptance fixtures, then add retained source visuals and approved school layouts, per-slide AI edits, and multi-lesson unit generation. Do not claim visual template fidelity before that comparison.

## Changed files

- `public/js/lesson-model.js`: shared validation, lesson checks and BCHS prompts.
- `public/js/lesson-import.js`: bounded PPTX text/notes extraction.
- `public/js/lesson-workspace.js`: editor, draft/library actions and exports.
- `public/views/lesson-workspace.html`, `public/css/lesson-studio.css`: accessible, responsive workspace.
- `public/js/aistudio.js`, `public/index.html`, `public/sw.js`: integrate and cache the workspace alongside existing tools.
- `lib/lesson-studio.js`, `server.js`: authenticated, owner-scoped library and bounded AI requests.
- `package.json`, `package-lock.json`: real PPTX test dependencies and patched image-size override.
- `test/lesson-studio.test.js`: source import, malformed ZIP/JSON, lesson checks, privacy/versioning, editor persistence and editable export tests.

## Storage and deployment

Lesson versions use the existing `Template` table under a reserved `ai-studio:` className prefix. No schema change, `db push`, migration, reset or paid resource is needed. The current database and login repair stay in place. Account deletion/the existing admin wipe also removes templates as before.

After review, merge the PR to `main`; Render teacher-planner auto-deploys. Wait for the live deployment, open AI Studio, create a manual lesson, save a version, reopen it and export PowerPoint. Use one real source deck to review content quality before teaching. AI calls were mocked in automated checks to avoid spending the user's allowance; real provider output quality still needs this acceptance run.

Rollback: redeploy `753c5adb93b4d934c7cfada007667aed9999d6ed` (the login repair). Saved lesson rows remain available for re-enabling the feature. The original preserved baseline `857d1033925bcbb4eec4215e9911e2d3bdc62430` remains untouched.
