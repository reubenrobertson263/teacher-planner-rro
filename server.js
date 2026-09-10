const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const session = require('express-session');
const { PrismaSessionStore } = require('@quixo3/prisma-session-store');
const bcrypt = require('bcrypt');

const domWindow = new JSDOM('').window;
const DOMPurify = createDOMPurify(domWindow);
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'flowdesk-v1-secure-fallback-master-key-2026';

if (!process.env.SESSION_SECRET) {
  console.warn('[FlowDesk] SESSION_SECRET is not set. Configure one in Render before production use.');
}

const sanitizeConfig = {
  ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'p', 'section', 'blockquote', 'hr', 'code', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img', 'audio', 'source', 'input'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'title', 'src', 'width', 'height', 'frameborder', 'allowfullscreen', 'controls', 'type', 'checked']
};

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  },
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new PrismaSessionStore(prisma, {
    checkPeriod: 2 * 60 * 1000,
    dbRecordIdIsSessionId: true
  })
}));

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
  req.user = { id: userId };
  next();
}

const requireAdmin = asyncHandler(async (req, res, next) => {
  if (!req.user?.id) return res.status(401).json({ error: { message: 'Not authenticated' } });
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) return res.status(403).json({ error: { message: 'Admin access required' } });
  next();
});

function cleanText(value, max = 5000) {
  const raw = String(value ?? '').trim();
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).slice(0, max);
}

function sanitizeHTML(value) {
  return DOMPurify.sanitize(String(value ?? ''), sanitizeConfig);
}

function sanitizeTaskPayload(value) {
  const raw = String(value ?? '');
  if (!raw.includes('|||||')) return DOMPurify.sanitize(raw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).slice(0, 10000);
  const [title, ...bodyParts] = raw.split('|||||');
  const safeTitle = DOMPurify.sanitize(title, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).slice(0, 500);
  const safeBody = sanitizeHTML(bodyParts.join('|||||')).slice(0, 50000);
  return `${safeTitle}|||||${safeBody}`;
}

function dateFromKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addUTCDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function rangeFromQuery(req) {
  const from = dateFromKey(req.query.from) || addUTCDays(new Date(), -31);
  const to = dateFromKey(req.query.to) || addUTCDays(new Date(), 31);
  return { gte: from, lt: addUTCDays(to, 1) };
}

async function ownsClass(userId, classId) {
  if (!classId) return false;
  return !!(await prisma.classGroup.findFirst({ where: { id: classId, teacherId: userId }, select: { id: true } }));
}

async function ownsRoom(userId, roomId) {
  if (!roomId) return false;
  return !!(await prisma.room.findFirst({ where: { id: roomId, teacherId: userId }, select: { id: true } }));
}

app.get('/api/health', (req, res) => res.status(200).send('OK'));

// ---------- Authentication ----------
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const email = cleanText(req.body.email, 320).toLowerCase();
  const password = String(req.body.password || '');
  const name = cleanText(req.body.name, 120);
  if (!email || !password || !name) return res.status(400).json({ error: { message: 'All fields required' } });
  if (password.length < 8) return res.status(400).json({ error: { message: 'Password must contain at least 8 characters' } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: { message: 'Email already registered' } });
  const passwordHash = await bcrypt.hash(password, 12);
  const count = await prisma.user.count();
  const user = await prisma.user.create({ data: { email, name, passwordHash, isAdmin: count === 0 } });
  req.session.userId = user.id;
  res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, onboarded: user.onboarded });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = cleanText(req.body.email, 320).toLowerCase();
  const password = String(req.body.password || '');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: { message: 'Invalid credentials' } });
  }
  req.session.userId = user.id;
  res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, onboarded: user.onboarded });
}));

app.post('/api/auth/logout', (req, res) => {
  if (!req.session) return res.status(204).end();
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.status(204).end();
  });
});

