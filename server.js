const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auto-create a default teacher profile if the database is empty
async function setupDefaultProfile() {
    let teacher = await prisma.user.findFirst();
    if (!teacher) {
        teacher = await prisma.user.create({ data: { email: 'admin@planner.local', name: 'Admin' } });
        await prisma.class.create({ data: { name: 'Default Class', teacherId: teacher.id } });
    }
}
setupDefaultProfile();

// Fetch saved lessons
app.get('/api/lessons', async (req, res) => {
    const lessons = await prisma.lessonPlan.findMany();
    res.json(lessons);
});

// Save a lesson when you type
app.post('/api/lessons', async (req, res) => {
    const { date, period, planText } = req.body;
    const teacher = await prisma.user.findFirst();
    const activeClass = await prisma.class.findFirst();
    
    const targetDate = new Date(date);
    
    let lesson = await prisma.lessonPlan.findFirst({
        where: { date: targetDate, period: parseInt(period) }
    });

    if (lesson) {
        lesson = await prisma.lessonPlan.update({
            where: { id: lesson.id },
            data: { planText }
        });
    } else {
        lesson = await prisma.lessonPlan.create({
            data: {
                date: targetDate,
                period: parseInt(period),
                planText: planText,
                teacherId: teacher.id,
                classId: activeClass.id
            }
        });
    }
    res.json(lesson);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
