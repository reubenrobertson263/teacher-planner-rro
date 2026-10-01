function databaseUrl(value) {
  if (!value) throw new Error('DATABASE_URL must be configured before starting FlowDesk.');
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');
  // Allow sleeping databases time to wake; retain explicitly configured values.
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15');
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '15');
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '5');
  return url.toString();
}

function databaseUnavailable(error) {
  return error?.name === 'PrismaClientInitializationError' ||
    ['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1011', 'P1012', 'P1017', 'P2021', 'P2022', 'P2024'].includes(error?.code || error?.errorCode);
}

module.exports = { databaseUrl, databaseUnavailable };
