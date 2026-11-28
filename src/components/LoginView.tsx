import React, { useEffect, useState } from 'react';
import type { AuthUser, JenjangUnit } from '../types';
import { loginWithPin, type LoginLinkPreview } from '../services/raportApi';
import { usesSharedBackend, ownerAccessUrl } from '../services/hosting';
import { loginReturnPath } from '../utils/loginLink';
import { SchoolLogo } from './SchoolLogo';
import { ShieldCheck, BookOpen, GraduationCap, Loader2 } from 'lucide-react';
import { GoogleAdminLogin } from './GoogleAdminLogin';

interface LoginViewProps {
  onLoginSuccess: (user: AuthUser, unit: JenjangUnit) => void;
  personalLink?: LoginLinkPreview | null;
  linkToken?: string | null;
  pinSlug?: string | null;
  accountMismatch?: boolean;
  inactiveLink?: boolean;
  errorMessage?: string;
  noticeMessage?: string;
}
export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, personalLink, linkToken, pinSlug, accountMismatch, inactiveLink, errorMessage, noticeMessage }) => {
  const [name,setName]=useState(personalLink?.name??'');
  const [pin,setPin]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [googleResult]=useState(()=>new URLSearchParams(window.location.search).get('google'));
  const [loginMode,setLoginMode]=useState<'pin'|'google'>(()=>usesSharedBackend&&new URLSearchParams(window.location.search).has('google')?'google':'pin');
  const usePin=Boolean(pinSlug)||!linkToken;
  const showGoogleChoice=usesSharedBackend&&!personalLink&&!pinSlug&&!linkToken&&!inactiveLink;
  useEffect(()=>{if(googleResult){const url=new URL(window.location.href);url.searchParams.delete('google');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}},[googleResult]);
  useEffect(()=>{setName(personalLink?.name??'');setPin('');setError('');},[personalLink?.name,pinSlug]);
  async function submit(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try {
      const user=await loginWithPin(name,pin,pinSlug??undefined);
      setPin('');onLoginSuccess(user,user.availableUnits?.[0]??'SMP');
    } catch(error) {setError(error instanceof Error?error.message:'Gagal masuk. Silakan coba kembali.');}
    finally {setBusy(false);}
  }
  const roleLabel=personalLink?.role==='admin'?'Administrator':personalLink?.role==='wali_kelas'?'Wali kelas':'Guru';
  return <main className="min-h-dvh bg-emerald-50 flex items-center justify-center px-5 py-10">
    <section className="w-full max-w-lg rounded-3xl border border-emerald-200 bg-white p-7 sm:p-10 shadow-xl shadow-emerald-950/5 text-center">
      <SchoolLogo size={72} className="mx-auto mb-5" />
      <p className="text-sm font-semibold tracking-widest uppercase text-emerald-700">Pondok Modern Al-Ghozali</p>
      <h1 className="text-3xl font-bold text-slate-900 mt-3">{personalLink?'Selamat datang':'Raport Integrasi'}</h1>
      {personalLink?<div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xl font-bold text-emerald-950 break-words">{personalLink.name}</p><p className="mt-2 text-sm font-medium text-emerald-800">{roleLabel}{personalLink.role!=='admin'?' · Sesuai penugasan':''}</p></div>:<p className="text-base text-slate-600 leading-relaxed mt-4">{showGoogleChoice?'Pilih akses sesuai peran Anda.':'Masuk menggunakan nama akun dan PIN Anda.'}</p>}
      {showGoogleChoice&&<div aria-label="Pilihan akses" className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">{([{id:'pin',label:'Guru & admin'},{id:'google',label:'Super admin'}] as const).map(mode=><button key={mode.id} type="button" aria-pressed={loginMode===mode.id} onClick={()=>{setLoginMode(mode.id);setError('');}} className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${loginMode===mode.id?'bg-white text-emerald-900 shadow-sm':'text-stone-600 hover:text-emerald-900'}`}>{mode.label}</button>)}</div>}
      {noticeMessage&&<p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{noticeMessage}</p>}
      {(error||errorMessage)&&<p role="alert" className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error||errorMessage}</p>}
      {showGoogleChoice&&loginMode==='google'?<GoogleAdminLogin result={googleResult}/>:inactiveLink?<a href="/" target="_top" className="mt-6 inline-flex rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white">Buka halaman masuk umum</a>:usePin?<form onSubmit={submit} className="mt-6 space-y-4 text-left">
        {!personalLink&&<label className="block text-sm font-semibold text-slate-700">Nama<input required autoComplete="username" value={name} maxLength={200} onChange={event=>setName(event.target.value)} placeholder="Nama yang ditetapkan admin" className="mt-1.5 block w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"/></label>}
        <label className="block text-sm font-semibold text-slate-700">PIN<input required type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={pin} onChange={event=>setPin(event.target.value)} placeholder="Masukkan PIN" className="mt-1.5 block w-full rounded-xl border border-slate-300 px-4 py-3 text-base tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500"/></label>
        <button disabled={busy} type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 py-3.5 text-base font-semibold text-white hover:bg-emerald-900 disabled:opacity-60">{busy?<Loader2 size={20} className="animate-spin"/>:<ShieldCheck size={20}/>}Masuk</button>
        <p className="text-center text-sm text-slate-500">Lupa PIN? Hubungi administrator sekolah.</p>
      </form>:<><a href={usesSharedBackend?ownerAccessUrl+'#akses='+(linkToken??''):(accountMismatch?'/signout-with-chatgpt?return_to=':'/signin-with-chatgpt?return_to=')+encodeURIComponent(loginReturnPath(linkToken??null))} target="_top" className="mt-7 flex justify-center items-center gap-2 rounded-xl bg-emerald-800 text-white px-5 py-3.5 font-semibold text-base"><ShieldCheck size={20}/>{accountMismatch?'Ganti akun ChatGPT':'Masuk dengan ChatGPT'}</a><p className="mt-4 text-sm text-slate-600">Gunakan email ChatGPT yang ditetapkan admin untuk link ini.</p></>}
      {usePin&&<details className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600"><summary className="cursor-pointer">Akses pemilik dengan ChatGPT</summary><a href={usesSharedBackend?ownerAccessUrl:'/signin-with-chatgpt?return_to=%2F'} target="_top" className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 font-semibold text-emerald-800"><ShieldCheck size={18}/>{usesSharedBackend?'Buka akses pemilik di Sites':'Masuk dengan ChatGPT'}</a>{usesSharedBackend&&<p className="mt-2 text-sm">Guru dan admin tambahan masuk di sini memakai nama dan PIN yang sama dengan Sites.</p>}</details>}
      <div className="grid grid-cols-3 gap-3 border-t border-slate-200 mt-6 pt-5 text-sm text-slate-700"><div><BookOpen className="mx-auto mb-2 text-emerald-700" size={21}/>Input Nilai</div><div><GraduationCap className="mx-auto mb-2 text-emerald-700" size={21}/>Rekap Kelas</div><div><ShieldCheck className="mx-auto mb-2 text-emerald-700" size={21}/>Akses Terbatas</div></div>
    </section>
  </main>;
};
