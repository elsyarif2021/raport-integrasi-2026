import pg from 'pg';

let pool: pg.Pool | undefined;

export function database() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL?.trim() || process.env.RAPORT_INTEGRASI_DATABASE_URL?.trim();
    if (!connectionString) throw new Error('Missing database configuration');
    pool = new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 15000, connectionTimeoutMillis: 8000 });
    pool.on('error', () => console.error('Idle PostgreSQL connection closed'));
  }
  return pool;
}
