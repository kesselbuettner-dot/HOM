'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hom-provider-payments-'));
process.env.HAUSKOSTEN_DATA=dir;
process.env.HOST='127.0.0.1';
delete process.env.HOM_PASSWORD_HASH;
const {server}=require('../server');
test('HTTP: Internetvertrag, monatliche Anbieter-Abschläge, Erhöhung und Sicherung',async t=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 async function req(endpoint,method='GET',data){
  const res=await fetch(base+endpoint,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  const mime=res.headers.get('content-type')||'';
  return {status:res.status,value:mime.includes('application/json')?await res.json():await res.text()};
 }
 let x=await req('/api/households','POST',{name:'EG',area_m2:80,occupants:2});assert.equal(x.status,201);
 const internet={kind:'internet',provider:'Telekom Festnetz',valid_from:'2026-01-01',
   unit_price_eur:'0',base_month_eur:'39.95',billing_frequency:'monthly',
   contract_start:'2026-01-01',contract_end:'2027-12-31',
   cancellation_deadline:'2027-11-30',reminder_days:60};
 x=await req('/api/tariffs','POST',internet);assert.equal(x.status,201);
 const tariffId=x.value.id;
 x=await req('/api/tariffs');assert.equal(x.value.find(t=>t.id===tariffId).billing_frequency,'monthly');
 x=await req('/api/provider-installments','POST',{tariff_id:tariffId,
   amount_eur:'39.95',day_of_month:31,valid_from:'2026-01-01'});assert.equal(x.status,201);
 x=await req('/api/provider-installments','POST',{tariff_id:tariffId,
   amount_eur:'44.95',day_of_month:31,valid_from:'2026-07-01'});assert.equal(x.status,201);
 x=await req('/api/provider_installments');assert.equal(x.value.length,2);
 assert.equal(x.value.find(r=>r.valid_from==='2026-01-01').valid_until,'2026-06-30');
 x=await req('/api/provider-installments','POST',{tariff_id:tariffId,
   amount_eur:'49.95',day_of_month:31,valid_from:'2026-08-01'});assert.equal(x.status,201);
 x=await req('/api/provider-installments','POST',{tariff_id:tariffId,
   amount_eur:'49.95',day_of_month:31,valid_from:'2026-08-01'});assert.equal(x.status,400);
 x=await req('/api/provider-installments/preview?year=2026');assert.equal(x.status,200);
 const july=x.value.entries.find(e=>e.tariff_id===tariffId&&e.date==='2026-07-31');
 assert.equal(july.amount_cents,4495);
 x=await req('/api/report?year=2026');assert.equal(x.status,200);
 assert.equal(x.value.totals.cost_cents,12*3995);assert.equal(x.value.totals.paid_cents,0);
 assert.equal(x.value.provider_installment_entries.length,12);
 const sum=6*3995+4495+5*4995;
 assert.equal(x.value.provider_installment_totals.planned_cents,sum);
 x=await req('/api/invoices','POST',{provider:'Telekom Festnetz',invoice_number:'I-001',kind:'internet',
   period_start:'2026-01-01',period_end:'2026-01-31',amount_eur:'39.95',distribution:'area',common_key:'area'});
 assert.equal(x.status,201);
 x=await req('/api/report?year=2026');assert.equal(x.value.totals.cost_cents,12*3995);
 assert.equal(x.value.totals.paid_cents,0);
 const b=await fetch(base+'/api/backup');assert.equal(b.status,200);const backup=await b.json();
 assert.equal(backup.tables.provider_installments.length,3);
 assert.equal(backup.tables.tariffs[0].kind,'internet');
 assert.equal(backup.tables.tariffs[0].recurring_cost_mode,'fixed_monthly');
 // Restore darf frühere Backups ohne die neue Tabelle weiterhin einlesen.
 delete backup.tables.provider_installments;
 x=await req('/api/restore','POST',{...backup,confirm:'RESTORE'});assert.equal(x.status,200);
 x=await req('/api/provider_installments');assert.equal(x.value.length,0);
});
