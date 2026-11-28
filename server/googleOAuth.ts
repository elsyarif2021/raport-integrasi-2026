import { EncryptJWT, jwtDecrypt, jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { GOOGLE_OWNER_EMAIL } from './googleAdmin.js';
import { validProxyKey } from './proxyClient.js';

export const APP_ORIGIN = 'https://raport-integrasi-2627.vercel.app';
export const GOOGLE_CALLBACK = APP_ORIGIN + '/auth/google/callback';
export const FLOW_COOKIE = '__Host-raport_google_flow';
export type GoogleIntent = 'register' | 'login';
export interface GoogleConfig { clientId: string; clientSecret: string; proxyKey: string }
export interface GoogleProfile { sub: string; email: string; name: string; emailVerified: true }
export interface GoogleFlow { state: string; nonce: string; verifier: string; intent: GoogleIntent }
const keySet = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const encoder = new TextEncoder();
const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export function configuredGoogle(value: Partial<GoogleConfig>): value is GoogleConfig {
  return typeof value.clientId === 'string' && /^[-\w.]+\.apps\.googleusercontent\.com$/.test(value.clientId)
    && typeof value.clientSecret === 'string' && value.clientSecret.trim().length >= 16 && validProxyKey(value.proxyKey);
}
async function flowKey(secret: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('raport-google-flow-v1\n' + secret)));
}
export function cookieValue(request: Request, name: string) {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}
export const flowCookie = (value: string, maxAge = 600) => `${FLOW_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export async function startGoogle(config: GoogleConfig, intent: GoogleIntent) {
  const flow: GoogleFlow = { state: random(), nonce: random(), verifier: random(), intent };
  const sealed = await new EncryptJWT({ ...flow }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer('raport-google-flow').setAudience(APP_ORIGIN).setIssuedAt().setExpirationTime('10m')
    .encrypt(await flowKey(config.proxyKey));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(flow.verifier)));
  const challenge = btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  target.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: GOOGLE_CALLBACK,
    response_type: 'code', scope: 'openid email profile', state: flow.state, nonce: flow.nonce,
    code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  return { url: target.href, cookie: flowCookie(sealed) };
}
export async function readGoogleFlow(request: Request, config: GoogleConfig): Promise<GoogleFlow> {
  const sealed = cookieValue(request, FLOW_COOKIE);
  if (!sealed || sealed.length > 4096) throw new Error('Invalid flow');
  const { payload } = await jwtDecrypt(sealed, await flowKey(config.proxyKey), {
    issuer: 'raport-google-flow', audience: APP_ORIGIN, keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'], maxTokenAge: '10m',
  });
  if (![payload.state, payload.nonce, payload.verifier].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
    || (payload.intent !== 'register' && payload.intent !== 'login')) throw new Error('Invalid flow');
  const state = new URL(request.url).searchParams.getAll('state');
  if (state.length !== 1 || state[0] !== payload.state) throw new Error('Invalid state');
  return payload as unknown as GoogleFlow;
}
export async function verifyGoogleIdentity(token: string, clientId: string, nonce: string, keys: JWTVerifyGetKey = keySet): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(token, keys, { algorithms: ['RS256'], audience: clientId,
    issuer: ['accounts.google.com', 'https://accounts.google.com'], requiredClaims: ['sub', 'exp', 'iat', 'nonce', 'email', 'email_verified'],
    maxTokenAge: '10m', clockTolerance: 5 });
  if (payload.nonce !== nonce || payload.email_verified !== true || typeof payload.email !== 'string'
    || payload.email.toLowerCase() !== GOOGLE_OWNER_EMAIL || typeof payload.sub !== 'string'
    || !/^[a-zA-Z0-9_-]{1,255}$/.test(payload.sub) || (payload.azp !== undefined && payload.azp !== clientId)
    || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new Error('Google account not allowed');
  return { sub: payload.sub, email: GOOGLE_OWNER_EMAIL, emailVerified: true,
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 200) : 'Super Admin' };
}
export async function exchangeGoogleCode(code: string, flow: GoogleFlow, config: GoogleConfig, fetcher: typeof fetch = fetch, keys?: JWTVerifyGetKey) {
  const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(12000),
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: GOOGLE_CALLBACK, grant_type: 'authorization_code', code_verifier: flow.verifier }) });
  if (!response.ok) throw new Error('Google authorization failed');
  const value = await response.json() as { id_token?: unknown };
  if (typeof value.id_token !== 'string' || value.id_token.length > 16000) throw new Error('Invalid Google response');
  return verifyGoogleIdentity(value.id_token, config.clientId, flow.nonce, keys);
}
