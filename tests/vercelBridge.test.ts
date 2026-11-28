import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { createRaportBridge } from '../api/raport';
import { handleApi,type Environment } from '../server/api';
import { savePinAccount } from '../server/pinAuth';
import { trustedClientRequest,verifiedProxyRequest } from '../server/proxyClient';
import { ALL_TEACHER_ASSIGNMENTS } from '../src/data/teacherSubjectsDatabase';
const key='a7'.repeat(32),bulkKey='c9'.repeat(32);
class Database {
 sql=new DatabaseSync(':memory:');
 constructor(){const directory=new URL('../drizzle/',import.meta.url);for(const file of readdirSync(directory).filter(x=>x.endsWith('.sql')).sort())this.sql.exec(readFileSync(new URL(file,directory),'utf8'));}
 prepare(sql:string){const db=this;const statement=(params:any[]=[]):any=>({bind:(...values:any[])=>statement(values),sql,params,first:async()=>db.sql.prepare(sql).get(...params)??null,all:async()=>({results:db.sql.prepare(sql).all(...params)}),run:async()=>({meta:{changes:Number(db.sql.prepare(sql).run(...params).changes)}})});return statement();}
 async batch(commands:any[]){this.sql.exec('BEGIN');try{const result=commands.map(command=>/^SELECT/i.test(command.sql)?{results:this.sql.prepare(command.sql).all(...command.params),meta:{changes:0}}:{results:[],meta:{changes:Number(this.sql.prepare(command.sql).run(...command.params).changes)}});this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
 env(){return {DB:this as unknown as D1Database,ASSETS:{} as Fetcher,RAPORT_PIN_BULK_KEY:bulkKey} satisfies Environment;}
}
function request(action:string,body?:unknown,cookie?:string,headers:Record<string,string>={}) {return new Request('https://raport.test/api/raport?action='+action,{method:body===undefined?'GET':'POST',headers:{...headers,...(cookie?{cookie}:{}),...(body===undefined?{}:{Origin:'https://raport.test','Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
test('Vercel bridge preserves PIN login, link preview, self PIN change and session revocation against the shared API',async()=>{
 const database=new Database(),name=ALL_TEACHER_ASSIGNMENTS.find(row=>row.teacherName)!.teacherName;
 const created=await savePinAccount(database.env().DB,{name,role:'guru',pin:'41827365'},undefined,bulkKey);
 const fetcher:typeof fetch=async(input,init)=>{
  const incoming=new Request(input,init);
  assert.equal(incoming.headers.has('oai-authenticated-user-id'),false);
  const upstream=await trustedClientRequest(new Request(incoming,{headers:new Headers({...Object.fromEntries(incoming.headers),'cf-connecting-ip':'192.0.2.20'})}),key);
  assert.equal(upstream.headers.get('cf-connecting-ip'),'203.0.113.4');
  return handleApi(upstream,database.env());
 };
 const bridge=createRaportBridge({key:()=>key,fetcher});
 const client={'x-vercel-forwarded-for':'203.0.113.4','oai-authenticated-user-id':'forged-owner','oai-authenticated-user-email':'lionxmumtaz@gmail.com'};
 assert.equal((await bridge(request('session',undefined,undefined,client))).status,401);
 const preview=await bridge(request('pin-preview',{slug:created.account!.slug},undefined,client));
 assert.equal((await preview.json() as any).name,name);
 const login=await bridge(request('pin-login',{name,pin:'41827365'},undefined,client));
 assert.equal(login.status,200);assert.match(login.headers.get('set-cookie')!,/HttpOnly/);
 const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const current=await bridge(request('session',undefined,cookie,client));assert.equal((await current.json() as any).user.role,'guru');
 assert.equal((await bridge(request('pin-accounts',{name,role:'admin'},cookie,client))).status,403);
 const changed=await bridge(request('pin-change',{oldPin:'41827365',newPin:'00193847',confirmPin:'00193847'},cookie,client));
 assert.equal(changed.status,200);assert.match(changed.headers.get('set-cookie')!,/Max-Age=0/);
 assert.equal((await bridge(request('session',undefined,cookie,client))).status,401);
 assert.equal((await bridge(request('pin-login',{name,pin:'41827365'},undefined,client))).status,401);
 assert.equal((await bridge(request('pin-login',{name,pin:'00193847'},undefined,client))).status,200);
 database.sql.close();
});
test('bridge validates requests locally, sends only the PIN cookie and rejects an unavailable backend',async()=>{
 let calls=0;
 const bridge=createRaportBridge({key:()=>key,fetcher:async(input,init)=>{calls++;const upstream=new Request(input,init);assert.equal(upstream.url,'https://raport-pondok.abumumtaz.chatgpt.site/api/raport?action=session');assert.equal(upstream.headers.get('cookie'),'raport_pin_session='+'a'.repeat(64));assert.equal(upstream.headers.has('authorization'),false);assert.equal(await verifiedProxyRequest(upstream,key),true);return Response.json({user:null},{headers:{'Set-Cookie':'unrelated=ignore; Path=/'}});}});
 const cookies='vercel-auth=private; raport_pin_session='+'a'.repeat(64)+'; other=private';
 const response=await bridge(request('session',undefined,cookies,{'Authorization':'secret'}));assert.equal(response.status,200);assert.equal(response.headers.has('set-cookie'),false);
 assert.equal((await bridge(new Request('https://raport.test/api/raport?action=pin-login',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}))).status,403);
 assert.equal((await bridge(new Request('https://raport.test/api/raport?action=session',{method:'PATCH'}))).status,405);
 assert.equal((await bridge(request('members'))).status,404);
 assert.equal((await bridge(new Request('https://raport.test/api/raport?action=save',{method:'POST',headers:{Origin:'https://raport.test','Content-Type':'text/plain'},body:'{}'}))).status,415);
 assert.equal(calls,1);
 assert.equal((await createRaportBridge({key:()=>undefined})(request('session'))).status,503);
 assert.equal((await createRaportBridge({key:()=>key,fetcher:async()=>new Response('Login',{headers:{'Content-Type':'text/html'}})})(request('session'))).status,502);
 assert.equal((await createRaportBridge({key:()=>key,fetcher:async()=>{throw new Error('Network');}})(request('session'))).status,502);
});
test('bridge health verifies the connection signature without exposing account data',async()=>{
 const bridge=createRaportBridge({key:()=>key,fetcher:async(input,init)=>{const incoming=new Request(input,init);assert.equal(new URL(incoming.url).pathname,'/api/bridge-health');return Response.json({ok:await verifiedProxyRequest(incoming,key),protocol:1});}});
 const response=await bridge(request('bridge-status'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,protocol:1});
});

test('bridge preserves multiple session cookies and drops unrelated cookies',async()=>{
 const headers=new Headers({'Content-Type':'application/json'});
 headers.append('Set-Cookie','raport_pin_session=; Path=/; HttpOnly; Secure; Max-Age=0');
 headers.append('Set-Cookie','__Host-raport_google_session='+'a'.repeat(64)+'; Path=/; Secure; HttpOnly; SameSite=Lax');
 headers.append('Set-Cookie','unrelated=ignore; Path=/');
 const bridge=createRaportBridge({key:()=>key,fetcher:async()=>new Response('{}',{headers})});
 const response=await bridge(request('session'));
 const cookies=response.headers.getSetCookie();
 assert.equal(cookies.length,2);
 assert.match(cookies[0],/^raport_pin_session=;/);
 assert.match(cookies[1],/^__Host-raport_google_session=a{64};/);
});
test('bridge cookie compatibility fallback separates cookies without splitting Expires dates',async()=>{
 const headers=new Headers({'Content-Type':'application/json'});
 headers.append('Set-Cookie','raport_pin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
 headers.append('Set-Cookie','__Host-raport_google_session='+'a'.repeat(64)+'; Path=/; Secure; HttpOnly');
 const upstream=new Response('{}',{headers});
 Object.defineProperty(upstream.headers,'getSetCookie',{value:undefined});
 const bridge=createRaportBridge({key:()=>key,fetcher:async()=>upstream});
 const response=await bridge(request('session'));
 const cookies=response.headers.getSetCookie();
 assert.equal(cookies.length,2);
 assert.match(cookies[0],/Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
 assert.match(cookies[1],/^__Host-raport_google_session=a{64};/);
});
