const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
const unhex=(value:string)=>Uint8Array.from(value.match(/../g)??[],value=>parseInt(value,16));
export const validProxyKey=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function proxyClientIp(value:string|null) {
  const ip=value?.split(',')[0].trim()??'';
  return /^[a-fA-F0-9:.]{3,64}$/.test(ip)?ip:'unknown';
}
function message(method:string,url:string,timestamp:string,ip:string) {
  const target=new URL(url);
  return new TextEncoder().encode([method,target.pathname+target.search,timestamp,ip].join('\n'));
}
async function proxyKey(secret:string,usage:'sign'|'verify') {
  return crypto.subtle.importKey('raw',unhex(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);
}
export async function signProxyRequest(method:string,url:string,timestamp:string,ip:string,secret:string) {
  if(!validProxyKey(secret))throw new Error('Proxy key is not configured');
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',await proxyKey(secret,'sign'),message(method,url,timestamp,ip))));
}
export async function verifiedProxyRequest(request:Request,secret:unknown) {
  if(!validProxyKey(secret))return false;
  const timestamp=request.headers.get('x-raport-proxy-time')??'',ip=request.headers.get('x-raport-proxy-ip')??'',signature=request.headers.get('x-raport-proxy-signature')??'';
  if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>90000||!/^(unknown|[a-fA-F0-9:.]{3,64})$/.test(ip)||!/^[a-f0-9]{64}$/.test(signature))return false;
  return crypto.subtle.verify('HMAC',await proxyKey(secret,'verify'),unhex(signature),message(request.method,request.url,timestamp,ip));
}
export async function trustedClientRequest(request:Request,secret:unknown) {
  if(!await verifiedProxyRequest(request,secret))return request;
  const headers=new Headers(request.headers);
  headers.set('cf-connecting-ip',headers.get('x-raport-proxy-ip')!);
  return new Request(request,{headers});
}
