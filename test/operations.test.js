const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { securityHeaders, sameOriginWrites, authThrottle, createMetrics } = require('../lib/operations');

async function fixture(t) {
  let time = 1000;
  const app = express(); const metrics = createMetrics();
  app.use(securityHeaders, metrics.middleware, sameOriginWrites, express.json());
  app.post('/login', authThrottle({now:()=>time, pairLimit:2, ipLimit:10, windowMs:1000}), (req,res)=>res.status(401).json({error:'Invalid'}));
  app.post('/save', (req,res)=>res.json({ok:true}));
  app.get('/students/:id', (req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {base:`http://127.0.0.1:${server.address().port}`,metrics,advance:()=>time+=1001};
}
test('login throttling limits repeated attempts and expires without blocking another email',async t=>{
  const f=await fixture(t);const login=email=>fetch(f.base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});
  assert.equal((await login('teacher@example.test')).status,401);assert.equal((await login('teacher@example.test')).status,401);
  const blocked=await login('teacher@example.test');assert.equal(blocked.status,429);assert.ok(blocked.headers.get('retry-after'));
  assert.equal((await login('colleague@example.test')).status,401);f.advance();assert.equal((await login('teacher@example.test')).status,401);
});
test('write protection accepts same origin and rejects foreign browser origins',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.base+'/save',{method:'POST',headers:{origin:'https://foreign.test'}})).status,403);
  const response=await fetch(f.base+'/save',{method:'POST',headers:{origin:f.base}});assert.equal(response.status,200);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);
});
test('metrics aggregate parameterised routes without student identifiers or query content',async t=>{
  const f=await fixture(t);await fetch(f.base+'/students/private-student?name=secret');await fetch(f.base+'/students/another-private-student');
  const snapshot=f.metrics.snapshot();assert.equal(snapshot.routes[0].requests,2);assert.equal(snapshot.routes[0].route,'GET /students/:id');assert.doesNotMatch(JSON.stringify(snapshot),/private-student|secret/);
});
