import React, { useEffect, useId, useRef, useState } from 'react';
import type { CalculatedStudent, ClassItem, SchoolConfig, AuthUser, JenjangUnit } from '../types';
import { Printer, Download, Loader2, ChevronDown, PenTool } from 'lucide-react';

interface SidebarControlsProps {
  students:CalculatedStudent[]; classes?:ClassItem[]; selectedClassId?:string;
  onSelectClassId?:(classId:string)=>void; selectedIndex:number; onSelectIndex:(index:number)=>void;
  rangeStart:number; rangeEnd:number; onChangeRangeStart:(value:number)=>void; onChangeRangeEnd:(value:number)=>void;
  onPrintSingle:()=>void; onPrintBatch:()=>void; onDownloadPdf:()=>void; isExportingPdf?:boolean;
  onOpenRekap:()=>void; onOpenSettings:()=>void; onOpenDesignModal?:()=>void; onEditStudent:(student:CalculatedStudent)=>void;
  config?:SchoolConfig; currentUser?:AuthUser|null; activeJenjang?:JenjangUnit; onSelectJenjang?:(unit:JenjangUnit)=>void;
  isEditingMode?:boolean; onToggleEditingMode?:()=>void;
}

export const SidebarControls:React.FC<SidebarControlsProps> = ({students,classes=[],selectedClassId,onSelectClassId,selectedIndex,onSelectIndex,rangeStart,rangeEnd,onChangeRangeStart,onChangeRangeEnd,onPrintSingle,onPrintBatch,onDownloadPdf,isExportingPdf=false,currentUser,isEditingMode=false,onToggleEditingMode}) => {
  const id=useId();
  const batchMenu=useRef<HTMLDetailsElement>(null);
  const [batchScope,setBatchScope]=useState<'all'|'range'>('all');
  const currentStudent=students[selectedIndex];
  const isAdmin=currentUser?.role==='admin';
  const safeStart=Math.max(1,Math.min(rangeStart||1,students.length||1));
  const safeEnd=Math.max(safeStart,Math.min(rangeEnd||safeStart,students.length||1));
  const batchCount=batchScope==='all'?students.length:students.length?safeEnd-safeStart+1:0;
  const selectClass='w-full min-w-0 appearance-none rounded-lg border border-stone-300 bg-white py-2.5 pl-3 pr-9 text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600';
  const chevron=<ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-500"/>;
  useEffect(()=>{
    const closeOutside=(event:PointerEvent)=>{if(batchMenu.current&&!batchMenu.current.contains(event.target as Node))batchMenu.current.open=false;};
    const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&batchMenu.current)batchMenu.current.open=false;};
    document.addEventListener('pointerdown',closeOutside);document.addEventListener('keydown',closeOnEscape);
    return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeOnEscape);};
  },[]);
  useEffect(()=>{if(batchMenu.current)batchMenu.current.open=false;},[selectedClassId,selectedIndex]);
  function openBatch(){
    if(batchMenu.current)batchMenu.current.open=false;
    onChangeRangeStart(batchScope==='all'?1:safeStart);
    onChangeRangeEnd(batchScope==='all'?students.length:safeEnd);
    onPrintBatch();
  }
  return <section aria-label="Pengaturan cetak rapor" className="no-print relative w-full rounded-xl border border-stone-200 bg-white p-4">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
        {classes.length>0&&onSelectClassId&&<div className="min-w-0"><label htmlFor={id+'-class'} className="mb-1.5 block text-sm font-semibold text-stone-700">Kelas</label><div className="relative"><select id={id+'-class'} className={selectClass} value={selectedClassId} onChange={event=>onSelectClassId(event.target.value)}>{classes.map(item=><option key={item.id} value={item.id}>{item.nameLatin}</option>)}</select>{chevron}</div></div>}
        <div className="min-w-0"><label htmlFor={id+'-student'} className="mb-1.5 block text-sm font-semibold text-stone-700">Santri <span className="font-normal text-stone-500">({students.length})</span></label><div className="relative"><select id={id+'-student'} aria-label="Santri" className={selectClass} value={students.length?selectedIndex:''} disabled={!students.length} onChange={event=>onSelectIndex(Number(event.target.value))}>{!students.length&&<option value="">Belum ada santri</option>}{students.map((student,index)=><option key={student.id} value={index}>{index+1}. {student.name}</option>)}</select>{chevron}</div></div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button type="button" onClick={onDownloadPdf} disabled={!currentStudent||isExportingPdf} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50">{isExportingPdf?<Loader2 aria-hidden="true" size={18} className="animate-spin"/>:<Download aria-hidden="true" size={18}/>}{isExportingPdf?'Membuat PDF…':'Unduh PDF'}</button>
        <button type="button" onClick={onPrintSingle} disabled={!currentStudent||isExportingPdf} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"><Printer aria-hidden="true" size={18}/>Cetak</button>
        <details ref={batchMenu} className="relative"><summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50">Cetak massal</summary>
          <div className="absolute right-0 top-full z-30 mt-2 w-64 space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-lg">
            <label htmlFor={id+'-scope'} className="block text-sm font-medium text-stone-600">Rapor yang dicetak</label><div className="relative"><select id={id+'-scope'} className={selectClass} value={batchScope} onChange={event=>setBatchScope(event.target.value as 'all'|'range')}><option value="all">Seluruh kelas</option><option value="range">Pilih rentang nomor</option></select>{chevron}</div>
            {batchScope==='range'&&<div className="grid grid-cols-2 gap-3">
              <div><label htmlFor={id+'-start'} className="mb-1.5 block text-sm text-stone-600">Dari nomor</label><div className="relative"><select id={id+'-start'} className={selectClass} value={safeStart} onChange={event=>{const next=Number(event.target.value);onChangeRangeStart(next);if(next>safeEnd)onChangeRangeEnd(next);}}>{students.map((student,index)=><option key={student.id} value={index+1}>{index+1}</option>)}</select>{chevron}</div></div>
              <div><label htmlFor={id+'-end'} className="mb-1.5 block text-sm text-stone-600">Sampai nomor</label><div className="relative"><select id={id+'-end'} className={selectClass} value={safeEnd} onChange={event=>onChangeRangeEnd(Math.max(safeStart,Number(event.target.value)))}>{students.map((student,index)=><option key={student.id} value={index+1} disabled={index+1<safeStart}>{index+1}</option>)}</select>{chevron}</div></div>
            </div>}
            <button type="button" onClick={openBatch} disabled={!batchCount||isExportingPdf} className="w-full rounded-lg bg-emerald-800 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50">Pratinjau {batchCount} rapor</button>
          </div>
        </details>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-stone-500"><span>F4 · satu halaman per santri</span>{isAdmin&&onToggleEditingMode&&<button type="button" onClick={onToggleEditingMode} aria-pressed={isEditingMode} className="flex items-center gap-1.5 rounded px-1 py-1 text-sm text-stone-600 hover:text-emerald-800"><PenTool size={15}/>{isEditingMode?'Selesai mengedit':'Edit tata letak'}</button>}</div>
  </section>;
};
