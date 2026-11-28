import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Users, Play, CheckCircle2 } from 'lucide-react';
import { createPinBulk, getPinBulkCandidates, type PinBulkChunk } from '../services/raportApi';
import type { PinBulkCandidate, PinBulkResult } from '../types';
import { downloadPinBulkExcel } from '../utils/pinBulkExport';

const roles={guru:'Guru',wali_kelas:'Wali kelas',admin:'Administrator'};
const pendingKey='raport_pin_bulk_pending_v1';
interface Job {chunks:PinBulkChunk[];total:number}
const emptyResult=():PinBulkResult=>({created:[],skipped:[]});
function storedJob():Job|null {
  try {
    const parsed=JSON.parse(sessionStorage.getItem(pendingKey)||'null');
    if(!parsed||!Array.isArray(parsed.chunks)||parsed.chunks.length<1||parsed.chunks.length>100)return null;
    const valid=parsed.chunks.every((chunk:PinBulkChunk)=>typeof chunk.operationId==='string'&&/^[a-f0-9-]{36}$/.test(chunk.operationId)&&['staff','admin'].includes(chunk.mode)&&Array.isArray(chunk.entries)&&chunk.entries.length>0&&chunk.entries.length<=5&&chunk.entries.every(entry=>typeof entry.name==='string'&&entry.name.length<=200&&['guru','wali_kelas','admin'].includes(entry.role)));
    return valid&&parsed.total===parsed.chunks.reduce((total:number,chunk:PinBulkChunk)=>total+chunk.entries.length,0)?parsed:null;
  }catch{return null;}
}
export function PinBulkAccounts({adminCount,maxAdmins,onCreated}:{adminCount:number;maxAdmins:number;onCreated:()=>Promise<void>}) {
  const [candidates,setCandidates]=useState<PinBulkCandidate[]>([]);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [group,setGroup]=useState<'staff'|'guru'|'wali_kelas'|'admin'>('staff');
  const [query,setQuery]=useState('');
  const [chunkSize,setChunkSize]=useState(5);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [error,setError]=useState('');
  const [job,setJob]=useState<Job|null>(storedJob);
  const [progress,setProgress]=useState(0);
  const [complete,setComplete]=useState(false);
  const [results,setResults]=useState<PinBulkResult>(emptyResult);
  const alive=useRef(true);
  async function load() {
    const data=await getPinBulkCandidates();
    if(!alive.current)return;
    setCandidates(data.candidates);setChunkSize(Math.max(1,Math.min(5,data.chunkSize)));
    setSelected(new Set(data.candidates.filter(row=>!row.exists).map(row=>row.name)));
  }
  useEffect(()=>{
    alive.current=true;load().catch(error=>{if(alive.current)setError(error.message);}).finally(()=>{if(alive.current)setLoading(false);});
    return()=>{alive.current=false;};
  },[]);
  const visible=candidates.filter(row=>(group==='staff'||group==='admin'||row.role===group)&&row.name.toLocaleLowerCase('id').includes(query.toLocaleLowerCase('id')));
  const eligible=(row:PinBulkCandidate)=>group==='admin'?row.accountRole!=='admin':!row.exists;
  const chosen=candidates.filter(row=>(group==='staff'||group==='admin'||row.role===group)&&eligible(row)&&selected.has(row.name));
  function chooseGroup(value:typeof group) {
    setGroup(value);setQuery('');setSelected(new Set(value==='admin'?[]:candidates.filter(row=>!row.exists).map(row=>row.name)));
  }
  function toggle(name:string) {setSelected(previous=>{const next=new Set(previous);next.has(name)?next.delete(name):next.add(name);return next;});}
  async function run(current:Job) {
    setBusy(true);setError('');setComplete(false);setProgress(0);setResults(emptyResult());
    const gathered=emptyResult();
    try {
      for(const chunk of current.chunks) {
        if(!alive.current)return;
        const result=await createPinBulk(chunk);
        gathered.created.push(...result.created);gathered.skipped.push(...result.skipped);
        gathered.promoted=[...(gathered.promoted??[]),...(result.promoted??[])];
        if(!alive.current)return;
        setResults({created:[...gathered.created],skipped:[...gathered.skipped],promoted:[...(gathered.promoted??[])]});
        setProgress(previous=>previous+chunk.entries.length);
      }
      setComplete(true);await onCreated();await load();
    }catch(error){if(alive.current)setError(error instanceof Error?error.message:'Proses massal terhenti. Klik Lanjutkan untuk mencoba kembali.');}
    finally{if(alive.current)setBusy(false);}
  }
  async function start() {
    setError('');
    if(group==='admin'&&chosen.length>maxAdmins-adminCount){setError(`Tersedia ${Math.max(0,maxAdmins-adminCount)} slot admin. Kurangi guru yang dipilih.`);return;}
    const entries=chosen.map(row=>({name:row.name,role:group==='admin'?'admin' as const:row.role}));
    if(!entries.length){setError('Pilih minimal satu akun baru.');return;}
    const chunks:PinBulkChunk[]=[];
    for(let index=0;index<entries.length;index+=chunkSize)chunks.push({operationId:crypto.randomUUID(),mode:group==='admin'?'admin':'staff',entries:entries.slice(index,index+chunkSize)});
    const planned={chunks,total:entries.length};
    try {sessionStorage.setItem(pendingKey,JSON.stringify(planned));}catch{/* PIN values are never stored in browser storage. */}
    setJob(planned);await run(planned);
  }
  function clear() {try{sessionStorage.removeItem(pendingKey);}catch{}setJob(null);setResults(emptyResult());setComplete(false);setProgress(0);setError('');}
  async function download() {
    setExporting(true);setError('');
    try {await downloadPinBulkExcel(results.created);}catch{setError('Unduhan Excel belum berhasil. Coba unduh kembali.');}finally{setExporting(false);}
  }
  return <section aria-label="Pembuatan akun massal" className="space-y-4 rounded-xl border border-emerald-200 bg-white p-4 sm:p-5">
    <div><h3 className="flex items-center gap-2 text-lg font-bold"><Users size={20} className="text-emerald-700"/>Buat akun massal</h3><p className="mt-1 text-sm text-slate-600">PIN acak 8 digit dibuat otomatis dan berbeda untuk setiap akun baru. Akun lama tetap memakai PIN yang sama.</p></div>
    {!job?<>
      <label className="block text-sm font-semibold">Daftar akun<select value={group} disabled={loading} onChange={event=>chooseGroup(event.target.value as typeof group)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"><option value="staff">Semua guru & wali kelas</option><option value="guru">Guru</option><option value="wali_kelas">Wali kelas</option><option value="admin">Administrator</option></select></label>
      {group==='admin'&&<p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">Pilih admin dari data guru. Akun guru yang sudah ada memakai PIN dan link yang sama, lalu masuk ulang untuk mengaktifkan peran admin. Akun baru mendapat PIN otomatis.</p>}
      {loading?<p role="status" className="text-sm text-slate-500">Memuat master penugasan…</p>:<>
        <label className="block text-sm font-semibold">Cari guru<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Ketik nama guru" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"/></label>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{chosen.length} dipilih · {group==='admin'?`${Math.max(0,maxAdmins-adminCount)} slot admin tersedia`: `${candidates.filter(row=>(group==='staff'||row.role===group)&&row.exists).length} sudah memiliki akun`}</span>{group!=='admin'&&<button type="button" onClick={()=>setSelected(new Set(visible.filter(eligible).map(row=>row.name)))} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">Pilih semua akun baru</button>}</div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-3">Pilih</th><th className="p-3">Nama & penugasan</th><th className="p-3">Peran saat ini</th></tr></thead><tbody>{visible.map(row=><tr key={row.name} className="border-t border-slate-100"><td className="p-3 align-top"><input type="checkbox" aria-label={'Pilih '+row.name} checked={eligible(row)&&selected.has(row.name)} disabled={!eligible(row)} onChange={()=>toggle(row.name)} className="h-4 w-4 accent-emerald-700"/></td><td className="p-3"><p className="font-semibold">{row.name}</p><p className="mt-1 text-sm text-slate-500">{row.accountRole==='admin'?'Sudah menjadi admin':row.exists?(group==='admin'?'Akun aktif · PIN dipertahankan':'Akun sudah ada'):row.classNames.join(', ')}</p></td><td className="p-3 align-top whitespace-nowrap">{roles[row.accountRole??row.role]}</td></tr>)}</tbody></table>{!visible.length&&<p className="p-4 text-sm text-slate-500">Nama guru tidak ditemukan.</p>}</div>
      </>}
      <button type="button" disabled={loading||busy||!chosen.length} onClick={start} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50"><Play size={18}/>{group==='admin'?'Tetapkan admin terpilih':'Buat akun & PIN massal'}</button>
    </>:<>
      <div className="rounded-lg bg-emerald-50 p-4"><p className="flex items-center gap-2 font-semibold text-emerald-950">{busy?<Loader2 size={18} className="animate-spin"/>:complete?<CheckCircle2 size={18}/>:<Users size={18}/>} {busy?'Memproses akun':complete?'Proses selesai':'Proses massal tersimpan'}</p><p className="mt-2 text-sm text-emerald-900">{progress} dari {job.total} akun diproses · {results.created.length} dibuat · {results.promoted?.length??0} ditetapkan sebagai admin · {results.skipped.length} dilewati</p><progress className="mt-3 h-2 w-full accent-emerald-700" value={progress} max={job.total}/></div>
      {!busy&&!complete&&<button type="button" onClick={()=>run(job)} className="rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white">Lanjutkan proses</button>}
      {results.created.length>0&&<div className="flex flex-wrap items-center gap-3"><button type="button" disabled={exporting} onClick={download} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white">{exporting?<Loader2 size={18} className="animate-spin"/>:<Download size={18}/>}Unduh Excel akun & PIN</button><p className="text-sm text-slate-600">Berisi nama, peran, kelas, mapel, PIN, dan link masuk.</p></div>}
      {results.created.length>0&&<div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-3">Nama</th><th className="p-3">Peran</th><th className="p-3">PIN</th></tr></thead><tbody>{results.created.map(row=><tr key={row.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{row.name}</td><td className="p-3">{roles[row.role]}</td><td className="p-3 tracking-widest" aria-label="PIN tersedia di Excel">••••••••</td></tr>)}</tbody></table></div>}
      {!!results.promoted?.length&&<div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><p className="font-semibold">Admin ditetapkan dari akun guru</p><p className="mt-1">{results.promoted.map(row=>row.name).join(', ')}</p><p className="mt-2">PIN dan link tetap sama. Minta guru masuk ulang. Setiap orang dapat mengganti PIN melalui Ubah PIN saya.</p></div>}
      {!busy&&<button type="button" onClick={clear} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold">{complete?'Tutup hasil & mulai baru':'Tutup proses ini'}</button>}
    </>}
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  </section>;
}
