import { handleApi, type Environment } from '../server/api';
import { handleStudentImport } from '../server/studentImport';
import { trustedClientRequest, verifiedProxyRequest } from '../server/proxyClient';
export default {
  async fetch(request:Request,env:Environment&{RAPORT_PROXY_KEY?:string}) {
    const path=new URL(request.url).pathname;
    if(path==='/api/bridge-health') {
      const ok=await verifiedProxyRequest(request,env.RAPORT_PROXY_KEY);
      return Response.json({ok,protocol:1},{status:ok?200:403,headers:{'Cache-Control':'private, no-store'}});
    }
    if(path==='/api/import-students')return handleStudentImport(request,env);
    if(path==='/api/raport')return handleApi(await trustedClientRequest(request,env.RAPORT_PROXY_KEY),env);
    return env.ASSETS.fetch(request);
  },
};
