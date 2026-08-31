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
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured in production.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || 'flowdesk-local-development-only-secret';

const DEFAULT_PERIODS = [
  { label: 'Progress Time', startTime: '08:50', endTime: '09:10', isBreak: false, sortOrder: 1 },
  { label: 'Period 1', startTime: '09:10', endTime: '10:10', isBreak: false, sortOrder: 2 },
  { label: 'Period 2', startTime: '10:10', endTime: '11:10', isBreak: false, sortOrder: 3 },
  { label: 'Break', startTime: '11:10', endTime: '11:25', isBreak: true, sortOrder: 4 },
  { label: 'Period 3', startTime: '11:25', endTime: '12:25', isBreak: false, sortOrder: 5 },
  { label: 'P4 & Lunch', startTime: '12:25', endTime: '13:55', isBreak: false, sortOrder: 6 },
  { label: 'Period 5', startTime: '13:55', endTime: '14:55', isBreak: false, sortOrder: 7 }
];

const sanitizeConfig = {
  ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h2', 'h3', 'h4', 'strong', 'em', 'p', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img', 'audio', 'source', 'input'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'title', 'src', 'width', 'height', 'controls', 'type', 'checked', 'data-placeholder']
};

const TOOLKIT_PROMPTS = {
  // Pedagogy & planning
  sow: 'Create a detailed 6-week Scheme of Work with weekly objectives, core knowledge, activities, assessment opportunities, differentiation and homework.',
  lesson_plan: 'Create a detailed 60-minute lesson plan with timings, retrieval, modelling, checks for understanding, independent practice and review.',
  five_part: 'Build a five-part lesson using Retrieve, Learning Intentions, Explicit Instruction, Apply and Review.',
  hook: 'Generate five engaging lesson hooks or starter activities suitable for a UK secondary classroom.',
  plenary: 'Generate differentiated exit tickets and plenary activities with answer guidance.',
  concept_check: 'Generate hinge questions and concept-check questions that expose likely misconceptions, including answers and rationale.',
  rubric: 'Create a clear assessment rubric matrix with criteria, performance bands and student-friendly success descriptors.',
  retrieval: 'Create a spaced retrieval-practice set with mixed prior-learning questions and answers.',
  homework: 'Create purposeful homework with instructions, success criteria, stretch and a concise answer key.',
  misconception: 'Identify likely misconceptions for the topic and provide teacher responses and corrective explanations.',
  modelling: 'Create an I-do / We-do / You-do modelling sequence with worked examples and checks for understanding.',
  questioning: 'Create a questioning sequence from recall through analysis/evaluation, with cold-call friendly prompts and answers.',
  interleave: 'Create an interleaved practice set mixing the current topic with prerequisite knowledge.',
  revision: 'Create a structured revision lesson and independent revision pack with answers.',
  knowledge_organiser: 'Create a one-page knowledge organiser with key facts, vocabulary, processes and common misconceptions.',

  // Differentiation & access
  explainer: 'Explain the concept in clear language suitable for an 11-year-old without losing subject accuracy.',
  dyslexia_adapt: 'Rewrite the supplied material for dyslexia accessibility using short chunks, explicit headings, simple sentence structures and reduced visual/verbal load.',
  eal_vocab: 'Create an EAL-friendly vocabulary and language-support resource including definitions, sentence stems and visual-prompt descriptions.',
  adhd_scaffold: 'Break the task into short, explicit ADHD-friendly steps with checkpoints, visible success criteria and minimal working-memory demand.',
  autism_clear: 'Rewrite instructions into literal, unambiguous, predictable steps suitable for autistic learners, avoiding implied meanings.',
  stretch: 'Create meaningful stretch-and-challenge tasks that deepen thinking rather than simply adding more work.',
  send_adapt: 'Adapt the material for mixed SEND needs while preserving the same curriculum objective.',
  reading_age: 'Rewrite the text at a lower reading age while retaining essential subject vocabulary and concepts.',
  chunk_task: 'Chunk this task into small completion stages with a tick-box checklist and teacher check-in points.',
  scaffold_write: 'Create writing scaffolds, paragraph frames, sentence starters and a gradual removal-of-support plan.',

  // Literacy & language
  comprehension: 'Generate a reading passage followed by three differentiated question sets and a complete answer key.',
  spag: 'Create a SPaG correction exercise containing 10 deliberate errors connected to the topic, followed by an answer key.',
  vocab: 'Create a Tier 2/Tier 3 vocabulary builder with student-friendly definitions, examples, non-examples and retrieval questions.',
  model_answer: 'Write a high-quality WAGOLL/model answer and annotate why it is successful against likely assessment criteria.',
  debate: 'Create a balanced classroom debate motion with arguments on both sides, evidence prompts and speaking stems.',
  writing_frame: 'Create a structured writing frame for the task, including sentence stems and paragraph guidance.',
  summary: 'Create a concise student-friendly summary plus a 5-question comprehension check.',
  glossary: 'Create an alphabetical subject glossary from the supplied material with concise definitions.',
  command_words: 'Explain the relevant exam command words and show how responses should differ for each.',

  // Assessment & marking
  quiz: 'Generate a 10-question multiple-choice quiz with plausible distractors, answers and misconception notes.',
  short_test: 'Create a 20-minute low-stakes test with mixed question types and a complete mark scheme.',
  markscheme: 'Act as Marking AI Pro. Analyse the submission, infer appropriate criteria from the context, identify strengths and gaps, produce actionable feedback, and give a clear improvement plan. Do not invent evidence not present in the submission.',
  exam_questions: 'Create exam-style questions at increasing difficulty with marks, command words and a mark scheme.',
  feedback_bank: 'Create a reusable feedback bank organised by common strengths, misconceptions and next steps.',
  self_assessment: 'Create a student self-assessment checklist and reflection prompts aligned to the task.',
  peer_assessment: 'Create a safe, specific peer-assessment protocol with success criteria and feedback stems.',
  gap_analysis: 'Analyse the supplied results or notes and identify likely knowledge gaps with targeted reteach actions.',

  // Pastoral, communication & leadership
  reports: 'Write three differentiated report comment templates: exceeding expectations, on track, and requiring improvement.',
  email_praise: 'Draft a warm, professional UK-school praise email to a parent/carer using the supplied facts only.',
  email_angry: 'Draft a calm, de-escalating and professional response to an unhappy parent/carer. Preserve boundaries and avoid admitting facts not established.',
  newsletter: 'Write a concise parent/carer newsletter section from the supplied information.',
  parent_call: 'Create a parent/carer phone-call script with opening, factual evidence, questions, agreed actions and follow-up.',
  detention_script: 'Create a restorative detention conversation script focused on behaviour, impact, repair and next steps.',
  pastoral_plan: 'Draft a practical pastoral support plan with observable actions, ownership and review points.',
  assembly: 'Write an engaging secondary-school assembly script with clear structure, examples and a memorable takeaway.',
  policy: 'Draft a formal UK-school policy document with purpose, scope, responsibilities, procedures and review arrangements.',
  observation: 'Write constructive lesson-observation feedback organised into strengths, evidence, impact and actionable next steps.',
  sip: 'Draft a measurable School Improvement Plan objective with success criteria, milestones, evidence and review points.',
  governor: 'Write a concise, data-aware governor-report section using only the evidence supplied.',
  cpd: 'Design a one-hour staff CPD session with objectives, modelling, active practice, reflection and follow-up.',
  risk: 'Generate a UK-school risk-assessment table with hazards, people at risk, controls, residual risk and actions.',
  meeting_agenda: 'Create a focused school meeting agenda with timings, decisions required and actions/owners.',
  minutes: 'Turn the supplied rough notes into professional meeting minutes with decisions, actions, owners and deadlines.',
  line_management: 'Create a line-management meeting structure covering progress, blockers, support, decisions and actions.',
  intervention: 'Create an academic intervention plan with entry data, targeted actions, frequency, owner and review measures.',

  // Subject/resource creation
  song: 'Write a catchy educational song that accurately summarises the topic.',
  timeline: 'Create a chronological timeline with key events, significance and retrieval questions.',
  case_study: 'Create a realistic classroom case study with questions and an answer guide.',
  scenario: 'Create applied scenarios for students to use the concept in context, with model responses.',
  worksheet: 'Create a printable worksheet with clear instructions, graduated practice and answers.',
  flashcards: 'Create concise question/answer flashcards covering the essential knowledge.',
  dual_code: 'Turn the topic into a dual-coding plan: concise text paired with suggested diagrams/icons/visual structures.',
  compare: 'Create a comparison table for the supplied concepts plus analytical follow-up questions.',
  data_response: 'Create a data-response activity using a small plausible dataset, questions and answers; clearly label any generated example data as illustrative.',

  // Phonics & reading intervention
  phonics: 'Create a secondary-appropriate phonics catch-up activity focusing on decoding, blending and subject vocabulary without infantilising the learner.',
  phonics_vocab: 'Create a phonics-informed subject-vocabulary intervention: syllable segmentation, grapheme focus, pronunciation, morphology and retrieval practice.',
  phonics_diagnostic: 'Create a short phonics/decoding diagnostic suitable for an older struggling reader, with teacher guidance and next-step interpretation.',
  fluency: 'Create a reading-fluency intervention using repeated reading, phrasing, vocabulary pre-teach and comprehension checks.'
};

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', service: 'flowdesk' }));
app.use(session({
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: isProduction,
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
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: { message: 'Not authenticated' } });
  }
  req.user = { id: req.session.userId };
  next();
}

