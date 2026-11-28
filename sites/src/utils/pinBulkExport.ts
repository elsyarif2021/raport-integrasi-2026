import type { PinBulkResult } from '../types';
import type * as SheetJS from 'xlsx';
const labels={guru:'Guru',wali_kelas:'Wali Kelas',admin:'Administrator'};
export function pinBulkExportRows(rows:PinBulkResult['created'],origin:string) {
  return [['No','Nama','Peran','Kelas','Mata Pelajaran','PIN','Link Masuk'],...rows.map((row,index)=>[
    String(index+1),row.name,labels[row.role],row.classNames.join(', '),row.subjectNames.join(', '),row.pin,new URL(row.path,origin).href,
  ])];
}
export function pinBulkWorkbook(XLSX:typeof SheetJS,rows:PinBulkResult['created'],origin:string) {
  const sheet=XLSX.utils.aoa_to_sheet(pinBulkExportRows(rows,origin));
  sheet['!cols']=[{wch:6},{wch:38},{wch:18},{wch:50},{wch:50},{wch:14},{wch:70}];
  sheet['!autofilter']={ref:`A1:G${rows.length+1}`};
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet,'Akun dan PIN');
  return workbook;
}
export async function downloadPinBulkExcel(rows:PinBulkResult['created']) {
  const XLSX=await import('xlsx');
  const workbook=pinBulkWorkbook(XLSX,rows,window.location.origin);
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta'}).format(new Date());
  XLSX.writeFile(workbook,`Akun-dan-PIN-${day}.xlsx`);
}
