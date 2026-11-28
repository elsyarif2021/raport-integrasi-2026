import type { AuthUser, StudentRecord, PinBulkCandidate, PinBulkResult, UserRole } from '../types';

export type StudentChange =
  | { kind: 'score'; id: string; subjectId: string; value: number }
  | { kind: 'attitude'; id: string; value: string }
  | { kind: 'identity'; id: string; name?: string; nisn?: string }
  | { kind: 'upsert'; student: Pick<StudentRecord, 'id' | 'classId' | 'name' | 'nisn' | 'scores' | 'keterangan'> }
  | { kind: 'delete'; id: string };

export class RaportApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(action: string, data?: unknown): Promise<T> {
  const response = await fetch('/api/raport?action=' + action, {
    cache: 'no-store',
    ...(data === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  });
  const result = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok || !result) throw new RaportApiError(result?.error || 'Layanan rapor belum tersedia.', response.status);
  return result as T;
}

export async function getSession() {
  return (await request<{ user: AuthUser | null }>('session')).user;
}
export const logout = async (method?: AuthUser['loginMethod']) => {
  const returnTo = window.location.pathname + window.location.hash;
  const result=await request<{loginMethod:AuthUser['loginMethod']}>('logout',{});
  window.top!.location.href = ['pin','google'].includes(method ?? result.loginMethod ?? '')
    ? new URL(returnTo,window.location.origin).href
    : new URL('/signout-with-chatgpt?return_to=' + encodeURIComponent(returnTo), window.location.origin).href;
};

export interface SchoolMember { email: string; name: string; role: 'admin' | 'guru' | 'wali_kelas'; hasLoginLink?: boolean }
export interface LoginLinkPreview { name: string; role: 'guru' | 'wali_kelas' | 'admin' }
export interface PinAccount { id:string; name:string; role:SchoolMember['role']; slug:string; path:string; isSelf?:boolean }
export const getPinAccounts=()=>request<{accounts:PinAccount[];adminCount:number;maxAdmins:number}>('pin-accounts');
export const savePinAccount=(account:{id?:string;name:string;role:SchoolMember['role'];resetPin?:boolean})=>request<{account:PinAccount;pin?:string}>('pin-accounts',account);
export const changeOwnPin=(oldPin:string,newPin:string,confirmPin:string)=>request<{ok:true}>('pin-change',{oldPin,newPin,confirmPin});
export const revokePinAccount=(id:string)=>request('pin-accounts',{id,revoke:true});
export const getPinBulkCandidates=()=>request<{candidates:PinBulkCandidate[];chunkSize:number}>('pin-bulk-candidates');
export interface PinBulkChunk { operationId:string; mode:'staff'|'admin'; entries:Array<{name:string;role:UserRole}> }
export const createPinBulk=(chunk:PinBulkChunk)=>request<PinBulkResult>('pin-bulk-create',chunk);
export const previewPinLink=(slug:string)=>request<LoginLinkPreview>('pin-preview',{slug});
export const getPinLinkedSession=async(slug:string)=>(await request<{user:AuthUser}>('pin-link-session',{slug})).user;
export const loginWithPin=async(name:string,pin:string,slug?:string)=>(await request<{user:AuthUser}>('pin-login',{name,pin,...(slug?{slug}:{})})).user;
export const createLoginLink = (email: string) => request<LoginLinkPreview & { path: string }>('login-links', { email });
export const revokeLoginLink = (email: string) => request('login-links', { email, revoke: true });
export const previewLoginLink = (token: string) => request<LoginLinkPreview>('login-link-preview', { token });
export const getLinkedSession = async (token: string) => (await request<{ user: AuthUser }>('login-link-session', { token })).user;
export const getMembers = () => request<{ members: SchoolMember[]; ownerEmail: string }>('members');
export const saveMember = (member: SchoolMember) => request('members', member);
export const revokeMember = (email: string) => request('members', { email, revoke: true });
export async function getStudents() {
  return (await request<{ students: StudentRecord[] }>('students')).students;
}
export const saveChanges = (changes: StudentChange[]) => request('save', { changes });

export async function importLegacyZip(file: File): Promise<{ imported: number; skipped: number }> {
  const response = await fetch('/api/raport?action=import-zip', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  });
  const result = await response.json().catch(() => null) as { error?: string; imported: number; skipped: number } | null;
  if (!response.ok || !result) throw new Error(result?.error || 'Impor ZIP gagal.');
  return result;
}
