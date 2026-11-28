import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi, type Environment } from '../server/api';
import { classes, permissions } from '../server/access';
import { ALL_TEACHER_ASSIGNMENTS } from '../src/data/teacherSubjectsDatabase';
import { DAFTAR_WALI_KELAS } from '../src/data/waliKelasDatabase';
import { parseDataLiteral } from '../server/legacyImport';
import { readLegacyZip } from '../server/legacyImport';
import { insertMissingStudents, handleStudentImport } from '../server/studentImport';
import type { StudentRecord } from '../src/types';
import { savePinAccount, PinAuthError } from '../server/pinAuth';
import { createPinBulk } from '../server/pinBulk';

class SqliteD1 {
  bulkKey:string|undefined;
  sql = new DatabaseSync(':memory:');
  beforeWrite: (()=>void) | undefined;
  beforeSessionWrite: (()=>void) | undefined;
  constructor() {
    const directory=new URL('../drizzle/',import.meta.url);
    for(const migration of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort()) {
      this.sql.exec(readFileSync(new URL(migration,directory),'utf8'));
    }
  }
  prepare(query:string) {
    const db=this;
    const statement = (params:any[]=[]):any => ({
      query, params,
      bind:(...args:any[])=>statement(args),
      first:async()=>db.sql.prepare(query).get(...params) ?? null,
      all:async()=>({results:db.sql.prepare(query).all(...params)}),
      run:async()=>({meta:{changes:Number(db.sql.prepare(query).run(...params).changes)}}),
    });return statement();
  }
  async batch(statements:any[]) {
    if(statements.some(s=>s.query.startsWith('INSERT INTO raport_pin_sessions')) && this.beforeSessionWrite) {
      const hook=this.beforeSessionWrite;this.beforeSessionWrite=undefined;hook();
    }
    if(statements.some(s=>s.query.startsWith('INSERT INTO raport_write_guards')) && this.beforeWrite) {
      const hook=this.beforeWrite;this.beforeWrite=undefined;hook();
    }
    this.sql.exec('BEGIN');
    try {
      const results=statements.map(s=>{
        const statement=this.sql.prepare(s.query);
        if(/^SELECT/i.test(s.query))return {results:statement.all(...s.params),meta:{changes:0}};
        return {results:[],meta:{changes:Number(statement.run(...s.params).changes)}};
      });this.sql.exec('COMMIT');return results;
    } catch(error) {this.sql.exec('ROLLBACK');throw error;}
  }
  environment():Environment {return {DB:this as unknown as D1Database,ASSETS:{} as Fetcher,RAPORT_PIN_BULK_KEY:this.bulkKey};}
}
const owner = {id:'owner-authenticated',email:'lionxmumtaz@gmail.com'};
type Identity = {id:string;email:string};
async function call(db:SqliteD1,action:string,identity:Identity|null=owner,body?:unknown,origin='https://raport.test',cookie?:string) {
  const headers:Record<string,string>={};
  if(cookie)headers.cookie=cookie;
  if(identity) {headers['oai-authenticated-user-id']=identity.id;headers['oai-authenticated-user-email']=identity.email;}
  if(body!==undefined) {headers.origin=origin;headers['content-type']='application/json';}
  const response=await handleApi(new Request('https://raport.test/api/raport?action='+action,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),db.environment());
  return {status:response.status,data:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0],cookieHeader:response.headers.get('set-cookie')};
}
// Seed pre-existing/manual-PIN fixtures to verify compatibility with older deployments.
async function legacyPin(db:SqliteD1,input:Record<string,unknown>) {
  try{return {status:200,data:await savePinAccount(db.environment().DB,input,undefined,db.bulkKey) as any};}
  catch(error){if(error instanceof PinAuthError)return {status:error.status,data:{error:error.message}};throw error;}
}
function student(id:string,classId='1a'):StudentRecord {return {id,no:1,classId,name:'Santri Uji '+id,nisn:'1234567890',scores:{},keterangan:''};}
async function addStudent(db:SqliteD1,record:StudentRecord) {assert.equal((await call(db,'save',owner,{changes:[{kind:'upsert',student:record}]})).status,200);}
const teacherName=[...new Set(ALL_TEACHER_ASSIGNMENTS.map(x=>x.teacherName))].find(name=>{
  const access=permissions({name,role:'guru'});return access.user.assignedClassIds?.length && access.user.assignedClassIds.length<classes.size;
})!;
const teacherAccess=permissions({name:teacherName,role:'guru'});
const teacherClass=teacherAccess.user.assignedClassIds![0];
const teacherSubject=teacherAccess.user.editableSubjectsByClass![teacherClass][0];
const otherClass=[...classes.keys()].find(id=>!teacherAccess.canRead(id))!;

test('bulk account creation produces unique PINs, preserves receipts on retry, and restricts exports to the creator',async()=>{
  const db=new SqliteD1();db.bulkKey='a1'.repeat(32);
  assert.equal((await call(db,'pin-bulk-candidates',null)).status,401);
  const preview=await call(db,'pin-bulk-candidates');
  assert.equal(preview.status,200);assert.ok(preview.data.candidates.length>5);
  const entries=preview.data.candidates.slice(0,3).map(({name,role}:any)=>({name,role}));
  const body={operationId:crypto.randomUUID(),mode:'staff',entries};
  const first=await call(db,'pin-bulk-create',owner,body);
  assert.equal(first.status,200);assert.equal(first.data.created.length,3);
  const pins=first.data.created.map((row:any)=>row.pin);
  assert.equal(new Set(pins).size,3);for(const pin of pins)assert.match(pin,/^\d{8}$/);
  const stored=db.sql.prepare('SELECT result_cipher FROM raport_pin_bulk_operations WHERE id=?').get(body.operationId)!;
  for(const pin of pins)assert.equal(String(stored.result_cipher).includes(pin),false);
  assert.equal((await call(db,'pin-bulk-create',owner,body)).status,200);
  assert.deepEqual((await call(db,'pin-bulk-create',owner,body)).data,first.data);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_pin_accounts').get()!.total,3);
  assert.equal((await call(db,'pin-bulk-create',owner,{...body,entries:entries.slice(0,1)})).status,409);
  await call(db,'members',owner,{email:'second-bulk-admin@example.test',name:teacherName,role:'admin'});
  assert.equal((await call(db,'pin-bulk-create',{id:'second-bulk-admin',email:'second-bulk-admin@example.test'},body)).status,403);
  for(const created of first.data.created) {
    const login=await call(db,'pin-login',null,{name:created.name,pin:created.pin});
    assert.equal(login.status,200);assert.equal(login.data.user.role,created.role);
    assert.equal((await call(db,'pin-bulk-candidates',null,undefined,undefined,login.cookie)).status,403);
  }
  assert.equal(db.sql.prepare('SELECT count(DISTINCT pin_fingerprint) AS total FROM raport_pin_accounts').get()!.total,3);
  assert.equal((await call(db,'pin-bulk-create',owner,body,'https://elsewhere.test')).status,403);
  db.sql.close();
});

