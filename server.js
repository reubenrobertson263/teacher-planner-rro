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

// Use a fallback for SESSION to prevent crashes if user didn't set env correctly
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-super-secret-key-12345';

// Default periods if none exist for a new user
const DEFAULT_PERIODS = [
  { label: 'Progress Time', startTime: '08:50', endTime: '09:10', isBreak: false, sortOrder: 1 },
  { label: 'Period 1',      startTime: '09:10', endTime: '10:10', isBreak: false, sortOrder: 2 },
  { label: 'Period 2',      startTime: '10:10', endTime: '11:10', isBreak: false, sortOrder: 3 },
  { label: 'Break',         startTime: '11:10', endTime: '11:25', isBreak: true,  sortOrder: 4 },
  { label: 'Period 3',      startTime: '11:25', endTime: '12:25', isBreak: false, sortOrder: 5 },
  { label: 'P4 & Lunch',    startTime: '12:25', endTime: '13:55', isBreak: false, sortOrder: 6 },
  { label: 'Period 5',      startTime: '13:55', endTime: '14:55', isBreak: false, sortOrder: 7 },
];

const sanitizeConfig = { 
  ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h3', 'h4', 'strong', 'em', 'p', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img', 'audio', 'source'], 
  ALLOWED_ATTR: ['href', 'target', 'class', 'style', 'title', 'src', 'width', 'height', 'frameborder', 'allowfullscreen', 'controls', 'type'] 
};

app.use(express.json({ limit: '50mb' })); 
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

app.use(session({
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: false, httpOnly: true, sameSite: 'lax' },
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new PrismaSessionStore(prisma, { checkPeriod: 2 * 60 * 1000, dbRecordIdIsSessionId: true })
}));

// --- PERIODS ---
app.get('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const periods = await prisma.dayPeriod.findMany({ where: { teacherId: req.user.id }, orderBy: { sortOrder: 'asc' } });
  if (periods.length === 0) return res.json(DEFAULT_PERIODS);
  res.json(periods);
}));

app.post('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const { periods } = req.body;
  
  // Wipe old periods and save the new sorted structure
  await prisma.dayPeriod.deleteMany({ where: { teacherId: req.user.id } });
  
  if (periods && periods.length > 0) {
    const mappedPeriods = periods.map((p, i) => ({
      teacherId: req.user.id,
      sortOrder: i + 1,
      label: p.label,
      startTime: p.startTime,
      endTime: p.endTime,
      isBreak: p.isBreak
    }));
    await prisma.dayPeriod.createMany({ data: mappedPeriods });
  }
  res.json({ success: true });
}));


const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- AUTH MIDDLEWARE ---
function requireAuth(req, res, next) {
  // Check auth token header to ensure seamless connection with index.html
  const token = req.headers.authorization || req.session.userId;
  if (!token) return res.status(401).json({ error: { message: 'Not authenticated' } });
  
  req.user = { id: token }; 
  next();
}

// --- AUTH ROUTES ---
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

// --- USER / CONFIG ROUTES ---
app.get('/api/user/me', requireAuth, asyncHandler(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!u) return res.status(401).json({ error: { message: 'Session invalid' } });
  res.json({ 
    id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin, 
    onboarded: u.onboarded, hoursSaved: u.hoursSaved, aiProvider: u.aiProvider, 
    slideStructure: u.slideStructure, hasApiKey: !!u.aiApiKey 
  });
}));

app.post('/api/settings/ai', requireAuth, asyncHandler(async (req, res) => {
  const data = {};
  if (req.body.provider) data.aiProvider = req.body.provider;
  if (req.body.apiKey) data.aiApiKey = req.body.apiKey;
  if (req.body.slideStructure) data.slideStructure = req.body.slideStructure;
  await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ success: true });
}));

app.post('/api/auth/nuke-rosters', requireAuth, asyncHandler(async (req, res) => {
  await prisma.grade.deleteMany({ where: { student: { class: { teacherId: req.user.id } } } });
  await prisma.behaviorLog.deleteMany({ where: { student: { class: { teacherId: req.user.id } } } });
  await prisma.assessment.deleteMany({ where: { class: { teacherId: req.user.id } } });
  await prisma.student.deleteMany({ where: { class: { teacherId: req.user.id } } });
  await prisma.seatingPlan.deleteMany({ where: { teacherId: req.user.id } });
  await prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id } });
  await prisma.classGroup.deleteMany({ where: { teacherId: req.user.id } });
  res.json({ success: true });
}));

