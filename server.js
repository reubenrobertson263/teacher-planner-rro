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

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

// FIXED: Removed the strict 'secure' check that causes Render proxies to drop cookies.
app.use(session({
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }, 
    secret: process.env.SESSION_SECRET || 'FlowDesk_Secure_Fallback_Key_2026!',
    resave: false, saveUninitialized: false,
    store: new PrismaSessionStore(prisma, { checkPeriod: 2 * 60 * 1000, dbRecordIdIsSessionId: true })
}));

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sanitizeConfig = { ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h3', 'h4', 'strong', 'em', 'p', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'iframe', 'img'], ALLOWED_ATTR: ['href', 'target', 'class', 'style', 'title', 'src', 'width', 'height', 'frameborder', 'allowfullscreen'] };

async function seedReubenClasses(userId, email, name) {
    if (!name || !email) return;
    if (name.toLowerCase().includes('reuben') || email.toLowerCase().includes('reuben')) {
        const classCount = await prisma.classGroup.count({ where: { teacherId: userId, archivedAt: null } });
        if (classCount === 0) {
            const myClasses = ['9a/Dt2', '10O3/Em1', '11O3/Em', '9b/Dt1', '11O1/Em1', '9b/Dt3', '8b/Dt2', '7a/DT2', '7b/DT3', '8b/Dt3', '8a/Dt2', '8a/Dt4'];
            const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#64748b'];
            const classData = myClasses.map((c, index) => ({ name: c, colorHex: colors[index % colors.length], teacherId: userId }));
            await prisma.classGroup.createMany({ data: classData });
            const roomCount = await prisma.room.count({ where: { teacherId: userId, name: 'IT2' } });
            if(roomCount === 0) await prisma.room.create({ data: { name: 'IT2', teacherId: userId } });
        }
    }
}

app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const { email, password, name, isTrial } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: { message: 'All fields required' }});
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: { message: 'Email in use' }});
    const passwordHash = await bcrypt.hash(password, 12);
    let trialExpires = null;
    if (isTrial) { trialExpires = new Date(); trialExpires.setDate(trialExpires.getDate() + 3); }
    const user = await prisma.user.create({ data: { email, name, passwordHash, isTrial: !!isTrial, trialExpiresAt: trialExpires, termStart: new Date("2026-08-31T00:00:00.000Z"), holidays: "2026-10-26,2026-12-21,2026-12-28,2027-02-15,2027-03-29,2027-04-05,2027-05-31" } });
    req.session.userId = user.id; req.session.trialExpiresAt = user.trialExpiresAt;
    await seedReubenClasses(user.id, user.email, user.name);
    
    // FIXED: Explicitly wait for session to save before sending response
    req.session.save((err) => {
        if(err) return res.status(500).json({ error: { message: "Session error" }});
        res.json({ id: user.id, email: user.email, name: user.name, isTrial: user.isTrial });
    });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: { message: 'Invalid credentials' } });
    req.session.userId = user.id; req.session.trialExpiresAt = user.trialExpiresAt;
    
    // FIXED: Explicitly wait for session to save before sending response
    req.session.save((err) => {
        if(err) return res.status(500).json({ error: { message: "Session error" }});
        res.json({ id: user.id, email: user.email, name: user.name, isTrial: user.isTrial });
    });
}));

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.status(204).end()); });

app.get('/api/auth/nuke', asyncHandler(async (req, res) => {
    await prisma.behaviorLog.deleteMany({}); await prisma.grade.deleteMany({}); await prisma.student.deleteMany({}); await prisma.assessment.deleteMany({}); await prisma.seatingPlan.deleteMany({}); await prisma.timetableSlot.deleteMany({}); await prisma.lessonPlan.deleteMany({}); await prisma.dailyNote.deleteMany({}); await prisma.kanbanTask.deleteMany({}); await prisma.taskDropBox.deleteMany({}); await prisma.template.deleteMany({}); await prisma.pushSubscription.deleteMany({}); await prisma.classGroup.deleteMany({}); await prisma.room.deleteMany({}); await prisma.user.deleteMany({}); 
    req.session.destroy();
    res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px;"><h1 style="color:#10b981;">Database Cleared!</h1><a href="/" style="padding:10px 20px; background:#4f46e5; color:white; text-decoration:none; border-radius:6px; display:inline-block; margin-top:20px;">Go back to FlowDesk</a></div>`);
}));

app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/api/dropbox/submit')) return next();
    if (!req.session.userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
    if (req.session.trialExpiresAt && new Date() > new Date(req.session.trialExpiresAt)) return res.status(403).json({ error: { message: 'Your 3-Day Trial has expired.' }});
    req.user = { id: req.session.userId };
    next();
});

async function assertOwnsClass(userId, classId) {
    const cls = await prisma.classGroup.findFirst({ where: { id: classId, teacherId: userId, archivedAt: null } });
    if (!cls) { const e = new Error('Class not found or unauthorized'); e.status = 404; throw e; }
    return cls;
}

app.get('/api/user/me', asyncHandler(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    await seedReubenClasses(u.id, u.email, u.name); 
    res.json({ 
        id: u.id, email: u.email, name: u.name, hoursSaved: u.hoursSaved, slideStructure: u.slideStructure, 
        aiProvider: u.aiProvider, hasApiKey: !!u.aiApiKey, calendarIcs: u.calendarIcs, 
        arborAppId: u.arborAppId, msTeamsToken: u.msTeamsToken, termStart: u.termStart, holidays: u.holidays 
    });
}));

