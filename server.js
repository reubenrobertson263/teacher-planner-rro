const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const { OpenAI } = require('openai');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// Increase limit to 10mb so image pasting works without crashing
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy_key' });

async function setupDefaultProfile() {
    let teacher = await prisma.user.findFirst();
    if (!teacher) {
        teacher = await prisma.user.create({ data: { email: 'reuben@bchs.local', name: 'Reuben' } });
        await prisma.class.create({ data: { name: 'Default Class', teacherId: teacher.id } });
    }
}
setupDefaultProfile();

// --- AI VISION & TEXT ROUTES ---
app.post('/api/ai/generate', async (req, res) => {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are an expert UK teacher. Expand the topic into a brief 3-part lesson (Do Now, Main, Plenary). Use basic HTML tags." },
                { role: "user", content: req.body.prompt }
            ],
            temperature: 0.7,
        });
        res.json({ text: response.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: "AI Generation failed." });
    }
});

app.post('/api/ai/vision-seating', async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { 
                    role: "system", 
                    content: `You are an AI that converts Arbor seating plan screenshots into JSON. 
                    Identify the grid layout (rows and columns) and extract student names and visible tags (like FSM, SEN, PP). 
                    Return ONLY valid JSON in this exact structure: 
                    { "rows": 5, "cols": 6, "students": [ { "name": "John D", "row": 0, "col": 1, "tags": ["FSM"] } ] }. 
                    Do NOT include markdown block formatting (\`\`\`json).` 
                },
                { 
                    role: "user", 
                    content: [
                        { type: "text", text: "Extract the seating plan layout and student data from this image." },
                        { type: "image_url", image_url: { url: imageBase64 } }
                    ] 
                }
            ],
            max_tokens: 1000,
        });
        
        // Clean up response in case OpenAI adds markdown formatting
        let cleanJson = response.choices[0].message.content.trim();
        if(cleanJson.startsWith('```json')) cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '');
        
        res.json(JSON.parse(cleanJson));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Vision processing failed." });
    }
});

// --- CORE APP ROUTES ---
app.get('/api/lessons', async (req, res) => res.json(await prisma.lessonPlan.findMany()));

app.post('/api/lessons', async (req, res) => {
    const { date, period, planText } = req.body;
    const teacher = await prisma.user.findFirst();
    const activeClass = await prisma.class.findFirst();
    const targetDate = new Date(date);
    
    let lesson = await prisma.lessonPlan.findFirst({ where: { date: targetDate, period: parseInt(period) } });
    if (lesson) lesson = await prisma.lessonPlan.update({ where: { id: lesson.id }, data: { planText } });
    else lesson = await prisma.lessonPlan.create({ data: { date: targetDate, period: parseInt(period), planText, teacherId: teacher.id, classId: activeClass.id } });
    res.json(lesson);
});

app.post('/api/lessons/bulk', async (req, res) => {
    const { updates } = req.body;
    for (let update of updates) {
        const targetDate = new Date(update.date);
        let lesson = await prisma.lessonPlan.findFirst({ where: { date: targetDate, period: parseInt(update.period) } });
        if (lesson) await prisma.lessonPlan.update({ where: { id: lesson.id }, data: { planText: update.planText } });
        else {
            const teacher = await prisma.user.findFirst();
            const activeClass = await prisma.class.findFirst();
            await prisma.lessonPlan.create({ data: { date: targetDate, period: parseInt(update.period), planText: update.planText, teacherId: teacher.id, classId: activeClass.id } });
        }
    }
    res.json({ success: true });
});

app.get('/api/notes', async (req, res) => res.json(await prisma.dailyNote.findMany()));
app.post('/api/notes', async (req, res) => {
    const { date, noteText } = req.body;
    const teacher = await prisma.user.findFirst();
    let note = await prisma.dailyNote.findFirst({ where: { date: new Date(date) } });
    if (note) note = await prisma.dailyNote.update({ where: { id: note.id }, data: { noteText } });
    else note = await prisma.dailyNote.create({ data: { date: new Date(date), noteText, teacherId: teacher.id } });
    res.json(note);
});

app.get('/api/timetable', async (req, res) => res.json(await prisma.timetableBlock.findMany()));
app.post('/api/timetable', async (req, res) => {
    await prisma.timetableBlock.deleteMany(); 
    res.json(await prisma.timetableBlock.createMany({ data: req.body.blocks }));
});

app.get('/api/tasks', async (req, res) => res.json(await prisma.kanbanTask.findMany()));
app.post('/api/tasks', async (req, res) => {
    const teacher = await prisma.user.findFirst();
    res.json(await prisma.kanbanTask.create({ data: { title: req.body.title, status: req.body.status, teacherId: teacher.id } }));
});
app.put('/api/tasks/:id', async (req, res) => res.json(await prisma.kanbanTask.update({ where: { id: req.params.id }, data: { status: req.body.status } })));

app.get('/api/templates', async (req, res) => res.json(await prisma.classTemplate.findMany()));
app.post('/api/templates', async (req, res) => {
    const teacher = await prisma.user.findFirst();
    let template = await prisma.classTemplate.findFirst({ where: { className: req.body.className } });
    if (template) template = await prisma.classTemplate.update({ where: { id: template.id }, data: { content: req.body.content } });
    else template = await prisma.classTemplate.create({ data: { className: req.body.className, content: req.body.content, teacherId: teacher.id } });
    res.json(template);
});

// --- SEATING PLAN API ---
app.get('/api/seating', async (req, res) => res.json(await prisma.seatingPlan.findMany()));
app.post('/api/seating', async (req, res) => {
    const teacher = await prisma.user.findFirst();
    const { className, layoutData } = req.body;
    let plan = await prisma.seatingPlan.findFirst({ where: { className } });
    if (plan) plan = await prisma.seatingPlan.update({ where: { id: plan.id }, data: { layoutData: JSON.stringify(layoutData) } });
    else plan = await prisma.seatingPlan.create({ data: { className, layoutData: JSON.stringify(layoutData), teacherId: teacher.id } });
    res.json(plan);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
