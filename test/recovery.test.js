const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createApp } = require('../server');
const { databaseUrl } = require('../lib/database');
const { DatabaseSessionStore } = require('../lib/session-store');

const env = { SESSION_SECRET: 'test-only-session-secret-not-for-deployment', NODE_ENV: 'test' };
const unavailable = () => Object.assign(new Error('private connection details'), { code: 'P1001' });

async function fixture(t, options = {}) {
  const records = new Map();
  const user = { id: 'teacher-1', email: 'teacher@example.test', name: 'Teacher', isAdmin: false, onboarded: true,
    passwordHash: await bcrypt.hash('test-password', 4) };
  const prisma = {
    user: {
      findUnique: async ({ where }) => where.email === user.email || where.id === user.id ? user : null,
      findFirst: async () => user,
      count: async () => 1,
      create: async ({ data }) => ({ ...data, id: 'teacher-2' })
    },
    session: {
      findUnique: async ({ where }) => records.get(where.sid) || null,
      findFirst: async () => null,
      upsert: async ({ where, create, update }) => { records.set(where.sid, records.has(where.sid) ? { ...records.get(where.sid), ...update } : create); },
      updateMany: async ({ where, data }) => { if (records.has(where.sid)) Object.assign(records.get(where.sid), data); return { count: 1 }; },
      deleteMany: async ({ where }) => {
        if (where.sid) records.delete(where.sid);
        else for (const [sid, record] of records) if (record.expiresAt < where.expiresAt.lt) records.delete(sid);
        return { count: 1 };
      }
    },
    classGroup: { findFirst: async () => null, count: async () => 0 },
    assessment: { findFirst: async () => null },
    kanbanTask: { updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
    $queryRaw: async () => [{ '?column?': 1 }]
  };
  options.configure?.(prisma);
  const app = createApp({ prisma, env: { ...env, ...options.env } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(path, body, method, headers = {}) {
    const response = await fetch(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  }
  const login = () => request('/api/auth/login', { email: '  TEACHER@example.test ', password: 'test-password' });
  return { request, login, prisma, records, user, getCookie: () => cookie };
}

test('login persists and rotates sessions; /me works; logout invalidates access', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/user/me')).status, 401);
  const login = await f.login();
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Lax/);
  const first = f.getCookie();
  assert.equal(f.records.size, 1);
  const profile = await (await f.request('/api/user/me')).json();
  assert.equal(profile.id, f.user.id);
  assert.equal(profile.passwordHash, undefined);
  assert.equal((await f.login()).status, 200);
  assert.notEqual(f.getCookie(), first);
  assert.equal((await f.request('/api/user/me', null, 'GET', { cookie: first })).status, 401);
  assert.equal((await f.request('/api/auth/logout', {})).status, 204);
  assert.equal((await f.request('/api/user/me')).status, 401);
});

test('wrong credentials and expired sessions cannot access teaching data', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/auth/login', { email: f.user.email, password: 'wrong' })).status, 401);
  assert.equal((await f.request('/api/auth/login', {})).status, 400);
  await f.login();
  for (const record of f.records.values()) record.expiresAt = new Date(0);
  assert.equal((await f.request('/api/user/me')).status, 401);
  for (const path of ['/api/lessons', '/api/tasks', '/api/seating', '/api/timetable', '/api/classes', '/api/rooms']) {
    assert.equal((await f.request(path)).status, 401, path);
  }
});

test('database outage returns a safe 503; health and static login still work', async t => {
  let calls = 0;
  const f = await fixture(t, { configure(prisma) {
    prisma.user.findUnique = async () => { calls++; throw unavailable(); };
    prisma.$queryRaw = async () => { calls++; throw unavailable(); };
  } });
  assert.equal(calls, 0, 'creating the app does not connect to the database');
  assert.equal((await f.request('/api/health')).status, 200);
  assert.equal((await f.request('/')).status, 200);
  assert.equal(calls, 0, 'health probes and assets do not use database compute');
  assert.equal((await f.request('/api/ready')).status, 503);
  const response = await f.login();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await response.text(), /private connection details/);
});

