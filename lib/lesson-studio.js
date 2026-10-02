const { randomUUID } = require('node:crypto');
const model = require('../public/js/lesson-model');
const PREFIX = 'ai-studio:';

function registerLessonStudio(app, { prisma, requireAuth, asyncHandler, callAI }) {
  const valid = (fn, res) => {
    try { return fn(); } catch (error) { res.status(400).json({ error: { message: error.message } }); return null; }
  };
  // Existing Template storage keeps deployment free of schema changes.
  app.get('/api/studio/lessons', requireAuth, asyncHandler(async (req, res) => {
    const rows = await prisma.template.findMany({ where: { teacherId: req.user.id, className: { startsWith: PREFIX } }, select: { id: true, content: true } });
    const items = rows.flatMap(row => {
      try { const data = JSON.parse(row.content); return [{ id: row.id, title: data.lesson.title, updatedAt: data.updatedAt }]; } catch { return []; }
    });
    res.json(items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }));
  app.get('/api/studio/lessons/:id', requireAuth, asyncHandler(async (req, res) => {
    const row = await prisma.template.findFirst({ where: { id: req.params.id, teacherId: req.user.id, className: { startsWith: PREFIX } } });
    if (!row) return res.status(404).json({ error: { message: 'Lesson not found.' } });
    res.json({ id: row.id, ...JSON.parse(row.content) });
  }));
  app.post('/api/studio/lessons', requireAuth, asyncHandler(async (req, res) => {
    const data = valid(() => ({ lesson: model.validate(req.body.lesson), brief: model.brief(req.body.brief), updatedAt: new Date().toISOString() }), res);
    if (!data) return;
    const row = await prisma.template.create({ data: { teacherId: req.user.id, className: PREFIX + randomUUID(), content: JSON.stringify(data) } });
    res.status(201).json({ id: row.id, updatedAt: data.updatedAt });
  }));
  // Saves create a version; the teacher's previous lesson is never overwritten by AI.
  const pending = new Set();
  app.post('/api/studio/generate', requireAuth, asyncHandler(async (req, res) => {
    const brief = valid(() => model.brief(req.body), res);
    if (!brief) return;
    if (pending.has(req.user.id)) return res.status(429).json({ error: { message: 'Your lesson is still generating. Please wait.' } });
    pending.add(req.user.id);
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      const raw = await callAI(user, model.messages(brief), { maxTokens: 12000 });
      let lesson;
      try { lesson = model.parse(raw); } catch (error) { return res.status(502).json({ error: { message: error.message } }); }
      res.json({ lesson, checks: model.checks(lesson, brief.duration) });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: { message: error.message } });
      res.status(502).json({ error: { message: 'Your AI provider could not complete this lesson. Check its key and allowance in Settings, or use Copy prompt for my AI chat. Your current draft is kept.' } });
    } finally { pending.delete(req.user.id); }
  }));
}
module.exports = { registerLessonStudio };
