import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(32).toString('hex');
  return salt + ':' + (await derive(password, salt)).toString('hex');
}

export async function verifyPassword(password: string, hash?: string) {
  const [salt, key] = hash?.split(':') || ['0'.repeat(64), '0'.repeat(128)];
  const actual = await derive(password, salt);
  return Boolean(hash) && timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
