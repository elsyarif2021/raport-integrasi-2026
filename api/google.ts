import { APP_ORIGIN, configuredGoogle, cookieValue, exchangeGoogleCode, flowCookie, readGoogleFlow, startGoogle, type GoogleConfig, type GoogleProfile } from '../server/googleOAuth.js';
import { GOOGLE_COOKIE, googleSessionCookie } from '../server/googleAdmin.js';
import { signGoogleRpc } from '../server/googleRpc.js';
import type { JWTVerifyGetKey } from 'jose';

const backend = 'https://raport-pondok.abumumtaz.chatgpt.site/api/google-admin';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ ...privateHeaders, Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}
export function createGoogleHandler({ configuration, fetcher = fetch, keys }: {
  configuration: () => Partial<GoogleConfig>; fetcher?: typeof fetch; keys?: JWTVerifyGetKey;
}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), action = url.pathname === '/auth/google/callback' ? 'callback' : url.searchParams.get('action');
    if (request.method !== 'GET') return Response.json({ error: 'Metode tidak tersedia.' }, { status: 405, headers: privateHeaders });
    const config = configuration(), configured = configuredGoogle(config);
    if (action === 'status') return Response.json({ configured }, { headers: privateHeaders });
    if (action !== 'start' && action !== 'callback') return Response.json({ error: 'Operasi tidak tersedia.' }, { status: 404, headers: privateHeaders });
    if (!configured) return redirect(APP_ORIGIN + '/?google=unavailable', [flowCookie('', 0)]);
    if (url.origin !== APP_ORIGIN) return redirect(APP_ORIGIN + '/?google=restart', [flowCookie('', 0)]);
    if (action === 'start') {
      if (request.headers.get('sec-fetch-site') === 'cross-site') return redirect(APP_ORIGIN + '/?google=restart');
      const intent = url.searchParams.get('intent');
      if (intent !== 'login' && intent !== 'register') return redirect(APP_ORIGIN + '/?google=restart');
      const flow = await startGoogle(config, intent);
      return redirect(flow.url, [flow.cookie]);
    }
    let profile: GoogleProfile, intent: 'register' | 'login';
    try {
      const flow = await readGoogleFlow(request, config); intent = flow.intent;
      if (url.searchParams.has('error')) return redirect(APP_ORIGIN + '/?google=cancelled', [flowCookie('', 0)]);
      const codes = url.searchParams.getAll('code');
      if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) throw new Error('Invalid authorization code');
      profile = await exchangeGoogleCode(codes[0], flow, config, fetcher, keys);
    } catch {
      return redirect(APP_ORIGIN + '/?google=denied', [flowCookie('', 0)]);
    }
    try {
      const previousSession = cookieValue(request, GOOGLE_COOKIE), previousPinSession = cookieValue(request, 'raport_pin_session');
      const body = JSON.stringify({ intent, profile, ...(previousSession && /^[a-f0-9]{64}$/.test(previousSession) ? { previousSession } : {}),
        ...(previousPinSession && /^[a-f0-9]{64}$/.test(previousPinSession) ? { previousPinSession } : {}) });
      const time = String(Date.now()), id = crypto.randomUUID();
      const signature = await signGoogleRpc('POST', backend, time, id, body, config.proxyKey);
      const response = await fetcher(backend, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'x-raport-rpc-time': time, 'x-raport-rpc-id': id, 'x-raport-rpc-signature': signature } });
      const result = await response.json() as { code?: string; token?: string; ok?: boolean };
      if (!response.ok || !result.ok) return redirect(APP_ORIGIN + '/?google=' + (result.code === 'not_registered' ? 'not_registered' : 'unavailable'), [flowCookie('', 0)]);
      if (intent === 'register') return redirect(APP_ORIGIN + '/?google=registered', [flowCookie('', 0)]);
      if (typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token)) throw new Error('Invalid session response');
      return redirect(APP_ORIGIN + '/', [flowCookie('', 0), googleSessionCookie(result.token), 'raport_pin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']);
    } catch {
      return redirect(APP_ORIGIN + '/?google=unavailable', [flowCookie('', 0)]);
    }
  };
}
export const GET = createGoogleHandler({ configuration: () => ({ clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET, proxyKey: process.env.RAPORT_PROXY_KEY }) });
