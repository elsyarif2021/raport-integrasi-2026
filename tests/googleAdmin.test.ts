import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { googleAdminFor, googleContextFor, googleSessionCookie, handleGoogleAdminRpc, GOOGLE_COOKIE } from '../server/googleAdmin';
import { signGoogleRpc, verifyGoogleRpc } from '../server/googleRpc';
import { handleApi, type Environment } from '../server/api';
import { savePinAccount } from '../server/pinAuth';
import { createRaportBridge } from '../api/raport';
import { trustedClientRequest } from '../server/proxyClient';
import { ALL_TEACHER_ASSIGNMENTS } from '../src/data/teacherSubjectsDatabase';

const key = 'a7'.repeat(32), bulkKey = 'c9'.repeat(32), rpcUrl = 'https://raport-pondok.abumumtaz.chatgpt.site/api/google-admin';
const profile = { sub: 'google-owner-123', email: 'lionxmumtaz@gmail.com', name: 'Pemilik Uji', emailVerified: true };
class Database {
  sql = new DatabaseSync(':memory:');
  constructor() {
    const directory = new URL('../drizzle/', import.meta.url);
    for (const file of readdirSync(directory).filter(x => x.endsWith('.sql')).sort()) this.sql.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  prepare(sql: string) {
    const db = this;
    const statement = (params: any[] = []): any => ({ bind: (...values: any[]) => statement(values), sql, params,
      first: async () => db.sql.prepare(sql).get(...params) ?? null, all: async () => ({ results: db.sql.prepare(sql).all(...params) }),
      run: async () => ({ meta: { changes: Number(db.sql.prepare(sql).run(...params).changes) } }) });
    return statement();
  }
  async batch(commands: any[]) {
    this.sql.exec('BEGIN');
    try {
      const result = commands.map(command => /^SELECT/i.test(command.sql)
        ? { results: this.sql.prepare(command.sql).all(...command.params), meta: { changes: 0 } }
        : { results: [], meta: { changes: Number(this.sql.prepare(command.sql).run(...command.params).changes) } });
      this.sql.exec('COMMIT'); return result;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  env() { return { DB: this as unknown as D1Database, ASSETS: {} as Fetcher, RAPORT_PIN_BULK_KEY: bulkKey } satisfies Environment; }
}
async function signed(body: unknown, time = String(Date.now()), id = crypto.randomUUID()) {
  const raw = JSON.stringify(body);
  return new Request(rpcUrl, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json',
    'x-raport-rpc-time': time, 'x-raport-rpc-id': id, 'x-raport-rpc-signature': await signGoogleRpc('POST', rpcUrl, time, id, raw, key) } });
}
async function rpc(db: Database, body: unknown) { return handleGoogleAdminRpc(await signed(body), db.env().DB, key); }
function client(action: string, cookie?: string, body?: unknown) {
  return new Request('https://raport.test/api/raport?action=' + action, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: 'https://raport.test' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function bridgeFor(db: Database) {
  return createRaportBridge({ key: () => key, fetcher: async (input, init) => {
    const incoming = new Request(input, init), context = await googleContextFor(incoming, db.env().DB, key);
    return handleApi(await trustedClientRequest(incoming, key), db.env(), context);
  } });
}
test('Google registration requires a verified allowlisted identity, signup before login, stable subject, and replay protection', async () => {
  const db = new Database();
  const before = await rpc(db, { intent: 'login', profile }); assert.equal(before.status, 409); assert.equal((await before.json() as any).code, 'not_registered');
  for (const changed of [{ email: 'visitor@example.test' }, { emailVerified: false }, { sub: '' }]) assert.equal((await rpc(db, { intent: 'register', profile: { ...profile, ...changed } })).status, 403);
  assert.equal((await handleGoogleAdminRpc(new Request(rpcUrl, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }), db.env().DB, key)).status, 403);
  const request = await signed({ intent: 'register', profile });
  const registration = await handleGoogleAdminRpc(request.clone() as Request, db.env().DB, key); assert.equal(registration.status, 200); assert.equal((await registration.json() as any).token, undefined);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_google_sessions').get()!.total, 0);
  assert.equal((await handleGoogleAdminRpc(request.clone() as Request, db.env().DB, key)).status, 409);
  assert.equal((await rpc(db, { intent: 'register', profile: { ...profile, sub: 'replacement-subject' } })).status, 403);
  const loginRequest = await signed({ intent: 'login', profile });
  const first = await handleGoogleAdminRpc(loginRequest.clone() as Request, db.env().DB, key); const value = await first.json() as any;
  assert.equal(first.status, 200); assert.match(value.token, /^[a-f0-9]{64}$/);
  assert.equal((await handleGoogleAdminRpc(loginRequest.clone() as Request, db.env().DB, key)).status, 409);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_google_sessions').get()!.total, 1);
  assert.notEqual(db.sql.prepare('SELECT token_hash FROM raport_google_sessions').get()!.token_hash, value.token);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_members').get()!.total, 0);
  const raw = JSON.stringify({ intent: 'login', profile });
  assert.equal(await verifyGoogleRpc(await signed({ intent: 'login', profile }), raw.replace('login', 'register'), key), false);
  assert.equal((await handleGoogleAdminRpc(await signed({ intent: 'login', profile }, String(Date.now() - 100000)), db.env().DB, key)).status, 403);
  db.sql.close();
});
test('Google sessions cross only the signed Vercel bridge, retain super admin permissions, and logout revokes the token', async () => {
  const db = new Database(); await rpc(db, { intent: 'register', profile });
  const { token } = await (await rpc(db, { intent: 'login', profile })).json() as any;
  const cookie = googleSessionCookie(token).split(';')[0], request = client('session', cookie), bridge = bridgeFor(db);
  assert.equal(await googleContextFor(request, db.env().DB, key), undefined);
  assert.equal((await handleApi(request.clone() as Request, db.env())).status, 401);
  const session = await bridge(request.clone() as Request); const { user } = await session.json() as any;
  assert.equal(user.role, 'admin'); assert.equal(user.isSuperAdmin, true); assert.equal(user.loginMethod, 'google'); assert.equal(user.email, profile.email);
  assert.equal((await bridge(client('pin-accounts', cookie))).status, 200);
  const record = { id: 'google-test-student', no: 1, name: 'Santri Uji', classId: '1a', nisn: '', scores: {}, keterangan: '' };
  assert.equal((await bridge(client('save', cookie, { changes: [{ kind: 'upsert', student: record }] }))).status, 200);
  assert.equal((await (await bridge(client('students', cookie))).json() as any).students.length, 1);
  assert.equal((await bridge(client('logout', cookie, {}))).headers.getSetCookie().filter(value => value.includes('Max-Age=0')).length, 2);
  assert.equal(await googleAdminFor(client('session', cookie), db.env().DB), null);
  assert.equal((await bridge(client('session', cookie))).status, 401);
  db.sql.close();
});
test('Switching between Google and PIN revokes the previous session; expired Google sessions cannot access data', async () => {
  const db = new Database(), bridge = bridgeFor(db), name = ALL_TEACHER_ASSIGNMENTS.find(row => row.teacherName)!.teacherName;
  await savePinAccount(db.env().DB, { name, role: 'guru', pin: '41827365' }, undefined, bulkKey);
  await rpc(db, { intent: 'register', profile });
  const first = await (await rpc(db, { intent: 'login', profile })).json() as any;
  const googleCookie = GOOGLE_COOKIE + '=' + first.token;
  const pinLogin = await bridge(client('pin-login', googleCookie, { name, pin: '41827365' }));
  assert.equal(pinLogin.status, 200); assert.equal(pinLogin.headers.getSetCookie().length, 2);
  assert.equal(await googleAdminFor(client('session', googleCookie), db.env().DB), null);
  const pinCookie = pinLogin.headers.getSetCookie().find(value => value.startsWith('raport_pin_session='))!.split(';')[0];
  const second = await (await rpc(db, { intent: 'login', profile, previousPinSession: pinCookie.split('=')[1], previousSession: first.token })).json() as any;
  assert.equal((await bridge(client('session', pinCookie))).status, 401);
  const secondCookie = GOOGLE_COOKIE + '=' + second.token;
  assert.equal((await bridge(client('session', secondCookie))).status, 200);
  db.sql.exec('UPDATE raport_google_sessions SET expires_at=1');
  assert.equal((await bridge(client('session', secondCookie))).status, 401);
  db.sql.close();
});