test('bulk creation skips existing accounts and rejects PIN collisions with legacy and newly generated accounts',async()=>{
  const db=new SqliteD1();
  const preview=(await call(db,'pin-bulk-candidates')).data.candidates;
  const first=preview[0],second=preview[1],third=preview[2];
  await legacyPin(db,{name:first.name,role:first.role,pin:'31029475'});
  const before=db.sql.prepare('SELECT pin_hash FROM raport_pin_accounts WHERE name=?').get(first.name)!.pin_hash;
  const login=await call(db,'pin-login',null,{name:first.name,pin:'31029475'});
  db.bulkKey='b2'.repeat(32);
  const values=['31029475','20481736'];
  const result=await createPinBulk(db.environment().DB,owner.id,{operationId:crypto.randomUUID(),mode:'staff',entries:[first,second]},db.bulkKey,()=>values.shift()??'20481736');
  assert.equal(result.skipped.length,1);assert.equal(result.created.length,1);assert.equal(result.created[0].pin,'20481736');
  assert.equal(db.sql.prepare('SELECT pin_hash FROM raport_pin_accounts WHERE name=?').get(first.name)!.pin_hash,before);
  assert.equal((await call(db,'session',null,undefined,undefined,login.cookie)).status,200);
  assert.equal((await legacyPin(db,{name:third.name,role:third.role,pin:'20481736'})).status,409);
  assert.equal((await legacyPin(db,{name:third.name,role:third.role,pin:'31029475'})).status,409);
  const more=['20481736','00123456'];
  const next=await createPinBulk(db.environment().DB,owner.id,{operationId:crypto.randomUUID(),mode:'staff',entries:[third]},db.bulkKey,()=>more.shift()??'00123456');
  assert.equal(next.created[0].pin,'00123456');
  db.sql.close();
});

test('bulk admin creation respects remaining slots and rolls back an over-cap chunk',async()=>{
  const db=new SqliteD1();db.bulkKey='c3'.repeat(32);
  const names=(await call(db,'pin-bulk-candidates')).data.candidates.map((row:any)=>row.name);
  for(const [start,count] of [[0,5],[5,3]]) {
    const entries=Array.from({length:count},(_,index)=>({name:names[start+index],role:'admin'}));
    assert.equal((await call(db,'pin-bulk-create',owner,{operationId:crypto.randomUUID(),mode:'admin',entries})).status,200);
  }
  assert.equal((await call(db,'pin-accounts')).data.adminCount,9);
  const excess=await call(db,'pin-bulk-create',owner,{operationId:crypto.randomUUID(),mode:'admin',entries:[{name:names[8],role:'admin'},{name:names[9],role:'admin'}]});
  assert.equal(excess.status,409);assert.equal((await call(db,'pin-accounts')).data.adminCount,9);
  assert.equal(db.sql.prepare("SELECT count(*) AS total FROM raport_pin_accounts WHERE name IN (?,?)").get(names[8],names[9])!.total,0);
  assert.equal((await call(db,'pin-bulk-create',owner,{operationId:crypto.randomUUID(),mode:'admin',entries:[{name:names[8],role:'admin'}]})).status,200);
  assert.equal((await call(db,'pin-accounts')).data.adminCount,10);
  db.sql.close();
});

test('invalid bulk requests and failed PIN generation do not create partial accounts',async()=>{
  const db=new SqliteD1();
  const entries=(await call(db,'pin-bulk-candidates')).data.candidates.slice(0,2).map(({name,role}:any)=>({name,role}));
  assert.equal((await call(db,'pin-bulk-create',owner,{operationId:crypto.randomUUID(),mode:'staff',entries})).status,503);
  db.bulkKey='d4'.repeat(32);
  const invalid=await call(db,'pin-bulk-create',owner,{operationId:crypto.randomUUID(),mode:'staff',entries:[entries[0],{name:'Nama tidak terdaftar',role:'guru'}]});
  assert.equal(invalid.status,400);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_pin_accounts').get()!.total,0);
  await assert.rejects(()=>createPinBulk(db.environment().DB,owner.id,{operationId:crypto.randomUUID(),mode:'staff',entries},db.bulkKey,()=> '80716253'),error=>(error as any).status===503);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_pin_accounts').get()!.total,0);
  db.sql.close();
});

