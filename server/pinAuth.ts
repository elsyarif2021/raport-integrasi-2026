import { permissions, type AccountIdentity } from './access';
import type { UserRole } from '../src/types';
import { generateRandomPin, pinFingerprint, validBulkKey } from './pinSecurity';

export const MAX_ADMINS = 10;
export const PIN_COOKIE = 'raport_pin_session';
const SESSION_SECONDS = 8 * 60 * 60;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const OWNER_EMAIL = 'lionxmumtaz@gmail.com';
export class PinAuthError extends Error { constructor(public status: number, message: string) { super(message); } }
interface PinAccount extends AccountIdentity { id:string; login_name:string; slug:string; pin_hash:string; pin_salt:string; pin_fingerprint?:string|null }
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
const unhex = (value:string) => Uint8Array.from(value.match(/../g) ?? [], value=>parseInt(value,16));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const pinLoginName = (name:string) => name.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const validPinSlug = (value:unknown):value is string => typeof value==='string' && /^[a-z0-9][a-z0-9-]{35,159}$/.test(value);
const validPin = (value:unknown):value is string => typeof value==='string' && /^\d{6,12}$/.test(value);
async function digest(value:string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))); }
export async function hashPin(pin:string,salt:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations:100000},key,256)));
}
function equalHash(left:string,right:string) {
  let difference=left.length ^ right.length;
  for(let index=0;index<left.length;index++)difference|=left.charCodeAt(index) ^ (right.charCodeAt(index)||0);
  return difference===0;
}

// Reserve the owner's place even before their first platform sign-in. Email invitations and members count once.
const ADMIN_COUNT_SQL=`(SELECT count(*) FROM raport_pin_accounts WHERE role='admin') + (SELECT count(*) FROM (
  SELECT '${OWNER_EMAIL}' AS email UNION SELECT email FROM raport_members WHERE role='admin'
  UNION SELECT email FROM raport_invitations WHERE role='admin' AND email NOT IN (SELECT email FROM raport_members)))`;
