import type { AuthUser, StudentRecord } from '../types';

export type StudentChange =
  | { kind: 'score'; id: string; subjectId: string; value: number }
  | { kind: 'attitude'; id: string; value: string }
  | { kind: 'identity'; id: string; name?: string; nisn?: string }
  | { kind: 'upsert'; student: Pick<StudentRecord, 'id' | 'classId' | 'name' | 'nisn' | 'scores' | 'keterangan'> }
  | { kind: 'delete'; id: string };

async function request<T>(action: string, data?: unknown): Promise<T> {
  const response = await fetch('/api/raport?action=' + action, {
    cache: 'no-store',
    ...(data === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Layanan rapor belum tersedia.');
  return result as T;
}

export async function getSession() {
  return (await request<{ user: AuthUser | null }>('session')).user;
}
export async function login(username: string, password: string) {
  return (await request<{ user: AuthUser }>('login', { username, password })).user;
}
export const logout = () => request('logout', {});
export async function getStudents() {
  return (await request<{ students: StudentRecord[] }>('students')).students;
}
export const saveChanges = (changes: StudentChange[]) => request('save', { changes });