app.post('/api/auth/nuke-rosters', asyncHandler(async (req, res) => {
    const userClasses = await prisma.classGroup.findMany({ where: { teacherId: req.user.id }, select: { id: true }});
    const classIds = userClasses.map(c => c.id);
    await prisma.behaviorLog.deleteMany({ where: { student: { classId: { in: classIds } } } });
    await prisma.grade.deleteMany({ where: { student: { classId: { in: classIds } } } });
    await prisma.student.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.seatingPlan.deleteMany({ where: { teacherId: req.user.id } });
    res.json({ success: true });
}));

app.post('/api/settings/ai', asyncHandler(async (req, res) => {
    const { provider, apiKey, slideStructure, calendarIcs, arborApiKey, msTeamsToken, termStart, holidays } = req.body;
    let data = { aiProvider: provider, aiApiKey: apiKey, slideStructure: slideStructure, calendarIcs: calendarIcs, arborApiKey: arborApiKey, msTeamsToken: msTeamsToken, holidays: holidays };
    if (termStart) data.termStart = new Date(termStart);
    await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ success: true });
}));

app.post('/api/students/bulk-import', asyncHandler(async (req, res) => {
    const { students } = req.body;
    let createdClasses = 0;
    let processedStudents = 0;
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#64748b'];

    for (const s of students) {
        if (!s.className) continue;
        let cls = await prisma.classGroup.findFirst({ where: { teacherId: req.user.id, name: s.className } });
        if (!cls) {
            cls = await prisma.classGroup.create({ data: { name: s.className, colorHex: colors[createdClasses % colors.length], teacherId: req.user.id } });
            createdClasses++;
        }
        const { className, ...studentData } = s;
        await prisma.student.upsert({
            where: { classId_externalRef: { classId: cls.id, externalRef: studentData.externalRef } },
            update: { name: DOMPurify.sanitize(studentData.name, {ALLOWED_TAGS:[]}), sen: studentData.sen, pp: studentData.pp, targetGrade: studentData.targetGrade, catMean: studentData.catMean, gender: studentData.gender },
            create: { ...studentData, classId: cls.id }
        });
        processedStudents++;
    }
    res.json({ success: true, createdClasses, processedStudents });
}));

app.get('/api/classes', asyncHandler(async (req, res) => { res.json(await prisma.classGroup.findMany({ where: { teacherId: req.user.id, archivedAt: null }, include: { students: true } })); }));
app.put('/api/classes/:id', asyncHandler(async (req, res) => { await assertOwnsClass(req.user.id, req.params.id); res.json(await prisma.classGroup.update({ where: { id: req.params.id }, data: { colorHex: req.body.colorHex, gradingSchema: req.body.gradingSchema } })); }));
app.delete('/api/classes/:id', asyncHandler(async (req, res) => { await assertOwnsClass(req.user.id, req.params.id); res.json(await prisma.classGroup.update({ where: { id: req.params.id }, data: { archivedAt: new Date() } })); }));

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
    const { from, to } = req.query; res.json(await prisma.dailyNote.findMany({ where: { teacherId: req.user.id, date: { gte: new Date(from), lte: new Date(to) } } })); 
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
        let cls = await prisma.classGroup.upsert({ where: { teacherId_name: { teacherId: req.user.id, name } }, update: { archivedAt: null }, create: { name, colorHex: '#6366f1', teacherId: req.user.id } });
        classMap[name] = cls.id;
    }
    const mappedBlocks = blocks.map(b => ({
        teacherId: req.user.id, weekType, dayOfWeek: b.dayOfWeek, period: b.period, entryType: b.entryType,
        classId: b.entryType === 'CLASS' ? classMap[b.label] : null, label: b.entryType === 'CLASS' ? null : b.label
    }));
    await prisma.$transaction([ prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id, weekType } }), prisma.timetableSlot.createMany({ data: mappedBlocks }) ]);
    res.json({ success: true });
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
        data: { 
            title: DOMPurify.sanitize(req.body.title, {ALLOWED_TAGS:[]}), date: new Date(req.body.date), classId: req.params.classId, teacherId: req.user.id,
            grades: { create: req.body.grades.map(g => ({ studentId: g.studentId, value: g.value })) }
        }
    }));
}));

app.post('/api/markbook/grade', asyncHandler(async (req, res) => {
    const { studentId, assessmentId, value } = req.body;
    res.json(await prisma.grade.upsert({
        where: { studentId_assessmentId: { studentId, assessmentId } },
        update: { value }, create: { studentId, assessmentId, value }
    }));
}));

app.get('/api/tasks', asyncHandler(async (req, res) => { res.json(await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { createdAt: 'desc' } })); }));
app.post('/api/tasks', asyncHandler(async (req, res) => { res.json(await prisma.kanbanTask.create({ data: { title: DOMPurify.sanitize(req.body.title, { ALLOWED_TAGS: [] }), status: req.body.status, clientCreatedAt: new Date(req.body.clientCreatedAt), teacherId: req.user.id } })); }));
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

app.post('/api/ai/slides', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    const { topic, keyStage, curriculum, customStructure } = req.body;
    if (!apiKey) throw new Error("API Key required.");
    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: "Output ONLY a valid JSON array representing slides." }, { role: "user", content: `Topic: ${topic}` }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    res.json(JSON.parse(data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim()));
}));

app.post('/api/ai/toolkit', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    const { tool, topic } = req.body;
    if (!apiKey) throw new Error("API Key required.");
    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: "Format output in clean HTML." }, { role: "user", content: `Tool: ${tool}, Context: ${topic}` }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    res.json({ text: DOMPurify.sanitize(data.choices[0].message.content, sanitizeConfig) });
}));

app.post('/api/ai/chat', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("API Key required.");
    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: req.body.message }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    res.json({ text: data.choices[0].message.content });
}));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: { message: err.message || 'Server error' }}); });
app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
