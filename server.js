const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const session = require('express-session');
const { PrismaSessionStore } = require('@quixo3/prisma-session-store');
const bcrypt = require('bcrypt');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET || 'flowdesk-v1-secure-fallback-master-key-2026';

const sanitizeConfig = { 
  ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h3', 'h4', 'strong', 'em', 'p', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img', 'audio', 'source', 'input'], 
  ALLOWED_ATTR: ['href', 'target', 'class', 'style', 'title', 'src', 'width', 'height', 'frameborder', 'allowfullscreen', 'controls', 'type'] 
};

app.use(express.json({ limit: '50mb' })); 
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

app.get('/api/health', (req, res) => {
    res.status(200).send('OK');
});

app.use(session({
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax' },
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new PrismaSessionStore(prisma, { checkPeriod: 2 * 60 * 1000, dbRecordIdIsSessionId: true })
}));

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireAuth(req, res, next) {
  const token = req.headers.authorization || req.session.userId;
  if (!token) return res.status(401).json({ error: { message: 'Not authenticated' } });
  req.user = { id: token }; 
  next();
}

function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    prisma.user.findUnique({ where: { id: req.user.id } }).then(u => {
        if (!u || !u.isAdmin) return res.status(403).json({ error: 'Not authorized' });
        next();
    }).catch(next);
}

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: { message: 'All fields required' } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: { message: 'Email already registered' } });
  const passwordHash = await bcrypt.hash(password, 12);
  const count = await prisma.user.count();
  const user = await prisma.user.create({ data: { email, name, passwordHash, isAdmin: count === 0 } });
  req.session.userId = user.id;
  res.json({ token: user.id, id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: { message: 'Invalid credentials' } });
  }
  req.session.userId = user.id;
  res.json({ token: user.id, id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, onboarded: user.onboarded });
}));

app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.status(204).end()));

app.get('/api/user/me', requireAuth, asyncHandler(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!u) return res.status(401).json({ error: { message: 'Session invalid' } });
  res.json({ id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin, onboarded: u.onboarded, hoursSaved: u.hoursSaved, aiProvider: u.aiProvider, slideStructure: u.slideStructure, hasApiKey: !!u.aiApiKey });
}));

app.post('/api/settings/ai', requireAuth, asyncHandler(async (req, res) => {
  const data = {};
  if (req.body.provider) data.aiProvider = req.body.provider;
  if (req.body.apiKey) data.aiApiKey = req.body.apiKey;
  if (req.body.slideStructure) data.slideStructure = req.body.slideStructure;
  await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ success: true });
}));

app.post('/api/settings/calendar', requireAuth, asyncHandler(async (req, res) => {
  res.json({ success: true });
}));

app.post(['/api/auth/nuke-rosters', '/api/admin/wipe'], requireAuth, asyncHandler(async (req, res) => {
    await prisma.grade.deleteMany({});
    await prisma.behaviorLog.deleteMany({});
    await prisma.assessment.deleteMany({});
    await prisma.student.deleteMany({});
    await prisma.seatingPlan.deleteMany({});
    await prisma.timetableSlot.deleteMany({});
    await prisma.classGroup.deleteMany({});
    await prisma.lessonPlan.deleteMany({});
    await prisma.dailyNote.deleteMany({});
    await prisma.kanbanTask.deleteMany({});
    res.json({ success: true });
}));

app.get('/api/admin/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, isAdmin: true } });
    res.json(users);
}));

app.put('/api/admin/users/:id/password', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
    res.json({ success: true });
}));

app.get('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const periods = await prisma.dayPeriod.findMany({ where: { teacherId: req.user.id }, orderBy: { sortOrder: 'asc' } });
  res.json(periods);
}));

app.post('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const { periods } = req.body;
  await prisma.dayPeriod.deleteMany({ where: { teacherId: req.user.id } });
  if (periods && periods.length > 0) {
    const mappedPeriods = periods.map((p, i) => ({
      teacherId: req.user.id, sortOrder: i + 1, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak
    }));
    await prisma.dayPeriod.createMany({ data: mappedPeriods });
  }
  res.json({ success: true });
}));

app.get('/api/classes', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.classGroup.findMany({ where: { teacherId: req.user.id }, include: { students: true } }));
}));

