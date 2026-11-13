'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const testDir=fs.mkdtempSync(path.join(os.tmpdir(),'hauskosten-it-'));
process.env.HAUSKOSTEN_DATA=testDir;
const {server}=require('../server');
test('HTTP-API, CRUD, Prognose, PDF, XLSX und Backup',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(url,method='GET',body){const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});let data;if(res.headers.get('Content-Type')?.includes('application/json'))data=await res.json();else data=Buffer.from(await res.arrayBuffer());return {res,data};}
 try{
  let x=await request('/api/households','POST',{name:'Haushalt A',area_m2:50,occupants:2,active:'1'});assert.equal(x.res.status,201);const idA=x.data.id;
  x=await request('/api/households','POST',{name:'Haushalt B',area_m2:100,occupants:3,active:'1'});const idB=x.data.id;
  x=await request(`/api/households/${idA}`,'PATCH',{name:'Haushalt A geändert',area_m2:50,occupants:2,active:'1'});assert.equal(x.res.status,200);
  x=await request('/api/invoices','POST',{provider:'Muster',invoice_number:'A1',kind:'strom',period_start:'2026-01-01',period_end:'2026-12-31',amount_eur:'100.01',distribution:'area',common_key:'area'});assert.equal(x.res.status,201);const inv=x.data.id;
  x=await request('/api/payments','POST',{household_id:idA,date:'2026-06-01',amount_eur:'20.00'});assert.equal(x.res.status,201);
  x=await request('/api/report?year=2026');assert.equal(x.data.totals.cost_cents,10001);assert.equal(x.data.totals.paid_cents,2000);
  assert.equal(x.data.households.reduce((sum,h)=>sum+h.cost_cents,0),10001);
  x=await request('/api/forecast?year=2026&price=4&consumption=1');assert.equal(x.data.scenarios.length,3);
  x=await request(`/api/report.pdf?year=2026&household=${idB}`);assert.equal(x.res.status,200);assert.equal(x.data.subarray(0,5).toString(),'%PDF-');
  x=await request('/api/report.xlsx?year=2026');assert.equal(x.data.subarray(0,2).toString(),'PK');
  x=await request('/api/backup');assert.equal(x.data.format,'hauskosten-backup-v1');
  const backup=x.data;x=await request('/api/restore','POST',{...backup,confirm:'RESTORE'});assert.equal(x.res.status,200);
  x=await request(`/api/households/${idA}`,'DELETE');assert.equal(x.res.status,400); // payment references household
  x=await request(`/api/invoices/${inv}`,'DELETE');assert.equal(x.res.status,200);
  x=await request('/api/report?year=2026');assert.equal(x.data.totals.cost_cents,0);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(testDir,{recursive:true,force:true});}
});
