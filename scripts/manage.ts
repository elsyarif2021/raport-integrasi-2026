import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { classes, permissions } from '../server/access';
import { database } from '../server/db';
import { hashPassword } from '../server/password';
import type { StudentRecord, UserRole } from '../src/types';

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile('.env.local');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const [command, value, accountRole, ...teacherName] = process.argv.slice(2);
const roles = new Set(['admin', 'guru', 'wali_kelas']);

async function run() {
  if (command === 'setup') {
    await database().query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    console.log('Tabel Raport Pondok siap.');
    return;
  }

  if (command === 'import') {
    if (!value) throw new Error('Sertakan lokasi berkas JSON privat.');
    const records: StudentRecord[] = JSON.parse(await readFile(value, 'utf8'));
    if (!Array.isArray(records) || !records.length || records.length > 10000) throw new Error('Berkas impor tidak valid.');
    const ids = new Set<string>();
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(record.id) ||
          ids.has(record.id) || !classes.has(record.classId) || typeof record.name !== 'string' ||
          typeof record.nisn !== 'string' || !record.scores || typeof record.scores !== 'object' ||
          Array.isArray(record.scores) || Object.values(record.scores).some((value) =>
            typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Ada entri santri yang tidak valid.');
      ids.add(record.id);
    }
    const result = await database().query(
      `INSERT INTO raport_students (id, record)
       SELECT item->>'id', item FROM jsonb_array_elements($1::jsonb) AS item
       ON CONFLICT (id) DO NOTHING`, [JSON.stringify(records)],
    );
    console.log(`${result.rowCount} santri baru diimpor. ID yang sudah ada dilewati.`);
    return;
  }

  if (command === 'account') {
    if (!value || !/^[a-z0-9._-]{1,64}$/i.test(value) || !roles.has(accountRole)) {
      throw new Error('Gunakan nama pengguna dan peran admin, guru, atau wali_kelas.');
    }
    const role = accountRole as UserRole;
    const username = value.toLowerCase();
    const name = teacherName.join(' ').trim() || (role === 'admin' ? 'Administrator Raport' : '');
    const { user } = permissions({ name, role });
    if (!name || (role === 'guru' && !user.assignedClassIds?.length)) {
      throw new Error('Nama guru belum cocok dengan Master Penugasan. Periksa ejaannya.');
    }
    if (role === 'wali_kelas' && !user.homeroomClassId) {
      throw new Error('Nama wali kelas belum cocok dengan Master Wali Kelas.');
    }
    const password = randomBytes(24).toString('base64url');
    const db = await database().connect();
    try {
      await db.query('BEGIN');
      await db.query(
        `INSERT INTO raport_accounts (username, name, role, password_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO UPDATE SET name = excluded.name, role = excluded.role, password_hash = excluded.password_hash`,
        [username, name, role, await hashPassword(password)],
      );
      await db.query('DELETE FROM raport_sessions WHERE username = $1', [username]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
    console.log('Nama pengguna:', username);
    console.log('Kata sandi baru, tampil sekali:', password);
    return;
  }

  if (command === 'revoke') {
    if (!value) throw new Error('Sertakan nama pengguna.');
    const result = await database().query('DELETE FROM raport_accounts WHERE username = $1', [value.toLowerCase()]);
    console.log(result.rowCount ? 'Akun dan sesinya telah dicabut.' : 'Akun tidak ditemukan.');
    return;
  }

  throw new Error('Perintah tidak dikenal.');
}

try {
  await run();
} catch (error) {
  const safeMessages = [
    'Sertakan lokasi berkas JSON privat.', 'Berkas impor tidak valid.', 'Ada entri santri yang tidak valid.',
    'Gunakan nama pengguna dan peran admin, guru, atau wali_kelas.',
    'Nama guru belum cocok dengan Master Penugasan. Periksa ejaannya.',
    'Nama wali kelas belum cocok dengan Master Wali Kelas.', 'Sertakan nama pengguna.', 'Perintah tidak dikenal.',
  ];
  const message = error instanceof Error ? error.message : '';
  console.error(safeMessages.includes(message) ? message : 'Perintah gagal. Periksa lokasi berkas, konfigurasi database, dan jalankan setup terlebih dahulu.');
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL) await database().end();
}