app.get('/api/user/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(401).json({ error: { message: 'Session invalid' } });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    onboarded: user.onboarded,
    hoursSaved: user.hoursSaved,
    aiProvider: user.aiProvider,
    slideStructure: user.slideStructure,
    hasApiKey: !!user.aiApiKey,
    termStart: user.termStart,
    holidays: user.holidays,
    theme: user.theme,
    fontStyle: user.fontStyle,
    fontSize: user.fontSize
  });
}));

// ---------- User settings ----------
app.post('/api/settings/ai', requireAuth, asyncHandler(async (req, res) => {
  const allowedProviders = new Set(['openai', 'anthropic', 'openrouter']);
  const data = {};
  if (req.body.provider) {
    const provider = cleanText(req.body.provider, 30).toLowerCase();
    if (!allowedProviders.has(provider)) return res.status(400).json({ error: { message: 'Unsupported AI provider' } });
    data.aiProvider = provider;
  }
  if (typeof req.body.apiKey === 'string' && req.body.apiKey.trim()) data.aiApiKey = req.body.apiKey.trim();
  if (typeof req.body.slideStructure === 'string') data.slideStructure = req.body.slideStructure.slice(0, 12000);
  await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ success: true });
}));

app.all('/api/settings/calendar', requireAuth, asyncHandler(async (req, res, next) => {
  if (!['PUT', 'POST'].includes(req.method)) return next();
  const termStart = cleanText(req.body.termStart, 10);
  const holidays = cleanText(req.body.holidays, 10000);
  if (termStart && !dateFromKey(termStart)) return res.status(400).json({ error: { message: 'termStart must be YYYY-MM-DD' } });
  await prisma.user.update({ where: { id: req.user.id }, data: { termStart: termStart || null, holidays } });
  res.json({ success: true });
}));

app.put('/api/settings/preferences', requireAuth, asyncHandler(async (req, res) => {
  const data = {};
  const allowedThemes = new Set(['light', 'dark', 'midnight', 'ocean', 'forest', 'sunset', 'high-contrast']);
  if (typeof req.body.theme === 'string' && allowedThemes.has(req.body.theme)) data.theme = req.body.theme;
  if (typeof req.body.fontStyle === 'string') data.fontStyle = req.body.fontStyle === 'dyslexic' ? 'dyslexic' : 'standard';
  if (typeof req.body.fontSize === 'string') data.fontSize = req.body.fontSize === 'large' ? 'large' : 'standard';
  if (typeof req.body.onboarded === 'boolean') data.onboarded = req.body.onboarded;
  await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ success: true });
}));

// ---------- Safe data resets ----------
app.post('/api/auth/nuke-rosters', requireAuth, asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  await prisma.$transaction([
    prisma.seatingPlan.deleteMany({ where: { teacherId } }),
    prisma.timetableSlot.deleteMany({ where: { teacherId } }),
    prisma.lessonPlan.deleteMany({ where: { teacherId } }),
    prisma.assessment.deleteMany({ where: { teacherId } }),
    prisma.classGroup.deleteMany({ where: { teacherId } })
  ]);
  res.json({ success: true });
}));

app.post('/api/admin/wipe', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await prisma.$transaction([
    prisma.pushSubscription.deleteMany({}),
    prisma.grade.deleteMany({}),
    prisma.behaviorLog.deleteMany({}),
    prisma.seatingPlan.deleteMany({}),
    prisma.timetableSlot.deleteMany({}),
    prisma.lessonPlan.deleteMany({}),
    prisma.dailyNote.deleteMany({}),
    prisma.kanbanTask.deleteMany({}),
    prisma.assessment.deleteMany({}),
    prisma.student.deleteMany({}),
    prisma.classGroup.deleteMany({}),
    prisma.template.deleteMany({}),
    prisma.room.deleteMany({}),
    prisma.dayPeriod.deleteMany({})
  ]);
  res.json({ success: true });
}));

app.post('/api/admin/nuke-users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await prisma.user.deleteMany({});
  await prisma.session.deleteMany({});
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true, redirect: '/' });
  });
}));