// --- PERIODS ---
// --- PERIODS ---
app.get('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const periods = await prisma.dayPeriod.findMany({ where: { teacherId: req.user.id }, orderBy: { sortOrder: 'asc' } });
  if (periods.length === 0) return res.json(DEFAULT_PERIODS);
  res.json(periods);
}));

app.post('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const { periods } = req.body;
  
  // Wipe old periods and save the new sorted structure
  await prisma.dayPeriod.deleteMany({ where: { teacherId: req.user.id } });
  
  if (periods && periods.length > 0) {
    const mappedPeriods = periods.map((p, i) => ({
      teacherId: req.user.id,
      sortOrder: i + 1,
      label: p.label,
      startTime: p.startTime,
      endTime: p.endTime,
      isBreak: p.isBreak
    }));
    await prisma.dayPeriod.createMany({ data: mappedPeriods });
  }
  res.json({ success: true });
}));

// --- CLASSES / STUDENTS ---
app.get('/api/classes', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.classGroup.findMany({ where: { teacherId: req.user.id }, include: { students: true } }));
}));

app.put('/api/classes/:id/color', requireAuth, asyncHandler(async (req, res) => {
  const cls = await prisma.classGroup.update({
    where: { id: req.params.id, teacherId: req.user.id },
    data: { colorHex: req.body.colorHex }
  });
  res.json({ success: true, colorHex: cls.colorHex });
}));

app.post('/api/students/bulk-import', requireAuth, asyncHandler(async (req, res) => {
  const { students, className } = req.body;
  if (!students || !students.length) return res.json({ success: true });
  
  const cls = await prisma.classGroup.upsert({
    where: { teacherId_name: { teacherId: req.user.id, name: className } },
    update: { isPinned: true },
    create: { name: className, isPinned: true, teacherId: req.user.id }
  });

  for (const s of students) {
    const data = { 
      name: s.name, sen: !!s.sen, pp: !!s.pp, fsm: !!s.fsm, 
      targetGrade: s.targetGrade || null, catMean: s.catMean || null, 
      gender: s.gender || null, classId: cls.id 
    };
    if (s.externalRef) {
      await prisma.student.upsert({
        where: { classId_externalRef: { classId: cls.id, externalRef: s.externalRef } },
        update: data, create: { ...data, externalRef: s.externalRef }
      });
    } else {
      await prisma.student.create({ data });
    }
  }
  res.json({ success: true, classId: cls.id });
}));

// --- ROOMS ---
app.get('/api/rooms', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.room.findMany({ where: { teacherId: req.user.id } }));
}));
app.post('/api/rooms', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.room.upsert({
    where: { teacherId_name: { teacherId: req.user.id, name: req.body.name } },
    update: {}, create: { name: req.body.name, teacherId: req.user.id }
  }));
}));

// --- TIMETABLE ---
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

// --- LESSONS ---
app.get('/api/lessons', requireAuth, asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const where = { teacherId: req.user.id };
  if (from && to) { where.date = { gte: new Date(from), lte: new Date(to) }; }
  res.json(await prisma.lessonPlan.findMany({ where, include: { class: true } }));
}));
app.post('/api/lessons', requireAuth, asyncHandler(async (req, res) => {
  const { date, period, planText, classId } = req.body;
  res.json(await prisma.lessonPlan.upsert({
    where: { teacherId_date_period: { teacherId: req.user.id, date: new Date(date), period: parseInt(period) } },
    update: { planText: DOMPurify.sanitize(planText, sanitizeConfig), classId: classId || null, version: { increment: 1 } },
    create: { date: new Date(date), period: parseInt(period), planText: DOMPurify.sanitize(planText, sanitizeConfig), classId: classId || null, teacherId: req.user.id }
  }));
}));

// --- NOTES ---
app.get('/api/notes', requireAuth, asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const where = { teacherId: req.user.id };
  if (from && to) { where.date = { gte: new Date(from), lte: new Date(to) }; }
  res.json(await prisma.dailyNote.findMany({ where }));
}));
app.post('/api/notes', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.dailyNote.upsert({
    where: { teacherId_date: { teacherId: req.user.id, date: new Date(req.body.date) } },
    update: { noteText: DOMPurify.sanitize(req.body.noteText, sanitizeConfig), version: { increment: 1 } },
    create: { date: new Date(req.body.date), noteText: DOMPurify.sanitize(req.body.noteText, sanitizeConfig), teacherId: req.user.id }
  }));
}));

