import { createHash, randomBytes } from 'node:crypto';
import { classes, permissions, type AccountIdentity } from '../server/access.js';
import { database } from '../server/db.js';
import { verifyPassword } from '../server/password.js';
import type { StudentRecord } from '../src/types.js';

const sessionSeconds = 8 * 60 * 60;
const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const cookieName = secure ? '__Host-raport' : 'raport-local';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const attitudes = new Set(['', 'Sangat Baik', 'Baik', 'Cukup', 'Perlu Bimbingan']);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
  && !Object.hasOwn(Object.prototype, value) && value !== 'prototype';
const score = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;
const nisn = (value: unknown): value is string => typeof value === 'string' && /^\d{0,10}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function invalid(): never { throw new RequestError(400, 'Data perubahan tidak valid.'); }
function forbidden(): never { throw new RequestError(403, 'Akun ini tidak memiliki izin untuk perubahan tersebut.'); }

function response(value: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return Response.json(value, { status, headers });
}

function sessionCookie(token: string, maxAge: number) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function getToken(request: Request) {
  const cookie = request.headers.get('cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  return cookie && /^[0-9a-f]{64}$/.test(cookie) ? hash(cookie) : null;
}

async function checkRate(key: string, limit: number) {
  const result = await database().query<{ attempts: number }>(
    `INSERT INTO raport_login_limits (key, attempts, expires_at)
     VALUES ($1, 1, now() + interval '15 minutes')
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE WHEN raport_login_limits.expires_at <= now() THEN 1 ELSE raport_login_limits.attempts + 1 END,
       expires_at = CASE WHEN raport_login_limits.expires_at <= now() THEN excluded.expires_at ELSE raport_login_limits.expires_at END
     RETURNING attempts`, [key],
  );
  return result.rows[0].attempts <= limit;
}

async function login(request: Request, body: Record<string, unknown>) {
  const { username, password } = body;
  if (typeof username !== 'string' || !/^[a-z0-9._-]{1,64}$/i.test(username) || !text(password, 256) || !password) invalid();
  const handle = username.toLowerCase();
  const ip = process.env.VERCEL === '1' ? (request.headers.get('x-vercel-forwarded-for') || 'unknown') : 'local';
  const pool = database();
  await pool.query('DELETE FROM raport_login_limits WHERE expires_at <= now()');
  if (!(await checkRate('ip:' + hash(ip), 100)) || !(await checkRate('account:' + hash(handle), 12))) {
    throw new RequestError(429, 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.');
  }
  const result = await pool.query<AccountIdentity & { password_hash: string }>(
    'SELECT name, role, password_hash FROM raport_accounts WHERE username = $1', [handle],
  );
  const account = result.rows[0];
  if (!(await verifyPassword(password, account?.password_hash)) || !account) {
    throw new RequestError(401, 'Nama pengguna atau kata sandi salah.');
  }
  await pool.query('DELETE FROM raport_login_limits WHERE key = $1', ['account:' + hash(handle)]);
  await pool.query('DELETE FROM raport_sessions WHERE expires_at <= now() OR token_hash = $1', [getToken(request)]);
  const token = randomBytes(32).toString('hex');
  const session = await pool.query(
    `INSERT INTO raport_sessions (token_hash, username, expires_at)
     SELECT $1, username, now() + $3 * interval '1 second'
     FROM raport_accounts WHERE username = $2 AND password_hash = $4 FOR UPDATE`,
    [hash(token), handle, sessionSeconds, account.password_hash],
  );
  if (!session.rowCount) throw new RequestError(401, 'Akun berubah. Silakan masuk kembali.');
  return response({ user: permissions(account).user }, 200, sessionCookie(token, sessionSeconds));
}

async function save(account: AccountIdentity, input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 3000) invalid();
  const changes = input.map((change: unknown) => {
    if (!object(change)) invalid();
    const target = change.kind === 'upsert' && object(change.student) ? change.student : change;
    if (!identifier(target.id)) invalid();
    return { id: target.id, change };
  });
  const access = permissions(account);
  const db = await database().connect();
  try {
    await db.query('BEGIN');
    // Serialize write batches so imports, new IDs and simultaneous edits stay consistent.
    await db.query('SELECT pg_advisory_xact_lock(904311741)');
    const result = await db.query<{ id: string; record: StudentRecord }>(
      'SELECT id, record FROM raport_students WHERE id = ANY($1::text[])',
      [[...new Set(changes.map(({ id }) => id))]],
    );
    const records = new Map<string, StudentRecord | null>(result.rows.map(({ id, record }) => [id, record]));
    const admin = account.role === 'admin';
    for (const { id, change } of changes) {
      const previous = records.get(id);
      if (change.kind === 'upsert') {
        if (!admin) forbidden();
        const item = change.student;
        if (!object(item) || !identifier(item.classId) || !classes.has(item.classId) || !nisn(item.nisn) ||
            !text(item.name, 200) || !item.name.trim()) invalid();
        if (!object(item.scores) || Object.entries(item.scores).some(([key, value]) => !identifier(key) || !score(value))) invalid();
        if (item.keterangan !== undefined && !text(item.keterangan, 250)) invalid();
        records.set(id, {
          ...previous, id, no: previous?.no ?? 0, classId: item.classId, name: item.name.trim(), nisn: item.nisn,
          schoolType: classes.get(item.classId)?.schoolType || 'mukim',
          scores: item.scores as Record<string, number>,
          keterangan: (item.keterangan as string | undefined) ?? previous?.keterangan ?? '',
        });
        continue;
      }
      if (!previous || !access.canRead(previous.classId)) forbidden();
      switch (change.kind) {
        case 'score': {
          const { subjectId, value } = change;
          if (!identifier(subjectId) || !score(value)) invalid();
          if (!access.canScore(previous.classId, subjectId)) forbidden();
          records.set(id, { ...previous, scores: { ...previous.scores, [subjectId]: value } });
          break;
        }
        case 'attitude':
          if (!access.canReadFull(previous.classId)) forbidden();
          if (typeof change.value !== 'string' || !attitudes.has(change.value)) invalid();
          records.set(id, { ...previous, sikap: change.value });
          break;
        case 'identity':
          if (!admin) forbidden();
          if (change.name !== undefined && (!text(change.name, 200) || !change.name.trim())) invalid();
          if (change.nisn !== undefined && !nisn(change.nisn)) invalid();
          records.set(id, {
            ...previous, name: (change.name as string | undefined)?.trim() ?? previous.name,
            nisn: (change.nisn as string | undefined) ?? previous.nisn,
          });
          break;
        case 'delete':
          if (!admin) forbidden();
          records.set(id, null);
          break;
        default:
          invalid();
      }
    }
    const updates = [...records.values()].filter((record): record is StudentRecord => record !== null);
    if (updates.length) {
      await db.query(
        `INSERT INTO raport_students (id, record)
         SELECT item->>'id', item FROM jsonb_array_elements($1::jsonb) AS item
         ON CONFLICT (id) DO UPDATE SET record = excluded.record`, [JSON.stringify(updates)],
      );
    }
    const deleted = [...records].filter(([, record]) => record === null).map(([id]) => id);
    if (deleted.length) await db.query('DELETE FROM raport_students WHERE id = ANY($1::text[])', [deleted]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

export async function GET(request: Request) { return handler(request); }
export async function POST(request: Request) { return handler(request); }

async function handler(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const token = getToken(request);
    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== url.origin) forbidden();
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') invalid();
      const payload = await request.text();
      if (payload.length > 900000) throw new RequestError(413, 'Perubahan terlalu besar.');
      try {
        const parsed: unknown = JSON.parse(payload);
        if (!object(parsed)) invalid();
        body = parsed;
      } catch { invalid(); }
      if (action === 'login') return await login(request, body);
      if (action === 'logout') {
        if (token) await database().query('DELETE FROM raport_sessions WHERE token_hash = $1', [token]);
        return response({ ok: true }, 200, sessionCookie('', 0));
      }
    }
    const account = token ? (await database().query<AccountIdentity>(
      `SELECT a.name, a.role FROM raport_sessions s JOIN raport_accounts a USING (username)
       WHERE s.token_hash = $1 AND s.expires_at > now()`, [token],
    )).rows[0] : undefined;
    if (request.method === 'GET' && action === 'session') {
      return response({ user: account ? permissions(account).user : null });
    }
    if (!account) throw new RequestError(401, 'Sesi berakhir. Silakan masuk kembali.');
    if (request.method === 'GET' && action === 'students') {
      const access = permissions(account);
      const result = await database().query<{ record: StudentRecord }>(
        `SELECT record FROM raport_students WHERE $1::boolean OR record->>'classId' = ANY($2::text[]) ORDER BY record->>'classId', (record->>'no')::int, id`,
        [account.role === 'admin', access.user.assignedClassIds],
      );
      return response({ students: result.rows.map(({ record }) => {
        if (access.canReadFull(record.classId)) return record;
        const { id, no, classId, name, nisn, nis, schoolType } = record;
        const scores = Object.fromEntries(Object.entries(record.scores).filter(([subjectId]) =>
          access.canScore(classId, subjectId)));
        return { id, no, classId, name, nisn, nis, schoolType, scores };
      }) });
    }
    if (request.method === 'POST' && action === 'save') {
      await save(account, body.changes);
      return response({ ok: true });
    }
    return response({ error: 'Operasi tidak tersedia.' }, 404);
  } catch (error) {
    if (error instanceof RequestError) return response({ error: error.message }, error.status);
    const errorCode = error instanceof Error && 'code' in error && typeof error.code === 'string'
      && /^[A-Z0-9_]{3,40}$/.test(error.code) ? error.code : undefined;
    console.error('Raport request failed', errorCode ?? (error instanceof Error ? error.name : 'UnknownError'));
    return response({ error: 'Layanan rapor gagal. Hubungi administrator sekolah.' }, 500);
  }
}
