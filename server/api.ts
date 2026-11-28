import { classes, permissions, type AccountIdentity } from './access';
import type { StudentRecord, UserRole } from '../src/types';
import { readLegacyZip } from './legacyImport';
import { createLoginToken, findLinkedAccount } from './loginLinks';
import { PinAuthError, changeOwnPin, clearPinSession, listPinAccounts, loginWithPin, pinAccountForSlug, readPinSession, saveAutomaticPinAccount, validatePinIdentity, writeWithAdminLimit } from './pinAuth';
import { createPinBulk, getPinBulkCandidates } from './pinBulk';

export interface Environment { DB: D1Database; ASSETS: Fetcher; RAPORT_PIN_BULK_KEY?:string }
type Member = AccountIdentity & { user_id: string; email: string; loginMethod?: 'pin' | 'chatgpt'; pinId?: string };
const OWNER_EMAIL = 'lionxmumtaz@gmail.com';
const roles = new Set(['admin', 'guru', 'wali_kelas']);
const attitudes = new Set(['', 'Sangat Baik', 'Baik', 'Cukup', 'Perlu Bimbingan']);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !Object.hasOwn(Object.prototype, value) && value !== 'prototype';
const score = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const nisn = (value: unknown): value is string => typeof value === 'string' && /^\d{0,10}$/.test(value);
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
function invalid(): never { throw new RequestError(400, 'Data perubahan tidak valid.'); }
function forbidden(): never { throw new RequestError(403, 'Akun ini tidak memiliki izin untuk perubahan tersebut.'); }
function json(value: unknown, status = 200, cookie?: string) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...(cookie ? {'Set-Cookie':cookie} : {}) } });
}

async function memberFor(request: Request, db: D1Database): Promise<Member | null> {
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) throw new RequestError(401, 'Silakan masuk dengan ChatGPT.');
  const email = (request.headers.get('oai-authenticated-user-email') || '').trim().toLowerCase();
  let account = await db.prepare('SELECT user_id, email, name, role FROM raport_members WHERE user_id = ?').bind(userId).first<Member>();
  if (!account && email === OWNER_EMAIL) {
    await db.prepare("INSERT OR IGNORE INTO raport_members (user_id,email,name,role) VALUES (?,?,?,'admin')").bind(userId,email,'Abu Mumtaz').run();
  } else if (!account && email) {
    await db.prepare('INSERT OR IGNORE INTO raport_members (user_id,email,name,role) SELECT ?,email,name,role FROM raport_invitations WHERE email = ?').bind(userId,email).run();
  }
  if (!account) account = await db.prepare('SELECT user_id, email, name, role FROM raport_members WHERE user_id = ?').bind(userId).first<Member>();
  return account ? {...account,loginMethod:'chatgpt'} : null;
}

async function accountFor(request: Request, db: D1Database): Promise<Member | null> {
  const pinAccount=await readPinSession(request,db);
  if(pinAccount)return {...pinAccount,user_id:'pin:'+pinAccount.id,email:'',pinId:pinAccount.id,loginMethod:'pin'};
  return memberFor(request,db);
}

