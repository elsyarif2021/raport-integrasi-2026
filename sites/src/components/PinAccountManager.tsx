import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, Loader2, Copy, Download } from 'lucide-react';
import { getPinAccounts, getPinBulkCandidates, savePinAccount, revokePinAccount, type PinAccount } from '../services/raportApi';
import type { PinBulkCandidate, PinBulkResult, UserRole } from '../types';
import { PinBulkAccounts } from './PinBulkAccounts';
import { downloadPinBulkExcel } from '../utils/pinBulkExport';
const roles={guru:'Guru',wali_kelas:'Wali kelas',admin:'Administrator'};
interface Form {id?:string;name:string;role:UserRole;resetPin:boolean}
const emptyForm:Form={name:'',role:'guru',resetPin:false};
export function PinAccountManager({revision=0}:{revision?:number}) {
  const [accounts,setAccounts]=useState<PinAccount[]>([]);
  const [candidates,setCandidates]=useState<PinBulkCandidate[]>([]);
  const [adminCount,setAdminCount]=useState(1),[maxAdmins,setMaxAdmins]=useState(10);
  const [form,setForm]=useState<Form>(emptyForm),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const [selectedLink,setSelectedLink]=useState<PinAccount|null>(null);
  const [generated,setGenerated]=useState<PinBulkResult['created']>([]);
  const [mode,setMode]=useState<'bulk'|'single'>('bulk');
  const previousRole=accounts.find(account=>account.id===form.id)?.role;
  const options=candidates.filter(row=>form.role==='admin'||form.role==='guru'||row.role==='wali_kelas');
  async function refresh() {
    const [data,master]=await Promise.all([getPinAccounts(),getPinBulkCandidates()]);
    setAccounts(data.accounts);setAdminCount(data.adminCount);setMaxAdmins(data.maxAdmins);setCandidates(master.candidates);
  }
  useEffect(()=>{refresh().catch(error=>setError(error.message));},[revision]);
  async function submit(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');setMessage('');setGenerated([]);
    try {
      const saved=await savePinAccount(form);
      const detail=candidates.find(row=>row.name===saved.account.name);
      if(saved.pin)setGenerated([{...saved.account,pin:saved.pin,classNames:saved.account.role==='admin'?['Semua kelas']:detail?.classNames??[],subjectNames:saved.account.role==='admin'?['Semua mapel']:detail?.subjectNames??[]}]);
      setSelectedLink(saved.account);await refresh();setForm(emptyForm);
      setMessage(saved.pin?'Akun tersimpan dengan PIN otomatis. Unduh Excel untuk membagikan PIN dan link masuk.':'Peran akun tersimpan. PIN dan link tetap sama. Pemilik akun perlu masuk ulang.');
    }catch(error){setError(error instanceof Error?error.message:'Akun gagal disimpan.');}finally{setBusy(false);}
  }
  async function copy(account:PinAccount) {
    setSelectedLink(account);setError('');
    try{await navigator.clipboard.writeText(new URL(account.path,window.location.origin).href);setMessage('Link '+account.name+' berhasil disalin.');}catch{setMessage('Salin alamat pada kolom link masuk.');}
  }
  async function disable(account:PinAccount) {
    if(!window.confirm('Nonaktifkan akun '+account.name+'? Link dan sesi masuknya juga akan dinonaktifkan.'))return;
    setBusy(true);setError('');setMessage('');
    try{await revokePinAccount(account.id);if(selectedLink?.id===account.id)setSelectedLink(null);if(form.id===account.id)setForm(emptyForm);setGenerated([]);await refresh();setMessage('Akun dan akses masuknya sudah dinonaktifkan.');}
    catch(error){setError(error instanceof Error?error.message:'Gagal menonaktifkan akun.');}finally{setBusy(false);}
  }
  function edit(account:PinAccount){setMode('single');setForm({id:account.id,name:account.name,role:account.role,resetPin:false});setError('');setMessage('');}
  return <section aria-label="Akun nama dan PIN" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-lg font-bold"><KeyRound size={20} className="text-emerald-700"/>Akun nama & PIN</h3><p className="mt-1 text-sm text-slate-600">Semua akun dipilih dari data guru. PIN awal dibuat otomatis oleh aplikasi.</p></div><span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">Admin {adminCount}/{maxAdmins}</span></div>
    <div className="flex gap-2" aria-label="Cara membuat akun">{(['bulk','single'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)} className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${mode===value?'border-emerald-800 bg-emerald-800 text-white':'border-slate-300'}`}>{value==='bulk'?'Buat massal':'Satu akun / ubah peran'}</button>)}</div>
    {mode==='bulk'?<PinBulkAccounts adminCount={adminCount} maxAdmins={maxAdmins} onCreated={refresh}/>:<form onSubmit={submit} className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">Peran akun<select value={form.role} onChange={event=>setForm({...form,role:event.target.value as UserRole,...(!form.id?{name:''}:{})})} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"><option value="guru">Guru</option><option value="wali_kelas">Wali kelas</option><option value="admin" disabled={adminCount>=maxAdmins&&previousRole!=='admin'}>Administrator</option></select></label>
      <label className="text-sm font-semibold">Pilih dari data guru<select required value={form.name} onChange={event=>setForm({...form,name:event.target.value})} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"><option value="">Pilih nama guru</option>{options.map(row=><option key={row.name} value={row.name} disabled={!form.id&&row.exists}>{row.name}{!form.id&&row.exists?' · Akun sudah ada':''}</option>)}</select></label>
      <p className="text-sm text-slate-600 sm:col-span-2">{form.id?'PIN tetap sama saat peran diperbarui. Setiap pemilik akun dapat menggantinya melalui Ubah PIN saya.':'PIN unik 8 digit dibuat otomatis. Unduh Excel setelah akun dibuat.'} Batas {maxAdmins} admin termasuk pemilik.</p>
      {form.id&&<label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.resetPin} onChange={event=>setForm({...form,resetPin:event.target.checked})} className="mt-0.5 h-4 w-4 accent-emerald-700"/><span>Buat ulang PIN otomatis jika pemilik akun lupa. PIN lama dan seluruh sesi masuk akan dinonaktifkan.</span></label>}
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={busy} type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-60">{busy?<Loader2 size={18} className="animate-spin"/>:<Plus size={18}/>} {form.id?'Simpan perubahan':'Buat akun & PIN otomatis'}</button>{form.id&&<button type="button" onClick={()=>setForm(emptyForm)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Batal ubah</button>}</div>
    </form>}
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {message&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {!!generated.length&&<button type="button" onClick={()=>downloadPinBulkExcel(generated).catch(()=>setError('Unduhan Excel belum berhasil. Coba kembali.'))} className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-3 text-sm font-semibold text-white"><Download size={18}/>Unduh Excel PIN otomatis</button>}
    {selectedLink&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-semibold text-emerald-950">Link masuk {selectedLink.name}</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input aria-label={'Link PIN untuk '+selectedLink.name} readOnly value={new URL(selectedLink.path,window.location.origin).href} onFocus={event=>event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm"/><button type="button" onClick={()=>copy(selectedLink)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white"><Copy size={16}/>Salin link masuk</button></div></div>}
    <div className="divide-y divide-slate-200">{accounts.map(account=><div key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="break-words text-base font-semibold">{account.name}{account.isSelf?' (Anda)':''}</p><p className="mt-1 text-sm text-slate-600">{roles[account.role]} · Nama & PIN</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>copy(account)} aria-label={'Salin link '+account.name} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800"><Copy size={15}/>Salin link</button>{account.isSelf?<p className="self-center text-sm text-slate-600">Ganti PIN melalui Ubah PIN saya.</p>:<><button type="button" disabled={busy} onClick={()=>edit(account)} aria-label={'Ubah akun PIN '+account.name} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Ubah</button><button type="button" disabled={busy} onClick={()=>disable(account)} aria-label={'Nonaktifkan akun PIN '+account.name} className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700">Nonaktifkan</button></>}</div></div>)}{!accounts.length&&<p className="py-4 text-sm text-slate-500">Belum ada akun nama dan PIN.</p>}</div>
  </section>;
}
