# Lesson Studio sprint

## What is ready

AI Studio now starts with Lesson Workshop. Import a PPTX, review the extracted text, add new information, then generate or manually edit a BCHS lesson. The existing slide generator, toolkit and marking tools remain available below it.

- Batch import PPTX files or a ZIP of up to 20 decks; each deck is limited to 25 MB and 120 slides, with a 120,000-character source limit. Text and speaker notes stay grouped by filename. The first 5–40 slide deck with up to 40 text boxes per slide and 120 total can also be kept locally as the visual source.
- BCHS profile: Retrieve, Learning Intentions, Explicit Instruction, Green Zone and Review; adjustable 20–120 minute brief, default 60. Microsoft Teams, Support/Core/Challenge, modelling, AfL, knowledge intentions, skills, success criteria and keywords.
- Source references, lesson scope and follow-on suggestions; worksheet and separate teacher answers. Curriculum alignment remains a teacher review step, not an assertion that OCR criteria were checked online.
- Editable slide titles, bodies, phases, timings, notes and references; add, duplicate, remove and reorder; pupil preview.
- Automatic local draft, account-private saved versions, JSON backup and restore. Saved versions retain the brief, imported source text, revision conversation and selected private template. Saving a version never overwrites the previous one.
- Three PowerPoint paths: adapt text inside the first source deck while keeping its backgrounds, images, layouts and editable text boxes; build a new deck from the teacher's private BCHS template; or export a standard deck. Printed worksheet/PDF and separate teacher copy/PDF remain available.
- Manual copy-prompt/paste-JSON workflow for use with an existing AI chat. Import/edit/export makes no paid API call. Automatic generation uses the teacher's configured provider and its allowance; no new paid services are provisioned.

## Limits and next sprint

The source archive supplied with this task contains 10 R068 presentations (117 slides). The workspace can import that ZIP as a source set; each filename is retained in the extracted text so the teacher can adapt last year's material to a new scenario entered in the lesson brief each year. The first deck in upload/archive order becomes the visual source; other decks inform content. The source PowerPoint file stays in the current browser and is not sent to the server. A saved lesson version keeps the adapted text-box content, but not the source PowerPoint bytes; re-import the original file to export its design from another browser/device.

Each teacher can upload their own cover plus five-phase PowerPoint template. That private template remains in that teacher's account and is never bundled in the application or defaulted to other accounts. Template export reuses phase slides. Source-design export updates the selected deck's editable text and existing speaker notes in place; image/media files, slide order, backgrounds and other package parts remain unchanged. Charts, tables, diagrams and text baked into images are not adapted and need a teacher check. Teacher notes/answers stay separate from pupil slides.

The importer reads PPTX text and speaker notes. During source-design export, each existing editable text box can be reviewed and edited in the lesson workspace. Images, chart/table/diagram content and text baked into images must be checked in the exported PowerPoint. Existing PPT files must be saved as PPTX. PDF and Word source import are not included yet. The AI revision chat uses the provider configured in Settings and its existing allowance; manual editing and export do not call AI.

The R069 planning structure came from the user's Enterprise Marketing Curriculum thread. The four R069 decks provide the teaching-style reference, and each teacher can upload a source deck in FlowDesk. Next improvements can compare rendered source/adapted slides against an approved exemplar, then add supported chart-data adaptation and a selector for choosing the visual source when importing a batch.

## Changed files

- `public/js/lesson-model.js`: shared validation, source-slide mapping, lesson checks and BCHS prompts.
- `public/js/lesson-import.js`: bounded multi-PPTX/ZIP text, notes and editable text-box extraction.
- `public/js/lesson-template.js`: private template export plus in-place source-deck text and notes update.
- `public/js/lesson-workspace.js`, `public/views/lesson-workspace.html`: local source deck storage, review/edit panel, revision chat and export actions.
- `public/js/sw.js`: refreshes cached workspace assets for the updated exporter.
- `lib/lesson-studio.js`: validates exact source slide and text-box counts returned by the AI.
- `test/lesson-studio.test.js`: media retention, text/notes replacement, slide-count protection and editor storage checks.

## Storage and deployment

Lesson versions use the existing `Template` table under a reserved `ai-studio:` className prefix. No schema change, `db push`, migration, reset or paid resource is needed. The current database and login repair stay in place. Account deletion/the existing admin wipe also removes templates as before.

After merging to `main`, Render teacher-planner auto-deploys. Upload the PowerPoint to adapt first, then any other reference decks. Enter the new scenario, generate the lesson, review the original text boxes and choose **Export with original slide design**. Check charts and any words inside images in PowerPoint. The binary source remains in the current browser. Automatic generation/revision uses the configured provider allowance; import, manual editing and export do not call AI.

Rollback: redeploy `753c5adb93b4d934c7cfada007667aed9999d6ed` (the login repair). Saved lesson rows remain available for re-enabling the feature. The original preserved baseline `857d1033925bcbb4eec4215e9911e2d3bdc62430` remains untouched.