async function requireOwnedClass(userId, classId) {
  if (!classId) return null;
  return prisma.classGroup.findFirst({ where: { id: classId, teacherId: userId } });
}

async function requireOwnedRoom(userId, roomId) {
  if (!roomId) return null;
  return prisma.room.findFirst({ where: { id: roomId, teacherId: userId } });
}

function sanitizeHTML(value) {
  return DOMPurify.sanitize(String(value || ''), sanitizeConfig);
}

function sanitizePlain(value) {
  return DOMPurify.sanitize(String(value || ''), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();
}

function parseDateOnly(value) {
  if (value instanceof Date) return value;
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00.000Z`);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${raw}`);
  return parsed;
}

function parseDateRangeStart(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00.000Z`);
  return new Date(raw);
}

function parseDateRangeEnd(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:59.999Z`);
  return new Date(raw);
}

function parseLayoutData(plan) {
  if (!plan) return plan;
  let layoutData = plan.layoutData;
  try { layoutData = JSON.parse(layoutData); } catch (_) {}
  return { ...plan, layoutData };
}

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = sanitizePlain(req.body.name);
  if (!email || !password || !name) return res.status(400).json({ error: { message: 'All fields required' } });
  if (password.length < 8) return res.status(400).json({ error: { message: 'Password must be at least 8 characters.' } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: { message: 'Email already registered' } });
  const passwordHash = await bcrypt.hash(password, 12);
  const count = await prisma.user.count();
  const user = await prisma.user.create({ data: { email, name, passwordHash, isAdmin: count === 0 } });
  req.session.userId = user.id;
  res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, onboarded: user.onboarded });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
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
  req.session.destroy(() => res.status(204).end());
});

