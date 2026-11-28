import type { UserRole } from '../src/types';

export interface LinkedAccount { email: string; name: string; role: Exclude<UserRole, 'admin'> }
export const validLoginToken = (token: unknown): token is string => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
async function digest(token: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

export async function findLinkedAccount(db: D1Database, token: unknown): Promise<LinkedAccount | null> {
  if (!validLoginToken(token)) return null;
  const row = await db.prepare(`SELECT link.email, COALESCE(member.name, invitation.name) AS name,
    COALESCE(member.role, invitation.role) AS role FROM raport_login_links AS link
    LEFT JOIN raport_members AS member ON member.email=link.email
    LEFT JOIN raport_invitations AS invitation ON invitation.email=link.email
    WHERE link.token_hash=?`).bind(await digest(token)).first<LinkedAccount>();
  return row && ['guru', 'wali_kelas'].includes(row.role) ? row : null;
}

export async function createLoginToken(db: D1Database, email: string): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare(`INSERT INTO raport_login_links (email,token_hash,created_at) VALUES (?,?,?)
    ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at`)
    .bind(email, await digest(token), Date.now()).run();
  return token;
}