test('admin creates name and PIN accounts; sessions and class permissions are enforced on the server',async()=>{
  const db=new SqliteD1();
  const created=await legacyPin(db,{name:teacherName,role:'guru',pin:'492817'});
  assert.equal(created.status,200);
  const account=created.data.account;
  assert.ok(account.path.includes('#masuk='));
  assert.equal(account.path.includes('492817'),false);
  const stored=db.sql.prepare('SELECT pin_hash,pin_salt FROM raport_pin_accounts WHERE id=?').get(account.id)!;
  assert.notEqual(stored.pin_hash,'492817');assert.equal(String(stored.pin_hash).length,64);
  const preview=await call(db,'pin-preview',null,{slug:account.slug});
  assert.deepEqual(preview.data,{name:teacherName,role:'guru'});
  assert.equal((await call(db,'pin-link-session',null,{slug:account.slug})).status,401);
  assert.equal((await call(db,'pin-login',null,{slug:account.slug,pin:'111111'})).status,401);
  const login=await call(db,'pin-login',null,{name:teacherName.toLowerCase(),pin:'492817',role:'admin'});
  assert.equal(login.status,200);assert.equal(login.data.user.role,'guru');assert.equal(login.data.user.loginMethod,'pin');
  assert.match(login.cookieHeader!,/HttpOnly/);assert.match(login.cookieHeader!,/Secure/);assert.match(login.cookieHeader!,/SameSite=Lax/);
  assert.equal(JSON.stringify(login.data).includes('492817'),false);
  await addStudent(db,{...student('pin-own',teacherClass),scores:{[teacherSubject]:82,hidden:99}});
  await addStudent(db,student('pin-other',otherClass));
  const rows=await call(db,'students',null,undefined,undefined,login.cookie);
  assert.equal(rows.status,200);assert.equal(rows.data.students.length,1);assert.deepEqual(rows.data.students[0].scores,{[teacherSubject]:82});
  assert.equal((await call(db,'save',null,{changes:[{kind:'score',id:'pin-other',subjectId:teacherSubject,value:1}]},undefined,login.cookie)).status,403);
  assert.equal((await call(db,'pin-accounts',null,{name:'Self promoted',role:'admin',pin:'492817'},undefined,login.cookie)).status,403);
  assert.equal((await call(db,'pin-accounts',null,{name:'Anonymous',role:'admin',pin:'492817'})).status,401);
  assert.equal((await call(db,'pin-link-session',null,{slug:account.slug},undefined,login.cookie)).status,200);
  const logout=await call(db,'logout',null,{},undefined,login.cookie);
  assert.equal(logout.data.loginMethod,'pin');assert.match(logout.cookieHeader!,/Max-Age=0/);
  assert.equal((await call(db,'session',null,undefined,undefined,login.cookie)).status,401);
  db.sql.close();
});

test('PIN replacement revokes old sessions and repeated guesses are limited',async()=>{
  const db=new SqliteD1();
  const created=await legacyPin(db,{name:teacherName,role:'guru',pin:'492817'});
  const account=created.data.account;
  const login=await call(db,'pin-login',null,{slug:account.slug,pin:'492817'});
  const rotated=await call(db,'pin-login',null,{slug:account.slug,pin:'492817'},undefined,login.cookie);
  assert.notEqual(rotated.cookie,login.cookie);
  assert.equal((await call(db,'session',null,undefined,undefined,login.cookie)).status,401);
  assert.equal((await legacyPin(db,{id:account.id,name:teacherName,role:'guru',pin:'806421'})).status,200);
  assert.equal((await call(db,'session',null,undefined,undefined,rotated.cookie)).status,401);
  for(let index=0;index<5;index++)assert.equal((await call(db,'pin-login',null,{slug:account.slug,pin:'492817'})).status,401);
  assert.equal((await call(db,'pin-login',null,{slug:account.slug,pin:'806421'})).status,429);
  db.sql.prepare('UPDATE raport_pin_attempts SET reset_at=0').run();
  const fresh=await call(db,'pin-login',null,{slug:account.slug,pin:'806421'});
  assert.equal(fresh.status,200);
  db.sql.prepare('UPDATE raport_pin_sessions SET expires_at=0').run();
  assert.equal((await call(db,'students',null,undefined,undefined,fresh.cookie)).status,401);
  assert.equal((await call(db,'pin-login',null,{slug:account.slug,pin:'806421'},'https://elsewhere.test')).status,403);
  assert.equal((await call(db,'pin-accounts',owner,{id:account.id,revoke:true})).status,200);
  assert.equal((await call(db,'pin-preview',null,{slug:account.slug})).status,404);
  db.sql.close();
});

test('a PIN change during sign-in cannot create a session using the old PIN',async()=>{
  const db=new SqliteD1();
  const created=await legacyPin(db,{name:teacherName,role:'guru',pin:'492817'});
  db.beforeSessionWrite=()=>db.sql.prepare('UPDATE raport_pin_accounts SET pin_hash=? WHERE id=?').run('0'.repeat(64),created.data.account.id);
  assert.equal((await call(db,'pin-login',null,{name:teacherName,pin:'492817'})).status,401);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_pin_sessions').get()!.total,0);
  db.sql.close();
});

test('PIN accounts validate names and PIN format and cannot use another account link',async()=>{
  const db=new SqliteD1();
  for(const pin of ['1234','abcdef','1234567890123',492817])assert.equal((await legacyPin(db,{name:teacherName,role:'guru',pin})).status,400);
  const created=await legacyPin(db,{name:teacherName,role:'guru',pin:'492817'});
  assert.equal((await legacyPin(db,{name:teacherName.toLowerCase(),role:'guru',pin:'492817'})).status,409);
  const homeroom=DAFTAR_WALI_KELAS.find(entry=>entry.classId&&classes.has(entry.classId)&&entry.waliName!==teacherName)!;
  const second=await legacyPin(db,{name:homeroom.waliName,role:'wali_kelas',pin:'806421'});
  assert.equal(second.status,200);
  const login=await call(db,'pin-login',null,{slug:created.data.account.slug,pin:'492817'});
  assert.equal((await call(db,'pin-link-session',null,{slug:second.data.account.slug},undefined,login.cookie)).status,403);
  const changed=await call(db,'pin-login',null,{slug:second.data.account.slug,pin:'806421'},undefined,login.cookie);
  assert.equal(changed.status,200);assert.equal(changed.data.user.role,'wali_kelas');
  assert.ok(changed.data.user.homeroomClassIds.includes(homeroom.classId));
  assert.equal((await call(db,'pin-link-session',null,{slug:second.data.account.slug},undefined,changed.cookie)).status,200);
  const rawCookie=changed.cookie!.split('=')[1];
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_pin_sessions WHERE token_hash=?').get(rawCookie)!.total,0);
  db.sql.close();
});