app.get('/api/admin/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, isAdmin: true },
    orderBy: [{ isAdmin: 'desc' }, { name: 'asc' }]
  });
  res.json(users);
}));

app.put('/api/admin/users/:id/password', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: { message: 'Password must contain at least 8 characters' } });
  const exists = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: { message: 'User not found' } });
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
  res.json({ success: true });
}));

// ---------- School day ----------
app.get('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const periods = await prisma.dayPeriod.findMany({ where: { teacherId: req.user.id }, orderBy: { sortOrder: 'asc' } });
  res.json(periods);
}));

app.post('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const periods = Array.isArray(req.body.periods) ? req.body.periods : [];
  const mapped = periods.map((period, index) => ({
    teacherId: req.user.id,
    sortOrder: index + 1,
    label: cleanText(period.label || `Period ${index + 1}`, 100),
    startTime: cleanText(period.startTime, 5),
    endTime: cleanText(period.endTime, 5),
    isBreak: !!period.isBreak
  }));
  if (mapped.some(period => !/^\d{2}:\d{2}$/.test(period.startTime) || !/^\d{2}:\d{2}$/.test(period.endTime))) {
    return res.status(400).json({ error: { message: 'Every period requires valid start and end times.' } });
  }
  await prisma.$transaction([
    prisma.dayPeriod.deleteMany({ where: { teacherId: req.user.id } }),
    ...(mapped.length ? [prisma.dayPeriod.createMany({ data: mapped })] : [])
  ]);
  res.json({ success: true });
}));

// ---------- Classes & local Arbor pinning ----------
app.get('/api/classes', requireAuth, asyncHandler(async (req, res) => {
  const classes = await prisma.classGroup.findMany({
    where: { teacherId: req.user.id },
    include: { students: { orderBy: { name: 'asc' } } },
    orderBy: { name: 'asc' }
  });
  res.json(classes);
}));

app.post('/api/classes/pin', requireAuth, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name, 120);
  if (!name) return res.status(400).json({ error: { message: 'Class name is required.' } });
  const cls = await prisma.classGroup.upsert({
    where: { teacherId_name: { teacherId: req.user.id, name } },
    update: { isPinned: true },
    create: { name, isPinned: true, teacherId: req.user.id }
  });
  res.json({ success: true, classId: cls.id });
}));

app.post('/api/students/bulk-import', requireAuth, asyncHandler(async (req, res) => {
  const students = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.students) ? req.body.students : []);
  if (!students.length) return res.json({ success: true, imported: 0 });
  if (students.length > 5000) return res.status(413).json({ error: { message: 'Too many students in one class import.' } });

  const normalized = students.map(student => ({
    externalRef: cleanText(student?.externalRef, 200),
    name: cleanText(student?.name, 250),
    classId: cleanText(student?.classId, 80)
  })).filter(student => student.externalRef && student.name && student.classId);

  if (normalized.length !== students.length) {
    return res.status(400).json({ error: { message: 'Each student requires externalRef, name and classId.' } });
  }

  const classIds = [...new Set(normalized.map(student => student.classId))];
  const ownedClasses = await prisma.classGroup.findMany({
    where: { teacherId: req.user.id, id: { in: classIds } },
    select: { id: true }
  });
  if (ownedClasses.length !== classIds.length) {
    return res.status(403).json({ error: { message: 'One or more classes are not available to this account.' } });
  }

  const existing = await prisma.student.findMany({
    where: {
      classId: { in: classIds },
      OR: normalized.map(student => ({ classId: student.classId, externalRef: student.externalRef }))
    },
    select: { id: true, classId: true, externalRef: true, name: true }
  });
  const existingByKey = new Map(existing.map(student => [`${student.classId}::${student.externalRef}`, student]));
  const toCreate = [];
  const toRename = [];
  normalized.forEach(student => {
    const current = existingByKey.get(`${student.classId}::${student.externalRef}`);
    if (!current) toCreate.push(student);
    else if (current.name !== student.name) toRename.push({ id: current.id, name: student.name });
  });

  if (toCreate.length) await prisma.student.createMany({ data: toCreate, skipDuplicates: true });
  if (toRename.length) {
    await prisma.$transaction(toRename.map(student => prisma.student.update({ where: { id: student.id }, data: { name: student.name } })));
  }
  await prisma.classGroup.updateMany({ where: { teacherId: req.user.id, id: { in: classIds } }, data: { isPinned: true } });
  res.json({ success: true, imported: normalized.length, created: toCreate.length, updated: toRename.length, classIds });
}));

