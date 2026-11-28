import { classes } from './access';
import { readLegacyZip } from './legacyImport';
import type { Environment } from './api';
import type { StudentRecord } from '../src/types';

const approvedArchive = '223e2e1e58223e82a88eb3213485cd1ed97a43c5edd7e41695f9dfc07d4f6bec';
type ImportEnvironment = Environment & { RAPORT_IMPORT_TOKEN?: string };
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function sha256(value:Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function sameSecret(actual:string,expected:string) {
  if(!actual || actual.length>256)return false;
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([sha256(encoder.encode(actual)),sha256(encoder.encode(expected))]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}

export async function insertMissingStudents(db:D1Database,records:StudentRecord[]) {
  if(!records.length || new Set(records.map(x=>x.id)).size!==records.length || records.some(x=>!classes.has(x.classId)))throw new Error('Invalid student dataset');
  const statements:D1PreparedStatement[]=[];
  // Keep each statement below D1's bound-parameter limit. D1 applies this batch atomically.
  for(let i=0;i<records.length;i+=25) {
    const chunk=records.slice(i,i+25);
    statements.push(db.prepare('INSERT OR IGNORE INTO raport_students (id,class_id,record) VALUES '+chunk.map(()=>'(?,?,?)').join(',')).bind(...chunk.flatMap(x=>[x.id,x.classId,JSON.stringify(x)])));
  }
  const results=await db.batch(statements);
  const imported=results.reduce((sum,x)=>sum+(x.meta.changes||0),0);
  let verified=0;
  for(let i=0;i<records.length;i+=90) {
    const chunk=records.slice(i,i+90);
    const row=await db.prepare('SELECT count(*) AS count FROM raport_students WHERE id IN ('+chunk.map(()=>'?').join(',')+')').bind(...chunk.map(x=>x.id)).first<{count:number}>();
    verified+=row?.count||0;
  }
  const total=await db.prepare('SELECT count(*) AS count FROM raport_students').first<{count:number}>();
  const byClass=await db.prepare('SELECT class_id AS classId,count(*) AS count FROM raport_students GROUP BY class_id ORDER BY class_id').all<{classId:string;count:number}>();
  return {imported,skipped:records.length-imported,verified,total:total?.count||0,byClass:byClass.results};
}

// Temporary maintenance route: requires both the private Sites service boundary
// and a separate runtime secret. Only the exact user-supplied archive is accepted.
// Removing RAPORT_IMPORT_TOKEN disables this route without affecting school login.
export async function handleStudentImport(request:Request,env:ImportEnvironment) {
  if(!env.RAPORT_IMPORT_TOKEN)return response({error:'Operasi tidak tersedia.'},404);
  if(request.method!=='POST')return response({error:'Metode tidak tersedia.'},405);
  if(!await sameSecret(request.headers.get('X-Raport-Import-Token')||'',env.RAPORT_IMPORT_TOKEN))return response({error:'Akses ditolak.'},403);
  if(request.headers.get('content-type')!=='application/zip')return response({error:'Pilih arsip ZIP.'},415);
  if(Number(request.headers.get('content-length'))>3*1024*1024)return response({error:'Arsip terlalu besar.'},413);
  try {
    const bytes=new Uint8Array(await request.arrayBuffer());
    if(bytes.length>3*1024*1024)return response({error:'Arsip terlalu besar.'},413);
    if(await sha256(bytes)!==approvedArchive)return response({error:'Arsip tidak cocok dengan sumber yang disetujui.'},400);
    const records=await readLegacyZip(bytes);
    return response(await insertMissingStudents(env.DB,records));
  } catch(error) {
    console.error('Student import failed',error instanceof Error?error.name:'UnknownError');
    return response({error:'Impor siswa gagal.'},500);
  }
}