app.get('/api/user/me', requireAuth, asyncHandler(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!u) return res.status(401).json({ error: { message: 'Session invalid' } });
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    onboarded: u.onboarded,
    hoursSaved: u.hoursSaved,
    aiProvider: u.aiProvider,
    slideStructure: u.slideStructure,
    hasApiKey: !!u.aiApiKey,
    termStart: u.termStart,
    holidays: u.holidays,
    theme: u.theme,
    fontStyle: u.fontStyle,
    fontSize: u.fontSize
  });
}));

app.put('/api/settings/preferences', requireAuth, asyncHandler(async (req, res) => {
  const allowedThemes = new Set(['light', 'dark', 'midnight', 'ocean']);
  const allowedStyles = new Set(['standard', 'dyslexic']);
  const allowedSizes = new Set(['standard', 'large']);
  const data = {};
  if (allowedThemes.has(req.body.theme)) data.theme = req.body.theme;
  if (allowedStyles.has(req.body.fontStyle)) data.fontStyle = req.body.fontStyle;
  if (allowedSizes.has(req.body.fontSize)) data.fontSize = req.body.fontSize;
  if (typeof req.body.onboarded === 'boolean') data.onboarded = req.body.onboarded;
  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ success: true, theme: user.theme, fontStyle: user.fontStyle, fontSize: user.fontSize, onboarded: user.onboarded });
}));

app.put('/api/settings/calendar', requireAuth, asyncHandler(async (req, res) => {
  const termStart = sanitizePlain(req.body.termStart);
  const holidays = sanitizePlain(req.body.holidays);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(termStart)) {
    return res.status(400).json({ error: { message: 'Term start must be YYYY-MM-DD.' } });
  }
  const user = await prisma.user.update({ where: { id: req.user.id }, data: { termStart, holidays } });
  res.json({ success: true, termStart: user.termStart, holidays: user.holidays });
}));

