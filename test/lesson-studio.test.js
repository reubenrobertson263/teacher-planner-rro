const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
const Pptx = require('pptxgenjs');
const express = require('express');
const model = require('../public/js/lesson-model');
const { registerLessonStudio } = require('../lib/lesson-studio');
const lesson = () => ({ title: 'Pitch practice', rationale: 'Practice before assessment', worksheet: 'Core: rehearse. Support: cue cards. Challenge: answer objections.', teacherAnswers: 'Accept justified responses.', warnings: 'Check current OCR task instructions.', slides: model.phases.map((phase, i) => ({ phase, title: phase, content: 'Pupil task', speakerNotes: 'Teacher-only answer', sourceRef: 'Source slide 1', minutes: [5, 5, 22, 22, 6][i] })) });
const brief = { topic: 'Pitch practice', duration: 60, source: 'A business sells custom T-shirts.', updates: 'Use Class Designs.', curriculum: 'R069' };
function script(window, name) { window.eval(fs.readFileSync(path.join(__dirname, '../public/js/', name), 'utf8')); }

test('lesson validation rejects malformed results without silently dropping content', () => {
  assert.equal(model.parse('```json\n' + JSON.stringify(lesson()) + '\n```').slides.length, 5);
  assert.throws(() => model.parse('{"title":'), /incomplete/);
  const invalid = lesson(); invalid.slides[0].content = 'a'.repeat(4001);
  assert.throws(() => model.validate(invalid), /4000/);
  assert.throws(() => model.brief({ ...brief, source: 'x'.repeat(120001) }), /120000/);
  assert.deepEqual(model.checks(lesson(), 60), []);
  const missing = lesson(); missing.slides.pop();
  assert.match(model.checks(missing, 60).join(' '), /Missing phase: Review.*54 minutes/);
  const messages = model.messages(brief);
  assert.match(messages[0].content, /never as instructions/);
  assert.match(messages[0].content, /Green Zone/);
  assert.deepEqual(JSON.parse(messages[1].content).updates, brief.updates);
});