test('there are at most ten admins including owner across PIN and ChatGPT accounts',async()=>{
  const db=new SqliteD1();const accounts:any[]=[];
  for(let index=0;index<9;index++) {
    const created=await legacyPin(db,{name:'Admin Uji '+index,role:'admin',pin:'548291'});
    assert.equal(created.status,200);accounts.push(created.data.account);
  }
  assert.equal((await call(db,'pin-accounts')).data.adminCount,10);
  assert.equal((await legacyPin(db,{name:'Admin kelebihan',role:'admin',pin:'548291'})).status,409);
  assert.equal((await call(db,'members',owner,{email:'over-limit@example.test',name:teacherName,role:'admin'})).status,409);
  const login=await call(db,'pin-login',null,{name:accounts[0].name,pin:'548291'});
  assert.equal(login.status,200);assert.equal(login.data.user.role,'admin');
  const list=await call(db,'pin-accounts',null,undefined,undefined,login.cookie);
  assert.equal(list.data.accounts.find((item:any)=>item.id===accounts[0].id).isSelf,true);
  assert.equal(JSON.stringify(list.data).includes('pin_hash'),false);
  assert.equal((await call(db,'pin-accounts',null,{id:accounts[0].id,revoke:true},undefined,login.cookie)).status,403);
  assert.equal((await call(db,'pin-accounts',null,{id:accounts[0].id,name:teacherName,role:'guru'},undefined,login.cookie)).status,403);
  assert.equal((await call(db,'pin-accounts',owner,{id:accounts[1].id,name:(await call(db,'pin-bulk-candidates')).data.candidates[20].name,role:'admin'})).status,200);
  assert.equal((await call(db,'pin-accounts',owner,{id:accounts[2].id,revoke:true})).status,200);
  assert.equal((await call(db,'members',owner,{email:'replacement@example.test',name:teacherName,role:'admin'})).status,200);
  assert.equal((await call(db,'pin-accounts')).data.adminCount,10);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_admin_guards').get()!.total,0);
  db.sql.close();
});

test('competing requests for the final admin place cannot exceed the cap',async()=>{
  const db=new SqliteD1();
  for(let index=0;index<8;index++)assert.equal((await legacyPin(db,{name:'Admin Bersama '+index,role:'admin',pin:'548291'})).status,200);
  const results=await Promise.all([
    legacyPin(db,{name:'Admin Terakhir PIN',role:'admin',pin:'548291'}),
    call(db,'members',owner,{email:'final-slot@example.test',name:teacherName,role:'admin'}),
  ]);
  assert.deepEqual(results.map(item=>item.status).sort(),[200,409]);
  assert.equal((await call(db,'pin-accounts')).data.adminCount,10);
  db.sql.close();
});

test('owner signs in using platform identity; anonymous and unassigned users cannot access students',async()=>{
  const db=new SqliteD1();
  assert.equal((await call(db,'students',null)).status,401);
  const session=await call(db,'session');assert.equal(session.status,200);assert.equal(session.data.user.role,'admin');
  assert.equal((await call(db,'students',{id:'other',email:'other@example.test'})).status,403);
  assert.equal((await call(db,'session',{id:'forged-owner',email:'other@example.test'})).data.user,null);
  db.sql.close();
});

test('student edits persist between requests and invalid batches save nothing',async()=>{
  const db=new SqliteD1();await addStudent(db,student('a'));
  assert.equal((await call(db,'save',owner,{changes:[{kind:'score',id:'a',subjectId:'s1',value:88}]})).status,200);
  assert.equal((await call(db,'students')).data.students[0].scores.s1,88);
  assert.equal((await call(db,'save',owner,{changes:[{kind:'score',id:'a',subjectId:'s1',value:90},{kind:'score',id:'a',subjectId:'s2',value:101}]})).status,400);
  assert.equal((await call(db,'students')).data.students[0].scores.s1,88);
  assert.equal((await call(db,'save',owner,{changes:[{kind:'upsert',student:{...student('bad'),'classId':'unknown'}}]})).status,400);
  db.sql.close();
});

test('teacher sees assigned classes and subjects only and cannot self-promote',async()=>{
  const db=new SqliteD1();
  await addStudent(db,{...student('allowed',teacherClass),scores:{[teacherSubject]:80,hidden:92},sikap:'Baik'});
  await addStudent(db,student('private',otherClass));
  assert.equal((await call(db,'members',owner,{email:'teacher@example.test',name:teacherName,role:'guru'})).status,200);
  const teacher={id:'teacher-id',email:'teacher@example.test'};
  const result=await call(db,'students',teacher);
  assert.equal(result.status,200);assert.equal(result.data.students.length,1);
  assert.deepEqual(result.data.students[0].scores,{[teacherSubject]:80});assert.equal(result.data.students[0].sikap,undefined);
  assert.equal((await call(db,'save',teacher,{changes:[{kind:'score',id:'allowed',subjectId:teacherSubject,value:89}]})).status,200);
  for(const change of [
    {kind:'score',id:'private',subjectId:teacherSubject,value:1},
    {kind:'score',id:'allowed',subjectId:'hidden',value:1},
    {kind:'attitude',id:'allowed',value:'Baik'},
    {kind:'identity',id:'allowed',name:'Unauthorized'},
    {kind:'delete',id:'allowed'},
    {kind:'upsert',student:student('unauthorized',teacherClass)},
  ]) assert.equal((await call(db,'save',teacher,{changes:[change]})).status,403);
  assert.equal((await call(db,'members',teacher,{email:teacher.email,name:teacherName,role:'admin'})).status,403);
  assert.equal((await call(db,'members',owner,{email:teacher.email,revoke:true})).status,200);
  assert.equal((await call(db,'students',teacher)).status,403);
  db.sql.close();
});

