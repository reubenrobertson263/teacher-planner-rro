const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const webpush = require('web-push');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sanitizeConfig = { ALLOWED_TAGS: ['b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'br', 'div', 'span', 'strike', 'mark', 'h3', 'h4', 'strong', 'em', 'p', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'iframe', 'img'], ALLOWED_ATTR: ['href', 'target', 'class', 'style', 'title', 'src', 'width', 'height', 'frameborder', 'allowfullscreen'] };

// === ABSOLUTE GOD MODE - NO AUTHENTICATION ===
app.use('/api', asyncHandler(async (req, res, next) => {
    if (req.path.startsWith('/api/dropbox/submit')) return next();
    
    // Always assign the first user in the database. If none exists, create one instantly.
    let user = await prisma.user.findFirst().catch(() => null);
    if (!user) {
        try {
            user = await prisma.user.create({
                data: { email: 'admin@flowdesk.local', name: 'Reuben', passwordHash: 'disabled', isTrial: false }
            });
        } catch(e) {
            // Absolute fallback to prevent server crashes
            user = { id: 'dev-fallback-id' };
        }
    }
    
    req.user = { id: user.id };
    next();
}));

async function seedReubenClasses(userId, email, name) {
    try {
        const classCount = await prisma.classGroup.count({ where: { teacherId: userId, archivedAt: null } });
        if (classCount === 0) {
            const myClasses = ['9a/Dt2', '10O3/Em1', '11O3/Em', '9b/Dt1', '11O1/Em1', '9b/Dt3', '8b/Dt2', '7a/DT2', '7b/DT3', '8b/Dt3', '8a/Dt2', '8a/Dt4'];
            const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#64748b'];
            const classData = myClasses.map((c, index) => ({ name: c, colorHex: colors[index % colors.length], teacherId: userId }));
            await prisma.classGroup.createMany({ data: classData });
            const roomCount = await prisma.room.count({ where: { teacherId: userId, name: 'IT2' } });
            if(roomCount === 0) await prisma.room.create({ data: { name: 'IT2', teacherId: userId } });
        }
    } catch(e) {
        console.error("Seeding bypassed.");
    }
}

app.post('/api/auth/nuke-rosters', asyncHandler(async (req, res) => {
    const classIds = await prisma.classGroup.findMany({
        where: { teacherId: req.user.id },
        select: { id: true }
    }).then(rows => rows.map(r => r.id));

    if (classIds.length === 0) {
        await prisma.seatingPlan.deleteMany({ where: { teacherId: req.user.id } });
        return res.json({ success: true, deleted: 0 });
    }

    const studentIds = await prisma.student.findMany({
        where: { classId: { in: classIds } }, 
        select: { id: true }
    }).then(rows => rows.map(r => r.id));

    if (studentIds.length > 0) {
        await prisma.grade.deleteMany({ where: { studentId: { in: studentIds } } });
        await prisma.behaviorLog.deleteMany({ where: { studentId: { in: studentIds } } });
        await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    }

    await prisma.assessment.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.seatingPlan.deleteMany({ where: { teacherId: req.user.id } });
    
    res.json({ success: true, deleted: studentIds.length });
}));

async function assertOwnsClass(userId, classId) {
    const cls = await prisma.classGroup.findFirst({ where: { id: classId, teacherId: userId, archivedAt: null } });
    if (!cls) { const e = new Error('Class not found or unauthorized'); e.status = 404; throw e; }
    return cls;
}

app.get('/api/user/me', asyncHandler(async (req, res) => {
    try {
        const u = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!u) throw new Error("User not found");
        await seedReubenClasses(u.id, u.email, u.name); 
        res.json({ id: u.id, email: u.email, name: u.name, hoursSaved: u.hoursSaved, slideStructure: u.slideStructure, aiProvider: u.aiProvider, hasApiKey: !!u.aiApiKey, calendarIcs: u.calendarIcs, arborAppId: u.arborAppId, msTeamsToken: u.msTeamsToken });
    } catch(err) {
        res.json({ id: "bypass", email: "admin@flowdesk.local", name: "Admin", hoursSaved: 0 });
    }
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

app.post('/api/students/bulk-import', asyncHandler(async (req, res) => {
    const { students } = req.body;
    let createdClasses = 0; let processedStudents = 0;
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#64748b'];

    const existingClasses = await prisma.classGroup.findMany({ where: { teacherId: req.user.id } });
    const classMap = new Map();
    existingClasses.forEach(c => classMap.set(c.name.trim().toLowerCase(), c.id));

    const classesToCreate = new Set();
    for (const s of students) {
        if (s.className && !classMap.has(s.className.trim().toLowerCase())) classesToCreate.add(s.className.trim());
    }

    const newClassData = [];
    for (const cName of classesToCreate) {
        newClassData.push({ name: cName, colorHex: colors[createdClasses % colors.length], teacherId: req.user.id });
        createdClasses++;
    }

    if (newClassData.length > 0) {
        await prisma.classGroup.createMany({ data: newClassData });
        const updatedClasses = await prisma.classGroup.findMany({ where: { teacherId: req.user.id } });
        updatedClasses.forEach(c => classMap.set(c.name.trim().toLowerCase(), c.id));
    }

    for (const s of students) {
        const cid = classMap.get(s.className.trim().toLowerCase());
        if (!cid) continue;
        const { className, ...studentData } = s;
        try {
            await prisma.student.upsert({
                where: { classId_externalRef: { classId: cid, externalRef: studentData.externalRef } },
                update: { name: DOMPurify.sanitize(studentData.name, {ALLOWED_TAGS:[]}), sen: studentData.sen, pp: studentData.pp, targetGrade: studentData.targetGrade, catMean: studentData.catMean, gender: studentData.gender },
                create: { ...studentData, classId: cid }
            });
            processedStudents++;
        } catch(e) {
            console.error("Skipped duplicate student.");
        }
    }

    res.json({ success: true, createdClasses, processedStudents });
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

app.post('/api/settings/ai', asyncHandler(async (req, res) => {
    const { provider, apiKey, slideStructure, calendarIcs, arborApiKey, msTeamsToken, termStart, holidays } = req.body;
    let data = { aiProvider: provider, aiApiKey: apiKey, slideStructure: slideStructure, calendarIcs: calendarIcs, arborApiKey: arborApiKey, msTeamsToken: msTeamsToken };
    if (termStart) data.termStart = new Date(termStart);
    if (holidays !== undefined) data.holidays = holidays;
    await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ success: true });
}));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: { message: err.message || 'Server error' }}); });
app.listen(PORT, () => console.log(`FlowDesk Server running on port ${PORT}`));
