import { proxyClientIp, signProxyRequest, validProxyKey } from '../server/proxyClient.js';
const backendOrigin='https://raport-pondok.abumumtaz.chatgpt.site';
const getActions=new Set(['session','students','pin-accounts','pin-bulk-candidates','bridge-status']);
const postActions=new Set(['pin-login','pin-preview','pin-link-session','logout','pin-change','pin-accounts','pin-bulk-create','save','import-zip']);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function createRaportBridge({key,fetcher=fetch}:{key:()=>string|undefined;fetcher?:typeof fetch}) {
  return async(request:Request):Promise<Response>=>{
    const url=new URL(request.url),action=url.searchParams.get('action')??'';
    if(request.method!=='GET'&&request.method!=='POST')return json({error:'Metode tidak tersedia.'},405);
    if(!(request.method==='GET'?getActions:postActions).has(action))return json({error:'Operasi tidak tersedia.'},404);
    if(request.method==='POST'&&(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'))return json({error:'Permintaan lintas situs ditolak.'},403);
    const secret=key();if(!validProxyKey(secret))return json({error:'Koneksi aplikasi sedang disiapkan.'},503);
    const limit=action==='import-zip'?3*1024*1024:900000;
    if(Number(request.headers.get('content-length'))>limit)return json({error:'Ukuran permintaan terlalu besar.'},413);
    let body:ArrayBuffer|undefined;
    if(request.method==='POST') {
      const type=request.headers.get('content-type')?.split(';')[0];
      if(type!==(action==='import-zip'?'application/zip':'application/json'))return json({error:'Format permintaan tidak sesuai.'},415);
      body=await request.arrayBuffer();if(body.byteLength>limit)return json({error:'Ukuran permintaan terlalu besar.'},413);
    }
    const target=new URL(action==='bridge-status'?'/api/bridge-health':'/api/raport',backendOrigin);
    if(action!=='bridge-status')target.searchParams.set('action',action);
    const headers=new Headers({'Origin':backendOrigin,'Sec-Fetch-Site':'same-origin'});
    if(request.method==='POST')headers.set('Content-Type',request.headers.get('content-type')!);
    const cookies=request.headers.get('cookie')?.split(';').map(part=>part.trim()).filter(part=>/^(raport_pin_session|__Host-raport_google_session)=[a-f0-9]{64}$/.test(part));
    if(cookies?.length)headers.set('Cookie',cookies.join('; '));
    const timestamp=String(Date.now()),ip=proxyClientIp(request.headers.get('x-vercel-forwarded-for')??request.headers.get('x-real-ip'));
    headers.set('x-raport-proxy-time',timestamp);headers.set('x-raport-proxy-ip',ip);
    headers.set('x-raport-proxy-signature',await signProxyRequest(request.method,target.href,timestamp,ip,secret));
    try {
      const upstream=await fetcher(target,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(25000)});
      if(!upstream.headers.get('content-type')?.includes('application/json'))return json({error:'Layanan pusat belum dapat dihubungi. Coba kembali.'},502);
      const responseHeaders=new Headers({'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
      const responseCookies=typeof upstream.headers.getSetCookie==='function'?upstream.headers.getSetCookie():[upstream.headers.get('set-cookie')??''];
      for(const value of responseCookies)if(/^(raport_pin_session|__Host-raport_google_session)=/.test(value))responseHeaders.append('Set-Cookie',value.replace(/;\s*Domain=[^;]+/ig,''));
      return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
    }catch{return json({error:'Layanan pusat belum dapat dihubungi. Coba kembali.'},502);}
  };
}
const handler=createRaportBridge({key:()=>process.env.RAPORT_PROXY_KEY});
export const GET=handler;
export const POST=handler;