test('homeroom teacher can edit attitude and all subjects in their own class',async()=>{
  const db=new SqliteD1();const homeroom=DAFTAR_WALI_KELAS.find(x=>x.classId && classes.has(x.classId))!;
  const identity={id:'wali-id',email:'wali@example.test'};
  await addStudent(db,student('homeroom',homeroom.classId));
  assert.equal((await call(db,'members',owner,{email:identity.email,name:homeroom.waliName,role:'wali_kelas'})).status,200);
  assert.equal((await call(db,'save',identity,{changes:[{kind:'attitude',id:'homeroom',value:'Sangat Baik'}]})).status,200);
  assert.equal((await call(db,'students',identity)).data.students[0].sikap,'Sangat Baik');db.sql.close();
});

test('homeroom rights do not extend to other classes the same teacher teaches',async()=>{
  const db=new SqliteD1();
  const homeroom=DAFTAR_WALI_KELAS.find(entry=>{
    const access=permissions({name:entry.waliName,role:'wali_kelas'});
    return access.user.homeroomClassIds?.length && access.user.assignedClassIds?.some(id=>!access.canReadFull(id));
  })!;
  const access=permissions({name:homeroom.waliName,role:'wali_kelas'});
  const ownClass=access.user.homeroomClassIds![0];
  const taughtClass=access.user.assignedClassIds!.find(id=>!access.canReadFull(id))!;
  const subject=access.user.editableSubjectsByClass![taughtClass][0];
  const unrelated=[...classes.keys()].find(id=>!access.canRead(id))!;
  await addStudent(db,{...student('own',ownClass),scores:{s1:91},sikap:'Baik'});
  await addStudent(db,{...student('taught',taughtClass),scores:{[subject]:80,hidden:99},sikap:'Sangat Baik'});
  await addStudent(db,student('unrelated',unrelated));
  assert.equal((await call(db,'save',owner,{changes:[
    {kind:'attitude',id:'own',value:'Baik'},
    {kind:'attitude',id:'taught',value:'Sangat Baik'},
  ]})).status,200);
  const identity={id:'wali-dual-id',email:'wali-dual@example.test'};
  assert.equal((await call(db,'members',owner,{email:identity.email,name:homeroom.waliName,role:'wali_kelas'})).status,200);
  const session=await call(db,'session',identity);
  assert.deepEqual(session.data.user.homeroomClassIds,access.user.homeroomClassIds);
  const rows=(await call(db,'students',identity)).data.students;
  assert.equal(rows.length,2);
  assert.equal(rows.find((item:any)=>item.id==='own').sikap,'Baik');
  assert.deepEqual(rows.find((item:any)=>item.id==='taught').scores,{[subject]:80});
  assert.equal(rows.find((item:any)=>item.id==='taught').sikap,undefined);
  assert.equal((await call(db,'save',identity,{changes:[{kind:'score',id:'taught',subjectId:subject,value:84}]})).status,200);
  for(const change of [
    {kind:'attitude',id:'taught',value:'Baik'},
    {kind:'score',id:'taught',subjectId:'hidden',value:1},
    {kind:'score',id:'unrelated',subjectId:subject,value:1},
  ]) assert.equal((await call(db,'save',identity,{changes:[change]})).status,403);
  assert.equal((await call(db,'save',identity,{changes:[{kind:'attitude',id:'own',value:'Sangat Baik'}]})).status,200);
  db.sql.close();
});

test('assigning a homeroom role requires an actual homeroom assignment',async()=>{
  const db=new SqliteD1();
  const name=[...new Set(ALL_TEACHER_ASSIGNMENTS.map(entry=>entry.teacherName))].find(name=>{
    return permissions({name,role:'guru'}).user.assignedClassIds?.length && !permissions({name,role:'wali_kelas'}).user.homeroomClassIds?.length;
  })!;
  assert.ok(name);
  assert.equal((await call(db,'members',owner,{email:'wrong-role@example.test',name,role:'wali_kelas'})).status,400);
  assert.equal((await call(db,'students',{id:'wrong-role',email:'wrong-role@example.test'})).status,403);
  db.sql.close();
});

test('personal teacher links show a name but require the assigned ChatGPT account',async()=>{
  const db=new SqliteD1();
  const identity={id:'link-teacher',email:'link-teacher@example.test'};
  assert.equal((await call(db,'members',owner,{...identity,name:teacherName,role:'guru'})).status,200);
  const created=await call(db,'login-links',owner,{email:identity.email});
  assert.equal(created.status,201);
  const token=new URL(created.data.path,'https://raport.test').hash.slice('#akses='.length);
  assert.match(token,/^[a-f0-9]{64}$/);
  const row=db.sql.prepare('SELECT * FROM raport_login_links WHERE email=?').get(identity.email)!;
  assert.notEqual(row.token_hash,token);
  assert.equal(Object.values(row).includes(token),false);
  const preview=await call(db,'login-link-preview',null,{token});
  assert.equal(preview.status,200);
  assert.deepEqual(preview.data,{name:teacherName,role:'guru'});
  assert.equal((await call(db,'login-link-session',null,{token})).status,401);
  assert.equal((await call(db,'login-link-session',owner,{token})).status,403);
  assert.equal((await call(db,'login-link-session',{id:'wrong-link-user',email:'wrong@example.test'},{token})).status,403);
  const opened=await call(db,'login-link-session',identity,{token,name:'Admin',role:'admin'});
  assert.equal(opened.status,200);
  assert.equal(opened.data.user.name,teacherName);
  assert.equal(opened.data.user.role,'guru');
  assert.deepEqual(opened.data.user.assignedClassIds,teacherAccess.user.assignedClassIds);
  assert.equal((await call(db,'login-links',identity,{email:identity.email})).status,403);
  assert.equal((await call(db,'login-links',null,{email:identity.email})).status,401);
  const members=await call(db,'members');
  assert.equal(members.data.members.find((item:any)=>item.email===identity.email).hasLoginLink,true);
  assert.equal(JSON.stringify(members.data).includes(token),false);
  assert.equal((await call(db,'login-link-preview',null,{token},'https://elsewhere.test')).status,403);
  assert.equal((await call(db,'login-link-preview',null,{token:'bad-token'})).status,404);
  db.sql.close();
});

