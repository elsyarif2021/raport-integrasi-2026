import React, { useEffect, useRef, useState } from 'react';
import { Users, PenTool, FileText, FileSpreadsheet, BookOpen, GraduationCap, Settings, Palette, ShieldCheck, LogOut, RotateCcw, Menu, X, ChevronDown, KeyRound } from 'lucide-react';
import type { AuthUser, JenjangUnit, SchoolType } from '../types';
import { SchoolLogo } from './SchoolLogo';

export type WorkspaceView = 'master' | 'guru' | 'raport' | 'rekap' | 'sikap' | 'muatan' | 'databaseGuru' | 'settings' | 'design' | 'accounts' | 'pin';
const features = [
  { id:'master', label:'Data santri', icon:Users, roles:['admin'] },
  { id:'guru', label:'Input nilai', icon:PenTool, roles:['admin','wali_kelas','guru'] },
  { id:'raport', label:'Cetak rapor', icon:FileText, roles:['admin','wali_kelas'] },
  { id:'rekap', label:'Rekap nilai', icon:FileSpreadsheet, roles:['admin','wali_kelas'] },
  { id:'sikap', label:'Penilaian sikap', icon:ShieldCheck, roles:['admin','wali_kelas'] },
  { id:'muatan', label:'Mata pelajaran', icon:BookOpen, roles:['admin'] },
  { id:'databaseGuru', label:'Data guru', icon:GraduationCap, roles:['admin'] },
  { id:'design', label:'Desain rapor', icon:Palette, roles:['admin'] },
  { id:'settings', label:'Pengaturan rapor', icon:Settings, roles:['admin'] },
  { id:'accounts', label:'Akses akun', icon:ShieldCheck, roles:['admin'] },
  { id:'pin', label:'Ubah PIN saya', icon:KeyRound, roles:['admin','wali_kelas','guru'] },
] as const;

interface Props {
  user:AuthUser; activeView:WorkspaceView; onSelectView:(view:WorkspaceView)=>void;
  schoolType:SchoolType; onSelectSchoolType:(type:SchoolType)=>void;
  activeJenjang:JenjangUnit; onSelectJenjang:(unit:JenjangUnit)=>void;
  availableSchoolTypes?:SchoolType[]; availableUnits?:JenjangUnit[];
  academicYear:string; studentCount:number; isSaving?:boolean;
  onReload:()=>void; onLogout:()=>void; hideWhenPrinting?:boolean; children:React.ReactNode;
}

