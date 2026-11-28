import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, EncryptJWT } from 'jose';
import { APP_ORIGIN, GOOGLE_CALLBACK, FLOW_COOKIE, isGoogleAppOrigin, configuredGoogle, readGoogleFlow, startGoogle, verifyGoogleIdentity } from '../server/googleOAuth';
import { createGoogleHandler } from '../api/google';
import { verifyGoogleRpc } from '../server/googleRpc';

const config = { clientId: 'synthetic-client.apps.googleusercontent.com', clientSecret: 'synthetic-google-client-secret', proxyKey: 'ba'.repeat(32) };
const pair = await generateKeyPair('RS256'), jwk = await exportJWK(pair.publicKey), keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'synthetic', alg: 'RS256', use: 'sig' }] });
async function idToken(nonce: string, claims: Record<string, unknown> = {}) {
  return new SignJWT({ nonce, email: 'lionxmumtaz@gmail.com', email_verified: true, name: 'Pemilik Uji', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).setIssuer('https://accounts.google.com')
    .setAudience(config.clientId).setSubject('google-owner-123').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
}
function callback(authUrl: URL, cookie: string, query: Record<string, string> = {}) {
  const url = new URL(GOOGLE_CALLBACK); url.search = new URLSearchParams({ state: authUrl.searchParams.get('state')!, code: 'synthetic-code', ...query }).toString();
  return new Request(url, { headers: { Cookie: cookie.split(';')[0] } });
}
test('OAuth uses encrypted expiring state cookies, independent nonce, and a matching PKCE challenge', async () => {
  const first = await startGoogle(config, 'register'), second = await startGoogle(config, 'login'), auth = new URL(first.url);
  assert.equal(auth.origin, 'https://accounts.google.com'); assert.equal(auth.searchParams.get('redirect_uri'), GOOGLE_CALLBACK);
  assert.equal(auth.searchParams.get('scope'), 'openid email profile'); assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(auth.searchParams.get('state'), new URL(second.url).searchParams.get('state'));
  assert.notEqual(auth.searchParams.get('state'), auth.searchParams.get('nonce'));
  assert.match(first.cookie, /HttpOnly; Secure; SameSite=Lax; Max-Age=600/); assert.equal(first.cookie.includes('verifier'), false);
  const flow = await readGoogleFlow(callback(auth, first.cookie), config); assert.equal(flow.intent, 'register');
  const expected = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(flow.verifier))).toString('base64url');
  assert.equal(auth.searchParams.get('code_challenge'), expected);
  await assert.rejects(readGoogleFlow(callback(auth, first.cookie, { state: 'forged' }), config));
  await assert.rejects(readGoogleFlow(callback(auth, first.cookie), { ...config, proxyKey: 'dc'.repeat(32) }));
  await assert.rejects(readGoogleFlow(new Request(GOOGLE_CALLBACK + '?state=' + flow.state), config));
  const tampered = callback(auth, first.cookie); tampered.headers.set('cookie', FLOW_COOKIE + '=invalid');
  await assert.rejects(readGoogleFlow(tampered, config));
  const encryptionKey = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('raport-google-flow-v1\n' + config.proxyKey)));
  const old = await new EncryptJWT({ ...flow }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer('raport-google-flow').setAudience(APP_ORIGIN).setIssuedAt(1).setExpirationTime(2).encrypt(encryptionKey);
  await assert.rejects(readGoogleFlow(callback(auth, FLOW_COOKIE + '=' + old), config));
});
test('Google ID tokens must pass signature, issuer, audience, expiry, nonce, verified email, and owner authorization', async () => {
  const nonce = 'ab'.repeat(32), valid = await idToken(nonce);
  assert.equal((await verifyGoogleIdentity(valid, config.clientId, nonce, keys)).email, 'lionxmumtaz@gmail.com');
  for (const claims of [{ nonce: 'other' }, { email_verified: false }, { email: 'visitor@gmail.com' }, { azp: 'other-client' }])
    await assert.rejects(verifyGoogleIdentity(await idToken(nonce, claims), config.clientId, nonce, keys));
  await assert.rejects(verifyGoogleIdentity(valid, 'wrong-client', nonce, keys));
  const signed = (issuer: string, expiry: number) => new SignJWT({ nonce, email: 'lionxmumtaz@gmail.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).setIssuer(issuer).setAudience(config.clientId)
    .setSubject('google-owner-123').setIssuedAt().setExpirationTime(expiry).sign(pair.privateKey);
  await assert.rejects(verifyGoogleIdentity(await signed('https://evil.test', Math.floor(Date.now() / 1000) + 300), config.clientId, nonce, keys));
  await assert.rejects(verifyGoogleIdentity(await signed('https://accounts.google.com', 1), config.clientId, nonce, keys));
  const other = await generateKeyPair('RS256'), forged = await new SignJWT({ nonce }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).sign(other.privateKey);
  await assert.rejects(verifyGoogleIdentity(forged, config.clientId, nonce, keys));
});
test('Google callback registers before login, exchanges PKCE server side, sends signed RPC, and never sends tokens in redirects', async () => {
  let nonce = '', currentVerifier = '', registered = false, rpcCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(await request.text());
      assert.equal(params.get('client_secret'), config.clientSecret); assert.equal(params.get('redirect_uri'), GOOGLE_CALLBACK);
      assert.equal(params.get('code_verifier'), currentVerifier); assert.equal(request.headers.get('authorization'), null);
      return Response.json({ id_token: await idToken(nonce) });
    }
    assert.equal(request.url, 'https://raport-pondok.abumumtaz.chatgpt.site/api/google-admin');
    const raw = await request.text(); assert.equal(await verifyGoogleRpc(request, raw, config.proxyKey), true);
    const body = JSON.parse(raw); rpcCalls++; assert.equal(body.profile.emailVerified, true);
    assert.equal(raw.includes('id_token'), false); assert.equal(raw.includes(config.clientSecret), false);
    if (body.intent === 'register') { registered = true; return Response.json({ ok: true }); }
    if (!registered) return Response.json({ code: 'not_registered' }, { status: 409 });
    return Response.json({ ok: true, token: 'c'.repeat(64) });
  };
  const handler = createGoogleHandler({ configuration: () => config, fetcher, keys });
  for (const intent of ['login', 'register', 'login']) {
    const start = await handler(new Request(APP_ORIGIN + '/api/google?action=start&intent=' + intent)); assert.equal(start.status, 303);
    const auth = new URL(start.headers.get('location')!), cookie = start.headers.getSetCookie()[0];
    const request = callback(auth, cookie), flow = await readGoogleFlow(request, config); nonce = flow.nonce; currentVerifier = flow.verifier;
    const response = await handler(request), location = response.headers.get('location')!;
    assert.equal(location.includes('synthetic-code'), false); assert.equal(location.includes('id_token'), false);
    if (intent === 'register') { assert.equal(location, APP_ORIGIN + '/?google=registered'); assert.equal(response.headers.getSetCookie().length, 1); }
    else if (!registered) { assert.equal(location, APP_ORIGIN + '/?google=not_registered'); assert.equal(response.headers.getSetCookie().length, 1); }
    else { assert.equal(location, APP_ORIGIN + '/'); assert.equal(response.headers.getSetCookie().length, 3); assert.match(response.headers.getSetCookie()[1], /^__Host-raport_google_session=c{64};.*HttpOnly; Secure/); }
  }
  assert.equal(rpcCalls, 3);
});
test('Unconfigured, cross-site, cancelled and forged callbacks cannot create a session or choose an external redirect', async () => {
  assert.equal(configuredGoogle({}), false); assert.equal(configuredGoogle(config), true);
  const disabled = createGoogleHandler({ configuration: () => ({}) });
  assert.deepEqual(await (await disabled(new Request(APP_ORIGIN + '/api/google?action=status'))).json(), { configured: false });
  assert.equal((await disabled(new Request(APP_ORIGIN + '/api/google?action=start&intent=register'))).headers.get('location'), APP_ORIGIN + '/?google=unavailable');
  let calls = 0;
  const handler = createGoogleHandler({ configuration: () => config, fetcher: async () => { calls++; throw new Error('Must not call Google'); }, keys });
  assert.equal((await handler(new Request(APP_ORIGIN + '/api/google?action=start&intent=login', { method: 'POST' }))).status, 405);
  assert.equal((await handler(new Request(APP_ORIGIN + '/api/google?action=start&intent=login', { headers: { 'Sec-Fetch-Site': 'cross-site' } }))).headers.get('location'), APP_ORIGIN + '/?google=restart');
  assert.equal((await handler(new Request('https://evil.test/api/google?action=start&intent=login'))).headers.get('location'), APP_ORIGIN + '/?google=restart');
  assert.equal((await handler(new Request(GOOGLE_CALLBACK + '?state=forged&code=forged'))).headers.get('location'), APP_ORIGIN + '/?google=denied');
  const first = await startGoogle(config, 'login'), auth = new URL(first.url);
  assert.equal((await handler(callback(auth, first.cookie, { error: 'access_denied' }))).headers.get('location'), APP_ORIGIN + '/?google=cancelled');
  assert.equal(calls, 0);
});