export async function saveStudents(db: D1Database, account: AccountIdentity, input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 3000) invalid();
  const changes = input.map((change: unknown) => {
    if (!object(change)) invalid();
    const target = change.kind === 'upsert' && object(change.student) ? change.student : change;
    if (!identifier(target.id)) invalid();
    return { id: target.id as string, change };
  });
  const ids = [...new Set(changes.map(({id}) => id))];
  const loaded = await db.batch(ids.map(id => db.prepare('SELECT record,version FROM raport_students WHERE id = ?').bind(id)));
  const originals = new Map<string, number | null>();
  const records = new Map<string, StudentRecord | null>();
  ids.forEach((id,i) => {
    const row = loaded[i].results[0] as {record:string;version:number} | undefined;
    originals.set(id,row?.version ?? null);
    if (row) records.set(id,JSON.parse(row.record));
  });
  const access = permissions(account);
  const admin = account.role === 'admin';
  for (const {id,change} of changes) {
    const previous = records.get(id);
    if (change.kind === 'upsert') {
      if (!admin) forbidden();
      const item = change.student;
      if (!object(item) || !identifier(item.classId) || !classes.has(item.classId) || !nisn(item.nisn) || !text(item.name,200) || !item.name.trim()) invalid();
      if (!object(item.scores) || Object.entries(item.scores).some(([key,value]) => !identifier(key) || !score(value))) invalid();
      if (item.keterangan !== undefined && !text(item.keterangan,250)) invalid();
      records.set(id,{ ...previous, id, no: previous?.no ?? 0, classId: item.classId, name: item.name.trim(), nisn: item.nisn, schoolType: classes.get(item.classId)?.schoolType || 'mukim', scores: item.scores, keterangan: item.keterangan ?? previous?.keterangan ?? '' });
      continue;
    }
    if (!previous || !access.canRead(previous.classId)) forbidden();
    switch (change.kind) {
      case 'score':
        if (!identifier(change.subjectId) || !score(change.value)) invalid();
        if (!access.canScore(previous.classId,change.subjectId)) forbidden();
        records.set(id,{...previous,scores:{...previous.scores,[change.subjectId]:change.value}});
        break;
      case 'attitude':
        if (!access.canReadFull(previous.classId)) forbidden();
        if (typeof change.value !== 'string' || !attitudes.has(change.value)) invalid();
        records.set(id,{...previous,sikap:change.value});
        break;
      case 'identity':
        if (!admin) forbidden();
        if (change.name !== undefined && (!text(change.name,200) || !change.name.trim())) invalid();
        if (change.nisn !== undefined && !nisn(change.nisn)) invalid();
        records.set(id,{...previous,name:change.name?.trim() ?? previous.name,nisn:change.nisn ?? previous.nisn});
        break;
      case 'delete':
        if (!admin) forbidden();
        records.set(id,null);
        break;
      default: invalid();
    }
  }
  const operation = crypto.randomUUID();
  const commands: D1PreparedStatement[] = [];
  for (const [id,version] of originals) {
    const guard = operation + ':' + id;
    commands.push(version === null
      ? db.prepare('INSERT INTO raport_write_guards (id,valid) VALUES (?,CASE WHEN NOT EXISTS(SELECT 1 FROM raport_students WHERE id = ?) THEN 1 ELSE 0 END)').bind(guard,id)
      : db.prepare('INSERT INTO raport_write_guards (id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM raport_students WHERE id = ? AND version = ?) THEN 1 ELSE 0 END)').bind(guard,id,version));
  }
  for (const [id,record] of records) {
    commands.push(record === null
      ? db.prepare('DELETE FROM raport_students WHERE id = ?').bind(id)
      : db.prepare('INSERT INTO raport_students (id,class_id,record,version) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id,record=excluded.record,version=raport_students.version+1').bind(id,record.classId,JSON.stringify(record)));
  }
  commands.push(db.prepare('DELETE FROM raport_write_guards WHERE id LIKE ?').bind(operation + ':%'));
  try { await db.batch(commands); }
  catch (error) {
    if (String(error).includes('raport_write_conflict')) throw new RequestError(409,'Data baru saja diperbarui pengguna lain. Muat ulang data sebelum menyimpan kembali.');
    throw error;
  }
}