export function AppShell({user,activeView,onSelectView,schoolType,onSelectSchoolType,activeJenjang,onSelectJenjang,availableSchoolTypes,availableUnits,academicYear,studentCount,isSaving,onReload,onLogout,hideWhenPrinting,children}:Props) {
  const [menuOpen,setMenuOpen]=useState(false);
  const workspace=useRef<HTMLElement>(null);
  const visibleFeatures=features.filter(item=>(item.roles as readonly string[]).includes(user.role)&&(item.id!=='pin'||user.loginMethod==='pin'));
  const activeLabel=features.find(item=>item.id===activeView)?.label || 'Raport Pondok';
  const units=availableUnits ?? user.availableUnits ?? ['SMP','SMA','TMMIA'];
  const programs:SchoolType[]=availableSchoolTypes ?? ['mukim','fullday'];
  const roleLabel=user.isSuperAdmin?'Super Admin':user.role==='admin'?'Administrator':user.role==='wali_kelas'?'Wali kelas':'Guru';
  useEffect(()=>{workspace.current?.scrollTo({top:0,left:0});},[activeView]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenuOpen(false);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  function navigate(view:WorkspaceView) {onSelectView(view);setMenuOpen(false);workspace.current?.scrollTo({top:0,left:0});}

  return <div className={`app-shell flex h-dvh min-h-0 overflow-hidden bg-stone-100 text-stone-900 print:block print:h-auto print:overflow-visible ${hideWhenPrinting?'print:hidden':''}`}>
    {menuOpen && <button type="button" aria-label="Tutup menu navigasi" onClick={()=>setMenuOpen(false)} className="no-print fixed inset-0 z-40 bg-stone-950/50 lg:hidden"/>}
    <aside id="app-navigation" aria-label="Menu utama" className={`no-print fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-emerald-950 bg-[#123c2d] text-white transition-transform lg:static lg:translate-x-0 ${menuOpen?'visible translate-x-0':'invisible -translate-x-full lg:visible'}`}>
      <div className="flex h-20 shrink-0 items-center gap-3 border-b border-white/10 px-4"><SchoolLogo size={40}/><div className="min-w-0"><p className="whitespace-nowrap text-base font-bold">Raport Pondok</p><p className="text-sm text-emerald-100/80">Al-Ghozali</p></div><button type="button" onClick={()=>setMenuOpen(false)} aria-label="Tutup menu" className="ml-auto rounded-lg p-2 hover:bg-white/10 lg:hidden"><X size={19}/></button></div>
      <div className="grid shrink-0 grid-cols-[1.3fr_1fr] gap-2 border-b border-white/10 p-4">
        <label className="text-sm text-emerald-100">Program<div className="relative mt-1.5"><select aria-label="Program sekolah" disabled={programs.length < 2} value={schoolType} onChange={event=>onSelectSchoolType(event.target.value as SchoolType)} className="w-full appearance-none rounded-lg border border-white/20 bg-[#1a4b38] py-2 pl-2 pr-7 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-300">{programs.map(type=><option key={type} value={type}>{type==='mukim'?'Mukim':'Full Day'}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"/></div></label>
        <label className="text-sm text-emerald-100">Jenjang<div className="relative mt-1.5"><select aria-label="Jenjang sekolah" disabled={units.length < 2} value={activeJenjang} onChange={event=>onSelectJenjang(event.target.value as JenjangUnit)} className="w-full appearance-none rounded-lg border border-white/20 bg-[#1a4b38] py-2 pl-2 pr-7 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-300">{units.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"/></div></label>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-3"><div className="space-y-1">{visibleFeatures.map(item=>{const Icon=item.icon;return <button type="button" key={item.id} onClick={()=>navigate(item.id)} aria-current={activeView===item.id?'page':undefined} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${activeView===item.id?'bg-white text-emerald-950 shadow-sm':'text-emerald-50/85 hover:bg-white/10 hover:text-white'} ${item.id==='design'?'mt-4 border-t border-white/10':''}`}><Icon aria-hidden="true" size={19}/><span className="flex-1">{item.label}</span>{item.id==='master'&&<span className={`text-sm ${activeView===item.id?'text-emerald-700':'text-emerald-100/70'}`}>{studentCount}</span>}</button>;})}</div></nav>
      <div className="shrink-0 border-t border-white/10 p-4"><p className="truncate text-sm font-semibold">{user.name}</p><p className="mt-0.5 text-sm text-emerald-100/70">{roleLabel}</p><div className="mt-3 flex items-center justify-between gap-2"><button type="button" onClick={onReload} className="flex items-center gap-1.5 rounded-lg py-1.5 text-sm text-emerald-100 hover:text-white"><RotateCcw size={15}/>Muat ulang</button><button type="button" onClick={onLogout} className="flex items-center gap-1.5 rounded-lg py-1.5 text-sm text-emerald-100 hover:text-white"><LogOut size={15}/>Keluar</button></div></div>
    </aside>
    <div className="app-workspace flex min-h-0 min-w-0 flex-1 flex-col print:block print:h-auto print:overflow-visible">
      <header className="no-print flex h-16 shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-white px-4 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button type="button" aria-label="Buka menu utama" aria-controls="app-navigation" aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)} className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium lg:hidden"><Menu size={18}/>Menu</button><h1 className="truncate text-lg font-semibold sm:text-xl">{activeLabel}</h1></div><div className="flex items-center gap-4 text-sm text-stone-500">{isSaving&&<span role="status" className="text-emerald-700">Menyimpan…</span>}<span className="hidden sm:inline">{schoolType==='mukim'?'Mukim':'Full Day'} · {activeJenjang} · {academicYear}</span></div></header>
      <main ref={workspace} className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6 print:block print:overflow-visible print:p-0 print:m-0 print:w-full"><div className="mx-auto w-full max-w-[1440px] print:m-0 print:w-full print:max-w-none">{children}</div></main>
    </div>
  </div>;
}
