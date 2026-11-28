import type { AuthUser, ClassItem, JenjangUnit, SchoolType } from '../types';
import { getJenjangForClass } from './authHelpers';

export function getHomeroomClassIds(user: AuthUser | null): string[] {
  if (user?.role !== 'wali_kelas') return [];
  return user.homeroomClassIds ?? (user.homeroomClassId ? [user.homeroomClassId] : []);
}

export function canManageClass(user: AuthUser | null, classId: string): boolean {
  return user?.role === 'admin' || getHomeroomClassIds(user).includes(classId);
}

export function getWorkspaceClasses(user: AuthUser | null, view: string, classes: ClassItem[]): ClassItem[] {
  if (!user) return [];
  const realClasses = classes.filter(item => item.id !== 'all');
  if (user.role === 'admin') return realClasses;
  const allowed = view === 'guru'
    ? user.assignedClassIds ?? []
    : ['raport', 'rekap', 'sikap'].includes(view) ? getHomeroomClassIds(user) : [];
  return realClasses.filter(item => allowed.includes(item.id));
}

/** Resolve the visible selection before rendering so switching features cannot show a stale class. */
export function selectWorkspaceClasses(user: AuthUser | null, view: string, classes: ClassItem[], preferred: {
  schoolType: SchoolType; jenjang: JenjangUnit; classId: string;
}) {
  const scopedClasses = getWorkspaceClasses(user, view, classes);
  const programs: SchoolType[] = ['mukim', 'fullday'];
  const availableSchoolTypes = programs.filter(type => scopedClasses.some(item => (item.schoolType ?? 'mukim') === type));
  const schoolType = availableSchoolTypes.includes(preferred.schoolType) ? preferred.schoolType : availableSchoolTypes[0] ?? preferred.schoolType;
  const programClasses = scopedClasses.filter(item => (item.schoolType ?? 'mukim') === schoolType);
  const units: JenjangUnit[] = ['SMP', 'SMA', 'TMMIA'];
  const availableUnits = units.filter(unit => programClasses.some(item => unit === 'TMMIA' || getJenjangForClass(item) === unit));
  const activeJenjang = availableUnits.includes(preferred.jenjang) ? preferred.jenjang : availableUnits[0] ?? preferred.jenjang;
  const filteredClasses = programClasses.filter(item => activeJenjang === 'TMMIA' || getJenjangForClass(item) === activeJenjang);
  const allowAll = user?.role === 'admin' && ['master', 'rekap'].includes(view);
  const selectedClassId = preferred.classId === 'all' && allowAll ? 'all'
    : filteredClasses.find(item => item.id === preferred.classId)?.id ?? filteredClasses[0]?.id ?? '';
  return { scopedClasses, availableSchoolTypes, availableUnits, schoolType, activeJenjang, filteredClasses, selectedClassId };
}
