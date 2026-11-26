import { INITIAL_CLASSES } from '../src/data/initialData';
import { getSubjectsForClass } from '../src/data/curriculumSubjects';
import { findTeachersForSubjectAndClass, normalizeTeacherName } from '../src/data/teacherSubjectsDatabase';
import { DAFTAR_WALI_KELAS } from '../src/data/waliKelasDatabase';
import { getJenjangForClass } from '../src/utils/authHelpers';
import type { AuthUser, JenjangUnit, UserRole } from '../src/types';

export interface AccountIdentity {
  name: string;
  role: UserRole;
}

const units: JenjangUnit[] = ['SMP', 'SMA', 'TMMIA'];
const classList = INITIAL_CLASSES.filter((item) => item.id !== 'all');
export const classes = new Map(classList.map((item) => [item.id, item]));
let assignments: Map<string, Map<string, Set<string>>> | undefined;

function getAssignments() {
  if (assignments) return assignments;
  assignments = new Map();
  for (const item of classList) {
    const subjects = new Map<string, Set<string>>();
    for (const subject of getSubjectsForClass(item.id)) {
      const names = findTeachersForSubjectAndClass(subject.nameId, item.id);
      subjects.set(subject.id, new Set(names.map(normalizeTeacherName).filter(Boolean)));
    }
    assignments.set(item.id, subjects);
  }
  return assignments;
}

export function permissions({ name, role }: AccountIdentity) {
  const normalized = normalizeTeacherName(name);
  const homeroom = role === 'wali_kelas' ? DAFTAR_WALI_KELAS.find((entry) =>
    normalized && normalizeTeacherName(entry.waliName) === normalized &&
    Boolean(entry.classId && classes.has(entry.classId))
  ) : undefined;
  const assignedClassIdsByUnit: Record<JenjangUnit, string[]> = { SMP: [], SMA: [], TMMIA: [] };
  const subjectIdsByClass = new Map<string, Set<string>>();
  if (role !== 'admin' && normalized) {
    for (const [classId, subjects] of getAssignments()) {
      const subjectIds = new Set([...subjects].filter(([, names]) => names.has(normalized)).map(([id]) => id));
      if (subjectIds.size || homeroom?.classId === classId) {
        subjectIdsByClass.set(classId, subjectIds);
        assignedClassIdsByUnit[getJenjangForClass(classes.get(classId))].push(classId);
        assignedClassIdsByUnit.TMMIA.push(classId);
      }
    }
  }
  const editableSubjectsByClass = Object.fromEntries([...subjectIdsByClass].map(([classId, subjects]) => [
    classId, homeroom?.classId === classId ? [...(getAssignments().get(classId)?.keys() || [])] : [...subjects],
  ]));
  const user: AuthUser = {
    name, role, assignedClassIdsByUnit, editableSubjectsByClass,
    availableUnits: role === 'admin' ? units : units.filter((unit) => assignedClassIdsByUnit[unit].length),
    assignedClassIds: [...subjectIdsByClass.keys()],
    homeroomClassId: homeroom?.classId,
    homeroomClassName: homeroom?.className,
  };
  return {
    user,
    canRead: (classId: string) => role === 'admin' || subjectIdsByClass.has(classId),
    canReadFull: (classId: string) => role === 'admin' || homeroom?.classId === classId,
    canScore: (classId: string, subjectId: string) =>
      role === 'admin' || Boolean(editableSubjectsByClass[classId]?.includes(subjectId)),
  };
}
