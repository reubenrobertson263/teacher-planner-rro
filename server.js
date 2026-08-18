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

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYpPNcXqGQ';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'N_cO05sX1v-0Yk4M2bUqP5_b5eI1_QZ1_hP-I9R-XzE';
webpush.setVapidDetails('mailto:admin@flowdesk.local', VAPID_PUBLIC, VAPID_PRIVATE);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

app.use(session({
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax' }, 
    secret: process.env.SESSION_SECRET || 'FlowDesk_Secure_Fallback_Key_2026!',
    resave: false, saveUninitialized: false,
    store: new PrismaSessionStore(prisma, { checkPeriod: 2 * 60 * 1000, dbRecordIdIsSessionId: true })
}));

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sanitizeConfig = { ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h3', 'h4', 'strong', 'em', 'p', 'table', 'tr', 'td', 'th', 'thead', 'tbody'], ALLOWED_ATTR: ['href', 'target', 'class'] };

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
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: { message: 'Invalid credentials' } });
    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email, name: user.name });
}));

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.status(204).end()); });
app.get('/api/auth/nuke', asyncHandler(async (req, res) => {
    await prisma.user.deleteMany({}); req.session.destroy();
    res.send(`<div style="text-align:center; padding:50px;"><h1 style="color:#10b981;">Database Cleared!</h1><a href="/" style="padding:10px 20px; background:#4f46e5; color:white; text-decoration:none; border-radius:6px;">Go back to FlowDesk</a></div>`);
}));

// --- DROP-BOX SUBMISSION (No Auth Required) ---
app.post('/api/dropbox/submit', asyncHandler(async (req, res) => {
    const dropBox = await prisma.taskDropBox.findUnique({ where: { token: req.body.token } });
    if (!dropBox || !dropBox.isActive) return res.status(403).json({ error: { message: "Invalid link." } });
    await prisma.kanbanTask.create({ data: { title: DOMPurify.sanitize(req.body.title, { ALLOWED_TAGS: [] }) + " (Delegated)", status: "TODO", teacherId: dropBox.teacherId } });
    res.json({ success: true });
}));

// --- AUTH GUARD ---
app.use('/api', (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
    req.user = { id: req.session.userId };
    next();
});

async function assertOwnsClass(userId, classId) {
    const cls = await prisma.classGroup.findFirst({ where: { id: classId, teacherId: userId } });
    if (!cls) { const e = new Error('Class not found or unauthorized'); e.status = 404; throw e; }
    return cls;
}

app.get('/api/user/me', asyncHandler(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    res.json({ id: u.id, email: u.email, name: u.name, hoursSaved: u.hoursSaved, slideStructure: u.slideStructure, aiProvider: u.aiProvider, hasApiKey: !!u.aiApiKey });
}));

// --- CORE APIS ---
app.get('/api/classes', asyncHandler(async (req, res) => { res.json(await prisma.classGroup.findMany({ where: { teacherId: req.user.id, archivedAt: null }, include: { students: true } })); }));
app.put('/api/classes/:id', asyncHandler(async (req, res) => { await assertOwnsClass(req.user.id, req.params.id); res.json(await prisma.classGroup.update({ where: { id: req.params.id }, data: { colorHex: req.body.colorHex } })); }));
app.get('/api/rooms', asyncHandler(async (req, res) => { res.json(await prisma.room.findMany({ where: { teacherId: req.user.id } })); }));
app.post('/api/rooms', asyncHandler(async (req, res) => { res.json(await prisma.room.create({ data: { name: req.body.name, teacherId: req.user.id } })); }));

app.get('/api/lessons', asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    res.json(await prisma.lessonPlan.findMany({ where: { teacherId: req.user.id, date: { gte: new Date(from), lte: new Date(to) } }, include: { class: true } })); 
}));
app.post('/api/lessons', asyncHandler(async (req, res) => {
    const { date, period, planText, classId } = req.body;
    res.json(await prisma.lessonPlan.upsert({
        where: { teacherId_date_period: { teacherId: req.user.id, date: new Date(date), period: parseInt(period) } },
        update: { planText: DOMPurify.sanitize(planText, sanitizeConfig), classId: classId || null, version: { increment: 1 } },
        create: { date: new Date(date), period: parseInt(period), planText: DOMPurify.sanitize(planText, sanitizeConfig), classId: classId || null, teacherId: req.user.id }
    }));
}));

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
        let cls = await prisma.classGroup.upsert({ where: { teacherId_name: { teacherId: req.user.id, name } }, update: {}, create: { name, teacherId: req.user.id } });
        classMap[name] = cls.id;
    }
    const mappedBlocks = blocks.map(b => ({
        teacherId: req.user.id, weekType, dayOfWeek: b.dayOfWeek, period: b.period, entryType: b.entryType,
        classId: b.entryType === 'CLASS' ? classMap[b.label] : null, label: b.entryType === 'CLASS' ? null : b.label
    }));
    await prisma.$transaction([ prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id, weekType } }), prisma.timetableSlot.createMany({ data: mappedBlocks }) ]);
    res.json({ success: true });
}));

app.post('/api/classes/:id/students/import', asyncHandler(async (req, res) => {
    await assertOwnsClass(req.user.id, req.params.id);
    const results = [];
    for (const s of req.body.students) {
        results.push(await prisma.student.upsert({
            where: { classId_externalRef: { classId: req.params.id, externalRef: s.externalRef } },
            update: { name: DOMPurify.sanitize(s.name, {ALLOWED_TAGS:[]}), sen: s.sen, pp: s.pp, fsm: s.fsm, targetGrade: s.targetGrade },
            create: { ...s, classId: req.params.id }
        }));
    }
    res.json({ success: true, count: results.length });
}));

