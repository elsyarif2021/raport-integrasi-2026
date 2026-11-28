import { unzipSync } from 'fflate';
import { legacyClassLabelsChecksum, legacyFiles } from './legacy-manifest';
import type { StudentRecord } from '../src/types';

// Read data literals only. Uploaded source is never evaluated as JavaScript.
export function parseDataLiteral(source: string, variable: string, resolving = new Set<string>()): unknown[] {
  if (resolving.has(variable) || resolving.size > 20) throw new Error('Circular data reference');
  resolving.add(variable);
  const declaration = new RegExp('(?:const|let|var)\\s+' + variable + '\\b[^=]*=').exec(source);
  if (!declaration) throw new Error('Missing data declaration');
  let cursor = declaration.index + declaration[0].length;
  function space() {
    while (cursor < source.length) {
      if (/\s/.test(source[cursor])) { cursor++; continue; }
      if (source.startsWith('//',cursor)) { const end=source.indexOf('\n',cursor); cursor=end<0?source.length:end+1; continue; }
      if (source.startsWith('/*',cursor)) { const end=source.indexOf('*/',cursor+2); if(end<0) throw new Error('Unclosed comment'); cursor=end+2; continue; }
      break;
    }
  }
  function string() {
    const quote=source[cursor++]; let result='';
    while(cursor<source.length) {
      const char=source[cursor++];
      if(char===quote) return result;
      if(quote==='`' && char==='$' && source[cursor]==='{') throw new Error('Expressions are not data');
      if(char!=='\\') { result+=char; continue; }
      const escaped=source[cursor++];
      if(escaped==='u' || escaped==='x') {
        const width=escaped==='u'?4:2; const code=source.slice(cursor,cursor+width);
        if(!new RegExp('^[0-9a-f]{'+width+'}$','i').test(code)) throw new Error('Invalid escape');
        result+=String.fromCharCode(parseInt(code,16));cursor+=width;
      } else result+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'} as Record<string,string>)[escaped] ?? escaped;
    }
    throw new Error('Unclosed string');
  }
  function value(depth=0, propertyKey?: string): any {
    if(depth>20) throw new Error('Data nesting too deep');
    space();const char=source[cursor];
    if(char==='"' || char==="'" || char==='`') return string();
    if(char==='[') {
      cursor++;const result:any[]=[];space();
      while(source[cursor]!==']') {
        if(source.startsWith('...',cursor)) {
          cursor+=3;const items=value(depth+1);if(!Array.isArray(items))throw new Error('Invalid array reference');result.push(...items);
        } else result.push(value(depth+1));
        space();if(source[cursor]!==',') break;cursor++;space();
      }
      if(source[cursor++]!==']') throw new Error('Invalid array');return result;
    }
    if(char==='{') {
      cursor++;const result:Record<string,unknown>=Object.create(null);space();
      while(source[cursor]!=='}') {
        let key:string;
        if(['"',"'",'`'].includes(source[cursor])) key=string();
        else { const match=/^[a-zA-Z_$][\w$]*/.exec(source.slice(cursor));if(!match) throw new Error('Invalid key');key=match[0];cursor+=key.length; }
        if(['__proto__','prototype','constructor'].includes(key)) throw new Error('Invalid key');
        space();if(source[cursor++]!==':') throw new Error('Invalid object');result[key]=value(depth+1,key);space();
        if(source[cursor]!==',') break;cursor++;space();
      }
      if(source[cursor++]!=='}') throw new Error('Invalid object');return result;
    }
    const literal=/^(true|false|null)\b/.exec(source.slice(cursor));
    if(literal) {cursor+=literal[0].length;return JSON.parse(literal[0]);}
    const number=/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(cursor));
    if(number) {cursor+=number[0].length;const parsed=Number(number[0]);if(!Number.isFinite(parsed)) throw new Error('Invalid number');return parsed;}
    const missingValue = /^undefined(?:\s+as\s+unknown\s+as\s+number)?\b/.exec(source.slice(cursor));
    if(missingValue) {cursor+=missingValue[0].length;return undefined;}
    // The old archive generates demonstration grades. Import pupils with empty
    // grades instead of executing that helper or treating examples as real marks.
    const generated = propertyKey === 'scores' && /^generateSubjectScores(?:Intensif|2Intensif|2|3|5SMA|4SMA|6SMA|3Int)?\(\s*\d+\s*\)/.exec(source.slice(cursor));
    if(generated) {cursor+=generated[0].length;return Object.create(null);}
    const reference=/^MASTER_STUDENTS_[A-Z0-9_]+\b/.exec(source.slice(cursor));
    if(reference) {cursor+=reference[0].length;return parseDataLiteral(source,reference[0],resolving);}
    throw new Error('Expressions are not data: '+variable+' / '+(propertyKey || 'array')+' / '+(/^[A-Za-z_$][\w$]*/.exec(source.slice(cursor))?.[0] || 'symbol'));
  }
  try {const result=value();if(!Array.isArray(result)) throw new Error('Expected array');return result;}
  finally {resolving.delete(variable);}
}

export async function readLegacyZip(archive: Uint8Array): Promise<StudentRecord[]> {
  const labelsPath='src/components/DataMasterView.tsx';
  const wanted=new Set([labelsPath,...legacyFiles.map(([name])=>'src/data/'+name)]);
  const normal=(name:string)=>{ const index=name.indexOf('src/');return index>=0?name.slice(index):name; };
  const unzipped=unzipSync(archive,{filter:({name,originalSize})=>wanted.has(normal(name)) && originalSize<=1024*1024});
  const files=new Map<string,Uint8Array>();
  for(const [name,bytes] of Object.entries(unzipped)) {const key=normal(name);if(files.has(key)) throw new Error('Duplicate file');files.set(key,bytes);}
  async function verified(path:string,checksum:string) {
    const bytes=files.get(path);if(!bytes) throw new Error('Missing source');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))).map(b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==checksum) throw new Error('Archive does not match audited source');return new TextDecoder().decode(bytes);
  }
  const labels=await verified(labelsPath,legacyClassLabelsChecksum);
  const sources=await Promise.all(legacyFiles.map(async([name,variable,checksum])=>({name,variable,source:await verified('src/data/'+name,checksum)})));
  const groups=[['1int','putriNisns'],['2int','putriNisns2Int'],['3int','putriNisns3Int']].map(([prefix,name])=>{
    const values=labels.match(new RegExp('const '+name+' = new Set\\(\\[([\\s\\S]*?)\\]\\)'))?.[1];
    if(!values) throw new Error('Missing class labels');return {prefix,numbers:new Set(values.match(/\d{10}/g)||[])};
  });
  const result:StudentRecord[]=[];
  for(const {name,variable,source} of sources) {
    const records=parseDataLiteral(source,variable) as StudentRecord[];
    for(const record of records) {
      const group=groups.find(({prefix})=>record.classId.startsWith(prefix));
      result.push({...record,...(name==='masterStudentsFullDay.ts'?{}:{schoolType:'mukim' as const}),...(group?{isFemale:group.numbers.has(record.nisn)}:{})});
    }
  }
  if(result.length!==818 || new Set(result.map(({id})=>id)).size!==818) throw new Error('Unexpected record count');
  const classNumbers=new Map<string,number>();
  for(const record of result) {
    const next=(classNumbers.get(record.classId) || 0)+1;
    classNumbers.set(record.classId,next);record.no=next;
    record.scores=Object.fromEntries(Object.entries(record.scores).filter(([,value])=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100));
    if(!Object.keys(record.scores).length)record.keterangan='';
  }
  return result;
}
