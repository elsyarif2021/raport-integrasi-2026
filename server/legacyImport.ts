import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { unzipSync } from 'fflate';
import { legacyClassLabelsChecksum, legacyFiles } from '../scripts/legacy-manifest.js';
import type { StudentRecord } from '../src/types.js';

const labelsPath = 'src/components/DataMasterView.tsx';
const sourcePath = (name: string) => 'src/data/' + name;
const wanted = new Set([labelsPath, ...legacyFiles.map(([name]) => sourcePath(name))]);

export function readLegacyZip(archive: Uint8Array): StudentRecord[] {
  const files = unzipSync(archive, {
    filter: ({ name, originalSize }) => wanted.has(name) && originalSize <= 1024 * 1024,
  });
  const verified = (path: string, checksum: string) => {
    const bytes = Object.hasOwn(files, path) ? files[path] : undefined;
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== checksum) {
      throw new Error('Archive does not match the audited source');
    }
    return Buffer.from(bytes).toString('utf8');
  };

  const labels = verified(labelsPath, legacyClassLabelsChecksum);
  const sources = legacyFiles.map(([name, variable, checksum]) =>
    ({ name, variable, source: verified(sourcePath(name), checksum) }));
  const groups = [['1int', 'putriNisns'], ['2int', 'putriNisns2Int'], ['3int', 'putriNisns3Int']]
    .map(([prefix, name]) => {
      const values = labels.match(new RegExp('const ' + name + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)'))?.[1];
      if (!values) throw new Error('Missing class labels');
      return { prefix, numbers: new Set(values.match(/\d{10}/g) || []) };
    });

  const result: StudentRecord[] = [];
  // Source files are evaluated only after every byte matches the reviewed archive.
  for (const { name, variable, source } of sources) {
    const javascript = stripTypeScriptTypes(source)
      .replace(/^import .*$/gm, '').replace(/^export /gm, '');
    const records = runInNewContext(javascript + '\n' + variable, Object.create(null), {
      timeout: 500, contextCodeGeneration: { strings: false, wasm: false },
    }) as StudentRecord[];
    if (!Array.isArray(records)) throw new Error('Missing records');
    for (const record of records) {
      const group = groups.find(({ prefix }) => record.classId.startsWith(prefix));
      result.push({
        ...record,
        ...(name === 'masterStudentsFullDay.ts' ? {} : { schoolType: 'mukim' }),
        ...(group ? { isFemale: group.numbers.has(record.nisn) } : {}),
      });
    }
  }

  if (result.length !== 818 || new Set(result.map(({ id }) => id)).size !== 818) {
    throw new Error('Unexpected record count');
  }
  return result;
}
