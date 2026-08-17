const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const session = require('express-session');
const { PrismaSessionStore } = require('@quixo3/prisma-session-store');
const webpush = require('web-push');
const bcrypt = require('bcrypt');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// VAPID keys for Web Push
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYpPNcXqGQ';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'N_cO05sX1v-0Yk4M2bUqP5_b5eI1_QZ1_hP-I9R-XzE';
webpush.setVapidDetails('mailto:admin@flowdesk.local', VAPID_PUBLIC, VAPID_PRIVATE);

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Secure Session Configuration
app.use(session({
    cookie: { 
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true, 
        sameSite: 'lax' 
    }, 
    secret: process.env.SESSION_SECRET || 'fallback_dev_secret_key',
    resave: false, 
    saveUninitialized: false,
    store: new PrismaSessionStore(prisma, { checkPeriod: 2 * 60 * 1000, dbRecordIdIsSessionId: true })
}));

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sanitizeConfig = { 
    ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h3', 'h4', 'strong', 'em', 'p', 'table', 'tr', 'td', 'th', 'thead', 'tbody'], 
    ALLOWED_ATTR: ['href', 'target', 'class'] 
};

// --- AUTHENTICATION ROUTES ---
app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: { message: 'All fields required' }});
    
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: { message: 'Email in use' }});

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, name, passwordHash } });
    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email, name: user.name });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }
    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email, name: user.name });
}));

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.status(204).end()); });

// --- AUTH GUARD MIDDLEWARE ---
function requireAuth(req, res, next) {
    if (req.path.startsWith('/api/dropbox/submit')) return next();
    if (!req.session.userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
    req.user = { id: req.session.userId };
    next();
}
app.use('/api', requireAuth);

// --- IDOR GUARD ---
async function assertOwnsClass(userId, classId) {
    const cls = await prisma.classGroup.findFirst({ where: { id: classId, teacherId: userId } });
    if (!cls) { const e = new Error('Class not found or unauthorized'); e.status = 404; throw e; }
    return cls;
}

// --- SECURE USER PROFILE (Excludes AI Key) ---
app.get('/api/user/me', asyncHandler(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    res.json({ id: u.id, email: u.email, name: u.name, hoursSaved: u.hoursSaved, slideStructure: u.slideStructure, aiProvider: u.aiProvider, hasApiKey: !!u.aiApiKey });
}));

// --- CORE APIS ---
app.get('/api/classes', asyncHandler(async (req, res) => { res.json(await prisma.classGroup.findMany({ where: { teacherId: req.user.id, archivedAt: null }, include: { students: true } })); }));
app.put('/api/classes/:id', asyncHandler(async (req, res) => {
    await assertOwnsClass(req.user.id, req.params.id);
    res.json(await prisma.classGroup.update({ where: { id: req.params.id }, data: { colorHex: req.body.colorHex } })); 
}));

app.get('/api/rooms', asyncHandler(async (req, res) => { res.json(await prisma.room.findMany({ where: { teacherId: req.user.id } })); }));
app.post('/api/rooms', asyncHandler(async (req, res) => { res.json(await prisma.room.create({ data: { name: req.body.name, teacherId: req.user.id } })); }));

// Date-Scoped Lesson Fetch
app.get('/api/lessons', asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    res.json(await prisma.lessonPlan.findMany({ 
        where: { teacherId: req.user.id, date: { gte: new Date(from), lte: new Date(to) } }, 
        include: { class: true } 
    })); 
}));
app.post('/api/lessons', asyncHandler(async (req, res) => {
    const { date, period, planText, classId } = req.body;
    res.json(await prisma.lessonPlan.upsert({
        where: { teacherId_date_period: { teacherId: req.user.id, date: new Date(date), period: parseInt(period) } },
        update: { planText: DOMPurify.sanitize(planText, sanitizeConfig), classId: classId || null, version: { increment: 1 } },
        create: { date: new Date(date), period: parseInt(period), planText: DOMPurify.sanitize(planText, sanitizeConfig), classId: classId || null, teacherId: req.user.id }
    }));
}));

