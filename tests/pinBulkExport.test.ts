import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { pinBulkExportRows, pinBulkWorkbook } from '../src/utils/pinBulkExport';

test('Excel exports keep PIN leading zeros and preserve names and links as text',()=>{
  const rows=[{id:'sample',name:'=Nama Admin Contoh',role:'admin' as const,pin:'00123456',path:'/#masuk=contoh-11111111-1111-4111-8111-111111111111',classNames:['Semua kelas'],subjectNames:['Semua mapel']}];
  const values=pinBulkExportRows(rows,'https://raport.test');
  assert.equal(values[1][5],'00123456');
  assert.equal(values[1][6],'https://raport.test/#masuk=contoh-11111111-1111-4111-8111-111111111111');
  const workbook=pinBulkWorkbook(XLSX,rows,'https://raport.test');
  const restored=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const sheet=restored.Sheets['Akun dan PIN'];
  assert.equal(sheet.F2.t,'s');assert.equal(sheet.F2.v,'00123456');
  assert.equal(sheet.B2.t,'s');assert.equal(sheet.B2.v,'=Nama Admin Contoh');assert.equal(sheet.B2.f,undefined);
  assert.equal(sheet.G2.v,values[1][6]);
});