// --- SEATING PLANS ---
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

// --- MARKBOOK ---
app.get('/api/markbook/:classId', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.assessment.findMany({
    where: { classId: req.params.classId, teacherId: req.user.id },
    include: { grades: { include: { student: true } } }
  }));
}));
app.post('/api/markbook/:classId', requireAuth, asyncHandler(async (req, res) => {
  const { title, date, grades } = req.body;
  res.json(await prisma.assessment.create({
    data: {
      title, date: new Date(date), classId: req.params.classId, teacherId: req.user.id,
      grades: { create: grades.map(g => ({ studentId: g.studentId, value: g.value })) }
    }
  }));
}));
app.post('/api/markbook/grade', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.grade.upsert({
    where: { studentId_assessmentId: { studentId: req.body.studentId, assessmentId: req.body.assessmentId } },
    update: { value: req.body.value },
    create: { studentId: req.body.studentId, assessmentId: req.body.assessmentId, value: req.body.value }
  }));
}));

// --- TASKS ---
app.get('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { createdAt: 'desc' } }));
}));
app.post('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.kanbanTask.create({
    data: {
      title: req.body.title, status: req.body.status || 'TODO',
      clientCreatedAt: req.body.clientCreatedAt ? new Date(req.body.clientCreatedAt) : new Date(),
      teacherId: req.user.id
    }
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

// --- AI STUDIO ---
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

app.post('/api/ai/slides', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const { topic, keyStage, curriculum, customStructure } = req.body;
  const diff = { KS3: 'Above Target, On Track, Developing, Below Target', KS4: 'GCSE Grades 9-1', Vocational: 'L1P, L1M, L1D, L2P, L2M, L2D, L2D*' }[keyStage] || '';
  const system = `You are a master teacher generating a presentation slide deck. Curriculum: ${curriculum}. Differentiate for ${keyStage} using the scale: ${diff}. Output ONLY a valid JSON array of objects without markdown wrappers. Each object must have keys: 'title', 'content', 'speakerNotes'. Follow sequence: ${customStructure || '1. Retrieve\n2. Learn\n3. Instruct\n4. Apply\n5. Review'}`;
  
  const raw = await callAI(user, [{ role: 'system', content: system }, { role: 'user', content: `Topic: ${topic}` }]);
  await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
  res.json(JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim()));
}));

app.post('/api/ai/toolkit', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const { tool, topic } = req.body;
  let system = `You are an expert UK education professional. Format output in clean HTML.`;
  const tools = {
    song: `Write a catchy educational song summarizing the topic.`,
    comprehension: `Generate a reading passage on the topic, followed by 3 differentiated question sets.`,
    explainer: `Explain the concept as if I am 11 years old.`,
    spag: `Write a paragraph related to the topic containing 10 deliberate SPaG errors. Provide the answer key below.`,
    quiz: `Generate a 10-question multiple choice quiz with an answer key.`,
    markscheme: `Generate a detailed mark scheme or grading rubric.`,
    sow: `Generate a 6-week Scheme of Work (SoW).`,
    reports: `Write 3 differentiated report card comment templates.`,
    iep: `Draft an IEP strategies list for this topic.`,
    dyslexia_adapt: `Rewrite the text to be highly accessible for Dyslexia.`,
    policy: `Write a formal UK school policy document.`,
    newsletter: `Write a parent/carer newsletter segment.`,
    observation: `Write constructive lesson observation feedback.`,
    sip: `Draft a School Improvement Plan objective.`,
    governor: `Write a data-driven report section for Governors.`,
    cpd: `Design a 1-hour staff CPD session.`,
    risk: `Generate a standard UK school risk assessment table.`,
    email_angry: `Draft a de-escalating, polite email response to an angry parent.`
  };
  if (tools[tool]) system += ` ${tools[tool]}`;
  
  const raw = await callAI(user, [{ role: 'system', content: system }, { role: 'user', content: topic }]);
  await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
  res.json({ text: DOMPurify.sanitize(raw, sanitizeConfig) });
}));

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: { message: err.message || 'Server error' } });
});

app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
