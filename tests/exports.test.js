'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createXlsx}=require('../src/xlsx');const {linesToPdf}=require('../src/pdf');
test('PDF hat gültigen Header und Abschluss',()=>{const pdf=linesToPdf('Abrechnung 2026',[{text:'Testhaushalt: 100,00 EUR'}]);assert(pdf.subarray(0,8).toString('latin1').startsWith('%PDF-1.4'));assert(pdf.toString('latin1').includes('%%EOF'));});
test('XLSX hat ZIP-Header und Arbeitsblattnamen',()=>{const xlsx=createXlsx({Abrechnung:[['Haushalt','Betrag'],['EG',12.34]],Kosten:[['Art'],['Strom']]});assert.equal(xlsx.subarray(0,4).toString('hex'),'504b0304');assert(xlsx.includes(Buffer.from('xl/workbook.xml')));});
