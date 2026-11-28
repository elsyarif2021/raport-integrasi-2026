import { handleApi, type Environment } from '../server/api';
import { handleStudentImport } from '../server/studentImport';
export default {
  async fetch(request: Request, env: Environment) {
    if (new URL(request.url).pathname === '/api/import-students') return handleStudentImport(request,env);
    if (new URL(request.url).pathname === '/api/raport') return handleApi(request,env);
    return env.ASSETS.fetch(request);
  },
};
