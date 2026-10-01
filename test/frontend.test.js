const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function frontend(responses) {
  const elements = {
    'login-email': { value: 'teacher@example.test' }, 'login-password': { value: 'test-password' },
    'btn-login-submit': { innerHTML: 'Log In', disabled: false }, 'auth-message': { hidden: true, textContent: '' }
  };
  let reloads = 0;
  const calls = [];
  const context = {
    window: { location: { reload: () => reloads++ } },
    document: { readyState: 'loading', addEventListener() {}, getElementById: id => elements[id] },
    fetch: async (url, options) => { calls.push({ url, options }); const value = responses.shift(); if (value instanceof Error) throw value; return value; },
    AbortController, setTimeout, clearTimeout, TypeError, console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8'), context);
  return { app: context.window.app, elements, calls, reloads: () => reloads };
}
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('frontend shows database outage and restores login button without reload loop', async () => {
  const f = frontend([response(503, { error: { message: 'Database temporarily unavailable' } })]);
  await f.app.handleLogin();
  assert.equal(f.reloads(), 0);
  assert.equal(f.elements['btn-login-submit'].disabled, false);
  assert.equal(f.elements['auth-message'].textContent, 'Database temporarily unavailable');
  assert.equal(f.elements['auth-message'].hidden, false);
});

test('frontend verifies persisted session before reloading', async () => {
  const f = frontend([response(200, { id: 'teacher' }), response(401, { error: { message: 'Session not available' } })]);
  await f.app.handleLogin();
  assert.equal(f.reloads(), 0);
  assert.equal(f.calls[1].url, '/api/user/me');
  assert.equal(f.elements['btn-login-submit'].disabled, false);
  const success = frontend([response(200, { id: 'teacher' }), response(200, { id: 'teacher' })]);
  await success.app.handleLogin();
  assert.equal(success.reloads(), 1);
  assert.equal(success.calls[0].options.credentials, 'same-origin');
});

test('frontend rejects HTML error pages and explains network failures', async () => {
  const f = frontend([{ ok: false, status: 502, json: async () => { throw new Error('HTML response'); } }]);
  await f.app.handleLogin();
  assert.match(f.elements['auth-message'].textContent, /temporarily unavailable/);
  const offline = frontend([new TypeError('network failure')]);
  await offline.app.handleLogin();
  assert.match(offline.elements['auth-message'].textContent, /Check your connection/);
});
