const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const crypto = require('crypto');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '200mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sanitizeConfig = { ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h3', 'h4', 'strong', 'em', 'p', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'iframe', 'img', 'audio', 'source'], ALLOWED_ATTR: ['href', 'target', 'class', 'style', 'title', 'src', 'width', 'height', 'frameborder', 'allowfullscreen', 'controls', 'type'] };

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// === AUTHENTICATION ===
app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'All fields are required' });
    
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ error: 'Email already in use' });
    
    const user = await prisma.user.create({
        data: { email, name, passwordHash: hashPassword(password), isTrial: false }
    });
    res.json({ token: user.id, user: { name: user.name, email: user.email } });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    if (user.passwordHash !== 'disabled' && user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ token: user.id, user: { name: user.name, email: user.email } });
}));

// === AUTH MIDDLEWARE ===
app.use('/api', asyncHandler(async (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    
    const user = await prisma.user.findUnique({ where: { id: token } });
    if (!user) return res.status(401).json({ error: "Invalid session" });
    
    req.user = { id: user.id };
    next();
}));

// HARD WIPE
app.post('/api/auth/nuke-rosters', asyncHandler(async (req, res) => {
    await prisma.grade.deleteMany({ where: { student: { class: { teacherId: req.user.id } } } });
    await prisma.behaviorLog.deleteMany({ where: { student: { class: { teacherId: req.user.id } } } });
    await prisma.student.deleteMany({ where: { class: { teacherId: req.user.id } } });
    await prisma.assessment.deleteMany({ where: { teacherId: req.user.id } });
    await prisma.seatingPlan.deleteMany({ where: { teacherId: req.user.id } });
    await prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id } });
    await prisma.classGroup.deleteMany({ where: { teacherId: req.user.id } });
    await prisma.room.deleteMany({ where: { teacherId: req.user.id } });
    res.json({ success: true });
}));

async function assertOwnsClass(userId, classId) {
    const cls = await prisma.classGroup.findFirst({ where: { id: classId, teacherId: userId, archivedAt: null } });
    if (!cls) { const e = new Error('Class not found or unauthorized'); e.status = 404; throw e; }
    return cls;
}

app.get('/api/user/me', asyncHandler(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    res.json({ id: u.id, email: u.email, name: u.name, hoursSaved: u.hoursSaved, slideStructure: u.slideStructure, aiProvider: u.aiProvider, hasApiKey: !!u.aiApiKey, calendarIcs: u.calendarIcs, termStart: u.termStart, holidays: u.holidays });
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
    const mappedBlocks = blocks.map(b => ({
        teacherId: req.user.id, weekType, dayOfWeek: b.dayOfWeek, period: b.period, entryType: b.entryType,
        classId: b.entryType === 'CLASS' ? b.classId : null, label: b.entryType === 'CLASS' ? null : b.label
    }));
    await prisma.$transaction([ prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id, weekType } }), prisma.timetableSlot.createMany({ data: mappedBlocks }) ]);
    res.json({ success: true });
}));

app.post('/api/students/bulk-import', asyncHandler(async (req, res) => {
    const { students, className } = req.body;
    if(!students || students.length === 0) return res.json({ success: true });
    
    let cls = await prisma.classGroup.findFirst({ where: { teacherId: req.user.id, name: className, archivedAt: null }});
    if(!cls) {
        cls = await prisma.classGroup.create({ data: { name: className, colorHex: '#6366f1', teacherId: req.user.id }});
    }

    for(const s of students) {
        await prisma.student.upsert({
            where: { classId_externalRef: { classId: cls.id, externalRef: s.externalRef } },
            update: { name: s.name, sen: s.sen, catMean: s.catMean, gender: s.gender },
            create: { externalRef: s.externalRef, name: s.name, sen: s.sen, catMean: s.catMean, gender: s.gender, classId: cls.id }
        });
    }
    res.json({ success: true, classId: cls.id });
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
app.put('/api/tasks/:id', asyncHandler(async (req, res) => { 
    const updateData = {};
    if(req.body.status) updateData.status = req.body.status;
    if(req.body.title) updateData.title = req.body.title;
    res.json(await prisma.kanbanTask.update({ where: { id: req.params.id, teacherId: req.user.id }, data: updateData })); 
}));
app.post('/api/tasks', asyncHandler(async (req, res) => { 
    res.json(await prisma.kanbanTask.create({ 
        data: { title: req.body.title, status: req.body.status || 'TODO', teacherId: req.user.id } 
    })); 
}));

app.post('/api/settings/ai', asyncHandler(async (req, res) => {
    const { provider, apiKey, slideStructure, calendarIcs, termStart, holidays } = req.body;
    let data = {};
    if (provider) data.aiProvider = provider;
    if (apiKey) data.aiApiKey = apiKey;
    if (slideStructure) data.slideStructure = slideStructure;
    if (calendarIcs) data.calendarIcs = calendarIcs;
    if (termStart) data.termStart = new Date(termStart);
    if (holidays !== undefined) data.holidays = holidays;
    await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ success: true });
}));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: { message: err.message || 'Server error' }}); });
app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