app.put('/api/classes/:id/color', requireAuth, asyncHandler(async (req, res) => {
  const colorHex = cleanText(req.body.colorHex, 7);
  if (!/^#[0-9a-f]{6}$/i.test(colorHex)) return res.status(400).json({ error: { message: 'Invalid colour value.' } });
  const result = await prisma.classGroup.updateMany({ where: { id: req.params.id, teacherId: req.user.id }, data: { colorHex } });
  if (!result.count) return res.status(404).json({ error: { message: 'Class not found.' } });
  res.json({ success: true, colorHex });
}));

// ---------- Rooms ----------
app.get('/api/rooms', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.room.findMany({ where: { teacherId: req.user.id }, orderBy: { name: 'asc' } }));
}));

app.post('/api/rooms', requireAuth, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name, 100);
  if (!name) return res.status(400).json({ error: { message: 'Room name is required.' } });
  const room = await prisma.room.upsert({
    where: { teacherId_name: { teacherId: req.user.id, name } },
    update: {},
    create: { name, teacherId: req.user.id }
  });
  res.json(room);
}));

// ---------- Timetable ----------
app.get('/api/timetable', requireAuth, asyncHandler(async (req, res) => {
  const blocks = await prisma.timetableSlot.findMany({
    where: { teacherId: req.user.id },
    include: { class: true },
    orderBy: [{ weekType: 'asc' }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  });
  res.json(blocks);
}));

app.post('/api/timetable', requireAuth, asyncHandler(async (req, res) => {
  const blocks = Array.isArray(req.body.blocks) ? req.body.blocks : null;
  const weekType = cleanText(req.body.weekType, 1).toUpperCase();
  if (!blocks || !['A', 'B'].includes(weekType)) {
    return res.status(400).json({ error: { message: 'A valid timetable block array and weekType are required.' } });
  }

  const mapped = [];
  const classIds = new Set();
  for (const block of blocks) {
    if (!block || !['CLASS', 'CUSTOM'].includes(block.entryType)) return res.status(400).json({ error: { message: 'Timetable contains an invalid block.' } });
    const dayOfWeek = Number(block.dayOfWeek);
    const period = Number(block.period);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 5 || !Number.isInteger(period) || period < 1) {
      return res.status(400).json({ error: { message: 'Timetable contains an invalid day or period.' } });
    }
    const classId = block.entryType === 'CLASS' ? cleanText(block.classId, 80) : null;
    const label = block.entryType === 'CUSTOM' ? cleanText(block.label, 160) : null;
    if (block.entryType === 'CLASS' && !classId) return res.status(400).json({ error: { message: 'A class block is missing its class.' } });
    if (block.entryType === 'CUSTOM' && !label) return res.status(400).json({ error: { message: 'A custom block is missing its label.' } });
    if (classId) classIds.add(classId);
    mapped.push({ teacherId: req.user.id, weekType, dayOfWeek, period, entryType: block.entryType, classId, label });
  }

  if (classIds.size) {
    const owned = await prisma.classGroup.count({ where: { teacherId: req.user.id, id: { in: [...classIds] } } });
    if (owned !== classIds.size) return res.status(403).json({ error: { message: 'Timetable contains a class that does not belong to this account.' } });
  }

  await prisma.$transaction([
    prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id, weekType } }),
    ...(mapped.length ? [prisma.timetableSlot.createMany({ data: mapped })] : [])
  ]);
  res.json({ success: true });
}));

