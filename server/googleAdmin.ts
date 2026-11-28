import { verifyGoogleRpc } from './googleRpc.js';
import { verifiedProxyRequest } from './proxyClient.js';
export const GOOGLE_OWNER_EMAIL='lionxmumtaz@gmail.com';
export const GOOGLE_COOKIE='__Host-raport_google_session';
export const GOOGLE_SESSION_SECONDS=8*60*60;
export interface GoogleAdminIdentity {user_id:string;email:string;name:string;role:'admin';loginMethod:'google';isSuperAdmin:true}
const hex=(value:Uint8Array)=>Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=async(value:string)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
export function googleSessionToken(request:Request) {
 const token=request.headers.get('cookie')?.split(';').map(item=>item.trim()).find(item=>item.startsWith(GOOGLE_COOKIE+'='))?.slice(GOOGLE_COOKIE.length+1);
 return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
}
export const googleSessionCookie=(token:string,maxAge=GOOGLE_SESSION_SECONDS)=>`${GOOGLE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export async function googleAdminFor(request:Request,db:D1Database):Promise<GoogleAdminIdentity|null> {
 const token=googleSessionToken(request);if(!token)return null;
 const row=await db.prepare(`SELECT a.google_sub,a.email,a.name FROM raport_google_sessions s JOIN raport_google_admins a ON a.google_sub=s.google_sub WHERE s.token_hash=? AND s.expires_at>? AND a.email=?`).bind(await digest(token),Date.now(),GOOGLE_OWNER_EMAIL).first<{google_sub:string;email:string;name:string}>();
 return row?{user_id:'google:'+row.google_sub,email:row.email,name:row.name,role:'admin',loginMethod:'google',isSuperAdmin:true}:null;
}
export async function googleContextFor(request:Request,db:D1Database,secret:unknown) {
 if(!await verifiedProxyRequest(request,secret))return undefined;
 return {account:await googleAdminFor(request,db),token:googleSessionToken(request)};
}
export async function revokeGoogleSession(db:D1Database,token?:string|null) {
 if(token&&/^[a-f0-9]{64}$/.test(token))await db.prepare('DELETE FROM raport_google_sessions WHERE token_hash=?').bind(await digest(token)).run();
 return googleSessionCookie('',0);
}
export async function handleGoogleAdminRpc(request:Request,db:D1Database,secret:unknown) {
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
 try {
  if(request.method!=='POST'||request.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'Permintaan tidak tersedia.'},405);
  const raw=await request.text();if(raw.length>4096)return json({error:'Permintaan terlalu besar.'},413);
  if(!await verifyGoogleRpc(request,raw,secret))return json({error:'Koneksi tidak diizinkan.'},403);
  let body:any;try{body=JSON.parse(raw);}catch{return json({error:'Data tidak valid.'},400);}
  const profile=body?.profile;
  if(!['register','login'].includes(body?.intent)||!profile||typeof profile.sub!=='string'||!/^[a-zA-Z0-9_-]{1,255}$/.test(profile.sub)||typeof profile.name!=='string'||!profile.name.trim()||profile.name.length>200||profile.emailVerified!==true||typeof profile.email!=='string'||profile.email.toLowerCase()!==GOOGLE_OWNER_EMAIL)return json({error:'Email Google ini belum diizinkan menjadi super admin.'},403);
  const email=GOOGLE_OWNER_EMAIL,name=profile.name.trim(),id=request.headers.get('x-raport-rpc-id')!;
  const existing=await db.prepare('SELECT google_sub,email FROM raport_google_admins WHERE email=? OR google_sub=?').bind(email,profile.sub).first<{google_sub:string;email:string}>();
  if(existing&&(existing.google_sub!==profile.sub||existing.email!==email))return json({error:'Akun Google tidak sesuai dengan pemilik terdaftar.'},403);
  if(body.intent==='login'&&!existing)return json({error:'Daftar super admin terlebih dahulu.',code:'not_registered'},409);
  const commands=[db.prepare('DELETE FROM raport_google_operations WHERE expires_at<?').bind(Date.now()),db.prepare('INSERT INTO raport_google_operations (id,expires_at) VALUES (?,?)').bind(id,Date.now()+180000)];
  if(body.intent==='register')commands.push(db.prepare('INSERT INTO raport_google_admins (google_sub,email,name,created_at) VALUES (?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET name=excluded.name').bind(profile.sub,email,name,Date.now()));
  const token=body.intent==='login'?hex(crypto.getRandomValues(new Uint8Array(32))):null;
  if(token){
   commands.push(db.prepare('DELETE FROM raport_google_sessions WHERE expires_at<?').bind(Date.now()));
   commands.push(db.prepare('INSERT INTO raport_google_sessions (token_hash,google_sub,expires_at) VALUES (?,?,?)').bind(await digest(token),profile.sub,Date.now()+GOOGLE_SESSION_SECONDS*1000));
   if(typeof body.previousPinSession==='string'&&/^[a-f0-9]{64}$/.test(body.previousPinSession))commands.push(db.prepare('DELETE FROM raport_pin_sessions WHERE token_hash=?').bind(await digest(body.previousPinSession)));
   if(typeof body.previousSession==='string'&&/^[a-f0-9]{64}$/.test(body.previousSession))commands.push(db.prepare('DELETE FROM raport_google_sessions WHERE token_hash=? AND google_sub=?').bind(await digest(body.previousSession),profile.sub));
  }
  try{await db.batch(commands);}catch(error){if(String(error).includes('UNIQUE constraint'))return json({error:'Permintaan Google sudah digunakan. Mulai masuk kembali.'},409);throw error;}
  return json({ok:true,...(token?{token}:{}),user:{name,email,role:'admin',loginMethod:'google',isSuperAdmin:true}});
 }catch(error){console.error('Google admin service failed',error instanceof Error?error.name:'UnknownError');return json({error:'Layanan login Google belum tersedia.'},500);}
}
