# FlowDesk PA prototype

The Task Notes page includes an account-scoped PA desk backed by existing KanbanTask rows. Enter one task per line, or scan a planner photo and review the transcription (including detected ticks) before adding. The application sends photos and tasks to the configured AI provider. Verify school approval for that data and provider before use. AI output is a draft for the teacher to review and never a record of sending.

For testing, log in on two devices with the same account, add a task on one device, and refresh on the other. With an existing configured AI key and an image-capable model, test transcription, then add a non-sensitive task and verify the result after processing. The email control opens the device's email app for manual addressing and sending. Speech recognition depends on browser support.

Processing starts in the web-server process and is not a durable queue. A restart or free-tier suspension can interrupt it; the user can retry a task after five minutes. Never interpret a draft as sent. There is no Outlook integration, automatic email, scheduling or reminders. No database migrations are included. Verify the existing `KanbanTask.notes` column and production version before deployment; keep a known-good rollback. Existing notes remain accessible separately.

This is a prototype. Photo transcription requires an image-capable configured provider/model and network access. API use is billed separately from ChatGPT. The current tests use mocks and do not establish that the live service, credentials, school network, or AI provider work. Check storage, access policy and live data classification before entering identifiable pupil information.