app.post('/api/settings/ai', requireAuth, asyncHandler(async (req, res) => {
  const data = {};
  if (['openai', 'anthropic', 'openrouter'].includes(req.body.provider)) data.aiProvider = req.body.provider;
  if (Object.prototype.hasOwnProperty.call(req.body, 'apiKey')) {
    const key = String(req.body.apiKey || '').trim();
    data.aiApiKey = key || null;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'slideStructure')) data.slideStructure = String(req.body.slideStructure || '');
  await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ success: true });
}));

app.post('/api/auth/nuke-rosters', requireAuth, asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  await prisma.$transaction([
    prisma.grade.deleteMany({ where: { student: { class: { teacherId } } } }),
    prisma.behaviorLog.deleteMany({ where: { student: { class: { teacherId } } } }),
    prisma.assessment.deleteMany({ where: { teacherId } }),
    prisma.seatingPlan.deleteMany({ where: { teacherId } }),
    prisma.lessonPlan.deleteMany({ where: { teacherId } }),
    prisma.timetableSlot.deleteMany({ where: { teacherId } }),
    prisma.student.deleteMany({ where: { class: { teacherId } } }),
    prisma.classGroup.deleteMany({ where: { teacherId } })
  ]);
  res.json({ success: true });
}));

app.get('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const periods = await prisma.dayPeriod.findMany({ where: { teacherId: req.user.id }, orderBy: { sortOrder: 'asc' } });
  res.json(periods.length ? periods : DEFAULT_PERIODS);
}));

app.post('/api/periods', requireAuth, asyncHandler(async (req, res) => {
  const periods = Array.isArray(req.body.periods) ? req.body.periods : [];
  const mapped = periods.map((p, index) => ({
    teacherId: req.user.id,
    sortOrder: index + 1,
    label: sanitizePlain(p.label) || `Period ${index + 1}`,
    startTime: String(p.startTime || '09:00').slice(0, 5),
    endTime: String(p.endTime || '10:00').slice(0, 5),
    isBreak: !!p.isBreak
  }));
  await prisma.$transaction([
    prisma.dayPeriod.deleteMany({ where: { teacherId: req.user.id } }),
    ...(mapped.length ? [prisma.dayPeriod.createMany({ data: mapped })] : [])
  ]);
  const saved = await prisma.dayPeriod.findMany({ where: { teacherId: req.user.id }, orderBy: { sortOrder: 'asc' } });
  res.json({ success: true, periods: saved });
}));

app.get('/api/classes', requireAuth, asyncHandler(async (req, res) => {
  const classes = await prisma.classGroup.findMany({
    where: { teacherId: req.user.id },
    include: { students: { orderBy: { name: 'asc' } } },
    orderBy: { name: 'asc' }
  });
  res.json(classes);
}));

app.post('/api/students/bulk-import', requireAuth, asyncHandler(async (req, res) => {
  const students = Array.isArray(req.body.students) ? req.body.students : [];
  const className = sanitizePlain(req.body.className);
  if (!className) return res.status(400).json({ error: { message: 'Class name required' } });

  const cls = await prisma.classGroup.upsert({
    where: { teacherId_name: { teacherId: req.user.id, name: className } },
    update: { isPinned: true },
    create: { name: className, isPinned: true, teacherId: req.user.id }
  });

  for (const s of students) {
    const data = {
      name: sanitizePlain(s.name),
      yearGroup: s.yearGroup == null ? null : sanitizePlain(s.yearGroup),
      sen: !!s.sen,
      pp: !!s.pp,
      fsm: !!s.fsm,
      targetGrade: s.targetGrade ? sanitizePlain(s.targetGrade) : null,
      catMean: s.catMean ? sanitizePlain(s.catMean) : null,
      gender: s.gender ? sanitizePlain(s.gender) : null,
      classId: cls.id
    };
    if (!data.name) continue;
    const externalRef = s.externalRef ? sanitizePlain(s.externalRef) : null;
    if (externalRef) {
      await prisma.student.upsert({
        where: { classId_externalRef: { classId: cls.id, externalRef } },
        update: data,
        create: { ...data, externalRef }
      });
    } else {
      const existing = await prisma.student.findFirst({ where: { classId: cls.id, name: data.name } });
      if (existing) await prisma.student.update({ where: { id: existing.id }, data });
      else await prisma.student.create({ data });
    }
  }
  res.json({ success: true, classId: cls.id });
}));