export async function handleApi(request: Request, env: Environment) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    if (!['GET','POST'].includes(request.method)) return json({error:'Metode tidak tersedia.'},405);
    if (request.method === 'POST' && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) forbidden();
    let body: Record<string,any> = {};
    if (request.method === 'POST' && action !== 'import-zip') {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') invalid();
      const payload = await request.text();
      if (payload.length > 900000) throw new RequestError(413,'Perubahan terlalu besar.');
      try { body = JSON.parse(payload); } catch { invalid(); }
      if (!object(body)) invalid();
    }
    if (request.method === 'POST' && action === 'pin-login') {
      const result=await loginWithPin(request,env.DB,body);
      return json({user:result.user},200,result.cookie);
    }
    if(action==='pin-change') {
      if(request.method!=='POST')return json({error:'Metode tidak tersedia.'},405);
      const result=await changeOwnPin(request,env.DB,body,env.RAPORT_PIN_BULK_KEY);
      return json({ok:true},200,result.cookie);
    }
    if (request.method === 'POST' && ['pin-preview','pin-link-session'].includes(action || '')) {
      const target=await pinAccountForSlug(env.DB,body.slug);
      if(!target)throw new RequestError(404,'Link akun tidak aktif. Minta link baru kepada administrator.');
      if(action==='pin-preview')return json({name:target.name,role:target.role});
      const session=await readPinSession(request,env.DB);
      if(!session)throw new RequestError(401,'Masukkan PIN dari administrator.');
      if(session.id!==target.id)throw new RequestError(403,'Masukkan PIN untuk nama yang tercantum pada link ini.');
      return json({user:{...permissions(session).user,loginMethod:'pin'}});
    }
    if (request.method === 'POST' && action === 'logout') {
      const pin=await readPinSession(request,env.DB);
      return json({ok:true,loginMethod:pin?'pin':'chatgpt'},200,await clearPinSession(request,env.DB));
    }
    if (request.method === 'POST' && ['login-link-preview', 'login-link-session'].includes(action || '')) {
      const linked = await findLinkedAccount(env.DB, body.token);
      if (!linked) throw new RequestError(404,'Link masuk tidak aktif. Minta link baru kepada administrator sekolah.');
      if (action === 'login-link-preview') return json({ name: linked.name, role: linked.role });
      if (!request.headers.get('oai-authenticated-user-id')) throw new RequestError(401,'Silakan masuk dengan akun ChatGPT yang ditetapkan administrator.');
      const email = (request.headers.get('oai-authenticated-user-email') || '').trim().toLowerCase();
      if (email !== linked.email) throw new RequestError(403,'Akun yang sedang masuk tidak sesuai dengan pemilik link ini. Ganti ke akun ChatGPT yang ditetapkan administrator.');
      const linkedMember = await memberFor(request, env.DB);
      if (!linkedMember || linkedMember.email !== linked.email || !['guru','wali_kelas'].includes(linkedMember.role)) forbidden();
      return json({ user: {...permissions(linkedMember).user,loginMethod:'chatgpt'} },200,await clearPinSession(request,env.DB));
    }
    const account = await accountFor(request,env.DB);
    if (request.method === 'GET' && action === 'session') return json({ user: account ? {...permissions(account).user,loginMethod:account.loginMethod} : null, authenticated: true });
    if (!account) throw new RequestError(403,'Akun ChatGPT Anda belum diberi peran. Hubungi administrator sekolah.');
    if(action==='pin-bulk-candidates'||action==='pin-bulk-create') {
      if(account.role!=='admin')forbidden();
      if(action==='pin-bulk-candidates'&&request.method==='GET')return json(await getPinBulkCandidates(env.DB));
      if(action==='pin-bulk-create'&&request.method==='POST')return json(await createPinBulk(env.DB,account.user_id,body,env.RAPORT_PIN_BULK_KEY));
      return json({error:'Metode tidak tersedia.'},405);
    }
    if (action === 'pin-accounts') {
      if(account.role!=='admin')forbidden();
      if(request.method==='GET')return json(await listPinAccounts(env.DB,account.pinId));
      return json(await saveAutomaticPinAccount(env.DB,body,account.pinId,env.RAPORT_PIN_BULK_KEY));
    }
    if (request.method === 'GET' && action === 'students') {
      const access = permissions(account);
      const allowed = access.user.assignedClassIds || [];
      const rows = account.role === 'admin'
        ? await env.DB.prepare('SELECT record FROM raport_students ORDER BY class_id,id').all<{record:string}>()
        : allowed.length ? await env.DB.prepare(`SELECT record FROM raport_students WHERE class_id IN (${allowed.map(()=>'?').join(',')}) ORDER BY class_id,id`).bind(...allowed).all<{record:string}>() : {results:[]};
      const students = rows.results.map(({record:raw}) => {
        const record: StudentRecord = JSON.parse(raw);
        if (access.canReadFull(record.classId)) return record;
        const {id,no,classId,name,nisn,nis,schoolType} = record;
        const scores = Object.fromEntries(Object.entries(record.scores).filter(([subjectId]) => access.canScore(classId,subjectId)));
        return {id,no,classId,name,nisn,nis,schoolType,scores};
      });
      students.sort((a,b)=>a.classId.localeCompare(b.classId) || a.no-b.no || a.id.localeCompare(b.id));
      return json({students});
    }
    if (request.method === 'POST' && action === 'save') { await saveStudents(env.DB,account,body.changes); return json({ok:true}); }
    if (request.method === 'POST' && action === 'login-links') {
      if (account.role !== 'admin') forbidden();
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) invalid();
      if (body.revoke === true) {
        await env.DB.prepare('DELETE FROM raport_login_links WHERE email=?').bind(email).run();
        return json({ok:true});
      }
      const target = await env.DB.prepare(`SELECT email,name,role FROM raport_members WHERE email=?
        UNION ALL SELECT email,name,role FROM raport_invitations WHERE email=? LIMIT 1`).bind(email,email).first<Member>();
      if (!target || !['guru','wali_kelas'].includes(target.role)) throw new RequestError(400,'Simpan akses guru atau wali kelas terlebih dahulu.');
      const assigned = permissions(target).user;
      if (!assigned.assignedClassIds?.length || (target.role === 'wali_kelas' && !assigned.homeroomClassIds?.length)) throw new RequestError(400,'Periksa kembali nama dan penugasan pada master sebelum membuat link.');
      const token = await createLoginToken(env.DB, email);
      return json({ path: '/#akses=' + token, name: target.name, role: target.role },201);
    }
    if (request.method === 'POST' && action === 'import-zip') {
      if (account.role !== 'admin') forbidden();
      if (request.headers.get('content-type') !== 'application/zip') throw new RequestError(415,'Pilih berkas ZIP asli Raport Pondok.');
      if (Number(request.headers.get('content-length')) > 3*1024*1024) throw new RequestError(413,'Ukuran ZIP melebihi 3 MB.');
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > 3*1024*1024) throw new RequestError(413,'Ukuran ZIP melebihi 3 MB.');
      let records: StudentRecord[];
      try { records = await readLegacyZip(bytes); } catch { throw new RequestError(400,'ZIP tidak cocok. Pilih raport-pondok.zip asli yang berisi data santri.'); }
      if (records.some(({classId})=>!classes.has(classId))) invalid();
      const results = await env.DB.batch(records.map(record => env.DB.prepare('INSERT OR IGNORE INTO raport_students (id,class_id,record) VALUES (?,?,?)').bind(record.id,record.classId,JSON.stringify(record))));
      const imported = results.reduce((sum,result)=>sum+(result.meta.changes || 0),0);
      return json({imported,skipped:records.length-imported});
    }
    if (action === 'members') {
      if (account.role !== 'admin') forbidden();
      if (request.method === 'GET') {
        const members = await env.DB.prepare(`SELECT account.email,account.name,account.role,
          CASE WHEN link.email IS NULL THEN 0 ELSE 1 END AS hasLoginLink FROM (
          SELECT email,name,role FROM raport_members UNION SELECT email,name,role FROM raport_invitations
          WHERE email NOT IN (SELECT email FROM raport_members)) AS account
          LEFT JOIN raport_login_links AS link ON link.email=account.email ORDER BY account.name`).all<{email:string;name:string;role:UserRole;hasLoginLink:number}>();
        return json({members:members.results.map(member=>({...member,hasLoginLink:Boolean(member.hasLoginLink)})),ownerEmail:OWNER_EMAIL});
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) invalid();
      if (email === OWNER_EMAIL) forbidden();
      if (body.revoke === true) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM raport_invitations WHERE email=?').bind(email),
          env.DB.prepare('DELETE FROM raport_members WHERE email=?').bind(email),
          env.DB.prepare('DELETE FROM raport_login_links WHERE email=?').bind(email),
        ]);
        return json({ok:true});
      }
      if (!text(body.name,200) || !body.name.trim() || !roles.has(body.role)) invalid();
      const next = {name:body.name.trim(),role:body.role as UserRole};
      if(next.role==='admin')validatePinIdentity(next.name,'guru');
      const assignedUser = permissions(next).user;
      if (next.role === 'wali_kelas' && !assignedUser.homeroomClassIds?.length) throw new RequestError(400,'Nama belum terdaftar sebagai wali kelas. Pilih nama wali kelas sesuai master.');
      if (next.role !== 'admin' && !assignedUser.assignedClassIds?.length) throw new RequestError(400,'Nama belum ditemukan pada penugasan resmi. Gunakan nama guru atau wali kelas sesuai master.');
      await writeWithAdminLimit(env.DB,'email',email,next.role,[
        env.DB.prepare('INSERT INTO raport_invitations (email,name,role) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role').bind(email,next.name,next.role),
        env.DB.prepare('UPDATE raport_members SET name=?,role=? WHERE email=?').bind(next.name,next.role,email),
        ...(next.role === 'admin' ? [env.DB.prepare('DELETE FROM raport_login_links WHERE email=?').bind(email)] : []),
      ]);
      return json({ok:true});
    }
    return json({error:'Operasi tidak tersedia.'},404);
  } catch (error) {
    if (error instanceof RequestError || error instanceof PinAuthError) return json({error:error.message},error.status);
    console.error('Raport API failure',error instanceof Error ? error.name : 'UnknownError');
    return json({error:'Layanan rapor gagal. Silakan muat ulang atau hubungi administrator.'},500);
  }
}