export async function getAdminCount(db:D1Database) {
  return Number((await db.prepare(`SELECT (${ADMIN_COUNT_SQL}) AS total`).first<{total:number}>())?.total ?? 1);
}
export async function writeWithNewAdminSlots(db:D1Database,added:number,commands:D1PreparedStatement[]) {
  if(!added){await db.batch(commands);return;}
  const guard=crypto.randomUUID();
  try {await db.batch([
    db.prepare(`INSERT INTO raport_admin_guards (id,valid) VALUES (?,CASE WHEN (${ADMIN_COUNT_SQL}) + ? <= ${MAX_ADMINS} THEN 1 ELSE 0 END)`).bind(guard,added),
    ...commands,db.prepare('DELETE FROM raport_admin_guards WHERE id=?').bind(guard),
  ]);}catch(error){
    if(String(error).includes('raport_admin_limit'))throw new PinAuthError(409,'Jumlah admin melebihi batas 10 akun, termasuk pemilik.');
    throw error;
  }
}
export function validatePinIdentity(rawName:unknown,rawRole:unknown) {
  const name=typeof rawName==='string'?rawName.trim().replace(/\s+/g,' '):'';
  const role=rawRole as UserRole;
  if(name.length<2||name.length>200||!['admin','guru','wali_kelas'].includes(role))throw new PinAuthError(400,'Isi nama dan peran akun dengan benar.');
  const assigned=permissions({name,role}).user;
  if(role!=='admin'&&!assigned.assignedClassIds?.length)throw new PinAuthError(400,'Pilih nama guru sesuai master penugasan.');
  if(role==='wali_kelas'&&!assigned.homeroomClassIds?.length)throw new PinAuthError(400,'Pilih nama wali kelas sesuai master kelas binaan.');
  return {name,role,assigned};
}
export function createPinSlug(name:string) {
  return (name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'akun')+'-'+crypto.randomUUID();
}
export async function assertUniquePin(db:D1Database,pin:string,secret:string,exceptId='') {
  const fingerprint=await pinFingerprint(secret,pin);
  if(await db.prepare('SELECT id FROM raport_pin_accounts WHERE pin_fingerprint=? AND id<>?').bind(fingerprint,exceptId).first())throw new PinAuthError(409,'PIN sudah digunakan akun lain. Pilih PIN berbeda.');
  const legacy=await db.prepare('SELECT pin_hash,pin_salt FROM raport_pin_accounts WHERE pin_fingerprint IS NULL AND id<>?').bind(exceptId).all<{pin_hash:string;pin_salt:string}>();
  for(const row of legacy.results)if(equalHash(await hashPin(pin,row.pin_salt),row.pin_hash))throw new PinAuthError(409,'PIN sudah digunakan akun lain. Pilih PIN berbeda.');
  return fingerprint;
}
export async function writeWithAdminLimit(db:D1Database,kind:'pin'|'email',id:string,role:UserRole,commands:D1PreparedStatement[]) {
  if(role!=='admin') {await db.batch(commands);return;}
  const guard=crypto.randomUUID();
  const existing=kind==='pin'
    ? "EXISTS(SELECT 1 FROM raport_pin_accounts WHERE id=? AND role='admin')"
    : "EXISTS(SELECT 1 FROM raport_members WHERE email=? AND role='admin') OR (NOT EXISTS(SELECT 1 FROM raport_members WHERE email=?) AND EXISTS(SELECT 1 FROM raport_invitations WHERE email=? AND role='admin'))";
  const guardStatement=db.prepare(`INSERT INTO raport_admin_guards (id,valid) VALUES (?,CASE WHEN
    (${ADMIN_COUNT_SQL}) + 1 - CASE WHEN (${existing}) THEN 1 ELSE 0 END <= ${MAX_ADMINS} THEN 1 ELSE 0 END)`)
    .bind(guard,...(kind==='pin'?[id]:[id,id,id]));
  try {await db.batch([guardStatement,...commands,db.prepare('DELETE FROM raport_admin_guards WHERE id=?').bind(guard)]);}
  catch(error) {
    if(String(error).includes('raport_admin_limit'))throw new PinAuthError(409,'Batas maksimal 10 akun admin sudah tercapai, termasuk akun pemilik.');
    throw error;
  }
}

