import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StudentRecord } from '../src/types';
import { legacyClassLabelsChecksum, legacyFiles } from './legacy-manifest';

const [directory, destination] = process.argv.slice(2);
if (!directory || !destination || !destination.endsWith('.private.json')) {
  console.error('Jalankan dengan folder ZIP lama yang sudah diekstrak dan nama keluaran *.private.json.');
  process.exit(1);
}

const output = resolve(destination);
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (output.startsWith(project + sep)) {
  console.error('Simpan hasil ekstraksi di luar folder repositori.');
  process.exit(1);
}

const temporary = await mkdtemp(join(tmpdir(), 'raport-extract-'));
try {
  // Check every source before loading any file. Only the audited original can be imported.
  for (const [name, , checksum] of legacyFiles) {
    const source = await readFile(join(directory, 'src', 'data', name));
    if (createHash('sha256').update(source).digest('hex') !== checksum) {
      throw new Error('Berkas sumber berbeda dari arsip asli yang diperiksa.');
    }
    await writeFile(join(temporary, name), source, { mode: 0o600 });
  }
  const classLabels = await readFile(join(directory, 'src', 'components', 'DataMasterView.tsx'), 'utf8');
  if (createHash('sha256').update(classLabels).digest('hex') !== legacyClassLabelsChecksum) {
    throw new Error('Sumber label kelas berbeda dari arsip asli.');
  }
  const groupLabels = new Map<string, Set<string>>();
  const arrayNames = [['1int', 'putriNisns'], ['2int', 'putriNisns2Int'], ['3int', 'putriNisns3Int']];
  for (const [prefix, variable] of arrayNames) {
    const literal = classLabels.match(new RegExp('const ' + variable + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)'))?.[1];
    if (!literal) throw new Error('Sumber label kelas tidak lengkap.');
    groupLabels.set(prefix, new Set(literal.match(/\d{10}/g) || []));
  }
  const students: StudentRecord[] = [];
  for (const [name, variable] of legacyFiles) {
    const source = await import(pathToFileURL(join(temporary, name)).href);
    const records = source[variable] ?? source.default?.[variable];
    if (!Array.isArray(records)) throw new Error('Daftar santri pada sumber tidak tersedia.');
    students.push(...(name === 'masterStudentsFullDay.ts' ? records : records.map(
      (student: StudentRecord) => ({ ...student, schoolType: 'mukim' }),
    )));
  }
  if (students.length !== 818 || new Set(students.map(({ id }) => id)).size !== 818) {
    throw new Error('Jumlah data santri tidak cocok.');
  }
  for (const student of students) {
    const group = [...groupLabels].find(([prefix]) => student.classId.startsWith(prefix));
    if (group) student.isFemale = group[1].has(student.nisn);
  }
  await writeFile(output, JSON.stringify(students), { flag: 'wx', mode: 0o600 });
  console.log('818 data santri siap diimpor. Simpan berkas hasil ekstraksi secara privat.');
} catch {
  console.error('Ekstraksi gagal. Gunakan ZIP asli, periksa lokasi, dan pastikan berkas tujuan belum ada.');
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
