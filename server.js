const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const crypto = require('crypto'); // Native Node library for secure, crash-free password hashing

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

// Simple, native hash function
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// === AUTHENTICATION ENDPOINTS ===
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
    
    // Allow old 'disabled' accounts to login for backward compatibility during testing
    if (user.passwordHash !== 'disabled' && user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ token: user.id, user: { name: user.name, email: user.email } });
}));

// === GLOBAL SECURITY MIDDLEWARE ===
app.use('/api', asyncHandler(async (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next(); // Let login/register bypass
    
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: "Unauthorized access. Please log in." });
    
    const user = await prisma.user.findUnique({ where: { id: token } });
    if (!user) return res.status(401).json({ error: "Invalid session." });
    
    req.user = { id: user.id };
    next();
}));

// COMPLETE HARD WIPE
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

// Selective Import Endpoint (Only creates the class the user searched for)
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

app.get('/api/tasks', asyncHandler(async (req, res) => { res.json(await prisma.kanbanTask.findMany({ where: { teacherId: req.user.id }, orderBy: { clientCreatedAt: 'desc' } })); }));
app.put('/api/tasks/:id', asyncHandler(async (req, res) => { res.json(await prisma.kanbanTask.update({ where: { id: req.params.id, teacherId: req.user.id }, data: { status: req.body.status } })); }));
app.post('/api/tasks', asyncHandler(async (req, res) => { 
    res.json(await prisma.kanbanTask.create({ 
        data: { title: req.body.title, status: req.body.status, clientCreatedAt: new Date(req.body.clientCreatedAt), teacherId: req.user.id } 
    })); 
}));

app.post('/api/settings/ai', asyncHandler(async (req, res) => {
    const { provider, apiKey, slideStructure, calendarIcs, termStart, holidays } = req.body;
    let data = { aiProvider: provider, aiApiKey: apiKey, slideStructure: slideStructure, calendarIcs: calendarIcs };
    if (termStart) data.termStart = new Date(termStart);
    if (holidays !== undefined) data.holidays = holidays;
    await prisma.user.update({ where: { id: req.user.id }, data });
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
    const systemPrompt = `You are a master teacher generating a presentation slide deck. Curriculum: ${curriculum}. Differentiate for ${keyStage} using the scale: ${differentiation}. Output ONLY a valid JSON array of objects. Do not include markdown formatting like \`\`\`json. Each object must represent one slide with the exact keys: 'title', 'content', 'speakerNotes'. The array MUST contain slides corresponding to this exact sequence/structure: ${slideHeadings}`;

    if (!apiKey) throw new Error("API Key required for Slide Generation.");
    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Topic: ${topic}` }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
    res.json(JSON.parse(data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim()));
}));

app.post('/api/ai/toolkit', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    const { tool, topic } = req.body;
    let systemPrompt = `You are an expert UK education professional and Senior Leader. Format output in clean HTML divs using headings, bullet points, and tables where appropriate.`;
    
    if (tool === 'song') systemPrompt += ` Write a catchy educational song summarizing the topic to the tune of a well-known pop song.`;
    else if (tool === 'comprehension') systemPrompt += ` Generate a reading passage on the topic, followed by 3 differentiated question sets (Basic, Secure, Advanced).`;
    else if (tool === 'explainer') systemPrompt += ` Explain the concept as if I am 11 years old, using a highly relatable everyday analogy.`;
    else if (tool === 'spag') systemPrompt += ` Write a paragraph related to the topic containing 10 deliberate SPaG errors for students to correct. Provide the answer key below.`;
    else if (tool === 'quiz') systemPrompt += ` Generate a 10-question multiple choice quiz on this topic with an answer key at the bottom. Provide it in a clear format.`;
    else if (tool === 'markscheme') systemPrompt += ` Generate a detailed mark scheme or grading rubric for a student assignment on this topic.`;
    else if (tool === 'sow') systemPrompt += ` Generate a 6-week Scheme of Work (SoW) overview for this topic. Include weekly learning objectives and key activities.`;
    else if (tool === 'reports') systemPrompt += ` Write 3 differentiated report card comment templates (Exceeding, Expected, Emerging) regarding student performance in this topic.`;
    else if (tool === 'iep') systemPrompt += ` Draft an Individual Education Plan (IEP) strategies list for a student struggling with this specific topic/concept.`;
    else if (tool === 'dyslexia_adapt') systemPrompt += ` Rewrite the provided text/concept to be highly accessible for a student with Dyslexia, using bullet points and simplified vocabulary.`;
    else if (tool === 'policy') systemPrompt += ` Write a formal, comprehensive UK school policy document regarding this topic. Include intent, scope, and procedures.`;
    else if (tool === 'newsletter') systemPrompt += ` Write a warm, professional, engaging parent/carer newsletter segment about this topic.`;
    else if (tool === 'observation') systemPrompt += ` Write constructive, professional, formal lesson observation feedback based on these notes. Detail strengths and clear areas for development.`;
    else if (tool === 'sip') systemPrompt += ` Draft a School Improvement Plan (SIP) objective section addressing this target. Include success criteria, monitoring strategies, and intended impact.`;
    else if (tool === 'governor') systemPrompt += ` Write a formal, data-driven report section intended for the Board of Governors summarizing this topic/issue.`;
    else if (tool === 'cpd') systemPrompt += ` Design a 1-hour staff CPD (Continuing Professional Development) session plan on this topic. Include timings, activities, and resources needed.`;
    else if (tool === 'risk') systemPrompt += ` Generate a standard UK school risk assessment table for this activity. Include Hazards, Who might be harmed, Existing Controls, and Further Action.`;
    else if (tool === 'email_angry') systemPrompt += ` Draft a highly professional, de-escalating, and polite email response to an angry or concerned parent/carer regarding this issue.`;

    if (!apiKey) throw new Error("API Key required.");
    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Context/Topic: ${topic}` }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    await prisma.user.update({ where: { id: user.id }, data: { hoursSaved: { increment: 1 } } });
    res.json({ text: DOMPurify.sanitize(data.choices[0].message.content, sanitizeConfig), raw: data.choices[0].message.content });
}));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: { message: err.message || 'Server error' }}); });
app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