// Date-Scoped Notes Fetch
app.get('/api/notes', asyncHandler(async (req, res) => { 
    const { from, to } = req.query;
    res.json(await prisma.dailyNote.findMany({ where: { teacherId: req.user.id, date: { gte: new Date(from), lte: new Date(to) } } })); 
}));
app.post('/api/notes', asyncHandler(async (req, res) => {
    res.json(await prisma.dailyNote.upsert({
        where: { teacherId_date: { teacherId: req.user.id, date: new Date(req.body.date) } },
        update: { noteText: DOMPurify.sanitize(req.body.noteText, sanitizeConfig), version: { increment: 1 } },
        create: { date: new Date(req.body.date), noteText: DOMPurify.sanitize(req.body.noteText, sanitizeConfig), teacherId: req.user.id }
    }));
}));

app.get('/api/timetable', asyncHandler(async (req, res) => { res.json(await prisma.timetableSlot.findMany({ where: { teacherId: req.user.id }, include: { class: true } })); }));
app.post('/api/timetable', asyncHandler(async (req, res) => {
    const { blocks, weekType } = req.body;
    const classNames = [...new Set(blocks.filter(b => b.entryType === 'CLASS').map(b => b.label))];
    const classMap = {};
    for (const name of classNames) {
        let cls = await prisma.classGroup.upsert({
            where: { teacherId_name: { teacherId: req.user.id, name } },
            update: {}, create: { name, teacherId: req.user.id }
        });
        classMap[name] = cls.id;
    }
    const mappedBlocks = blocks.map(b => ({
        teacherId: req.user.id, weekType, dayOfWeek: b.dayOfWeek, period: b.period, entryType: b.entryType,
        classId: b.entryType === 'CLASS' ? classMap[b.label] : null, label: b.entryType === 'CLASS' ? null : b.label
    }));
    await prisma.$transaction([
        prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id, weekType } }),
        prisma.timetableSlot.createMany({ data: mappedBlocks })
    ]);
    res.json({ success: true });
}));

// --- SEATING & BEHAVIOR (Destructive Import Fixed via Upsert) ---
app.post('/api/classes/:id/students/import', asyncHandler(async (req, res) => {
    await assertOwnsClass(req.user.id, req.params.id);
    const results = [];
    for (const s of req.body.students) {
        const created = await prisma.student.upsert({
            where: { classId_externalRef: { classId: req.params.id, externalRef: s.externalRef } },
            update: { name: DOMPurify.sanitize(s.name, {ALLOWED_TAGS:[]}), sen: s.sen, pp: s.pp, fsm: s.fsm, targetGrade: s.targetGrade },
            create: { ...s, classId: req.params.id }
        });
        results.push(created);
    }
    res.json({ success: true, count: results.length });
}));

app.post('/api/students/:id/behavior', asyncHandler(async (req, res) => {
    const student = await prisma.student.findFirst({ where: { id: req.params.id, class: { teacherId: req.user.id } } });
    if (!student) return res.status(404).json({ error: { message: 'Student not found or unauthorized' } });
    res.json(await prisma.behaviorLog.create({ data: { type: req.body.type, points: req.body.points, reason: req.body.reason, studentId: student.id } }));
}));

app.get('/api/seating', asyncHandler(async (req, res) => { res.json(await prisma.seatingPlan.findMany({ where: { teacherId: req.user.id } })); }));
app.post('/api/seating', asyncHandler(async (req, res) => {
    await assertOwnsClass(req.user.id, req.body.classId);
    res.json(await prisma.seatingPlan.upsert({
        where: { teacherId_classId_roomId: { teacherId: req.user.id, classId: req.body.classId, roomId: req.body.roomId } },
        update: { layoutData: JSON.stringify(req.body.layoutData) },
        create: { classId: req.body.classId, roomId: req.body.roomId, layoutData: JSON.stringify(req.body.layoutData), teacherId: req.user.id }
    }));
}));

// --- MARKBOOK (IDOR Guarded) ---
app.get('/api/markbook/:classId', asyncHandler(async (req, res) => {
    await assertOwnsClass(req.user.id, req.params.classId);
    res.json(await prisma.assessment.findMany({ where: { classId: req.params.classId, teacherId: req.user.id }, include: { grades: { include: { student: true } } } }));
}));
app.post('/api/markbook/:classId', asyncHandler(async (req, res) => {
    await assertOwnsClass(req.user.id, req.params.classId);
    res.json(await prisma.assessment.create({
        data: { title: DOMPurify.sanitize(req.body.title, {ALLOWED_TAGS:[]}), date: new Date(req.body.date), classId: req.params.classId, teacherId: req.user.id,
            grades: { create: req.body.grades.map(g => ({ studentId: g.studentId, value: g.value })) }
        }
    }));
}));