export async function pinAccountForSlug(db:D1Database,slug:unknown) {
  if(!validPinSlug(slug))return null;
  return db.prepare('SELECT id,name,role,slug FROM raport_pin_accounts WHERE slug=?').bind(slug).first<Pick<PinAccount,'id'|'name'|'role'|'slug'>>();
}
export async function listPinAccounts(db:D1Database,currentId?:string) {
  const rows=await db.prepare('SELECT id,name,role,slug FROM raport_pin_accounts ORDER BY name').all<Pick<PinAccount,'id'|'name'|'role'|'slug'>>();
  return {accounts:rows.results.map(row=>({...row,path:'/#masuk='+row.slug,isSelf:row.id===currentId})),adminCount:await getAdminCount(db),maxAdmins:MAX_ADMINS};
}
export async function savePinAccount(db:D1Database,input:Record<string,unknown>,currentId?:string,bulkKey?:string) {
  const id=typeof input.id==='string'?input.id:crypto.randomUUID();
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new PinAuthError(400,'ID akun tidak valid.');
  const previous=await db.prepare('SELECT id,name,role,login_name,slug,pin_hash,pin_salt,pin_fingerprint FROM raport_pin_accounts WHERE id=?').bind(id).first<PinAccount>();
  if(input.id && !previous)throw new PinAuthError(404,'Akun tidak ditemukan.');
  if(input.revoke===true) {
    if(id===currentId)throw new PinAuthError(403,'Akun admin yang sedang digunakan tidak dapat dinonaktifkan sendiri.');
    await db.batch([db.prepare('DELETE FROM raport_pin_sessions WHERE account_id=?').bind(id),db.prepare('DELETE FROM raport_pin_accounts WHERE id=?').bind(id)]);
    return {ok:true};
  }
  const role=input.role as UserRole;
  if(id===currentId && role!=='admin')throw new PinAuthError(403,'Peran admin yang sedang digunakan tidak dapat diturunkan sendiri.');
  const {name}=validatePinIdentity(input.name,role);
  const changingPin=input.pin!==undefined && input.pin!=='';
  if((!previous || changingPin) && !validPin(input.pin))throw new PinAuthError(400,'PIN harus terdiri dari 6–12 digit angka.');
  if(changingPin&&previous?.pin_fingerprint&&!bulkKey)throw new PinAuthError(503,'Layanan PIN sedang dikonfigurasi. Coba kembali nanti.');
  const fingerprint=changingPin&&bulkKey?await assertUniquePin(db,input.pin as string,bulkKey,id):previous?.pin_fingerprint??null;
  const salt=changingPin?hex(crypto.getRandomValues(new Uint8Array(16))):previous!.pin_salt;
  const pinHash=changingPin?await hashPin(input.pin as string,salt):previous!.pin_hash;
  const slug=previous?.slug || createPinSlug(name);
  const normalized=pinLoginName(name);
  const duplicate=await db.prepare('SELECT id FROM raport_pin_accounts WHERE login_name=? AND id<>?').bind(normalized,id).first();
  if(duplicate)throw new PinAuthError(409,'Nama ini sudah memiliki akun. Gunakan tombol Ubah pada akun tersebut.');
  const bucket=await digest('account:'+id);
  const commands=[
    db.prepare(`INSERT INTO raport_pin_accounts (id,name,login_name,slug,role,pin_hash,pin_salt,pin_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,login_name=excluded.login_name,role=excluded.role,pin_hash=excluded.pin_hash,pin_salt=excluded.pin_salt,pin_fingerprint=excluded.pin_fingerprint`)
      .bind(id,name,normalized,slug,role,pinHash,salt,fingerprint,Date.now()),
    db.prepare('DELETE FROM raport_pin_sessions WHERE account_id=?').bind(id),
    db.prepare('DELETE FROM raport_pin_attempts WHERE bucket=?').bind(bucket),
  ];
  try {await writeWithAdminLimit(db,'pin',id,role,commands);}
  catch(error) {
    if(String(error).includes('raport_pin_accounts.pin_fingerprint'))throw new PinAuthError(409,'PIN sudah digunakan akun lain. Pilih PIN berbeda.');
    if(String(error).includes('raport_pin_accounts.login_name'))throw new PinAuthError(409,'Nama ini sudah memiliki akun.');
    throw error;
  }
  return {ok:true,account:{id,name,role,slug,path:'/#masuk='+slug}};
}

// Administrative creation/reset always uses an application-generated PIN.
export async function saveAutomaticPinAccount(db:D1Database,input:Record<string,unknown>,currentId?:string,bulkKey?:string) {
  if(Object.hasOwn(input,'pin'))throw new PinAuthError(400,'PIN awal dibuat otomatis oleh aplikasi.');
  if(input.revoke===true)return savePinAccount(db,input,currentId,bulkKey);
  validatePinIdentity(input.name,input.role);
  if(input.role==='admin')validatePinIdentity(input.name,'guru');
  if(input.id&&input.resetPin!==true)return savePinAccount(db,input,currentId,bulkKey);
  if(input.id&&input.id===currentId)throw new PinAuthError(403,'Gunakan menu Ubah PIN saya untuk mengganti PIN sendiri.');
  if(!validBulkKey(bulkKey))throw new PinAuthError(503,'Layanan PIN sedang dikonfigurasi. Coba kembali nanti.');
  const previous=input.id?await db.prepare('SELECT pin_hash,pin_salt FROM raport_pin_accounts WHERE id=?').bind(input.id).first<{pin_hash:string;pin_salt:string}>():null;
  for(let attempt=0;attempt<20;attempt++) {
    const pin=generateRandomPin();
    if(previous&&equalHash(await hashPin(pin,previous.pin_salt),previous.pin_hash))continue;
    try {
      await assertUniquePin(db,pin,bulkKey,typeof input.id==='string'?input.id:'');
      return {...await savePinAccount(db,{...input,pin},currentId,bulkKey),pin};
    }catch(error){if(!(error instanceof PinAuthError&&error.status===409&&error.message.startsWith('PIN sudah digunakan')))throw error;}
  }
  throw new PinAuthError(503,'PIN unik belum berhasil dibuat. Coba kembali.');
}

