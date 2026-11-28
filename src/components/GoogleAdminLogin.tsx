import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';

export const googleMessages: Record<string, string> = {
  registered: 'Pendaftaran super admin berhasil. Sekarang pilih Masuk dengan Google.',
  not_registered: 'Akun ini belum terdaftar. Pilih Daftar super admin terlebih dahulu.',
  cancelled: 'Login Google dibatalkan. Anda dapat mencoba kembali.',
  denied: 'Login belum berhasil. Gunakan email Google pemilik yang diizinkan dan mulai kembali.',
  restart: 'Mulai kembali dari halaman masuk ini.',
  unavailable: 'Login Google belum tersedia. Silakan coba lagi setelah pengaturan selesai.',
};
export function GoogleAdminLogin({ result }: { result: string | null }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/google?action=status', { cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? response.json() as Promise<{configured?:boolean}> : null)
      .then(value => setConfigured(value?.configured === true))
      .catch(() => { if (!controller.signal.aborted) setConfigured(false); });
    return () => controller.abort();
  }, []);
  return <div className="mt-6 space-y-4 text-left">
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <h2 className="flex items-center gap-2 font-bold text-emerald-950"><ShieldCheck size={20}/>Akses super admin</h2>
      <p className="mt-2 text-sm leading-relaxed text-emerald-900">Daftar sekali dengan email Google pemilik yang diizinkan. Setelah terdaftar, masuk dengan akun Google yang sama.</p>
    </div>
    {result && googleMessages[result] && <p role={result === 'registered' ? 'status' : 'alert'} className={`rounded-xl p-4 text-sm ${result === 'registered' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>{googleMessages[result]}</p>}
    {configured === null ? <p role="status" className="flex items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={17} className="animate-spin"/>Memeriksa login Google…</p>
      : configured === false && <p role="status" className="rounded-xl bg-stone-100 p-4 text-sm text-stone-700">Login Google belum diaktifkan oleh pengelola aplikasi. Akses Sites tetap tersedia di bawah.</p>}
    <button type="button" disabled={!configured} onClick={() => { window.location.href = '/api/google?action=start&intent=login'; }} className="flex w-full items-center justify-center gap-3 rounded-xl bg-emerald-800 px-5 py-3.5 font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"><span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded bg-white font-bold text-emerald-800">G</span>Masuk dengan Google</button>
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-slate-600"><span>Belum terdaftar?</span><button type="button" disabled={!configured} onClick={() => { window.location.href = '/api/google?action=start&intent=register'; }} className="rounded px-1 py-2 font-semibold text-emerald-800 underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50">Daftar super admin</button></div>
  </div>;
}