test('Google sign-in supports both fixed production hosts and rejects cross-domain OAuth flow cookies', async () => {
  const alternative = 'https://raport-integrasi-2026.vercel.app';
  assert.equal(isGoogleAppOrigin(alternative), true);
  assert.equal(isGoogleAppOrigin('https://raport-integrasi-2026.vercel.app.evil.test'), false);
  const start = await startGoogle(config, 'login', alternative), auth = new URL(start.url);
  assert.equal(auth.searchParams.get('redirect_uri'), alternative + '/auth/google/callback');
  const callbackUrl = new URL(alternative + '/auth/google/callback');
  callbackUrl.search = new URLSearchParams({ state: auth.searchParams.get('state')!, code: 'synthetic-code' }).toString();
  const request = new Request(callbackUrl, { headers: { Cookie: start.cookie.split(';')[0] } });
  assert.equal((await readGoogleFlow(request, config, alternative)).intent, 'login');
  await assert.rejects(readGoogleFlow(request, config, APP_ORIGIN));
  const handler = createGoogleHandler({ configuration: () => config });
  assert.deepEqual(await (await handler(new Request(alternative + '/api/google?action=status'))).json(), { configured: true });
  assert.deepEqual(await (await handler(new Request('https://evil.test/api/google?action=status'))).json(), { configured: false });
});