app.put('/api/classes/:id/color', requireAuth, asyncHandler(async (req, res) => {
  const cls = await requireOwnedClass(req.user.id, req.params.id);
  if (!cls) return res.status(404).json({ error: { message: 'Class not found' } });
  const colorHex = String(req.body.colorHex || '');
  if (!/^#[0-9a-f]{6}$/i.test(colorHex)) return res.status(400).json({ error: { message: 'Invalid colour' } });
  const updated = await prisma.classGroup.update({ where: { id: cls.id }, data: { colorHex } });
  res.json({ success: true, colorHex: updated.colorHex });
}));

app.get('/api/rooms', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.room.findMany({ where: { teacherId: req.user.id }, orderBy: { name: 'asc' } }));
}));

app.post('/api/rooms', requireAuth, asyncHandler(async (req, res) => {
  const name = sanitizePlain(req.body.name);
  if (!name) return res.status(400).json({ error: { message: 'Room name required' } });
  const room = await prisma.room.upsert({
    where: { teacherId_name: { teacherId: req.user.id, name } },
    update: {},
    create: { name, teacherId: req.user.id }
  });
  res.json(room);
}));

app.get('/api/timetable', requireAuth, asyncHandler(async (req, res) => {
  const where = { teacherId: req.user.id };
  if (req.query.weekType && ['A', 'B'].includes(req.query.weekType)) where.weekType = req.query.weekType;
  res.json(await prisma.timetableSlot.findMany({
    where,
    include: { class: true },
    orderBy: [{ weekType: 'asc' }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  }));
}));

app.post('/api/timetable', requireAuth, asyncHandler(async (req, res) => {
  const weekType = String(req.body.weekType || '').toUpperCase();
  const incoming = Array.isArray(req.body.slots) ? req.body.slots : (Array.isArray(req.body.blocks) ? req.body.blocks : []);
  if (!['A', 'B'].includes(weekType)) return res.status(400).json({ error: { message: 'weekType must be A or B' } });

  const slots = incoming.map(item => ({
    dayOfWeek: Number(item.dayOfWeek),
    period: Number(item.period),
    entryType: item.entryType === 'CLASS' ? 'CLASS' : 'CUSTOM',
    classId: item.entryType === 'CLASS' ? (item.classId || null) : null,
    label: item.entryType === 'CLASS' ? null : (sanitizePlain(item.label) || 'Custom')
  }));

  const invalid = slots.find(slot => !Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 1 || slot.dayOfWeek > 5 || !Number.isInteger(slot.period) || slot.period < 1 || (slot.entryType === 'CLASS' && !slot.classId));
  if (invalid) return res.status(400).json({ error: { message: 'Timetable payload contains an invalid day, period or class slot.' } });

  const seen = new Set();
  for (const slot of slots) {
    const key = `${slot.dayOfWeek}:${slot.period}`;
    if (seen.has(key)) return res.status(400).json({ error: { message: `Duplicate timetable slot for day ${slot.dayOfWeek}, period ${slot.period}.` } });
    seen.add(key);
  }

  const classIds = [...new Set(slots.map(slot => slot.classId).filter(Boolean))];
  if (classIds.length) {
    const owned = await prisma.classGroup.findMany({ where: { teacherId: req.user.id, id: { in: classIds } }, select: { id: true } });
    if (owned.length !== classIds.length) return res.status(403).json({ error: { message: 'Timetable contains a class you do not own.' } });
  }

  await prisma.$transaction(async tx => {
    await tx.timetableSlot.deleteMany({ where: { teacherId: req.user.id, weekType } });
    if (slots.length) {
      await tx.timetableSlot.createMany({
        data: slots.map(slot => ({ teacherId: req.user.id, weekType, ...slot }))
      });
    }
  });

  const saved = await prisma.timetableSlot.findMany({
    where: { teacherId: req.user.id, weekType },
    include: { class: true },
    orderBy: [{ dayOfWeek: 'asc' }, { period: 'asc' }]
  });
  res.json({ success: true, weekType, slots: saved });
}));

app.get('/api/lessons', requireAuth, asyncHandler(async (req, res) => {
  const where = { teacherId: req.user.id };
  if (req.query.from && req.query.to) {
    where.date = { gte: parseDateRangeStart(req.query.from), lte: parseDateRangeEnd(req.query.to) };
  }
  res.json(await prisma.lessonPlan.findMany({ where, include: { class: true }, orderBy: [{ date: 'asc' }, { period: 'asc' }] }));
}));

app.post('/api/lessons', requireAuth, asyncHandler(async (req, res) => {
  const date = parseDateOnly(req.body.date);
  const period = Number(req.body.period);
  const classId = req.body.classId || null;
  if (!Number.isInteger(period)) return res.status(400).json({ error: { message: 'Invalid period' } });
  if (classId && !(await requireOwnedClass(req.user.id, classId))) return res.status(403).json({ error: { message: 'Class not owned by user' } });
  const planText = sanitizeHTML(req.body.planText);
  const result = await prisma.lessonPlan.upsert({
    where: { teacherId_date_period: { teacherId: req.user.id, date, period } },
    update: { planText, classId, version: { increment: 1 } },
    create: { date, period, planText, classId, teacherId: req.user.id }
  });
  res.json(result);
}));

app.post('/api/lessons/bulk', requireAuth, asyncHandler(async (req, res) => {
  const lessons = Array.isArray(req.body.lessons) ? req.body.lessons : [];
  const results = [];
  for (const lesson of lessons) {
    const date = parseDateOnly(lesson.date);
    const period = Number(lesson.period);
    if (!Number.isInteger(period)) continue;
    const classId = lesson.classId || null;
    if (classId && !(await requireOwnedClass(req.user.id, classId))) continue;
    results.push(await prisma.lessonPlan.upsert({
      where: { teacherId_date_period: { teacherId: req.user.id, date, period } },
      update: { planText: sanitizeHTML(lesson.planText), classId, version: { increment: 1 } },
      create: { date, period, planText: sanitizeHTML(lesson.planText), classId, teacherId: req.user.id }
    }));
  }
  res.json(results);
}));

app.get('/api/notes', requireAuth, asyncHandler(async (req, res) => {
  const where = { teacherId: req.user.id };
  if (req.query.from && req.query.to) {
    where.date = { gte: parseDateRangeStart(req.query.from), lte: parseDateRangeEnd(req.query.to) };
  }
  res.json(await prisma.dailyNote.findMany({ where, orderBy: { date: 'asc' } }));
}));

app.post('/api/notes', requireAuth, asyncHandler(async (req, res) => {
  const date = parseDateOnly(req.body.date);
  const result = await prisma.dailyNote.upsert({
    where: { teacherId_date: { teacherId: req.user.id, date } },
    update: { noteText: sanitizeHTML(req.body.noteText), version: { increment: 1 } },
    create: { date, noteText: sanitizeHTML(req.body.noteText), teacherId: req.user.id }
  });
  res.json(result);
}));

app.get('/api/templates', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.template.findMany({ where: { teacherId: req.user.id }, orderBy: { className: 'asc' } }));
}));

