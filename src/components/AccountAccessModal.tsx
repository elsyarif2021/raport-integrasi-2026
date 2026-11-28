import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, Loader2, Link2, Copy } from 'lucide-react';
import { usesSharedBackend, ownerAccessUrl } from '../services/hosting';
import { PinAccountManager } from './PinAccountManager';
import { getMembers, saveMember, revokeMember, createLoginLink, revokeLoginLink, type SchoolMember } from '../services/raportApi';
import { ALL_TEACHER_ASSIGNMENTS } from '../data/teacherSubjectsDatabase';
import { DAFTAR_WALI_KELAS } from '../data/waliKelasDatabase';

const teacherNames = [...new Set([...ALL_TEACHER_ASSIGNMENTS.map(x=>x.teacherName),...DAFTAR_WALI_KELAS.map(x=>x.waliName)])].filter(Boolean).sort();
const roleLabel = { admin:'Administrator', guru:'Guru', wali_kelas:'Wali Kelas' };
const emptyForm: SchoolMember = {email:'',name:'',role:'guru'};
export function AccountAccessModal({ onClose, embedded = false }: { onClose:()=>void; embedded?:boolean }) {
  const [pinRevision,setPinRevision] = useState(0);
  const [members,setMembers] = useState<SchoolMember[]>([]);
  const [ownerEmail,setOwnerEmail] = useState('');
  const [form,setForm] = useState<SchoolMember>(emptyForm);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const [generatedLink,setGeneratedLink] = useState<{email:string;name:string;url:string}|null>(null);
  const refresh = async()=> {if(usesSharedBackend){setPinRevision(value=>value+1);return;}const data=await getMembers();setMembers(data.members);setOwnerEmail(data.ownerEmail);setPinRevision(value=>value+1);};
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  async function makeLink(member: SchoolMember) {
    const result=await createLoginLink(member.email);
    setGeneratedLink({email:member.email.toLowerCase().trim(),name:result.name,url:new URL(result.path,window.location.origin).href});
  }
  async function submit(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setMessage('');setError('');
    try {
      await saveMember(form);
      if(form.role!=='admin') await makeLink(form);
      else if(generatedLink?.email===form.email.toLowerCase().trim())setGeneratedLink(null);
      await refresh();setForm(emptyForm);
      setMessage(form.role==='admin'?'Akses akun berhasil disimpan.':'Akses tersimpan. Link pribadi siap disalin dan dibagikan kepada guru yang bersangkutan.');
    } catch(e) {setError(e instanceof Error?e.message:'Gagal menyimpan akses.');} finally {setBusy(false);}
  }
  async function generate(member: SchoolMember) {
    setBusy(true);setMessage('');setError('');
    try {await makeLink(member);await refresh();setMessage(member.hasLoginLink?'Link baru siap disalin. Link sebelumnya sudah tidak aktif.':'Link pribadi siap disalin.');}
    catch(e) {setError(e instanceof Error?e.message:'Gagal membuat link.');} finally {setBusy(false);}
  }
  async function disableLink(member: SchoolMember) {
    setBusy(true);setMessage('');setError('');
    try {
      await revokeLoginLink(member.email);
      if(generatedLink?.email===member.email)setGeneratedLink(null);
      await refresh();setMessage('Link pribadi dinonaktifkan. Akses akun tetap mengikuti penugasan admin.');
    } catch(e) {setError(e instanceof Error?e.message:'Gagal menonaktifkan link.');} finally {setBusy(false);}
  }
  async function copyLink() {
    if(!generatedLink)return;
    try {await navigator.clipboard.writeText(generatedLink.url);setMessage('Link masuk berhasil disalin.');}
    catch {setMessage('Pilih dan salin alamat pada kolom link masuk di bawah.');}
  }
  async function revoke(member:SchoolMember) {
    if(!window.confirm('Cabut akses rapor untuk '+member.name+'?'))return;
    setBusy(true);setMessage('');setError('');
    try {
      await revokeMember(member.email);
      if(generatedLink?.email===member.email)setGeneratedLink(null);
      await refresh();setMessage('Akses akun dan link pribadinya sudah dicabut.');
    } catch(e) {setError(e instanceof Error?e.message:'Gagal mencabut akses.');} finally {setBusy(false);}
  }
  return <div className={embedded ? 'w-full no-print' : 'fixed inset-0 z-[100] bg-slate-950/60 flex items-center justify-center p-3 sm:p-6 no-print'}>
    <section role={embedded?'region':'dialog'} aria-modal={embedded?undefined:true} aria-labelledby="account-access-title" className={`w-full bg-white rounded-2xl text-slate-900 ${embedded?'border border-stone-200':'max-w-3xl max-h-[90dvh] overflow-y-auto shadow-2xl'}`}>
      <div className="sticky top-0 bg-white border-b border-slate-200 p-5 flex justify-between items-center z-10"><h2 id="account-access-title" className="font-bold text-xl flex items-center gap-2"><ShieldCheck className="text-emerald-700"/>Ruang Administrator</h2><button onClick={onClose} aria-label="Tutup pengaturan akses" className="p-2 rounded-lg hover:bg-slate-100"><X size={22}/></button></div>
      <div className="p-5 sm:p-6">
        <PinAccountManager revision={pinRevision}/>
        {!usesSharedBackend&&<details className="mt-6 rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-600">Akses melalui akun ChatGPT</summary><div className="mt-4">
        <p className="text-sm text-slate-600 mb-4">Kelola akun pemilik dan akses ChatGPT yang sudah terdaftar.</p>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4 bg-slate-50 rounded-xl border border-slate-200 p-4">
          <label className="text-sm font-semibold">Email ChatGPT<input required type="email" autoComplete="off" maxLength={254} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} className="block mt-1.5 w-full border border-slate-300 rounded-lg px-3 py-2.5 bg-white text-base"/></label>
          <label className="text-sm font-semibold">Peran<select value={form.role} onChange={e=>setForm({...form,role:e.target.value as SchoolMember['role']})} className="block mt-1.5 w-full border border-slate-300 rounded-lg px-3 py-2.5 bg-white text-base"><option value="guru">Guru</option><option value="wali_kelas">Wali Kelas</option><option value="admin">Administrator</option></select></label>
          <label className="text-sm font-semibold sm:col-span-2">Pilih dari data guru<select required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="block mt-1.5 w-full border border-slate-300 rounded-lg px-3 py-2.5 bg-white text-base"><option value="">Pilih nama guru</option>{(form.role==='wali_kelas' ? [...new Set(DAFTAR_WALI_KELAS.map(entry=>entry.waliName))].sort() : teacherNames).map(name=><option key={name} value={name}>{name}</option>)}</select></label>
          <button disabled={busy} className="sm:col-span-2 bg-emerald-800 text-white font-semibold rounded-lg px-4 py-3 hover:bg-emerald-900 disabled:opacity-60 flex justify-center items-center gap-2">{busy?<Loader2 size={18} className="animate-spin"/>:<Link2 size={18}/>} {form.role==='admin'?'Simpan akses':'Simpan & buat link'}</button>
        </form>
        {error&&<p role="alert" className="bg-rose-50 text-rose-800 p-3 rounded-lg mt-4 text-sm">{error}</p>}
        {message&&<p role="status" className="bg-emerald-50 text-emerald-800 p-3 rounded-lg mt-4 text-sm">{message}</p>}
        {generatedLink&&<section aria-label="Link masuk pribadi" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-semibold text-emerald-950">Link masuk untuk {generatedLink.name}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input aria-label={'Link masuk untuk '+generatedLink.name} readOnly value={generatedLink.url} onFocus={event=>event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm"/><button type="button" onClick={copyLink} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white"><Copy size={16}/>Salin link</button></div>
          <p className="mt-3 text-sm text-emerald-800">Guru tetap masuk dengan email ChatGPT yang ditetapkan. Salin link ini sekarang; membuat ulang link akan menonaktifkan link sebelumnya.</p>
        </section>}
        <ul className="mt-5 divide-y divide-slate-200">{members.map(member=><li key={member.email} className="py-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-base">{member.name}</p><p className="text-sm text-slate-600 break-all">{member.email}</p><p className="text-sm text-emerald-700 mt-1">{roleLabel[member.role]}{member.email===ownerEmail?' · Pemilik':''}{member.hasLoginLink?' · Link aktif':''}</p></div>{member.email!==ownerEmail&&<div className="flex flex-wrap gap-2">
          {member.role!=='admin'&&<><button type="button" disabled={busy} onClick={()=>generate(member)} aria-label={(member.hasLoginLink?'Buat ulang link untuk ':'Buat link untuk ')+member.name} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-emerald-300 text-emerald-800 hover:bg-emerald-50"><Link2 size={15}/>{member.hasLoginLink?'Buat ulang link':'Buat link'}</button>{member.hasLoginLink&&<button type="button" disabled={busy} onClick={()=>disableLink(member)} aria-label={'Nonaktifkan link '+member.name} className="px-3 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50">Nonaktifkan link</button>}</>}
          <button type="button" disabled={busy} onClick={()=>setForm(member)} aria-label={'Ubah akses '+member.name} className="px-3 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50">Ubah</button><button type="button" disabled={busy} onClick={()=>revoke(member)} aria-label={'Cabut akses '+member.name} className="px-3 py-2 text-sm rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50">Cabut akses</button>
        </div>}</li>)}</ul>
        </div></details>}
        {usesSharedBackend&&<p className="mt-5 text-sm text-slate-600">Data dan akun terhubung dengan Sites. <a href={ownerAccessUrl} target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 underline">Akses pemilik dengan ChatGPT</a></p>}
      </div>
    </section>
  </div>;
}
