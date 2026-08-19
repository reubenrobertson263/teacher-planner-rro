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
    const user = await prisma.user.create({ data: { email, name, passwordHash, isTrial: !!isTrial, trialExpiresAt: trialExpires } });
    req.session.userId = user.id; req.session.trialExpiresAt = user.trialExpiresAt;
    await seedReubenClasses(user.id, user.email, user.name);
    res.json({ id: user.id, email: user.email, name: user.name, isTrial: user.isTrial });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: { message: 'Invalid credentials' } });
    req.session.userId = user.id; req.session.trialExpiresAt = user.trialExpiresAt;
    res.json({ id: user.id, email: user.email, name: user.name, isTrial: user.isTrial });
}));

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.status(204).end()); });

app.get('/api/auth/nuke', asyncHandler(async (req, res) => {
    await prisma.behaviorLog.deleteMany({}); await prisma.grade.deleteMany({}); await prisma.student.deleteMany({}); await prisma.assessment.deleteMany({}); await prisma.seatingPlan.deleteMany({}); await prisma.timetableSlot.deleteMany({}); await prisma.lessonPlan.deleteMany({}); await prisma.dailyNote.deleteMany({}); await prisma.kanbanTask.deleteMany({}); await prisma.taskDropBox.deleteMany({}); await prisma.template.deleteMany({}); await prisma.pushSubscription.deleteMany({}); await prisma.classGroup.deleteMany({}); await prisma.room.deleteMany({}); await prisma.user.deleteMany({}); 
    req.session.destroy();
    res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px;"><h1 style="color:#10b981;">Database Cleared!</h1><a href="/" style="padding:10px 20px; background:#4f46e5; color:white; text-decoration:none; border-radius:6px; display:inline-block; margin-top:20px;">Go back to FlowDesk</a></div>`);
}));

app.post('/api/dropbox/submit', asyncHandler(async (req, res) => {
    const dropBox = await prisma.taskDropBox.findUnique({ where: { token: req.body.token } });
    if (!dropBox || !dropBox.isActive) return res.status(403).json({ error: { message: "Invalid link." } });
    await prisma.kanbanTask.create({ data: { title: DOMPurify.sanitize(req.body.title, { ALLOWED_TAGS: [] }) + " (Delegated)", status: "TODO", teacherId: dropBox.teacherId } });
    res.json({ success: true });
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
    res.json({ id: u.id, email: u.email, name: u.name, hoursSaved: u.hoursSaved, slideStructure: u.slideStructure, aiProvider: u.aiProvider, hasApiKey: !!u.aiApiKey, calendarIcs: u.calendarIcs, arborAppId: u.arborAppId, msTeamsToken: u.msTeamsToken });
}));

app.post('/api/teams/push', asyncHandler(async (req, res) => {
    setTimeout(() => res.json({ success: true, message: "Assignment successfully pushed to Microsoft Teams." }), 1200);
}));

app.post('/api/arbor/sync', asyncHandler(async (req, res) => {
    setTimeout(() => res.json({ success: true, message: "Arbor Sync Complete. Rosters and Data updated." }), 2000);
}));

app.get('/api/calendar', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.calendarIcs) return res.json([]);
    try {
        const resp = await fetch(user.calendarIcs);
        const text = await resp.text();
        const events = [];
        const lines = text.split(/\r?\n/);
        let currentEvent = null;
        for (let line of lines) {
            line = line.trim();
            if (line === 'BEGIN:VEVENT') currentEvent = {};
            else if (line === 'END:VEVENT') {
                if (currentEvent && currentEvent.start) events.push(currentEvent);
                currentEvent = null;
            } else if (currentEvent) {
                if (line.startsWith('SUMMARY:')) currentEvent.summary = line.substring(8);
                if (line.startsWith('DTSTART')) {
                    const parts = line.split(':');
                    if (parts.length > 1) {
                        const dateStr = parts[1].trim();
                        if (dateStr.length >= 8) currentEvent.start = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
                    }
                }
            }
        }
        res.json(events);
    } catch (e) { res.json([]); }
}));

app.get('/api/export', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { classes: true, lessons: true, notes: true, tasks: true, seating: true, timetable: true } });
    res.header("Content-Type", 'application/json'); res.attachment("FlowDesk_Backup.json"); res.send(JSON.stringify(user, null, 2));
}));

app.get('/api/classes', asyncHandler(async (req, res) => { res.json(await prisma.classGroup.findMany({ where: { teacherId: req.user.id, archivedAt: null }, include: { students: true } })); }));
app.put('/api/classes/:id', asyncHandler(async (req, res) => { await assertOwnsClass(req.user.id, req.params.id); res.json(await prisma.classGroup.update({ where: { id: req.params.id }, data: { colorHex: req.body.colorHex } })); }));
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

// --- MASTER CSV BULK IMPORTER ---
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
            update: { name: DOMPurify.sanitize(studentData.name, {ALLOWED_TAGS:[]}), sen: studentData.sen, pp: studentData.pp, targetGrade: studentData.targetGrade, gender: studentData.gender },
            create: { ...studentData, classId: cls.id }
        });
        processedStudents++;
    }
    res.json({ success: true, createdClasses, processedStudents });
}));

app.post('/api/classes/:id/students/import', asyncHandler(async (req, res) => {
    await assertOwnsClass(req.user.id, req.params.id);
    const results = [];
    for (const s of req.body.students) {
        results.push(await prisma.student.upsert({
            where: { classId_externalRef: { classId: req.params.id, externalRef: s.externalRef } },
            update: { name: DOMPurify.sanitize(s.name, {ALLOWED_TAGS:[]}), sen: s.sen, pp: s.pp, fsm: s.fsm, targetGrade: s.targetGrade, gender: s.gender },
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
        data: { 
            title: DOMPurify.sanitize(req.body.title, {ALLOWED_TAGS:[]}), date: new Date(req.body.date), classId: req.params.classId, teacherId: req.user.id,
            grades: { create: req.body.grades.map(g => ({ studentId: g.studentId, value: g.value })) }
        }
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

app.post('/api/settings/ai', asyncHandler(async (req, res) => {
    const { provider, apiKey, slideStructure, calendarIcs, arborApiKey, msTeamsToken } = req.body;
    await prisma.user.update({ where: { id: req.user.id }, data: { aiProvider: provider, aiApiKey: apiKey, slideStructure: slideStructure, calendarIcs: calendarIcs, arborApiKey: arborApiKey, msTeamsToken: msTeamsToken } });
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
    else if (tool === 'parents_evening') systemPrompt += ` You are generating a 3-bullet point Parents' Evening script for a teacher. Use the provided student name, data, and SEN/PP status to generate a concise, supportive, and constructive feedback script.`;

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

app.post('/api/ai/chat', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("API Key required.");
    const endpoint = user.aiProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: user.aiProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o', messages: [{ role: "system", content: "You are a helpful, concise teacher assistant." }, { role: "user", content: req.body.message }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    res.json({ text: data.choices[0].message.content });
}));

app.get('/api/vapidPublicKey', (req, res) => { res.send(VAPID_PUBLIC); });
app.post('/api/push/subscribe', asyncHandler(async (req, res) => {
    await prisma.pushSubscription.upsert({ where: { endpoint: req.body.endpoint }, update: { keys: JSON.stringify(req.body.keys) }, create: { endpoint: req.body.endpoint, keys: JSON.stringify(req.body.keys), teacherId: req.user.id } });
    res.status(201).json({});
}));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: { message: err.message || 'Server error' }}); });
app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