test('personal links can be rotated and disabled and are removed with account access',async()=>{
  const db=new SqliteD1();const email='rotated-link@example.test';
  await call(db,'members',owner,{email,name:teacherName,role:'guru'});
  const make=async()=>{
    const result=await call(db,'login-links',owner,{email});
    assert.equal(result.status,201);
    return result.data.path.split('#akses=')[1] as string;
  };
  const first=await make();const second=await make();
  assert.notEqual(first,second);
  assert.equal((await call(db,'login-link-preview',null,{token:first})).status,404);
  assert.equal((await call(db,'login-link-preview',null,{token:second})).status,200);
  assert.equal((await call(db,'login-links',owner,{email,revoke:true})).status,200);
  assert.equal((await call(db,'login-link-preview',null,{token:second})).status,404);
  assert.equal((await call(db,'login-link-session',{id:'after-disable',email},{token:second})).status,404);
  const third=await make();
  assert.equal((await call(db,'members',owner,{email,revoke:true})).status,200);
  assert.equal((await call(db,'login-link-preview',null,{token:third})).status,404);
  assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_login_links').get()!.total,0);
  db.sql.close();
});

test('a link follows the current approved name and role and cannot become an admin link',async()=>{
  const db=new SqliteD1();const email='role-link@example.test';
  await call(db,'members',owner,{email,name:teacherName,role:'guru'});
  const created=await call(db,'login-links',owner,{email});
  const token=created.data.path.split('#akses=')[1];
  const homeroom=DAFTAR_WALI_KELAS.find(entry=>entry.classId && classes.has(entry.classId))!;
  await call(db,'members',owner,{email,name:homeroom.waliName,role:'wali_kelas'});
  const preview=await call(db,'login-link-preview',null,{token});
  assert.deepEqual(preview.data,{name:homeroom.waliName,role:'wali_kelas'});
  const user=(await call(db,'login-link-session',{id:'role-link-user',email},{token})).data.user;
  assert.equal(user.role,'wali_kelas');assert.ok(user.homeroomClassIds.includes(homeroom.classId));
  await call(db,'members',owner,{email,name:teacherName,role:'admin'});
  assert.equal((await call(db,'login-link-preview',null,{token})).status,404);
  assert.equal((await call(db,'login-links',owner,{email})).status,400);
  assert.equal((await call(db,'login-links',owner,{email:owner.email})).status,400);
  db.sql.close();
});

test('cross-origin writes and owner revocation are blocked',async()=>{
  const db=new SqliteD1();await addStudent(db,student('a'));
  assert.equal((await call(db,'save',owner,{changes:[{kind:'delete',id:'a'}]},'https://elsewhere.test')).status,403);
  assert.equal((await call(db,'members',owner,{email:owner.email,revoke:true})).status,403);
  assert.equal((await call(db,'students')).data.students.length,1);db.sql.close();
});

test('a concurrent update rolls back the entire batch and preserves the other editor',async()=>{
  const db=new SqliteD1();await addStudent(db,student('a'));await addStudent(db,student('b'));
  db.beforeWrite=()=>db.sql.exec("UPDATE raport_students SET record=json_set(record,'$.scores.s1',75),version=version+1 WHERE id='a'");
  const result=await call(db,'save',owner,{changes:[{kind:'score',id:'a',subjectId:'s1',value:10},{kind:'score',id:'b',subjectId:'s1',value:20}]});
  assert.equal(result.status,409);
  const rows=(await call(db,'students')).data.students;
  assert.equal(rows.find((x:any)=>x.id==='a').scores.s1,75);assert.equal(rows.find((x:any)=>x.id==='b').scores.s1,undefined);
  assert.equal(db.sql.prepare('SELECT count(*) AS count FROM raport_write_guards').get()!.count,0);db.sql.close();
});

test('legacy data parser reads literals and rejects executable expressions',()=>{
  const parsed=parseDataLiteral("export const RECORDS: StudentRecord[] = [{id:'a',scores:{s1:90},name:'Uji \\'A\\'',active:true,},];",'RECORDS');
  assert.equal((parsed[0] as any).name,"Uji 'A'");assert.equal((parsed[0] as any).scores.s1,90);
  assert.throws(()=>parseDataLiteral('const RECORDS = [fetch("https://example.test")];','RECORDS'));
  assert.throws(()=>parseDataLiteral('const RECORDS = [{__proto__: {admin:true}}];','RECORDS'));
});

test('legacy arrays support fixed references and ignore generated or missing grades',()=>{
  const source='const MASTER_STUDENTS_A = [{id:"a",no:undefined as unknown as number,scores:generateSubjectScores2(101)}]; const MASTER_STUDENTS_B = [{id:"b",scores:{pai:undefined as unknown as number}}]; const MASTER_STUDENTS_ALL = [...MASTER_STUDENTS_A,...MASTER_STUDENTS_B];';
  const rows=parseDataLiteral(source,'MASTER_STUDENTS_ALL') as any[];
  assert.equal(rows.length,2);assert.deepEqual({...rows[0].scores},{});assert.equal(rows[1].scores.pai,undefined);
  assert.throws(()=>parseDataLiteral('const MASTER_STUDENTS_A = [...MASTER_STUDENTS_A];','MASTER_STUDENTS_A'));
  assert.throws(()=>parseDataLiteral('const RECORDS=[{scores:generateSubjectScores(fetch("bad"))}];','RECORDS'));
});