// ---------- Seating ----------
app.get('/api/seating', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.seatingPlan.findMany({ where: { teacherId: req.user.id }, orderBy: { updatedAt: 'desc' } }));
}));

app.post('/api/seating', requireAuth, asyncHandler(async (req, res) => {
  const classId = cleanText(req.body.classId, 80);
  let roomId = cleanText(req.body.roomId, 80);
  if (!(await ownsClass(req.user.id, classId))) {
    return res.status(403).json({ error: { message: 'Class is not available to this account.' } });
  }

  if (!roomId || roomId === 'default_room') {
    const defaultRoom = await prisma.room.upsert({
      where: { teacherId_name: { teacherId: req.user.id, name: 'Default Room' } },
      update: {},
      create: { teacherId: req.user.id, name: 'Default Room' }
    });
    roomId = defaultRoom.id;
  } else if (!(await ownsRoom(req.user.id, roomId))) {
    return res.status(403).json({ error: { message: 'Room is not available to this account.' } });
  }

  const layoutData = req.body.layoutData && typeof req.body.layoutData === 'object' ? req.body.layoutData : {};
  const stored = JSON.stringify(layoutData);
  if (stored.length > 2_000_000) return res.status(413).json({ error: { message: 'Seating plan is too large.' } });
  const plan = await prisma.seatingPlan.upsert({
    where: { teacherId_classId_roomId: { teacherId: req.user.id, classId, roomId } },
    update: { layoutData: stored },
    create: { classId, roomId, layoutData: stored, teacherId: req.user.id }
  });
  res.json(plan);
}));

// ---------- Planbook ----------
app.get('/api/lessons', requireAuth, asyncHandler(async (req, res) => {
  const date = rangeFromQuery(req);
  const lessons = await prisma.lessonPlan.findMany({
    where: { teacherId: req.user.id, date },
    orderBy: [{ date: 'asc' }, { period: 'asc' }]
  });
  res.json(lessons.map(lesson => ({ ...lesson, planText: sanitizeHTML(lesson.planText || '') })));
}));

app.post('/api/lessons', requireAuth, asyncHandler(async (req, res) => {
  const date = dateFromKey(req.body.date);
  const period = Number(req.body.period);
  const classId = cleanText(req.body.classId, 80) || null;
  if (!date || !Number.isInteger(period) || period < 1) return res.status(400).json({ error: { message: 'Lesson date and period are required.' } });
  if (classId && !(await ownsClass(req.user.id, classId))) return res.status(403).json({ error: { message: 'Class not available to this account.' } });
  const planText = sanitizeHTML(req.body.planText).slice(0, 250000);
  const lesson = await prisma.lessonPlan.upsert({
    where: { teacherId_date_period: { teacherId: req.user.id, date, period } },
    update: { classId, planText, version: { increment: 1 } },
    create: { teacherId: req.user.id, date, period, classId, planText }
  });
  res.json(lesson);
}));

app.get('/api/notes', requireAuth, asyncHandler(async (req, res) => {
  const date = rangeFromQuery(req);
  const notes = await prisma.dailyNote.findMany({ where: { teacherId: req.user.id, date }, orderBy: { date: 'asc' } });
  res.json(notes.map(note => ({ ...note, noteText: sanitizeHTML(note.noteText || '') })));
}));

app.post('/api/notes', requireAuth, asyncHandler(async (req, res) => {
  const date = dateFromKey(req.body.date);
  if (!date) return res.status(400).json({ error: { message: 'Note date is required.' } });
  const noteText = sanitizeHTML(req.body.noteText).slice(0, 250000);
  const note = await prisma.dailyNote.upsert({
    where: { teacherId_date: { teacherId: req.user.id, date } },
    update: { noteText, version: { increment: 1 } },
    create: { teacherId: req.user.id, date, noteText }
  });
  res.json(note);
}));

