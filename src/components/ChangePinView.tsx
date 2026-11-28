import React, { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { changeOwnPin } from '../services/raportApi';
export function ChangePinView({name,beforeChange,onChanged}:{name:string;beforeChange:()=>Promise<void>;onChanged:()=>void}) {
  const [oldPin,setOldPin]=useState(''),[newPin,setNewPin]=useState(''),[confirmPin,setConfirmPin]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:React.FormEvent) {
    event.preventDefault();setError('');
    if(newPin!==confirmPin){setError('Konfirmasi PIN baru belum sama.');return;}
    if(newPin===oldPin){setError('Gunakan PIN baru yang berbeda dari PIN lama.');return;}
    setBusy(true);
    try{await beforeChange();await changeOwnPin(oldPin,newPin,confirmPin);setOldPin('');setNewPin('');setConfirmPin('');onChanged();}
    catch(error){setError(error instanceof Error?error.message:'PIN belum berhasil diubah.');}finally{setBusy(false);}
  }
  return <section aria-labelledby="change-pin-title" className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
    <h2 id="change-pin-title" className="flex items-center gap-2 text-xl font-bold"><KeyRound className="text-emerald-700"/>Ubah PIN saya</h2>
    <p className="mt-2 break-words font-semibold text-emerald-900">{name}</p>
    <p className="mt-2 text-sm text-slate-600">Gunakan 6–12 digit angka. Setelah PIN berubah, seluruh sesi akun akan keluar dan Anda perlu masuk kembali dengan PIN baru.</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      {([{label:'PIN lama',value:oldPin,set:setOldPin,auto:'current-password'},{label:'PIN baru',value:newPin,set:setNewPin,auto:'new-password'},{label:'Konfirmasi PIN baru',value:confirmPin,set:setConfirmPin,auto:'new-password'}] as const).map(field=><label key={field.label} className="block text-sm font-semibold">{field.label}<input required disabled={busy} type="password" inputMode="numeric" autoComplete={field.auto} pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={field.value} onChange={event=>field.set(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-base tracking-widest"/></label>)}
      {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <button disabled={busy} type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-60">{busy?<Loader2 size={18} className="animate-spin"/>:<KeyRound size={18}/>}Simpan PIN baru & masuk ulang</button>
    </form>
  </section>;
}