test('student import is idempotent and preserves existing grades and identities',async()=>{
  const db=new SqliteD1();const existing={...student('a'),name:'Identitas tersimpan',scores:{s1:89}};
  await addStudent(db,existing);
  const records=[student('a'),student('b')];
  const first=await insertMissingStudents(db.environment().DB,records);
  assert.equal(first.imported,1);assert.equal(first.skipped,1);assert.equal(first.verified,2);
  const second=await insertMissingStudents(db.environment().DB,records);
  assert.equal(second.imported,0);assert.equal(second.skipped,2);assert.equal(second.total,2);
  const saved=(await call(db,'students')).data.students.find((x:any)=>x.id==='a');
  assert.equal(saved.name,existing.name);assert.equal(saved.scores.s1,89);db.sql.close();
});

test('maintenance import requires its runtime secret and the approved archive',async()=>{
  const db=new SqliteD1();
  const req=(token:string)=>new Request('https://raport.test/api/import-students',{method:'POST',headers:{'Content-Type':'application/zip','X-Raport-Import-Token':token},body:new Uint8Array([1,2,3])});
  assert.equal((await handleStudentImport(req('test'),db.environment())).status,404);
  const env={...db.environment(),RAPORT_IMPORT_TOKEN:'test'};
  assert.equal((await handleStudentImport(req('wrong'),env)).status,403);
  assert.equal((await handleStudentImport(req('test'),env)).status,400);
  assert.equal((await call(db,'students')).data.students.length,0);db.sql.close();
});

test('actual approved archive imports all 818 pupils with blank grades', {skip:!process.env.RAPORT_IMPORT_FIXTURE},async()=>{
  const db=new SqliteD1();const bytes=new Uint8Array(readFileSync(process.env.RAPORT_IMPORT_FIXTURE!));
  const records=await readLegacyZip(bytes);
  assert.equal(records.length,818);assert.equal(records.filter(x=>x.schoolType==='mukim').length,625);
  assert.equal(records.filter(x=>x.schoolType==='fullday').length,193);
  assert.equal(records.filter(x=>Object.keys(x.scores).length).length,0);
  const env={...db.environment(),RAPORT_IMPORT_TOKEN:'fixture-only-token'};
  const response=await handleStudentImport(new Request('https://raport.test/api/import-students',{method:'POST',headers:{'Content-Type':'application/zip','X-Raport-Import-Token':'fixture-only-token'},body:bytes}),env);
  assert.equal(response.status,200);const result=await response.json() as any;
  assert.equal(result.imported,818);assert.equal(result.verified,818);assert.equal(result.total,818);assert.equal(result.byClass.length,43);
  const repeat=await insertMissingStudents(env.DB,records);assert.equal(repeat.imported,0);assert.equal(repeat.skipped,818);db.sql.close();
});

test('administrative creation and reset use unique automatic PINs and admin names must be teachers',async()=>{
  const db=new SqliteD1();db.bulkKey='e5'.repeat(32);
  const names=(await call(db,'pin-bulk-candidates')).data.candidates;
  assert.equal((await call(db,'pin-accounts',owner,{name:names[0].name,role:'admin',pin:'12345678'})).status,400);
  assert.equal((await call(db,'pin-accounts',owner,{name:'Admin bebas tidak terdaftar',role:'admin'})).status,400);
  const first=await call(db,'pin-accounts',owner,{name:names[0].name,role:'admin'});
  const second=await call(db,'pin-accounts',owner,{name:names[1].name,role:names[1].role});
  assert.equal(first.status,200);assert.equal(second.status,200);
  assert.match(first.data.pin,/^\d{8}$/);assert.match(second.data.pin,/^\d{8}$/);assert.notEqual(first.data.pin,second.data.pin);
  const login=await call(db,'pin-login',null,{name:first.data.account.name,pin:first.data.pin});
  assert.equal(login.status,200);
  assert.equal((await call(db,'pin-accounts',null,{id:first.data.account.id,name:first.data.account.name,role:'admin',resetPin:true},undefined,login.cookie)).status,403);
  const reset=await call(db,'pin-accounts',owner,{id:first.data.account.id,name:first.data.account.name,role:'admin',resetPin:true});
  assert.equal(reset.status,200);assert.match(reset.data.pin,/^\d{8}$/);assert.notEqual(reset.data.pin,first.data.pin);
  assert.equal((await call(db,'session',null,undefined,undefined,login.cookie)).status,401);
  assert.equal((await call(db,'pin-login',null,{name:first.data.account.name,pin:first.data.pin})).status,401);
  assert.equal((await call(db,'pin-login',null,{name:first.data.account.name,pin:reset.data.pin})).status,200);
  assert.equal((await call(db,'members',owner,{email:'free-admin@example.test',name:'Di luar data guru',role:'admin'})).status,400);
  db.sql.close();
});

test('selecting a teacher as admin promotes the existing account without replacing their PIN or link',async()=>{
  const db=new SqliteD1();
  const old=await legacyPin(db,{name:teacherName,role:'guru',pin:'48372619'});
  const login=await call(db,'pin-login',null,{name:teacherName,pin:'48372619'});
  const before=db.sql.prepare('SELECT pin_hash,pin_salt,slug FROM raport_pin_accounts WHERE id=?').get(old.data.account.id);
  db.bulkKey='f6'.repeat(32);
  const body={operationId:crypto.randomUUID(),mode:'admin',entries:[{name:teacherName,role:'admin'}]};
  const result=await call(db,'pin-bulk-create',owner,body);
  assert.equal(result.status,200);assert.equal(result.data.created.length,0);assert.equal(result.data.promoted.length,1);
  assert.deepEqual(db.sql.prepare('SELECT pin_hash,pin_salt,slug FROM raport_pin_accounts WHERE id=?').get(old.data.account.id),before);
  assert.equal((await call(db,'session',null,undefined,undefined,login.cookie)).status,401);
  const relogin=await call(db,'pin-login',null,{name:teacherName,pin:'48372619'});
  assert.equal(relogin.status,200);assert.equal(relogin.data.user.role,'admin');
  assert.deepEqual((await call(db,'pin-bulk-create',owner,body)).data,result.data);
  assert.equal((await call(db,'pin-accounts')).data.adminCount,2);
  const repeated=await call(db,'pin-bulk-create',owner,{...body,operationId:crypto.randomUUID()});
  assert.equal(repeated.status,200);assert.equal(repeated.data.skipped.length,1);
  assert.equal((await call(db,'pin-bulk-create',owner,{...body,operationId:crypto.randomUUID(),entries:[{name:'Guru tidak ada',role:'admin'}]})).status,400);
  const candidate=(await call(db,'pin-bulk-candidates')).data.candidates.find((row:any)=>row.name===teacherName);
  assert.equal(candidate.accountRole,'admin');
  db.sql.close();
});

