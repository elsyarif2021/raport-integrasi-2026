import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissions, classes } from '../server/access';
import { ALL_TEACHER_ASSIGNMENTS } from '../src/data/teacherSubjectsDatabase';
import { DAFTAR_WALI_KELAS } from '../src/data/waliKelasDatabase';
import { canManageClass, getWorkspaceClasses, selectWorkspaceClasses } from '../src/utils/workspaceAccess';
import type { AuthUser } from '../src/types';

const allClasses=[...classes.values()];
const waliEntry=DAFTAR_WALI_KELAS.find(entry=>{
  const access=permissions({name:entry.waliName,role:'wali_kelas'});
  return access.user.homeroomClassIds?.length && access.user.assignedClassIds?.some(id=>!access.canReadFull(id));
})!;
const wali=permissions({name:waliEntry.waliName,role:'wali_kelas'}).user;
const taughtOnly=wali.assignedClassIds!.find(id=>!wali.homeroomClassIds!.includes(id))!;

test('homeroom menus contain only classes being guided; grading also includes teaching assignments',()=>{
  assert.ok(getWorkspaceClasses(wali,'guru',allClasses).some(item=>item.id===taughtOnly));
  for(const view of ['raport','rekap','sikap']) {
    assert.deepEqual(getWorkspaceClasses(wali,view,allClasses).map(item=>item.id),wali.homeroomClassIds);
    const selection=selectWorkspaceClasses(wali,view,allClasses,{schoolType:'fullday',jenjang:'SMA',classId:taughtOnly});
    assert.ok(wali.homeroomClassIds!.includes(selection.selectedClassId));
    assert.equal(selection.schoolType,classes.get(selection.selectedClassId)!.schoolType ?? 'mukim');
  }
  assert.equal(canManageClass(wali,taughtOnly),false);
  assert.equal(canManageClass(wali,wali.homeroomClassIds![0]),true);
});

test('teacher gets assigned classes only and resolves an unavailable saved program',()=>{
  const name=[...new Set(ALL_TEACHER_ASSIGNMENTS.map(entry=>entry.teacherName))].find(name=>{
    const ids=permissions({name,role:'guru'}).user.assignedClassIds;
    return ids?.length && ids.every(id=>classes.get(id)!.schoolType==='fullday');
  })!;
  const user=permissions({name,role:'guru'}).user;
  const selection=selectWorkspaceClasses(user,'guru',allClasses,{schoolType:'mukim',jenjang:'SMA',classId:'1a'});
  assert.equal(selection.schoolType,'fullday');
  assert.deepEqual(selection.availableSchoolTypes,['fullday']);
  assert.ok(user.assignedClassIds!.includes(selection.selectedClassId));
  assert.deepEqual(getWorkspaceClasses(user,'guru',allClasses).map(item=>item.id),user.assignedClassIds);
  assert.deepEqual(getWorkspaceClasses(user,'raport',allClasses),[]);
});

test('homeroom matching uses explicit class IDs and supports multiple homeroom assignments',()=>{
  const user:AuthUser={...wali,homeroomClassIds:['1a','4c'],homeroomClassId:'1a',homeroomClassName:'1'};
  assert.deepEqual(getWorkspaceClasses(user,'rekap',allClasses).map(item=>item.id),['1a','4c']);
  assert.equal(canManageClass(user,'1b'),false);
  assert.deepEqual(getWorkspaceClasses(null,'rekap',allClasses),[]);
  const unassigned:AuthUser={role:'guru',name:'Belum ditugaskan',assignedClassIds:[]};
  assert.equal(selectWorkspaceClasses(unassigned,'guru',allClasses,{schoolType:'mukim',jenjang:'SMP',classId:'1a'}).selectedClassId,'');
  const admin:AuthUser={role:'admin',name:'Admin'};
  assert.equal(getWorkspaceClasses(admin,'rekap',allClasses).length,allClasses.length);
});