// --- TASKS ---
app.get('/api/tasks', asyncHandler(async (req, res) => { res.json(await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { createdAt: 'desc' } })); }));
app.post('/api/tasks', asyncHandler(async (req, res) => {
    res.json(await prisma.kanbanTask.create({ data: { title: DOMPurify.sanitize(req.body.title, { ALLOWED_TAGS: [] }), status: req.body.status, clientCreatedAt: new Date(req.body.clientCreatedAt), teacherId: req.user.id } }));
}));
app.put('/api/tasks/:id', asyncHandler(async (req, res) => { res.json(await prisma.kanbanTask.update({ where: { id: req.params.id, teacherId: req.user.id }, data: { status: req.body.status } })); }));
app.post('/api/dropbox/submit', asyncHandler(async (req, res) => {
    const dropBox = await prisma.taskDropBox.findUnique({ where: { token: req.body.token } });
    if (!dropBox || !dropBox.isActive) return res.status(403).json({ error: { message: "Invalid link." } });
    await prisma.kanbanTask.create({ data: { title: DOMPurify.sanitize(req.body.title, { ALLOWED_TAGS: [] }) + " (Delegated)", status: "TODO", teacherId: dropBox.teacherId } });
    res.json({ success: true });
}));

// --- AI STUDIO & TOOLS ---
app.post('/api/settings/ai', asyncHandler(async (req, res) => {
    await prisma.user.update({ where: { id: req.user.id }, data: { aiProvider: req.body.provider, aiApiKey: req.body.apiKey, slideStructure: req.body.slideStructure } });
    res.json({ success: true });
}));

app.post('/api/ai/slides', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("API Key required.");

    const { topic, keyStage, curriculum, customStructure } = req.body;
    let differentiation = "Target specific needs.";
    if (keyStage === 'KS3') differentiation = "Above Target, On Track, Developing, Below Target";
    else if (keyStage === 'KS4') differentiation = "GCSE Grades 9-1";
    else if (keyStage === 'Vocational') differentiation = "L1P, L1M, L1D, L2P, L2M, L2D, L2D*";

    const slideHeadings = customStructure || "1. Retrieve\n2. Learning Intentions\n3. Explicit Instruction\n4. Green Zone\n5. Review";

    const systemPrompt = `You are a master teacher generating a presentation slide deck. Curriculum: ${curriculum}. Differentiate for ${keyStage} using: ${differentiation}.
Output ONLY a valid JSON array of objects. Do not include markdown formatting.
Each object must represent one slide with keys: 'title', 'content', 'speakerNotes'.
The array MUST correspond to this sequence:
${slideHeadings}`;

    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [ { role: "system", content: systemPrompt }, { role: "user", content: `Topic: ${topic}` } ] })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
    res.json(JSON.parse(data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim()));
}));

app.post('/api/ai/toolkit', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("API Key required.");

    const { tool, topic } = req.body;
    let systemPrompt = `You are an expert UK education professional. Format output in clean HTML divs.`;
    if (tool === 'song') systemPrompt += ` Write a catchy song summarizing the topic.`;
    else if (tool === 'comprehension') systemPrompt += ` Generate a reading passage on the topic, followed by 3 differentiated question sets.`;
    else if (tool === 'policy') systemPrompt += ` Write a formal, comprehensive UK school policy document regarding this topic.`;
    else if (tool === 'observation') systemPrompt += ` Write constructive lesson observation feedback based on these notes.`;

    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Context/Topic: ${topic}` }] })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
    res.json({ text: DOMPurify.sanitize(data.choices[0].message.content, sanitizeConfig) });
}));

// Push Subscriptions
app.get('/api/vapidPublicKey', (req, res) => { res.send(vapidKeys.publicKey); });
app.post('/api/push/subscribe', asyncHandler(async (req, res) => {
    await prisma.pushSubscription.upsert({
        where: { endpoint: req.body.endpoint },
        update: { keys: JSON.stringify(req.body.keys) },
        create: { endpoint: req.body.endpoint, keys: JSON.stringify(req.body.keys), teacherId: req.user.id }
    });
    res.status(201).json({});
}));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: { message: err.message || 'Server error' }}); });
app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