// ---------- Markbook ----------
app.post('/api/markbook/grade', requireAuth, asyncHandler(async (req, res) => {
  const studentId = cleanText(req.body.studentId, 80);
  const assessmentId = cleanText(req.body.assessmentId, 80);
  const value = cleanText(req.body.value, 50);
  const assessment = await prisma.assessment.findFirst({ where: { id: assessmentId, teacherId: req.user.id }, select: { id: true, classId: true } });
  if (!assessment) return res.status(404).json({ error: { message: 'Assessment not found.' } });
  const student = await prisma.student.findFirst({ where: { id: studentId, classId: assessment.classId }, select: { id: true } });
  if (!student) return res.status(403).json({ error: { message: 'Student is not in this assessment class.' } });
  const grade = await prisma.grade.upsert({
    where: { studentId_assessmentId: { studentId, assessmentId } },
    update: { value },
    create: { studentId, assessmentId, value }
  });
  res.json(grade);
}));

app.get('/api/markbook/:classId', requireAuth, asyncHandler(async (req, res) => {
  if (!(await ownsClass(req.user.id, req.params.classId))) return res.status(404).json({ error: { message: 'Class not found.' } });
  const assessments = await prisma.assessment.findMany({
    where: { teacherId: req.user.id, classId: req.params.classId },
    include: { grades: true },
    orderBy: { date: 'asc' }
  });
  res.json(assessments);
}));

app.post('/api/markbook/:classId', requireAuth, asyncHandler(async (req, res) => {
  if (!(await ownsClass(req.user.id, req.params.classId))) return res.status(404).json({ error: { message: 'Class not found.' } });
  const title = cleanText(req.body.title, 200);
  if (!title) return res.status(400).json({ error: { message: 'Assessment title is required.' } });
  const rawDate = req.body.date ? new Date(req.body.date) : new Date();
  const date = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate;
  const assessment = await prisma.assessment.create({ data: { title, date, classId: req.params.classId, teacherId: req.user.id }, include: { grades: true } });
  res.json(assessment);
}));

// ---------- Task Notes ----------
app.get('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  const tasks = await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { createdAt: 'desc' } });
  res.json(tasks.map(task => ({ ...task, title: sanitizeTaskPayload(task.title || '') })));
}));

app.post('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  const title = sanitizeTaskPayload(req.body.title || 'Untitled Note');
  const status = ['TODO', 'DOING', 'DONE'].includes(req.body.status) ? req.body.status : 'TODO';
  const task = await prisma.kanbanTask.create({ data: { title, status, teacherId: req.user.id, clientCreatedAt: new Date() } });
  res.json(task);
}));

app.put('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  const data = {};
  if (typeof req.body.status === 'string' && ['TODO', 'DOING', 'DONE'].includes(req.body.status)) data.status = req.body.status;
  if (typeof req.body.title === 'string') data.title = sanitizeTaskPayload(req.body.title);
  const result = await prisma.kanbanTask.updateMany({ where: { id: req.params.id, teacherId: req.user.id }, data });
  if (!result.count) return res.status(404).json({ error: { message: 'Task note not found.' } });
  res.json(await prisma.kanbanTask.findUnique({ where: { id: req.params.id } }));
}));

app.delete('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await prisma.kanbanTask.deleteMany({ where: { id: req.params.id, teacherId: req.user.id } });
  if (!result.count) return res.status(404).json({ error: { message: 'Task note not found.' } });
  res.status(204).end();
}));

