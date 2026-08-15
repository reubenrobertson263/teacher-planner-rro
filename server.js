const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function setupDefaultProfile() {
    let teacher = await prisma.user.findFirst();
    if (!teacher) {
        teacher = await prisma.user.create({ data: { email: 'reuben@bchs.local', name: 'Reuben' } });
        await prisma.class.create({ data: { name: 'Default Class', teacherId: teacher.id } });
    }
}
setupDefaultProfile();

app.get('/api/lessons', async (req, res) => {
    const lessons = await prisma.lessonPlan.findMany();
    res.json(lessons);
});

app.post('/api/lessons', async (req, res) => {
    const { date, period, planText, teamsLink } = req.body;
    const teacher = await prisma.user.findFirst();
    const activeClass = await prisma.class.findFirst();
    const targetDate = new Date(date);
    
    let lesson = await prisma.lessonPlan.findFirst({
        where: { date: targetDate, period: parseInt(period) }
    });

    if (lesson) {
        lesson = await prisma.lessonPlan.update({
            where: { id: lesson.id },
            data: { planText, teamsLink: teamsLink || lesson.teamsLink }
        });
    } else {
        lesson = await prisma.lessonPlan.create({
            data: { date: targetDate, period: parseInt(period), planText, teamsLink: teamsLink || "", teacherId: teacher.id, classId: activeClass.id }
        });
    }
    res.json(lesson);
});

app.get('/api/notes', async (req, res) => {
    const notes = await prisma.dailyNote.findMany();
    res.json(notes);
});

app.post('/api/notes', async (req, res) => {
    const { date, noteText } = req.body;
    const teacher = await prisma.user.findFirst();
    const targetDate = new Date(date);

    let note = await prisma.dailyNote.findFirst({ where: { date: targetDate } });
    if (note) {
        note = await prisma.dailyNote.update({ where: { id: note.id }, data: { noteText } });
    } else {
        note = await prisma.dailyNote.create({ data: { date: targetDate, noteText, teacherId: teacher.id } });
    }
    res.json(note);
});

app.get('/api/timetable', async (req, res) => {
    const blocks = await prisma.timetableBlock.findMany();
    res.json(blocks);
});

app.post('/api/timetable', async (req, res) => {
    const { blocks } = req.body;
    await prisma.timetableBlock.deleteMany(); 
    const newBlocks = await prisma.timetableBlock.createMany({ data: blocks });
    res.json(newBlocks);
});

// Kanban API
app.get('/api/tasks', async (req, res) => {
    const tasks = await prisma.kanbanTask.findMany();
    res.json(tasks);
});

app.post('/api/tasks', async (req, res) => {
    const { title, status } = req.body;
    const teacher = await prisma.user.findFirst();
    const task = await prisma.kanbanTask.create({ data: { title, status, teacherId: teacher.id } });
    res.json(task);
});

app.put('/api/tasks/:id', async (req, res) => {
    const { status } = req.body;
    const task = await prisma.kanbanTask.update({
        where: { id: req.params.id },
        data: { status }
    });
    res.json(task);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