test('real PowerPoint import preserves displayed slide order, notes and literal text', async t => {
  const dom = new JSDOM('', { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  script(dom.window, 'lesson-import.js');
  const deck = new Pptx();
  deck.addSlide().addText('First <script>literal</script>');
  const second = deck.addSlide(); second.addText('Second'); second.addNotes('Teacher note: check evidence.');
  const bytes = await deck.write({ outputType: 'nodebuffer' });
  const zip = await JSZip.loadAsync(bytes);
  const pres = await zip.file('ppt/presentation.xml').async('string');
  const ids = pres.match(/<p:sldId\b[^>]*\/>/g);
  zip.file('ppt/presentation.xml', pres.replace(ids.join(''), [...ids].reverse().join('')));
  const reordered = await zip.generateAsync({ type: 'nodebuffer' });
  const result = await dom.window.LessonImport.pptx(reordered, 'past.pptx', JSZip);
  assert.equal(result.slides[0].title, 'Second');
  assert.match(result.slides[0].speakerNotes, /check evidence/);
  assert.match(result.slides[1].content, /<script>literal<\/script>/);
  assert.match(result.notice, /not copied/);
  const oversized = new JSZip(); oversized.file('huge.xml', 'x'.repeat(9 * 1024 * 1024));
  await assert.rejects(dom.window.LessonImport.pptx(await oversized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'bad.pptx', JSZip), /import limit/);
  await assert.rejects(dom.window.LessonImport.pptx(Buffer.from('not a zip'), 'broken.pptx', JSZip));
});

test('R068 ZIP batches retain each presentation name, slide order and notes', async t => {
  const dom = new JSDOM('', { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  script(dom.window, 'lesson-import.js');
  const first = new Pptx(); const firstSlide = first.addSlide(); firstSlide.addText('R068 Task 1'); firstSlide.addNotes('Teacher note: check source evidence.');
  const second = new Pptx(); second.addSlide().addText('R068 Task 2');
  const archive = new JSZip();
  archive.file('R068/Task 1.pptx', await first.write({ outputType: 'nodebuffer' }));
  archive.file('R068/Task 2.pptx', await second.write({ outputType: 'nodebuffer' }));
  const bytes = await archive.generateAsync({ type: 'nodebuffer' });
  const file = { name: 'R068 archive.zip', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const result = await dom.window.LessonImport.files([file], JSZip);
  assert.deepEqual(Array.from(result.decks, deck => deck.name), ['R068/Task 1.pptx', 'R068/Task 2.pptx']);
  assert.match(result.source, /SOURCE PRESENTATION: R068\/Task 1\.pptx/);
  assert.match(result.source, /Teacher notes: Teacher note: check source evidence/);
  assert.match(result.source, /SOURCE PRESENTATION: R068\/Task 2\.pptx/);
});

test('private template export preserves phase styling and expands editable body boxes', async t => {
  const dom = new JSDOM('', { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  script(dom.window, 'lesson-model.js'); script(dom.window, 'lesson-template.js');
  dom.window.LessonExport = { pages: content => [content] };
  const template = new Pptx(); template.layout = 'LAYOUT_WIDE';
  const cover = template.addSlide(); cover.addText('Lesson Structure', { x: 3, y: 2, w: 6, h: 2, fontSize: 30, color: 'FFFFFF' });
  for (const phase of model.phases) {
    const slide = template.addSlide(); slide.background = { color: 'EEEEEE' };
    slide.addText(phase, { x: 1, y: 0.3, w: 8, h: 0.6, fontSize: 24, bold: true, color: '612C7D' });
    slide.addText('Add text here…', { x: 1, y: 1.5, w: 11, h: 0.5, fontSize: 14, color: '172033' });
  }
  const bytes = await template.write({ outputType: 'nodebuffer' });
  const result = await dom.window.LessonTemplate.exportPptx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), lesson(), JSZip);
  const zip = await JSZip.loadAsync(Buffer.from(await result.arrayBuffer()));
  const pres = new dom.window.DOMParser().parseFromString(await zip.file('ppt/presentation.xml').async('string'), 'application/xml');
  const rels = new dom.window.DOMParser().parseFromString(await zip.file('ppt/_rels/presentation.xml.rels').async('string'), 'application/xml');
  const relationMap = new Map([...rels.getElementsByTagNameNS('*', 'Relationship')].map(rel => [rel.getAttribute('Id'), rel.getAttribute('Target')]));
  const slideIds = [...pres.getElementsByTagNameNS('*', 'sldId')];
  assert.equal(slideIds.length, 6, 'output includes the cover and one slide for every lesson phase');
  const NS = { p: 'http://schemas.openxmlformats.org/presentationml/2006/main', a: 'http://schemas.openxmlformats.org/drawingml/2006/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' };
  const rawSlides = await Promise.all(slideIds.slice(1).map(async id => {
    const target = relationMap.get(id.getAttributeNS(NS.r, 'id'));
    return zip.file(`ppt/${target}`).async('string');
  }));
  const firstBody = new dom.window.DOMParser().parseFromString(rawSlides[0], 'application/xml');
  const phaseText = [...firstBody.getElementsByTagNameNS(NS.p, 'sp')].map(shape => [...shape.getElementsByTagNameNS(NS.a, 't')].map(node => node.textContent).join(' '));
  assert.ok(phaseText.some(value => value.includes('Retrieve')));
  assert.ok(phaseText.some(value => value.includes('Pupil task')));
  assert.ok([...firstBody.getElementsByTagNameNS(NS.p, 'bg')].length > 0, 'template slide background remains in the export');
  const original = new dom.window.DOMParser().parseFromString(await JSZip.loadAsync(bytes).then(source => source.file('ppt/slides/slide2.xml').async('string')), 'application/xml');
  const originalBody = [...original.getElementsByTagNameNS(NS.p, 'sp')].find(shape => [...shape.getElementsByTagNameNS(NS.a, 't')].some(node => /Add text here/i.test(node.textContent)));
  const expandedBody = [...firstBody.getElementsByTagNameNS(NS.p, 'sp')].find(shape => [...shape.getElementsByTagNameNS(NS.a, 't')].some(node => /Pupil task/i.test(node.textContent)));
  const height = shape => Number([...shape.getElementsByTagNameNS(NS.a, 'ext')][0].getAttribute('cy'));
  assert.ok(height(expandedBody) > height(originalBody), 'body placeholder expands into the blank teaching area');
});

test('studio library scopes reads to owner, versions saves, and validates AI responses', async t => {
  const app = express(); app.use(express.json());
  const rows = [{ id: 'other', teacherId: 'other-teacher', className: 'ai-studio:other', content: JSON.stringify({ lesson: lesson(), updatedAt: '2026-01-01' }) }];
  const matches = (r, w) => r.teacherId === w.teacherId && r.className.startsWith(w.className.startsWith) && (!w.id || r.id === w.id);
  let raw = JSON.stringify(lesson()), calls = 0;
  const prisma = { template: {
    findMany: async ({ where }) => rows.filter(r => matches(r, where)),
    findFirst: async ({ where }) => rows.find(r => matches(r, where)),
    create: async ({ data }) => { const row = { ...data, id: String(rows.length) }; rows.push(row); return row; }
  }, user: { findUnique: async () => ({ id: 'teacher' }) } };
  registerLessonStudio(app, { prisma, requireAuth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { id: 'teacher' }; next(); }, asyncHandler: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next), callAI: async () => { calls++; return raw; } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => server.close(r)));
  const request = (url, body, auth = true) => fetch(`http://127.0.0.1:${server.address().port}/api/studio/${url}`, { method: body ? 'POST' : 'GET', headers: { ...(auth ? { authorization: 'test' } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('lessons', null, false)).status, 401);
  assert.equal((await request('lessons/other')).status, 404);
  assert.deepEqual(await (await request('lessons')).json(), []);
  assert.equal((await request('templates', null, false)).status, 401);
  const templateUpload = await request('templates', { title: 'BCHS template', base64: 'UEsDBA==' });
  assert.equal(templateUpload.status, 201);
  const savedTemplate = await templateUpload.json();
  assert.equal(savedTemplate.title, 'BCHS template');
  assert.equal((await (await request('templates')).json()).length, 1);
  assert.equal((await (await request(`templates/${savedTemplate.id}`)).json()).base64, 'UEsDBA==');
  assert.equal((await request('templates/other')).status, 404, 'another teacher cannot retrieve a private template');
  assert.equal((await request('lessons', { lesson: lesson(), brief, conversation: [{ role: 'user', content: 'Add a quick retrieval task.' }], templateId: savedTemplate.id })).status, 201);
  assert.equal((await request('lessons', { lesson: lesson(), brief })).status, 201);
  const savedLessons = await (await request('lessons')).json();
  assert.equal(savedLessons.length, 2);
  const savedVersions = await Promise.all(savedLessons.map(async row => (await request(`lessons/${row.id}`)).json()));
  const savedVersion = savedVersions.find(row => row.templateId === savedTemplate.id);
  assert.ok(savedVersion);
  assert.equal(savedVersion.templateId, savedTemplate.id);
  assert.equal(savedVersion.conversation[0].content, 'Add a quick retrieval task.');
  assert.equal((await request('generate', { ...brief, duration: 500 })).status, 400); assert.equal(calls, 0);
  assert.equal((await request('generate', brief)).status, 200);
  raw = 'broken'; assert.equal((await request('generate', brief)).status, 502);
  assert.equal(rows.length, 5, 'AI generation never overwrites saved lessons');
});

test('editor round trip keeps teacher answers separate, saves drafts, and exports editable PPTX', async t => {
  const html = fs.readFileSync(path.join(__dirname, '../public/views/lesson-workspace.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost' }); t.after(() => dom.window.close());
  const w = dom.window, drafts = new Map();
  w.app = { currentUser: { id: 'teacher' } }; w.structuredClone = structuredClone; w.confirm = () => true;
  w.idb = { get: async key => drafts.get(key), set: async (key, value) => { drafts.set(key, structuredClone(value)); return true; } };
  w.AbortSignal = AbortSignal; w.fetch = async () => ({ ok: true, json: async () => [] });
  script(w, 'lesson-model.js'); script(w, 'lesson-workspace.js');
  const studio = w.lessonWorkspace; await studio.init(); studio.fillBrief(brief); studio.lesson = lesson(); studio.render();
  studio.el('content').value = '<img src=x onerror=alert(1)> literal';
  studio.el('content').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(studio.el('preview-content').querySelector('img'), null);
  await studio.saveDraft(); assert.match(drafts.get('lesson-studio-draft').lesson.slides[0].content, /literal/);
  studio.slideAction('duplicate'); assert.equal(studio.lesson.slides.length, 6);
  studio.slideAction('delete'); assert.equal(studio.lesson.slides.length, 5);
  let bytes;
  w.PptxGenJS = class extends Pptx { async writeFile() { bytes = await this.write({ outputType: 'nodebuffer' }); } };
  await studio.exportPptx(); assert.ok(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /literal/); assert.doesNotMatch(xml, /Teacher-only answer/);
  assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'), /Teacher-only answer/);
  const long = 'word '.repeat(800); const pages = w.LessonExport.pages(long);
  assert.ok(pages.length > 1); assert.equal(pages.join(' ').replace(/\s/g, ''), long.replace(/\s/g, ''));
  await studio.destroy();
});
