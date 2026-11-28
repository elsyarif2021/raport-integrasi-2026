const bytes=(value:string)=>Uint8Array.from(value.match(/../g)??[],part=>parseInt(part,16));
const hex=(value:Uint8Array)=>Array.from(value,part=>part.toString(16).padStart(2,'0')).join('');
export const validBulkKey=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function generateRandomPin() {
  const range=100000000,limit=Math.floor(4294967296/range)*range;
  let value:number;
  do {value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=limit);
  return String(value%range).padStart(8,'0');
}
async function keyFor(secret:string,purpose:'fingerprint'|'export') {
  if(!validBulkKey(secret))throw new Error('PIN bulk key is not configured');
  const root=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const material=await crypto.subtle.sign('HMAC',root,new TextEncoder().encode('raport-pin-v1/'+purpose));
  return purpose==='fingerprint'
    ? crypto.subtle.importKey('raw',material,{name:'HMAC',hash:'SHA-256'},false,['sign'])
    : crypto.subtle.importKey('raw',material,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function pinFingerprint(secret:string,pin:string) {
  const key=await keyFor(secret,'fingerprint');
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(pin))));
}
export async function sealBulkResult(secret:string,value:unknown,context:string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},await keyFor(secret,'export'),new TextEncoder().encode(JSON.stringify(value)));
  return hex(iv)+':'+hex(new Uint8Array(encrypted));
}
export async function openBulkResult<T>(secret:string,value:string,context:string):Promise<T> {
  const [iv,cipher]=value.split(':');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(context)},await keyFor(secret,'export'),bytes(cipher));
  return JSON.parse(new TextDecoder().decode(plain));
}