app.post('/api/templates', requireAuth, asyncHandler(async (req, res) => {
  const className = sanitizePlain(req.body.className || 'General');
  const content = sanitizeHTML(req.body.content);
  const template = await prisma.template.upsert({
    where: { teacherId_className: { teacherId: req.user.id, className } },
    update: { content },
    create: { teacherId: req.user.id, className, content }
  });
  res.json(template);
}));

app.get('/api/seating', requireAuth, asyncHandler(async (req, res) => {
  const where = { teacherId: req.user.id };
  if (req.query.classId) where.classId = req.query.classId;
  if (req.query.roomId) where.roomId = req.query.roomId;
  const plans = await prisma.seatingPlan.findMany({ where, orderBy: { updatedAt: 'desc' } });
  res.json(plans.map(parseLayoutData));
}));

app.post('/api/seating', requireAuth, asyncHandler(async (req, res) => {
  const { classId, roomId, layoutData } = req.body;
  const [cls, room] = await Promise.all([requireOwnedClass(req.user.id, classId), requireOwnedRoom(req.user.id, roomId)]);
  if (!cls || !room) return res.status(403).json({ error: { message: 'Invalid class or room ownership' } });
  const safeLayout = {
    desks: Array.isArray(layoutData?.desks) ? layoutData.desks : [],
    furniture: Array.isArray(layoutData?.furniture) ? layoutData.furniture : [],
    students: Array.isArray(layoutData?.students) ? layoutData.students.map(s => ({ id: s.id, deskId: s.deskId || null })) : []
  };
  const plan = await prisma.seatingPlan.upsert({
    where: { teacherId_classId_roomId: { teacherId: req.user.id, classId, roomId } },
    update: { layoutData: JSON.stringify(safeLayout) },
    create: { classId, roomId, layoutData: JSON.stringify(safeLayout), teacherId: req.user.id }
  });
  res.json(parseLayoutData(plan));
}));