// ---------- AI ----------
async function callAI(user, messages) {
  const provider = user.aiProvider || 'openai';
  const apiKey = user.aiApiKey || (provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error('API key required. Add one in Settings.');

  if (provider === 'anthropic') {
    const systemMessage = messages.find(message => message.role === 'system')?.content || '';
    const chatMessages = messages.filter(message => message.role !== 'system').map(message => ({ role: message.role, content: String(message.content || '') }));
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest', max_tokens: 3500, system: systemMessage, messages: chatMessages })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error?.message || `Anthropic request failed (${response.status})`);
    return (data.content || []).map(part => part.text || '').join('\n').trim();
  }

  const isOpenRouter = provider === 'openrouter';
  const endpoint = isOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = isOpenRouter ? (process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet') : (process.env.OPENAI_MODEL || 'gpt-4o');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || `AI request failed (${response.status})`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI provider returned an empty response.');
  return text;
}

async function incrementHoursSaved(userId) {
  await prisma.user.update({ where: { id: userId }, data: { hoursSaved: { increment: 1 } } }).catch(() => {});
}

app.post('/api/ai/toolkit', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const tool = cleanText(req.body.tool, 80);
  const topic = String(req.body.topic || '').trim().slice(0, 30000);
  if (!tool || !topic) return res.status(400).json({ error: { message: 'Choose a tool and add some context.' } });
  const system = 'You are an expert UK secondary education professional. Produce practical teacher-ready content. Return clean HTML only, with no markdown code fences. Preserve facts supplied by the teacher and do not invent student data.';
  const raw = await callAI(user, [{ role: 'system', content: system }, { role: 'user', content: `Task type: ${tool}\n\nContext/Topic:\n${topic}` }]);
  await incrementHoursSaved(user.id);
  res.json({ text: sanitizeHTML(raw) });
}));

// --- THE ONLY CHANGE IS THE PROMPT IN THIS BLOCK ---
app.post('/api/ai/generate', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const prompt = String(req.body.prompt || '').trim().slice(0, 30000);
  if (!prompt) return res.status(400).json({ error: { message: 'Prompt is required.' } });
  const raw = await callAI(user, [
    { 
      role: 'system', 
      content: "You are an expert UK secondary school teacher. Convert the user's rough notes into a concise, well-structured lesson plan formatted completely in HTML. Use headings (<h1>, <h2>) and bullet points (<ul><li>) where appropriate. Keep all stated facts exactly the same. Output ONLY the HTML, with no introductory text or markdown formatting." 
    },
    { role: 'user', content: prompt }
  ]);
  await incrementHoursSaved(user.id);
  res.json({ text: sanitizeHTML(raw) });
}));
// ---------------------------------------------------

function parseSlidesJSON(raw) {
  const cleaned = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('AI did not return a slide array.');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('AI returned an empty slide array.');
  return parsed.slice(0, 30).map((slide, index) => ({
    title: cleanText(slide?.title || `Slide ${index + 1}`, 200),
    content: String(slide?.content || '').slice(0, 12000),
    speakerNotes: String(slide?.speakerNotes || '').slice(0, 12000)
  }));
}

app.post('/api/ai/slides', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const topic = cleanText(req.body.topic, 500);
  const keyStage = cleanText(req.body.keyStage, 50);
  const curriculum = String(req.body.curriculum || '').trim().slice(0, 12000);
  const customStructure = String(req.body.customStructure || user.slideStructure || '').trim().slice(0, 12000);
  if (!topic) return res.status(400).json({ error: { message: 'Lesson topic is required.' } });
  const prompt = `Create a classroom-ready slide deck for a UK secondary teacher.\nTopic: ${topic}\nKey stage/year: ${keyStage || 'not specified'}\nCurriculum/context: ${curriculum || 'not specified'}\nRequested structure: ${customStructure || 'Use a clear five-part lesson structure.'}\n\nReturn ONLY a JSON array. Each item must be {"title":"...","content":"...","speakerNotes":"..."}. Keep slide content concise and usable on screen.`;
  const raw = await callAI(user, [
    { role: 'system', content: 'You design accurate, teacher-ready UK secondary lesson presentations and return valid JSON exactly as requested.' },
    { role: 'user', content: prompt }
  ]);
  const slides = parseSlidesJSON(raw);
  await incrementHoursSaved(user.id);
  res.json(slides);
}));

// ---------- Errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: { message: 'API route not found' } }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: { message: err.message || 'Server error' } });
});

app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