test('failed session writes never report login success; recovery works without restart', async t => {
  const f = await fixture(t);
  const save = f.prisma.session.upsert;
  f.prisma.session.upsert = async () => { throw unavailable(); };
  assert.equal((await f.login()).status, 503);
  assert.equal(f.records.size, 0);
  f.prisma.session.upsert = save;
  assert.equal((await f.login()).status, 200);
  assert.equal((await f.request('/api/user/me')).status, 200);
  const read = f.prisma.session.findUnique;
  f.prisma.session.findUnique = async () => { throw unavailable(); };
  assert.equal((await f.request('/api/user/me')).status, 503);
  assert.equal((await f.request('/api/health')).status, 200);
  f.prisma.session.findUnique = read;
  assert.equal((await f.request('/api/user/me')).status, 200);
});

test('registration saves session and validates existing accounts', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/auth/register', { name: 'Teacher', email: f.user.email, password: 'test-password' })).status, 409);
  assert.equal((await f.request('/api/auth/register', { name: 'Teacher', email: 'new@example.test', password: 'short' })).status, 400);
  assert.equal((await f.request('/api/auth/register', { name: 'Teacher', email: 'new@example.test', password: 'test-password' })).status, 200);
  assert.equal(f.records.size, 1);
});

test('production cookie works behind Render HTTPS proxy', async t => {
  const f = await fixture(t, { env: { NODE_ENV: 'production' } });
  const response = await f.request('/api/auth/login', { email: f.user.email, password: 'test-password' }, 'POST', { 'x-forwarded-proto': 'https' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Secure/);
});

test('restored ownership checks reject foreign classes, assessments and tasks', async t => {
  const f = await fixture(t);
  await f.login();
  const cases = [
    ['/api/seating', { classId: 'foreign', roomId: 'default_room' }, 'POST', 403],
    ['/api/lessons', { date: '2026-10-01', period: 1, classId: 'foreign', planText: 'test' }, 'POST', 403],
    ['/api/markbook/foreign', { title: 'test' }, 'POST', 404],
    ['/api/markbook/grade', { studentId: 'foreign', assessmentId: 'foreign', value: 'A' }, 'POST', 404],
    ['/api/tasks/foreign', { title: 'test' }, 'PUT', 404],
    ['/api/timetable', { weekType: 'A', blocks: [{ entryType: 'CLASS', classId: 'foreign', dayOfWeek: 1, period: 1 }] }, 'POST', 403],
    ['/api/notes', { date: 'invalid', noteText: 'test' }, 'POST', 400]
  ];
  for (const [path, body, method, expected] of cases) assert.equal((await f.request(path, body, method)).status, expected, path);
});

test('session cleanup runs on use only and never accepts expired stored sessions', async () => {
  let calls = 0;
  const store = new DatabaseSessionStore({ session: { findUnique: async () => { calls++; return { data: '{}', expiresAt: new Date(0) }; } } });
  assert.equal(calls, 0);
  const value = await new Promise((resolve, reject) => store.get('expired', (error, data) => error ? reject(error) : resolve(data)));
  assert.equal(value, null);
});

test('configuration rejects public fallback secrets and adds bounded connection timeouts', () => {
  assert.throws(() => createApp({ env: {} }), /SESSION_SECRET/);
  assert.throws(() => databaseUrl(''), /DATABASE_URL/);
  const url = new URL(databaseUrl('postgresql://user:pass@localhost/db?sslmode=require'));
  assert.equal(url.searchParams.get('connect_timeout'), '15');
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(new URL(databaseUrl('postgresql://user:pass@localhost/db?connect_timeout=30')).searchParams.get('connect_timeout'), '30');
});
