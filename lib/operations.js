const { randomUUID, createHash } = require('node:crypto');

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

function sameOriginWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  let mismatch = req.get('sec-fetch-site') === 'cross-site';
  if (origin) {
    try { mismatch ||= new URL(origin).origin !== `${req.protocol}://${req.get('host')}`; }
    catch { mismatch = true; }
  }
  if (mismatch) return res.status(403).json({ error: { message: 'Open FlowDesk directly before making changes.' } });
  next();
}

// Per-process protection. A shared rate-limit store is required before horizontal scaling.
function authThrottle({ now = Date.now, windowMs = 15 * 60 * 1000, ipLimit = 300, pairLimit = 10, maxEntries = 10000 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [key, item] of buckets) if (item.until <= time) buckets.delete(key);
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 320) : '';
    const digest = value => createHash('sha256').update(value).digest('hex');
    const keys = [[digest(ip), ipLimit], [digest(`${ip}|${email}`), pairLimit]];
    const denied = keys.map(([key, limit]) => ({ item: buckets.get(key), limit })).find(({item, limit}) => item && item.count >= limit);
    if (denied || buckets.size + keys.filter(([key]) => !buckets.has(key)).length > maxEntries) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(((denied?.item.until || time + windowMs) - time) / 1000))));
      return res.status(429).json({ error: { message: 'Too many sign-in attempts. Please wait before trying again.' } });
    }
    for (const [key] of keys) {
      const item = buckets.get(key) || {count: 0, until: time + windowMs};
      item.count++; buckets.set(key, item);
    }
    res.once('finish', () => { if (res.statusCode < 400) buckets.delete(keys[1][0]); });
    next();
  };
}

function createMetrics() {
  const startedAt = new Date().toISOString();
  const buckets = [100, 250, 500, 1000, 2500, 5000, 15000, 60000, Infinity];
  const routes = new Map();
  return {
    middleware(req, res, next) {
      const start = performance.now();
      res.set('X-Request-ID', randomUUID());
      res.once('finish', () => {
        if (req.path === '/api/health' || req.path === '/api/admin/metrics') return;
        const route = typeof req.route?.path === 'string' ? req.route.path : 'other';
        const key = `${req.method} ${route}`;
        const safeKey = routes.has(key) || routes.size < 100 ? key : 'other';
        const row = routes.get(safeKey) || { requests: 0, serverErrors: 0, clientErrors: 0, totalMs: 0, maxMs: 0, histogram: buckets.map(() => 0) };
        const elapsed = performance.now() - start;
        row.requests++; row.serverErrors += Number(res.statusCode >= 500); row.clientErrors += Number(res.statusCode >= 400 && res.statusCode < 500);
        row.totalMs += elapsed; row.maxMs = Math.max(row.maxMs, elapsed); row.histogram[buckets.findIndex(limit => elapsed <= limit)]++;
        routes.set(safeKey, row);
      });
      next();
    },
    snapshot() {
      return { startedAt, scope: 'This instance since its last restart; server duration excludes browser/network time. No names, request bodies, IDs or URLs with query strings are collected.', routes: [...routes].map(([route, row]) => {
        let count = 0; const p95 = buckets.find((_, index) => (count += row.histogram[index]) >= Math.ceil(row.requests * .95));
        return { route, requests: row.requests, serverErrors: row.serverErrors, clientErrors: row.clientErrors, meanMs: Math.round(row.totalMs / row.requests), maxMs: Math.round(row.maxMs), p95UpperBoundMs: Number.isFinite(p95) ? p95 : null };
      }) };
    }
  };
}
module.exports = { securityHeaders, sameOriginWrites, authThrottle, createMetrics };
