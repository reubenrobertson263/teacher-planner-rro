const { PrismaClient } = require('@prisma/client');
const { databaseUrl } = require('../lib/database');
async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl(process.env.DATABASE_URL) } } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.session.findFirst({ select: { sid: true } });
    await prisma.user.findFirst({ select: { id: true, passwordHash: true } });
    console.log('Database connectivity and authentication tables verified (read-only).');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => {
  console.error('Database check failed:', error.code || error.errorCode || error.name);
  console.error('Check database availability, quota, connection settings and schema. No changes were made.');
  process.exitCode = 1;
});