app.get('/api/markbook/:classId', requireAuth, asyncHandler(async (req, res) => {
  const cls = await requireOwnedClass(req.user.id, req.params.classId);
  if (!cls) return res.status(404).json({ error: { message: 'Class not found' } });
  res.json(await prisma.assessment.findMany({
    where: { classId: cls.id, teacherId: req.user.id },
    include: { grades: { include: { student: true } } },
    orderBy: { date: 'desc' }
  }));
}));

app.post('/api/markbook/:classId', requireAuth, asyncHandler(async (req, res) => {
  const cls = await requireOwnedClass(req.user.id, req.params.classId);
  if (!cls) return res.status(404).json({ error: { message: 'Class not found' } });
  const studentIds = (Array.isArray(req.body.grades) ? req.body.grades : []).map(g => g.studentId);
  const ownedStudents = await prisma.student.findMany({ where: { classId: cls.id, id: { in: studentIds } }, select: { id: true } });
  const owned = new Set(ownedStudents.map(s => s.id));
  const grades = (req.body.grades || []).filter(g => owned.has(g.studentId));
  res.json(await prisma.assessment.create({
    data: {
      title: sanitizePlain(req.body.title) || 'Assessment',
      date: parseDateOnly(req.body.date),
      classId: cls.id,
      teacherId: req.user.id,
      grades: { create: grades.map(g => ({ studentId: g.studentId, value: sanitizePlain(g.value) })) }
    }
  }));
}));

app.post('/api/markbook/grade', requireAuth, asyncHandler(async (req, res) => {
  const assessment = await prisma.assessment.findFirst({ where: { id: req.body.assessmentId, teacherId: req.user.id } });
  if (!assessment) return res.status(404).json({ error: { message: 'Assessment not found' } });
  const student = await prisma.student.findFirst({ where: { id: req.body.studentId, classId: assessment.classId } });
  if (!student) return res.status(404).json({ error: { message: 'Student not found in assessment class' } });
  res.json(await prisma.grade.upsert({
    where: { studentId_assessmentId: { studentId: student.id, assessmentId: assessment.id } },
    update: { value: sanitizePlain(req.body.value) },
    create: { studentId: student.id, assessmentId: assessment.id, value: sanitizePlain(req.body.value) }
  }));
}));

app.get('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { createdAt: 'desc' } }));
}));

app.post('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  const title = sanitizePlain(req.body.title);
  if (!title) return res.status(400).json({ error: { message: 'Title required' } });
  res.json(await prisma.kanbanTask.create({
    data: {
      title,
      notes: sanitizeHTML(req.body.notes),
      status: sanitizePlain(req.body.status) || 'TODO',
      priority: sanitizePlain(req.body.priority) || 'NORMAL',
      clientCreatedAt: req.body.clientCreatedAt ? new Date(req.body.clientCreatedAt) : null,
      teacherId: req.user.id
    }
  }));
}));

app.put('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  const task = await prisma.kanbanTask.findFirst({ where: { id: req.params.id, teacherId: req.user.id } });
  if (!task) return res.status(404).json({ error: { message: 'Task not found' } });
  const data = {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'status')) data.status = sanitizePlain(req.body.status);
  if (Object.prototype.hasOwnProperty.call(req.body, 'title')) data.title = sanitizePlain(req.body.title);
  if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) data.notes = sanitizeHTML(req.body.notes);
  if (Object.prototype.hasOwnProperty.call(req.body, 'priority')) data.priority = sanitizePlain(req.body.priority);
  res.json(await prisma.kanbanTask.update({ where: { id: task.id }, data }));
}));

app.delete('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  const task = await prisma.kanbanTask.findFirst({ where: { id: req.params.id, teacherId: req.user.id } });
  if (!task) return res.status(404).json({ error: { message: 'Task not found' } });
  await prisma.kanbanTask.delete({ where: { id: task.id } });
  res.status(204).end();
}));