export async function changeOwnPin(request:Request,db:D1Database,input:Record<string,unknown>,bulkKey?:string) {
  const session=await readPinSession(request,db);
  if(!session)throw new PinAuthError(401,'Masuk dengan nama dan PIN untuk mengganti PIN sendiri.');
  if(Object.keys(input).some(key=>!['oldPin','newPin','confirmPin'].includes(key)))throw new PinAuthError(400,'Perubahan PIN hanya berlaku untuk akun sendiri.');
  if(!validPin(input.oldPin)||!validPin(input.newPin))throw new PinAuthError(400,'PIN harus terdiri dari 6–12 digit angka.');
  if(input.newPin!==input.confirmPin)throw new PinAuthError(400,'Konfirmasi PIN baru belum sama.');
  if(!validBulkKey(bulkKey))throw new PinAuthError(503,'Layanan PIN sedang dikonfigurasi. Coba kembali nanti.');
  const bucket=await digest('pin-change-account:'+session.id);
  await reserveAttempt(db,await digest('pin-change-client:'+(request.headers.get('cf-connecting-ip')||'unknown')),25);
  await reserveAttempt(db,bucket,5);
  const account=await db.prepare('SELECT id,pin_hash,pin_salt FROM raport_pin_accounts WHERE id=?').bind(session.id).first<PinAccount>();
  if(!account||!equalHash(await hashPin(input.oldPin,account.pin_salt),account.pin_hash))throw new PinAuthError(401,'PIN lama tidak sesuai.');
  if(input.oldPin===input.newPin)throw new PinAuthError(400,'Gunakan PIN baru yang berbeda dari PIN lama.');
  const fingerprint=await assertUniquePin(db,input.newPin,bulkKey,session.id);
  const salt=hex(crypto.getRandomValues(new Uint8Array(16))),pinHash=await hashPin(input.newPin,salt);
  const guard=crypto.randomUUID();
  try {
    await db.batch([
      db.prepare('INSERT INTO raport_write_guards (id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM raport_pin_accounts WHERE id=? AND pin_hash=? AND pin_salt=?) AND EXISTS(SELECT 1 FROM raport_pin_sessions WHERE token_hash=? AND account_id=? AND expires_at>?) THEN 1 ELSE 0 END)').bind(guard,session.id,account.pin_hash,account.pin_salt,await digest(tokenFromCookie(request)!),session.id,Date.now()),
      db.prepare('UPDATE raport_pin_accounts SET pin_hash=?,pin_salt=?,pin_fingerprint=? WHERE id=?').bind(pinHash,salt,fingerprint,session.id),
      db.prepare('DELETE FROM raport_pin_sessions WHERE account_id=?').bind(session.id),
      db.prepare('DELETE FROM raport_pin_attempts WHERE bucket IN (?,?)').bind(bucket,await digest('account:'+session.id)),
      db.prepare('DELETE FROM raport_write_guards WHERE id=?').bind(guard),
    ]);
  }catch(error){
    if(String(error).includes('raport_write_conflict'))throw new PinAuthError(409,'PIN baru saja diperbarui. Masuk kembali dengan PIN terbaru.');
    if(String(error).includes('raport_pin_accounts.pin_fingerprint'))throw new PinAuthError(409,'PIN sudah digunakan akun lain. Pilih PIN berbeda.');
    throw error;
  }
  return {cookie:sessionCookie(request,'',0)};
}