app.post('/api/students/:id/behavior', asyncHandler(async (req, res) => {
    const student = await prisma.student.findFirst({ where: { id: req.params.id, class: { teacherId: req.user.id } } });
    if (!student) return res.status(404).json({ error: { message: 'Student not found' } });
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

// --- TASKS & DROP-BOX CREATION ---
app.get('/api/tasks', asyncHandler(async (req, res) => { res.json(await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { createdAt: 'desc' } })); }));
app.post('/api/tasks', asyncHandler(async (req, res) => {
    res.json(await prisma.kanbanTask.create({ data: { title: DOMPurify.sanitize(req.body.title, { ALLOWED_TAGS: [] }), status: req.body.status, clientCreatedAt: new Date(req.body.clientCreatedAt), teacherId: req.user.id } }));
}));
app.put('/api/tasks/:id', asyncHandler(async (req, res) => { res.json(await prisma.kanbanTask.update({ where: { id: req.params.id, teacherId: req.user.id }, data: { status: req.body.status } })); }));
app.post('/api/dropbox/create', asyncHandler(async (req, res) => {
    let dropBox = await prisma.taskDropBox.findFirst({ where: { teacherId: req.user.id, isActive: true } });
    if (!dropBox) {
        const crypto = require('crypto');
        const token = crypto.randomBytes(16).toString('hex');
        dropBox = await prisma.taskDropBox.create({ data: { token, teacherId: req.user.id } });
    }
    res.json({ token: dropBox.token });
}));

// --- AI STUDIO & TOOLS ---
app.post('/api/settings/ai', asyncHandler(async (req, res) => {
    const { provider, apiKey, slideStructure } = req.body;
    await prisma.user.update({ where: { id: req.user.id }, data: { aiProvider: provider, aiApiKey: apiKey, slideStructure: slideStructure } });
    res.json({ success: true });
}));

app.post('/api/ai/slides', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    const { topic, keyStage, curriculum, customStructure } = req.body;

    let differentiation = "";
    if (keyStage === 'KS3') differentiation = "Above Target, On Track, Developing, Below Target";
    else if (keyStage === 'KS4') differentiation = "GCSE Grades 9-1";
    else if (keyStage === 'Vocational') differentiation = "L1P, L1M, L1D, L2P, L2M, L2D, L2D*";

    const slideHeadings = customStructure || "1. Retrieve\n2. Learning Intentions\n3. Explicit Instruction\n4. Green Zone\n5. Review";

    const systemPrompt = `You are a master teacher generating a presentation slide deck. Curriculum: ${curriculum}. Differentiate for ${keyStage} using the scale: ${differentiation}.
Output ONLY a valid JSON array of objects. Do not include markdown formatting.
Each object must represent one slide with the exact keys: 'title', 'content', 'speakerNotes'.
The array MUST contain slides corresponding to this exact sequence/structure:
${slideHeadings}`;

    if (!apiKey) throw new Error("API Key required for Slide Generation.");

    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Topic: ${topic}` }] })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
    let jsonString = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
    res.json(JSON.parse(jsonString));
}));

app.post('/api/ai/toolkit', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    const { tool, topic } = req.body;

    let systemPrompt = `You are an expert UK education professional. Format output in clean HTML divs.`;
    if (tool === 'song') systemPrompt += ` Write a catchy song summarizing the topic.`;
    else if (tool === 'comprehension') systemPrompt += ` Generate a reading passage on the topic, followed by 3 differentiated question sets.`;
    else if (tool === 'explainer') systemPrompt += ` Explain the concept as if I am 11 years old, using an everyday analogy.`;
    else if (tool === 'spag') systemPrompt += ` Write 3 incorrect sentences related to the topic for students to correct spelling, punctuation, and grammar.`;
    else if (tool === 'quiz') systemPrompt += ` Generate a 5-question multiple choice quiz with an answer key at the bottom.`;
    else if (tool === 'markscheme') systemPrompt += ` Generate a detailed mark scheme or rubric for this topic.`;
    else if (tool === 'email') systemPrompt += ` Draft a highly professional, polite email to parents/colleagues regarding this topic.`;
    else if (tool === 'assembly') systemPrompt += ` Write an engaging, 3-minute assembly script suitable for secondary students.`;
    else if (tool === 'policy') systemPrompt += ` Write a formal, comprehensive UK school policy document.`;
    else if (tool === 'newsletter') systemPrompt += ` Write a warm, professional parent/carer newsletter segment.`;
    else if (tool === 'observation') systemPrompt += ` Write constructive, professional, formal lesson observation feedback.`;

    if (!apiKey) throw new Error("API Key required.");

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

app.get('/api/vapidPublicKey', (req, res) => { res.send(VAPID_PUBLIC); });
app.post('/api/push/subscribe', asyncHandler(async (req, res) => {
    await prisma.pushSubscription.upsert({ where: { endpoint: req.body.endpoint }, update: { keys: JSON.stringify(req.body.keys) }, create: { endpoint: req.body.endpoint, keys: JSON.stringify(req.body.keys), teacherId: req.user.id } });
    res.status(201).json({});
}));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: { message: err.message || 'Server error' }}); });
app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
