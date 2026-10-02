# Lesson Studio sprint

## What is ready

AI Studio now starts with Lesson Workshop. Import a PPTX, review the extracted text, add new information, then generate or manually edit a BCHS lesson. The existing slide generator, toolkit and marking tools remain available below it.

- Batch import PPTX files or a ZIP of up to 20 decks; each deck is limited to 25 MB and 120 slides, with a 120,000-character source limit. Text and speaker notes stay grouped by filename. Import happens in the browser; only the source text is sent to the teacher's AI provider on generation or stored in the teacher's private lesson version when saved.
- BCHS profile: Retrieve, Learning Intentions, Explicit Instruction, Green Zone and Review; adjustable 20–120 minute brief, default 60. Microsoft Teams, Support/Core/Challenge, modelling, AfL, knowledge intentions, skills, success criteria and keywords.
- Source references, lesson scope and follow-on suggestions; worksheet and separate teacher answers. Curriculum alignment remains a teacher review step, not an assertion that OCR criteria were checked online.
- Editable slide titles, bodies, phases, timings, notes and references; add, duplicate, remove and reorder; pupil preview.
- Automatic local draft, account-private saved versions, JSON backup and restore. Saved versions retain the brief, imported source text, revision conversation and selected private template. Saving a version never overwrites the previous one.
- Standard PowerPoint, or PowerPoint built from a teacher's own private template; printed worksheet/PDF and separate teacher copy/PDF. Long bodies continue onto additional slides.
- Manual copy-prompt/paste-JSON workflow for use with an existing AI chat. Import/edit/export makes no paid API call. Automatic generation uses the teacher's configured provider and its allowance; no new paid services are provisioned.

## Limits and next sprint

The source archive supplied with this task contains 10 R068 presentations (117 slides). The workspace can import that ZIP as a source set; each filename is retained in the extracted text so the teacher can adapt last year's material to a new scenario entered in the lesson brief each year. Imported text can be saved with a private lesson version for reuse. The archive and its source decks are not included in the application code.

Each teacher uploads their own cover plus five-phase PowerPoint template. The private template remains in that teacher's account and is never bundled in the application or defaulted to other accounts. Export clones its phase slide XML and retains its images, backgrounds, fonts, layouts and relationships while replacing the editable heading/content fields. Source deck visuals are used as content references; the separately uploaded template provides the visual style. Teacher notes/answers appear in the printable teacher copy; they do not appear in the pupil export.

The current importer reads PPTX text and speaker notes. Image-only content in the old source decks must be described in the new brief if it matters. Existing PPT files must be saved as PPTX. PDF and Word source import are not included yet. The AI revision chat uses the provider configured in Settings and its existing allowance; manual editing and template export do not call AI.

The R069 planning structure came from the user's Enterprise Marketing Curriculum thread. An actual BCHS/Samsara reference PPTX is still needed to implement and visually compare exact layouts. The next sprint should use one approved R067/R069 source deck and a finished exemplar as acceptance fixtures, then add retained source visuals and approved school layouts, per-slide AI edits, and multi-lesson unit generation. Do not claim visual template fidelity before that comparison.

## Changed files

- `public/js/lesson-model.js`: shared validation, lesson checks and BCHS prompts.
- `public/js/lesson-import.js`: bounded multi-PPTX/ZIP text and notes extraction.
- `public/js/lesson-template.js`: private PPTX template inspection and phase-slide export.
- `public/js/lesson-workspace.js`: editor, source import, private template, revision chat, draft/library actions and exports.
- `public/views/lesson-workspace.html`, `public/css/lesson-studio.css`: accessible, responsive workspace.
- `public/js/aistudio.js`, `public/index.html`, `public/sw.js`: integrate and cache the workspace alongside existing tools.
- `lib/lesson-studio.js`, `server.js`: authenticated, owner-scoped lesson/template storage and bounded AI requests.
- `package.json`, `package-lock.json`: real PPTX test dependencies and patched image-size override.
- `test/lesson-studio.test.js`: source import, malformed ZIP/JSON, lesson checks, privacy/versioning, editor persistence and editable export tests.

## Storage and deployment

Lesson versions use the existing `Template` table under a reserved `ai-studio:` className prefix. No schema change, `db push`, migration, reset or paid resource is needed. The current database and login repair stay in place. Account deletion/the existing admin wipe also removes templates as before.

After review, merge the PR to `main`; Render teacher-planner auto-deploys. Import the R068 source ZIP, enter the new scenario in the brief, upload the BCHS template to the teacher account, save a private version and export a PowerPoint. Review the lesson and deck before teaching. Automatic generation and revisions use the configured provider allowance; no AI call is made by import, manual editing or export.

Rollback: redeploy `753c5adb93b4d934c7cfada007667aed9999d6ed` (the login repair). Saved lesson rows remain available for re-enabling the feature. The original preserved baseline `857d1033925bcbb4eec4215e9911e2d3bdc62430` remains untouched.
