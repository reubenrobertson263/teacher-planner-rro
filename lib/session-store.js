const { Store } = require('express-session');

// Preserve the existing Session table and cookie format. No startup connection or
// polling: idle apps must allow Neon to scale to zero on the free plan.
class DatabaseSessionStore extends Store {
  constructor(prisma) {
    super();
    this.prisma = prisma;
    this.nextCleanup = 0;
  }

  get(sid, callback) {
    this.prisma.session.findUnique({ where: { sid } }).then(record => {
      if (!record || new Date(record.expiresAt) <= new Date()) return null;
      return JSON.parse(record.data);
    }).then(value => callback(null, value), callback);
  }

  set(sid, data, callback = () => {}) {
    const expiresAt = new Date(data.cookie.expires);
    this.prisma.session.upsert({
      where: { sid },
      create: { id: sid, sid, data: JSON.stringify(data), expiresAt },
      update: { data: JSON.stringify(data), expiresAt }
    }).then(() => { this.cleanup(); callback(null); }, callback);
  }

  touch(sid, data, callback = () => {}) {
    this.prisma.session.updateMany({
      where: { sid }, data: { expiresAt: new Date(data.cookie.expires) }
    }).then(() => callback(null), callback);
  }

  destroy(sid, callback = () => {}) {
    this.prisma.session.deleteMany({ where: { sid } }).then(() => callback(null), callback);
  }

  cleanup() {
    if (Date.now() < this.nextCleanup) return;
    this.nextCleanup = Date.now() + 60 * 60 * 1000;
    // Only run after an actual session write, while the database is already awake.
    this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => console.warn('[FlowDesk] Expired-session cleanup deferred.'));
  }
}

module.exports = { DatabaseSessionStore };
