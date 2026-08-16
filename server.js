const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function getAuthUser() {
    let teacher = await prisma.user.findFirst();
    if (!teacher) teacher = await prisma.user.create({ data: { email: 'reuben@bchs.local', name: 'Reuben' } });
    return teacher;
}

// Security sanitization configuration
const sanitizeConfig = { ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span'], ALLOWED_ATTR: ['href', 'target', 'style', 'color'] };

// Lessons API
app.get('/api/lessons', asyncHandler(async (req, res) => {
    const teacher = await getAuthUser();
    const lessons = await prisma.lessonPlan.findMany({ where: { teacherId: teacher.id }});
    res.json(lessons);
}));

app.post('/api/lessons', asyncHandler(async (req, res) => {
    const { date, period, planText, className } = req.body;
    const teacher = await getAuthUser();
    const cleanHTML = DOMPurify.sanitize(planText, sanitizeConfig);
    const targetDate = new Date(date);
    
    const lesson = await prisma.lessonPlan.upsert({
        where: { teacherId_date_period: { teacherId: teacher.id, date: targetDate, period: parseInt(period) } },
        update: { planText: cleanHTML, className: className || "", version: { increment: 1 } },
        create: { date: targetDate, period: parseInt(period), planText: cleanHTML, className: className || "", teacherId: teacher.id }
    });
    res.json(lesson);
}));

app.post('/api/lessons/bulk', asyncHandler(async (req, res) => {
    const { updates } = req.body;
    const teacher = await getAuthUser();
    
    const results = await prisma.$transaction(
        updates.map(update => prisma.lessonPlan.upsert({
            where: { teacherId_date_period: { teacherId: teacher.id, date: new Date(update.date), period: parseInt(update.period) } },
            update: { planText: DOMPurify.sanitize(update.planText, sanitizeConfig), version: { increment: 1 } },
            create: { date: new Date(update.date), period: parseInt(update.period), planText: DOMPurify.sanitize(update.planText, sanitizeConfig), teacherId: teacher.id }
        }))
    );
    res.json({ success: true, count: results.length });
}));

// Notes API
app.get('/api/notes', asyncHandler(async (req, res) => {
    const teacher = await getAuthUser();
    const notes = await prisma.dailyNote.findMany({ where: { teacherId: teacher.id } });
    res.json(notes);
}));

app.post('/api/notes', asyncHandler(async (req, res) => {
    const { date, noteText } = req.body;
    const teacher = await getAuthUser();
    const targetDate = new Date(date);
    const note = await prisma.dailyNote.upsert({
        where: { teacherId_date: { teacherId: teacher.id, date: targetDate } },
        update: { noteText: DOMPurify.sanitize(noteText, sanitizeConfig), version: { increment: 1 } },
        create: { date: targetDate, noteText: DOMPurify.sanitize(noteText, sanitizeConfig), teacherId: teacher.id }
    });
    res.json(note);
}));

// Timetable API
app.get('/api/timetable', asyncHandler(async (req, res) => {
    const teacher = await getAuthUser();
    const blocks = await prisma.timetableBlock.findMany({ where: { teacherId: teacher.id } });
    res.json(blocks);
}));

app.post('/api/timetable', asyncHandler(async (req, res) => {
    const { blocks, weekType } = req.body;
    const teacher = await getAuthUser();
    await prisma.$transaction([
        prisma.timetableBlock.deleteMany({ where: { teacherId: teacher.id, weekType: weekType } }),
        prisma.timetableBlock.createMany({ data: blocks.map(b => ({ ...b, teacherId: teacher.id, weekType: weekType })) })
    ]);
    res.json({ success: true });
}));

// Templates API
app.get('/api/templates', asyncHandler(async (req, res) => {
    const teacher = await getAuthUser();
    const templates = await prisma.template.findMany({ where: { teacherId: teacher.id } });
    res.json(templates);
}));

app.post('/api/templates', asyncHandler(async (req, res) => {
    const { className, content } = req.body;
    const teacher = await getAuthUser();
    const template = await prisma.template.upsert({
        where: { teacherId_className: { teacherId: teacher.id, className } },
        update: { content: DOMPurify.sanitize(content, sanitizeConfig) },
        create: { className, content: DOMPurify.sanitize(content, sanitizeConfig), teacherId: teacher.id }
    });
    res.json(template);
}));

// Tasks API
app.get('/api/tasks', asyncHandler(async (req, res) => {
    const teacher = await getAuthUser();
    const tasks = await prisma.kanbanTask.findMany({ where: { teacherId: teacher.id }, orderBy: { updatedAt: 'desc' } });
    res.json(tasks);
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
    const { title, status } = req.body;
    const teacher = await getAuthUser();
    const task = await prisma.kanbanTask.create({ data: { title: DOMPurify.sanitize(title, { ALLOWED_TAGS: [] }), status, teacherId: teacher.id } });
    res.json(task);
}));

app.put('/api/tasks/:id', asyncHandler(async (req, res) => {
    const { status } = req.body;
    const task = await prisma.kanbanTask.update({ where: { id: req.params.id }, data: { status } });
    res.json(task);
}));

// Seating API
app.get('/api/seating', asyncHandler(async (req, res) => {
    const teacher = await getAuthUser();
    const plans = await prisma.seatingPlan.findMany({ where: { teacherId: teacher.id } });
    res.json(plans);
}));

app.post('/api/seating', asyncHandler(async (req, res) => {
    const { className, layoutData } = req.body;
    const teacher = await getAuthUser();
    const plan = await prisma.seatingPlan.upsert({
        where: { teacherId_className: { teacherId: teacher.id, className } },
        update: { layoutData: JSON.stringify(layoutData) },
        create: { className, layoutData: JSON.stringify(layoutData), teacherId: teacher.id }
    });
    res.json(plan);
}));

// Dummy AI Route for Testing
app.post('/api/ai/generate', (req, res) => {
    res.json({ text: `<i>AI suggestion based on: "${req.body.prompt}"</i><br><ul><li>Introduce concept</li><li>Main activity</li><li>Review</li></ul>` });
});

app.use((err, req, res, next) => {
    console.error("API Error:", err);
    res.status(500).json({ error: { message: 'Internal server error' }});
});

app.listen(PORT, () => console.log(`Teacher OS Server running on port ${PORT}`));
