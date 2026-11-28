import { validProxyKey } from './proxyClient.js';
const hex=(value:Uint8Array)=>Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('');
const unhex=(value:string)=>Uint8Array.from(value.match(/../g)??[],byte=>parseInt(byte,16));
async function rpcKey(secret:string,usage:'sign'|'verify') {
 return crypto.subtle.importKey('raw',unhex(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);
}
async function rpcMessage(method:string,url:string,time:string,id:string,body:string) {
 const target=new URL(url),hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))));
 return new TextEncoder().encode(['raport-google-rpc-v1',method,target.pathname+target.search,time,id,hash].join('\n'));
}
export async function signGoogleRpc(method:string,url:string,time:string,id:string,body:string,secret:string) {
 if(!validProxyKey(secret))throw new Error('Invalid RPC key');
 return hex(new Uint8Array(await crypto.subtle.sign('HMAC',await rpcKey(secret,'sign'),await rpcMessage(method,url,time,id,body))));
}
export async function verifyGoogleRpc(request:Request,body:string,secret:unknown) {
 const time=request.headers.get('x-raport-rpc-time')??'',id=request.headers.get('x-raport-rpc-id')??'',signature=request.headers.get('x-raport-rpc-signature')??'';
 if(!validProxyKey(secret)||!/^\d{13}$/.test(time)||Math.abs(Date.now()-Number(time))>90000||!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(signature))return false;
 return crypto.subtle.verify('HMAC',await rpcKey(secret,'verify'),unhex(signature),await rpcMessage(request.method,request.url,time,id,body));
}
