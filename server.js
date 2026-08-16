const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const session = require('express-session');
const { PrismaSessionStore } = require('@quixo3/prisma-session-store');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// TRUE AUTHENTICATION FOUNDATION: Session Management
app.use(
    session({
        cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 1 week
        secret: process.env.SESSION_SECRET || 'dev_secret_key_change_in_prod',
        resave: true,
        saveUninitialized: true,
        store: new PrismaSessionStore(prisma, {
            checkPeriod: 2 * 60 * 1000, dbRecordIdIsSessionId: true, dbRecordIdFunction: undefined,
        })
    })
);

// Auth Middleware: Assigns default profile for dev, but establishes the session boundary.
app.use(async (req, res, next) => {
    if (!req.session.userId) {
        let teacher = await prisma.user.findFirst();
        if (!teacher) teacher = await prisma.user.create({ data: { email: 'reuben@bchs.local', name: 'Reuben' } });
        req.session.userId = teacher.id;
    }
    req.user = { id: req.session.userId };
    next();
});

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sanitizeConfig = { ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span'], ALLOWED_ATTR: ['href', 'target', 'style'] };

// Classes API (New for Sprint 2)
app.get('/api/classes', asyncHandler(async (req, res) => {
    const classes = await prisma.classGroup.findMany({ where: { teacherId: req.user.id } });
    res.json(classes);
}));

// Lessons API
app.get('/api/lessons', asyncHandler(async (req, res) => {
    const lessons = await prisma.lessonPlan.findMany({ 
        where: { teacherId: req.user.id },
        include: { class: true }
    });
    res.json(lessons);
}));

app.post('/api/lessons', asyncHandler(async (req, res) => {
    const { date, period, planText, classId } = req.body;
    const cleanHTML = DOMPurify.sanitize(planText, sanitizeConfig);
    const targetDate = new Date(date);
    
    const lesson = await prisma.lessonPlan.upsert({
        where: { teacherId_date_period: { teacherId: req.user.id, date: targetDate, period: parseInt(period) } },
        update: { planText: cleanHTML, classId: classId || null, version: { increment: 1 } },
        create: { date: targetDate, period: parseInt(period), planText: cleanHTML, classId: classId || null, teacherId: req.user.id }
    });
    res.json(lesson);
}));

app.post('/api/lessons/bulk', asyncHandler(async (req, res) => {
    const { updates } = req.body;
    const results = await prisma.$transaction(
        updates.map(update => prisma.lessonPlan.upsert({
            where: { teacherId_date_period: { teacherId: req.user.id, date: new Date(update.date), period: parseInt(update.period) } },
            update: { planText: DOMPurify.sanitize(update.planText, sanitizeConfig), version: { increment: 1 } },
            create: { date: new Date(update.date), period: parseInt(update.period), planText: DOMPurify.sanitize(update.planText, sanitizeConfig), teacherId: req.user.id }
        }))
    );
    res.json({ success: true, count: results.length });
}));

// Notes API
app.get('/api/notes', asyncHandler(async (req, res) => {
    const notes = await prisma.dailyNote.findMany({ where: { teacherId: req.user.id } });
    res.json(notes);
}));

app.post('/api/notes', asyncHandler(async (req, res) => {
    const { date, noteText } = req.body;
    const targetDate = new Date(date);
    const note = await prisma.dailyNote.upsert({
        where: { teacherId_date: { teacherId: req.user.id, date: targetDate } },
        update: { noteText: DOMPurify.sanitize(noteText, sanitizeConfig), version: { increment: 1 } },
        create: { date: targetDate, noteText: DOMPurify.sanitize(noteText, sanitizeConfig), teacherId: req.user.id }
    });
    res.json(note);
}));

// Timetable API (Updated for TimetableEntryType)
app.get('/api/timetable', asyncHandler(async (req, res) => {
    const blocks = await prisma.timetableSlot.findMany({ 
        where: { teacherId: req.user.id },
        include: { class: true }
    });
    res.json(blocks);
}));

app.post('/api/timetable', asyncHandler(async (req, res) => {
    const { blocks, weekType } = req.body;
    
    // First, ensure all passed classes exist and assign colour keys
    const classNames = [...new Set(blocks.filter(b => b.entryType === 'CLASS').map(b => b.label))];
    const classMap = {};
    
    for (const name of classNames) {
        let cls = await prisma.classGroup.findFirst({ where: { teacherId: req.user.id, name } });
        if (!cls) {
            // Assign color hash on creation
            let hash = 0; for (let i = 0; i < name.length; i++) { hash = ((hash << 5) - hash) + name.charCodeAt(i); hash |= 0; }
            const colourKey = Math.abs(hash) % 8; // 8 palettes
            cls = await prisma.classGroup.create({ data: { name, colourKey, teacherId: req.user.id } });
        }
        classMap[name] = cls.id;
    }

    const mappedBlocks = blocks.map(b => ({
        teacherId: req.user.id,
        weekType: weekType,
        dayOfWeek: b.dayOfWeek,
        period: b.period,
        entryType: b.entryType,
        classId: b.entryType === 'CLASS' ? classMap[b.label] : null,
        label: b.entryType === 'CLASS' ? null : b.label
    }));

    await prisma.$transaction([
        prisma.timetableSlot.deleteMany({ where: { teacherId: req.user.id, weekType: weekType } }),
        prisma.timetableSlot.createMany({ data: mappedBlocks })
    ]);
    res.json({ success: true });
}));

// Tasks API (Updated with Extended Schema)
app.get('/api/tasks', asyncHandler(async (req, res) => {
    const tasks = await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { createdAt: 'desc' } });
    res.json(tasks);
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
    const { title, clientCreatedAt } = req.body;
    const task = await prisma.kanbanTask.create({ 
        data: { 
            title: DOMPurify.sanitize(title, { ALLOWED_TAGS: [] }), 
            clientCreatedAt: clientCreatedAt ? new Date(clientCreatedAt) : new Date(),
            teacherId: req.user.id 
        } 
    });
    res.json(task);
}));

app.put('/api/tasks/:id', asyncHandler(async (req, res) => {
    const { status } = req.body;
    const task = await prisma.kanbanTask.update({ where: { id: req.params.id }, data: { status } });
    res.json(task);
}));

// Templates & Seating... (Remain scoped to req.user.id)
app.get('/api/templates', asyncHandler(async (req, res) => { res.json(await prisma.template.findMany({ where: { teacherId: req.user.id } })); }));
app.post('/api/templates', asyncHandler(async (req, res) => {
    const { className, content } = req.body;
    const template = await prisma.template.upsert({
        where: { teacherId_className: { teacherId: req.user.id, className } },
        update: { content: DOMPurify.sanitize(content, sanitizeConfig) },
        create: { className, content: DOMPurify.sanitize(content, sanitizeConfig), teacherId: req.user.id }
    });
    res.json(template);
}));

app.use((err, req, res, next) => {
    console.error("API Error:", err);
    res.status(500).json({ error: { message: 'Internal server error' }});
});

app.listen(PORT, () => console.log(`Teacher OS Server running on port ${PORT}`));