function sessionCookie(request:Request,token:string,maxAge:number) {
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return `${PIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function tokenFromCookie(request:Request) {
  const token=request.headers.get('cookie')?.split(';').map(value=>value.trim()).find(value=>value.startsWith(PIN_COOKIE+'='))?.slice(PIN_COOKIE.length+1);
  return token && /^[a-f0-9]{64}$/.test(token)?token:null;
}
export async function readPinSession(request:Request,db:D1Database) {
  const token=tokenFromCookie(request);
  if(!token)return null;
  return db.prepare(`SELECT account.id,account.name,account.role,account.slug FROM raport_pin_sessions AS session
    JOIN raport_pin_accounts AS account ON account.id=session.account_id WHERE session.token_hash=? AND session.expires_at>?`)
    .bind(await digest(token),Date.now()).first<Pick<PinAccount,'id'|'name'|'role'|'slug'>>();
}
export async function clearPinSession(request:Request,db:D1Database) {
  const token=tokenFromCookie(request);
  if(token)await db.prepare('DELETE FROM raport_pin_sessions WHERE token_hash=?').bind(await digest(token)).run();
  return sessionCookie(request,'',0);
}
async function reserveAttempt(db:D1Database,bucket:string,limit:number) {
  const now=Date.now();
  const results=await db.batch([
    db.prepare(`INSERT INTO raport_pin_attempts (bucket,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END`)
      .bind(bucket,now+ATTEMPT_WINDOW,now,now),
    db.prepare('SELECT attempts FROM raport_pin_attempts WHERE bucket=?').bind(bucket),
  ]);
  const attempts=Number((results[1].results[0] as {attempts:number}).attempts);
  if(attempts>limit)throw new PinAuthError(429,'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit atau minta admin mengganti PIN.');
}
export async function loginWithPin(request:Request,db:D1Database,input:Record<string,unknown>) {
  const name=typeof input.name==='string'?pinLoginName(input.name).slice(0,200):'';
  const account=input.slug!==undefined
    ? validPinSlug(input.slug)?await db.prepare('SELECT id,name,role,login_name,slug,pin_hash,pin_salt FROM raport_pin_accounts WHERE slug=?').bind(input.slug).first<PinAccount>():null
    : name?await db.prepare('SELECT id,name,role,login_name,slug,pin_hash,pin_salt FROM raport_pin_accounts WHERE login_name=?').bind(name).first<PinAccount>():null;
  const client=await digest('client:'+(request.headers.get('cf-connecting-ip')||'unknown'));
  const accountBucket=await digest(account?'account:'+account.id:'unknown:'+name);
  await reserveAttempt(db,client,25);
  await reserveAttempt(db,accountBucket,5);
  const candidate=await hashPin(validPin(input.pin)?input.pin:'000000',account?.pin_salt||'00'.repeat(16));
  if(!account || !validPin(input.pin) || !equalHash(candidate,account.pin_hash))throw new PinAuthError(401,'Nama atau PIN tidak sesuai. Periksa kembali data dari administrator.');
  const token=randomToken();
  const oldToken=tokenFromCookie(request);
  const commands=[
    db.prepare('DELETE FROM raport_pin_sessions WHERE expires_at<=?').bind(Date.now()),
    db.prepare('DELETE FROM raport_pin_attempts WHERE reset_at<?').bind(Date.now()-86400000),
    db.prepare('DELETE FROM raport_pin_attempts WHERE bucket=?').bind(accountBucket),
    db.prepare(`INSERT INTO raport_pin_sessions (token_hash,account_id,expires_at) SELECT ?,id,? FROM raport_pin_accounts
      WHERE id=? AND pin_hash=? AND pin_salt=?`).bind(await digest(token),Date.now()+SESSION_SECONDS*1000,account.id,account.pin_hash,account.pin_salt),
  ];
  if(oldToken)commands.push(db.prepare('DELETE FROM raport_pin_sessions WHERE token_hash=?').bind(await digest(oldToken)));
  commands.push(db.prepare('SELECT name,role FROM raport_pin_accounts WHERE id=?').bind(account.id));
  const saved=await db.batch(commands);
  const current=saved[saved.length-1].results[0] as AccountIdentity|undefined;
  if(saved[3].meta.changes!==1 || !current)throw new PinAuthError(401,'PIN atau akses akun baru saja diperbarui. Masuk kembali dengan data terbaru dari admin.');
  return {user:{...permissions(current).user,loginMethod:'pin' as const},cookie:sessionCookie(request,token,SESSION_SECONDS)};
}
