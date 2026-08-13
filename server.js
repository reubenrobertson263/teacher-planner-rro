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
        teacher = await prisma.user.create({ data: { email: 'admin@planner.local', name: 'Admin' } });
        await prisma.class.create({ data: { name: 'Default Class', teacherId: teacher.id } });
    }
}
setupDefaultProfile();

// Lesson API Routes
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
            data: {
                date: targetDate,
                period: parseInt(period),
                planText: planText,
                teamsLink: teamsLink || "",
                teacherId: teacher.id,
                classId: activeClass.id
            }
        });
    }
    res.json(lesson);
});

// Timetable API Routes
app.get('/api/timetable', async (req, res) => {
    const blocks = await prisma.timetableBlock.findMany();
    res.json(blocks);
});

app.post('/api/timetable', async (req, res) => {
    // Expects an array of timetable blocks to bulk save
    const { blocks } = req.body;
    await prisma.timetableBlock.deleteMany(); // Clear old timetable
    const newBlocks = await prisma.timetableBlock.createMany({ data: blocks });
    res.json(newBlocks);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
