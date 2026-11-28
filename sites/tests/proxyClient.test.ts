import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signProxyRequest, trustedClientRequest, verifiedProxyRequest } from '../server/proxyClient';
const key='a7'.repeat(32),url='https://raport-pondok.abumumtaz.chatgpt.site/api/raport?action=pin-login';
async function signed(timestamp=String(Date.now())) {
 const ip='203.0.113.8',signature=await signProxyRequest('POST',url,timestamp,ip,key);
 return new Request(url,{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1','x-raport-proxy-time':timestamp,'x-raport-proxy-ip':ip,'x-raport-proxy-signature':signature}});
}
test('only a fresh signed proxy request can supply the original client IP',async()=>{
 const request=await signed();
 assert.equal(await verifiedProxyRequest(request,key),true);
 assert.equal((await trustedClientRequest(request,key)).headers.get('cf-connecting-ip'),'203.0.113.8');
 for(const secret of [undefined,'bad','b8'.repeat(32)])assert.equal((await trustedClientRequest(request,secret)).headers.get('cf-connecting-ip'),'192.0.2.1');
 assert.equal(await verifiedProxyRequest(await signed(String(Date.now()-120000)),key),false);
 const headers=new Headers(request.headers);headers.set('x-raport-proxy-ip','203.0.113.9');
 assert.equal(await verifiedProxyRequest(new Request(request,{headers}),key),false);
 assert.equal(await verifiedProxyRequest(new Request(url.replace('pin-login','pin-change'),{method:'POST',headers:request.headers}),key),false);
 assert.equal(await verifiedProxyRequest(new Request(url,{headers:request.headers}),key),false);
});