async function callAI(user, messages) {
  const provider = user.aiProvider || 'openai';
  const providerEnvKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
  const apiKey = user.aiApiKey || providerEnvKey;
  if (!apiKey) throw new Error('API key required. Add one in Settings.');

  if (provider === 'anthropic') {
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const anthropicMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest', max_tokens: 4000, system: systemMessage, messages: anthropicMessages })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Anthropic request failed');
    return (data.content || []).map(part => part.text || '').join('');
  }

  const endpoint = provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = provider === 'openrouter' ? (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini') : (process.env.OPENAI_MODEL || 'gpt-4o-mini');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'AI request failed');
  return data.choices?.[0]?.message?.content || '';
}

app.post('/api/ai/slides', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const { topic, keyStage, curriculum, customStructure } = req.body;
  const diff = { KS3: 'Above Target, On Track, Developing, Below Target', KS4: 'GCSE Grades 9-1', Vocational: 'L1P, L1M, L1D, L2P, L2M, L2D, L2D*' }[keyStage] || '';
  const system = `You are a master UK teacher generating a presentation slide deck. Curriculum: ${curriculum || 'not specified'}. Differentiate for ${keyStage || 'secondary'} using the scale: ${diff}. Output ONLY a valid JSON array of objects without markdown wrappers. Each object must have keys title, content, speakerNotes. Follow this sequence: ${customStructure || user.slideStructure || '1. Retrieve\n2. Learning Intentions\n3. Explicit Instruction\n4. Apply\n5. Review'}`;
  const raw = await callAI(user, [{ role: 'system', content: system }, { role: 'user', content: `Topic: ${topic}` }]);
  await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 }, slideStructure: customStructure || user.slideStructure } });
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  res.json(JSON.parse(cleaned));
}));

app.post('/api/ai/toolkit', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const tool = String(req.body.tool || '');
  const topic = String(req.body.topic || '');
  const instruction = TOOLKIT_PROMPTS[tool];
  if (!instruction) return res.status(400).json({ error: { message: 'Unknown toolkit item.' } });
  const system = `You are an expert UK secondary education professional. ${instruction} Format the output as clean, accessible HTML. Do not fabricate specific student facts, school data, grades or evidence.`;
  const raw = await callAI(user, [{ role: 'system', content: system }, { role: 'user', content: topic }]);
  await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
  res.json({ text: sanitizeHTML(raw) });
}));

app.post('/api/ai/generate', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const prompt = String(req.body.prompt || '');
  if (!prompt.trim()) return res.status(400).json({ error: { message: 'Prompt required' } });
  const raw = await callAI(user, [
    { role: 'system', content: 'You are FlowDesk AI, a precise UK secondary teaching assistant. Return clean HTML suitable for inserting into a lesson plan. Preserve facts supplied by the teacher and do not invent pupil data.' },
    { role: 'user', content: prompt }
  ]);
  res.json({ text: sanitizeHTML(raw) });
}));

function requireAdmin(req, res, next) {
  prisma.user.findUnique({ where: { id: req.user.id } }).then(user => {
    if (!user || !user.isAdmin) return res.status(403).json({ error: { message: 'Not authorized' } });
    next();
  }).catch(next);
}

app.get('/api/admin/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, isAdmin: true }, orderBy: { name: 'asc' } }));
}));

app.put('/api/admin/users/:id/password', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: { message: 'Password must be at least 8 characters.' } });
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
  res.json({ success: true });
}));

app.post('/api/admin/wipe', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await prisma.$transaction([
    prisma.grade.deleteMany({}),
    prisma.behaviorLog.deleteMany({}),
    prisma.assessment.deleteMany({}),
    prisma.seatingPlan.deleteMany({}),
    prisma.lessonPlan.deleteMany({}),
    prisma.dailyNote.deleteMany({}),
    prisma.kanbanTask.deleteMany({}),
    prisma.timetableSlot.deleteMany({}),
    prisma.student.deleteMany({}),
    prisma.template.deleteMany({}),
    prisma.pushSubscription.deleteMany({}),
    prisma.classGroup.deleteMany({}),
    prisma.room.deleteMany({}),
    prisma.dayPeriod.deleteMany({})
  ]);
  res.json({ success: true, preserved: 'users' });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: { message: err.message || 'Server error' } });
});

app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
