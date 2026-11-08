# Locked RRO / BCHS teaching and presentation style

**Source of truth:** approved teacher uploads:
- `R068_Task2_Customer_Profile_BCHS_RRO_Style(1).pptx`
- `BCHS_R068_Task1_ALL_5_RRO_FORMAT_FINAL_V3(1).zip`
- `RRO_BCHS_LOCKED_PRESENTATION_STYLE.txt`

## Non-negotiable
- Comic Sans MS, readable large text, **no white card / box grid layouts**.
- BCHS five phases in order: **Retrieve → Learning Intentions → Explicit Instruction → Green Zone → Review**.
- Start directly with **4-minute independent retrieval** (no cover slide) plus stretch.
- Five differentiated phase colours; orange top-right **KEYWORDS** banner; teal left strip.
- Relevant emojis, graphics and visual examples; generously spaced, not stock decoration.
- Meaningful cognitive sequence: I DO → WE DO → hinge check → substantial 25–30-minute independent application, then Review.
- Provide conceptual intentions, skills, progressive success criteria, misconceptions, EAL/SEND access routes and strong stretch. Never confuse high attainment with writing more.
- **Green pen only in Green Zone**, purple for pupils' reflection, red for teacher feedback.
- Microsoft Teams, Word and PowerPoint rather than Google Classroom.
- Teacher answers in presenter notes; pupils work independently under the correct official NEA rules.
- Treat web trends or TikTok examples as potentially out-of-date. Do not fabricate metrics or claims. Use genuine source material or fictional practice examples.

## How FlowDesk applies this
The **Lesson Workshop** prompt in `public/js/lesson-model.js` and both slide/lesson generation endpoints enforce these requirements. The **RRO-style PowerPoint export** and quick **AI Studio Slide Deck Generator** both call `public/js/bchs-art.js`, which makes an independent choice between editable comparison, process, research, audience, data and other vector graphics.

The built-in vector renderer recreates the design language, but **cannot reproduce the actual Blackburn Central High School logo pixel for pixel**: for that, upload the approved school PowerPoint to **Lesson Workshop → Your private school PowerPoint template** and use **Export using my BCHS template**. The exact background artwork stays in that account-scoped private PPTX. Template export begins directly on Retrieve, even though a six-slide source template contains a cover for its internal phase map. The teacher copy / answer notes should be printed separately from Lesson Workshop; the autonomous RRO-style export includes notes in its PPTX.

Original-design export preserves source shapes and imagery, rather than replacing them with auto-vector graphics. Do not promise generated photos: the autonomous renderer makes editable PowerPoint visuals, not external-image AI generations.

Review slides and brand examples before teaching. New live NEA scenarios may only be issued for the valid moderation series. No completed live-NEA exemplars should be presented as a teaching resource.

## Graphics capability
Available kinds: `none`, `concept`, `compare`, `process`, `timeline`, `data`, `decision`, `research`, `audience`, `checklist`. Model suggests one per slide from the lesson context; renderer derives a fallback when missing. Diagrams use editable native PowerPoint shapes rather than downloaded images. The `data` type makes numerical bars **only when a model-supplied dataset is present**.

Teacher remains responsible for reviewing output and copyright/safeguarding compliance.
