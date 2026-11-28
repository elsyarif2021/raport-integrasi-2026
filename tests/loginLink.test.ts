import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLoginLinkToken, loginReturnPath, readPinLinkSlug } from '../src/utils/loginLink';

test('login links keep an opaque token in a fragment and preserve it through same-origin sign-in',()=>{
  const token='a1'.repeat(32);
  assert.equal(readLoginLinkToken('#akses='+token),token);
  assert.equal(loginReturnPath(token),'/#akses='+token);
  for(const value of ['', '#akses=short', '#nama=Guru', '#akses=https://elsewhere.test', '#akses='+token+'extra']) {
    assert.equal(readLoginLinkToken(value),null);
  }
  assert.equal(loginReturnPath('https://elsewhere.test'),'/');
  assert.equal(loginReturnPath(null),'/');
});

test('named PIN links accept a public account slug and never use the PIN in the URL',()=>{
  const slug='guru-contoh-12345678-1234-1234-1234-123456789abc';
  assert.equal(readPinLinkSlug('#masuk='+slug),slug);
  for(const hash of ['#masuk=123456','#masuk=https://elsewhere.test','#masuk='+slug+'/extra','#pin=492817'])assert.equal(readPinLinkSlug(hash),null);
});
