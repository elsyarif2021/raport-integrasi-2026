import { ALL_TEACHER_ASSIGNMENTS, normalizeTeacherName } from '../src/data/teacherSubjectsDatabase';
import { DAFTAR_WALI_KELAS } from '../src/data/waliKelasDatabase';
import { getSubjectsForClass } from '../src/data/curriculumSubjects';
import { classes, permissions } from './access';
import { assertUniquePin, createPinSlug, hashPin, pinLoginName, PinAuthError, validatePinIdentity, writeWithNewAdminSlots } from './pinAuth';
import { generateRandomPin, openBulkResult, sealBulkResult, validBulkKey } from './pinSecurity';
import type { PinBulkCandidate, PinBulkResult, UserRole } from '../src/types';

export const PIN_BULK_CHUNK_SIZE=5;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=(bytes:Uint8Array)=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
function summary(name:string,role:UserRole) {
  const user=permissions({name,role}).user;
  return {
    classNames:role==='admin'?['Semua kelas']:(user.assignedClassIds??[]).map(id=>classes.get(id)?.nameLatin??id),
    subjectNames:role==='admin'?['Semua mapel']:[...new Set(Object.entries(user.editableSubjectsByClass??{}).flatMap(([classId,ids])=>getSubjectsForClass(classId).filter(subject=>ids.includes(subject.id)).map(subject=>subject.nameId)))],
  };
}
function officialCandidates() {
  const names=new Map<string,string>();
  for(const entry of DAFTAR_WALI_KELAS)if(entry.waliName)names.set(normalizeTeacherName(entry.waliName),entry.waliName);
  for(const entry of ALL_TEACHER_ASSIGNMENTS)if(entry.teacherName&&!names.has(normalizeTeacherName(entry.teacherName)))names.set(normalizeTeacherName(entry.teacherName),entry.teacherName);
  return [...names.values()].flatMap(name=>{
    const wali=permissions({name,role:'wali_kelas'}).user;
    const role=wali.homeroomClassIds?.length?'wali_kelas' as const:'guru' as const;
    if(!permissions({name,role}).user.assignedClassIds?.length)return [];
    return [{name,role,...summary(name,role)}];
  }).sort((left,right)=>left.name.localeCompare(right.name,'id'));
}
export async function getPinBulkCandidates(db:D1Database) {
  const current=await db.prepare('SELECT name,role FROM raport_pin_accounts').all<{name:string;role:UserRole}>();
  const existing=new Map(current.results.map(account=>[normalizeTeacherName(account.name),account]));
  return {candidates:officialCandidates().map(item=>{const account=existing.get(normalizeTeacherName(item.name));return {...item,exists:Boolean(account),...(account?{accountRole:account.role}:{})};}),chunkSize:PIN_BULK_CHUNK_SIZE};
}
interface CachedOperation {owner_id:string;request_hash:string;result_cipher:string;expires_at:number}
export async function createPinBulk(db:D1Database,ownerId:string,input:Record<string,unknown>,secret:unknown,randomPin=generateRandomPin):Promise<PinBulkResult> {
  if(!validBulkKey(secret))throw new PinAuthError(503,'Pembuatan massal sedang dikonfigurasi. Coba kembali nanti.');
  if(typeof input.operationId!=='string'||!uuid.test(input.operationId))throw new PinAuthError(400,'ID proses massal tidak valid.');
  if(!['staff','admin'].includes(String(input.mode))||!Array.isArray(input.entries)||input.entries.length<1||input.entries.length>PIN_BULK_CHUNK_SIZE)throw new PinAuthError(400,'Pilih akun yang akan dibuat melalui pratinjau massal.');
  const entries=input.entries.map(entry=>{
    if(!entry||typeof entry!=='object'||typeof entry.name!=='string'||!['guru','wali_kelas','admin'].includes(entry.role))throw new PinAuthError(400,'Daftar akun tidak valid.');
    return {name:entry.name.trim().replace(/\s+/g,' '),role:entry.role as UserRole};
  });
  const requestHash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({mode:input.mode,entries})))));
  const context=input.operationId+':'+ownerId;
  await db.prepare("UPDATE raport_pin_bulk_operations SET result_cipher='' WHERE expires_at<? AND result_cipher<>''").bind(Date.now()).run();
  async function cached():Promise<PinBulkResult|null> {
    const row=await db.prepare('SELECT owner_id,request_hash,result_cipher,expires_at FROM raport_pin_bulk_operations WHERE id=?').bind(input.operationId).first<CachedOperation>();
    if(!row)return null;
    if(row.owner_id!==ownerId)throw new PinAuthError(403,'Proses massal ini dibuat oleh akun administrator lain.');
    if(row.request_hash!==requestHash)throw new PinAuthError(409,'Daftar akun pada proses ini sudah berubah. Mulai proses baru.');
    if(row.expires_at<Date.now())throw new PinAuthError(410,'Hasil proses sudah kedaluwarsa. Periksa daftar akun yang sudah dibuat.');
    return openBulkResult<PinBulkResult>(secret as string,row.result_cipher,context);
  }
  const previous=await cached();if(previous)return previous;
  const official=new Map(officialCandidates().map(candidate=>[normalizeTeacherName(candidate.name),candidate]));
  const current=await db.prepare('SELECT id,name,role,slug,login_name FROM raport_pin_accounts').all<{id:string;name:string;role:UserRole;slug:string;login_name:string}>();
  const existingNames=new Set(current.results.map(row=>pinLoginName(row.name)));
  const existingStaff=new Set(current.results.map(row=>normalizeTeacherName(row.name)));
  const existingByStaff=new Map(current.results.map(row=>[normalizeTeacherName(row.name),row]));
  const incoming=new Set<string>();const usedPins=new Set<string>();
  const commands:D1PreparedStatement[]=[];
  const result:PinBulkResult={created:[],skipped:[]};
  for(const entry of entries) {
    let account=validatePinIdentity(entry.name,entry.role);
    if(input.mode==='staff') {
      const candidate=official.get(normalizeTeacherName(account.name));
      if(!candidate||candidate.role!==account.role)throw new PinAuthError(400,'Peran guru atau wali kelas harus mengikuti master penugasan.');
      account=validatePinIdentity(candidate.name,candidate.role);
    }else {
      if(account.role!=='admin')throw new PinAuthError(400,'Daftar administrator harus menggunakan peran Administrator.');
      const candidate=official.get(normalizeTeacherName(account.name));
      if(!candidate)throw new PinAuthError(400,'Pilih administrator dari data guru yang terdaftar.');
      account=validatePinIdentity(candidate.name,'admin');
    }
    const key=input.mode==='staff'?normalizeTeacherName(account.name):pinLoginName(account.name);
    if(incoming.has(key))throw new PinAuthError(400,'Nama yang sama tercantum lebih dari sekali.');
    incoming.add(key);
    const existingAccount=existingByStaff.get(normalizeTeacherName(account.name));
    if(input.mode==='admin'&&existingAccount&&existingAccount.role!=='admin') {
      const guard=crypto.randomUUID();
      commands.push(
        db.prepare('INSERT INTO raport_write_guards (id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM raport_pin_accounts WHERE id=? AND role=?) THEN 1 ELSE 0 END)').bind(guard,existingAccount.id,existingAccount.role),
        db.prepare("UPDATE raport_pin_accounts SET role='admin' WHERE id=?").bind(existingAccount.id),
        db.prepare('DELETE FROM raport_pin_sessions WHERE account_id=?').bind(existingAccount.id),
        db.prepare('DELETE FROM raport_write_guards WHERE id=?').bind(guard),
      );
      (result.promoted??=[]).push({id:existingAccount.id,name:existingAccount.name,role:'admin',path:'/#masuk='+existingAccount.slug});
      continue;
    }
    if(existingNames.has(pinLoginName(account.name))||(input.mode==='staff'&&existingStaff.has(normalizeTeacherName(account.name)))) {
      result.skipped.push({name:account.name,reason:'Akun sudah ada; PIN dipertahankan.'});continue;
    }
    let pin='',fingerprint='';
    for(let attempt=0;attempt<20;attempt++) {
      const candidate=randomPin();
      if(!/^\d{8}$/.test(candidate)||usedPins.has(candidate))continue;
      try {fingerprint=await assertUniquePin(db,candidate,secret as string);pin=candidate;break;}
      catch(error) {if(!(error instanceof PinAuthError&&error.status===409))throw error;}
    }
    if(!pin)throw new PinAuthError(503,'PIN unik belum berhasil dibuat. Coba lanjutkan proses kembali.');
    usedPins.add(pin);
    const id=crypto.randomUUID(),slug=createPinSlug(account.name);
    const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
    commands.push(db.prepare('INSERT INTO raport_pin_accounts (id,name,login_name,slug,role,pin_hash,pin_salt,pin_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id,account.name,pinLoginName(account.name),slug,account.role,await hashPin(pin,salt),salt,fingerprint,Date.now()));
    result.created.push({id,name:account.name,role:account.role,pin,path:'/#masuk='+slug,...summary(account.name,account.role)});
  }
  const encrypted=await sealBulkResult(secret,result,context);
  commands.push(db.prepare('INSERT INTO raport_pin_bulk_operations (id,owner_id,request_hash,result_cipher,expires_at) VALUES (?,?,?,?,?)')
    .bind(input.operationId,ownerId,requestHash,encrypted,Date.now()+24*60*60*1000));
  try {await writeWithNewAdminSlots(db,result.created.filter(row=>row.role==='admin').length+(result.promoted?.length??0),commands);}
  catch(error) {
    const completed=await cached();if(completed)return completed;
    if(String(error).includes('UNIQUE constraint'))throw new PinAuthError(409,'Akun atau PIN baru saja dibuat oleh proses lain. Klik Lanjutkan untuk memeriksa ulang.');
    if(String(error).includes('raport_write_conflict'))throw new PinAuthError(409,'Peran baru saja diperbarui. Klik Lanjutkan untuk memeriksa ulang.');
    throw error;
  }
  return result;
}