app.post('/api/students/bulk-import', requireAuth, asyncHandler(async (req, res) => {
  const { students, className } = req.body;
  const cls = await prisma.classGroup.upsert({
    where: { teacherId_name: { teacherId: req.user.id, name: className } },
    update: { isPinned: true },
    create: { name: className, isPinned: true, teacherId: req.user.id }
  });
  
  if (!students || !students.length) return res.json({ success: true, classId: cls.id });
  
  const operations = students.map(s => {
      const data = { 
        name: s.name, sen: !!s.sen, pp: !!s.pp, fsm: !!s.fsm, 
        targetGrade: s.targetGrade || null, catMean: s.catMean || null, 
        gender: s.gender || null, classId: cls.id 
      };
      if (s.externalRef) {
        return prisma.student.upsert({
          where: { classId_externalRef: { classId: cls.id, externalRef: s.externalRef } },
          update: data, create: { ...data, externalRef: s.externalRef }
        });
      } else {
        return prisma.student.create({ data });
      }
  });
  
  await prisma.$transaction(operations);
  res.json({ success: true, classId: cls.id });
}));

app.put('/api/classes/:id/color', requireAuth, asyncHandler(async (req, res) => {
  const cls = await prisma.classGroup.update({
    where: { id: req.params.id, teacherId: req.user.id },
    data: { colorHex: req.body.colorHex }
  });
  res.json({ success: true, colorHex: cls.colorHex });
}));

app.get('/api/rooms', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.room.findMany({ where: { teacherId: req.user.id } }));
}));
app.post('/api/rooms', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.room.upsert({
    where: { teacherId_name: { teacherId: req.user.id, name: req.body.name } },
    update: {}, create: { name: req.body.name, teacherId: req.user.id }
  }));
}));

app.get('/api/timetable', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.timetableSlot.findMany({ where: { teacherId: req.user.id }, include: { class: true } }));
}));
app.post('/api/timetable', requireAuth, asyncHandler(async (req, res) => {
  const { blocks, weekType } = req.body;
  const mappedBlocks = blocks.map(b => ({
    teacherId: req.user.id, weekType, dayOfWeek: b.dayOfWeek, period: b.period,
    entryType: b.entryType, classId: b.classId || null, label: b.label || null
  }));
  await prisma.$transaction([
    prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id, weekType } }),
    prisma.timetableSlot.createMany({ data: mappedBlocks })
  ]);
  res.json({ success: true });
}));

app.get('/api/seating', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.seatingPlan.findMany({ where: { teacherId: req.user.id } }));
}));
app.post('/api/seating', requireAuth, asyncHandler(async (req, res) => {
  const { classId, roomId, layoutData } = req.body;
  res.json(await prisma.seatingPlan.upsert({
    where: { teacherId_classId_roomId: { teacherId: req.user.id, classId, roomId } },
    update: { layoutData: JSON.stringify(layoutData) },
    create: { classId, roomId, layoutData: JSON.stringify(layoutData), teacherId: req.user.id }
  }));
}));

app.get('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { createdAt: 'desc' } }));
}));
app.post('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.kanbanTask.create({
    data: { title: req.body.title, status: req.body.status || 'TODO', teacherId: req.user.id }
  }));
}));
app.put('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  const data = {};
  if (req.body.status) data.status = req.body.status;
  if (req.body.title) data.title = req.body.title;
  res.json(await prisma.kanbanTask.update({ where: { id: req.params.id, teacherId: req.user.id }, data }));
}));
app.delete('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  await prisma.kanbanTask.delete({ where: { id: req.params.id, teacherId: req.user.id } });
  res.status(204).end();
}));

async function callAI(user, messages) {
  const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('API key required. Add one in Settings.');
  const isOR = user.aiProvider === 'openrouter';
  const endpoint = isOR ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = isOR ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o';
  
  const res = await fetch(endpoint, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

app.post('/api/ai/toolkit', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const { tool, topic } = req.body;
  const system = `You are an expert UK education professional generating content for a teacher. Format output in clean HTML without markdown blocks.`;
  const raw = await callAI(user, [{ role: 'system', content: system }, { role: 'user', content: `Task type: ${tool}\n\nContext/Topic: ${topic}` }]);
  await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
  res.json({ text: DOMPurify.sanitize(raw, sanitizeConfig) });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: { message: err.message || 'Server error' } });
});

app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