test('teacher, homeroom teacher and additional admin can change only their own PIN after verifying the old PIN',async()=>{
  const wali=DAFTAR_WALI_KELAS.find(row=>row.classId&&classes.has(row.classId))!.waliName;
  for(const role of ['guru','wali_kelas','admin'] as const) {
    const db=new SqliteD1();db.bulkKey='17'.repeat(32);
    const name=role==='wali_kelas'?wali:teacherName;
    const created=await legacyPin(db,{name,role,pin:'49281736'});
    const login=await call(db,'pin-login',null,{name,pin:'49281736'});
    const otherSession=await call(db,'pin-login',null,{name,pin:'49281736'});
    const change={oldPin:'49281736',newPin:'00193847',confirmPin:'00193847'};
    assert.equal((await call(db,'pin-change',null,change)).status,401);
    assert.equal((await call(db,'pin-change',owner,change)).status,401);
    assert.equal((await call(db,'pin-change',null,{...change,id:created.data.account.id},undefined,login.cookie)).status,400);
    assert.equal((await call(db,'pin-change',null,{...change,oldPin:'11111111'},undefined,login.cookie)).status,401);
    assert.equal((await call(db,'pin-change',null,{...change,confirmPin:'98765432'},undefined,login.cookie)).status,400);
    assert.equal((await call(db,'pin-change',null,change,'https://elsewhere.test',login.cookie)).status,403);
    const result=await call(db,'pin-change',null,change,undefined,login.cookie);
    assert.equal(result.status,200);assert.deepEqual(result.data,{ok:true});assert.match(result.cookieHeader!,/Max-Age=0/);
    assert.equal((await call(db,'session',null,undefined,undefined,login.cookie)).status,401);
    assert.equal((await call(db,'session',null,undefined,undefined,otherSession.cookie)).status,401);
    assert.equal((await call(db,'pin-login',null,{name,pin:'49281736'})).status,401);
    const fresh=await call(db,'pin-login',null,{slug:created.data.account.slug,pin:'00193847'});
    assert.equal(fresh.status,200);assert.equal(fresh.data.user.role,role);
    assert.equal(db.sql.prepare('SELECT count(*) AS total FROM raport_write_guards').get()!.total,0);
    db.sql.close();
  }
});

test('self PIN changes reject another account PIN, limit guesses, and cannot race a revoked session',async()=>{
  const db=new SqliteD1();
  const candidates=(await call(db,'pin-bulk-candidates')).data.candidates;
  const first=await legacyPin(db,{name:candidates[0].name,role:candidates[0].role,pin:'49281736'});
  await legacyPin(db,{name:candidates[1].name,role:candidates[1].role,pin:'83619274'});
  db.bulkKey='28'.repeat(32);
  const login=await call(db,'pin-login',null,{name:candidates[0].name,pin:'49281736'});
  const body={oldPin:'49281736',newPin:'83619274',confirmPin:'83619274'};
  assert.equal((await call(db,'pin-change',null,body,undefined,login.cookie)).status,409);
  const target={oldPin:'49281736',newPin:'00193847',confirmPin:'00193847'};
  db.beforeWrite=()=>db.sql.prepare('DELETE FROM raport_pin_sessions WHERE account_id=?').run(first.data.account.id);
  assert.equal((await call(db,'pin-change',null,target,undefined,login.cookie)).status,409);
  const again=await call(db,'pin-login',null,{name:candidates[0].name,pin:'49281736'});
  assert.equal(again.status,200);
  db.sql.prepare('DELETE FROM raport_pin_attempts').run();
  for(let index=0;index<5;index++)assert.equal((await call(db,'pin-change',null,{...target,oldPin:'11111111'},undefined,again.cookie)).status,401);
  assert.equal((await call(db,'pin-change',null,target,undefined,again.cookie)).status,429);
  db.sql.close();
});

test('promoting existing teachers is atomic and shares the ten-admin cap',async()=>{
  const db=new SqliteD1();
  for(let index=0;index<8;index++)await legacyPin(db,{name:'Legacy Admin '+index,role:'admin',pin:'87654321'});
  const candidates=(await call(db,'pin-bulk-candidates')).data.candidates.slice(0,2);
  for(const row of candidates)await legacyPin(db,{name:row.name,role:row.role,pin:'21837465'});
  db.bulkKey='39'.repeat(32);
  const entries=candidates.map((row:any)=>({name:row.name,role:'admin'}));
  assert.equal((await call(db,'pin-bulk-create',owner,{operationId:crypto.randomUUID(),mode:'admin',entries})).status,409);
  assert.equal((await call(db,'pin-accounts')).data.adminCount,9);
  for(const row of candidates)assert.notEqual(db.sql.prepare('SELECT role FROM raport_pin_accounts WHERE name=?').get(row.name)!.role,'admin');
  assert.equal((await call(db,'pin-bulk-create',owner,{operationId:crypto.randomUUID(),mode:'admin',entries:entries.slice(0,1)})).status,200);
  assert.equal((await call(db,'pin-bulk-create',owner,{operationId:crypto.randomUUID(),mode:'admin',entries:entries.slice(1)})).status,409);
  assert.equal((await call(db,'pin-accounts')).data.adminCount,10);
  db.sql.close();
});
