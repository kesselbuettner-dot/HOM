'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hom-gas-contract-'));
process.env.HAUSKOSTEN_DATA=dir;
process.env.HOST='127.0.0.1';
delete process.env.HOM_PASSWORD_HASH;
const {server}=require('../server');

test('API: Gastarif mit Faktoren, Rechnungs-Snapshot, monatliche Daueraufträge und Änderung ab Juli',async t=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{
   await new Promise(resolve=>server.close(resolve));
   fs.rmSync(dir,{recursive:true,force:true});
 });
 const base='http://127.0.0.1:'+server.address().port;
 async function req(uri,method='GET',body){
   const res=await fetch(base+uri,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
   const value=await res.json();
   return {status:res.status,value};
 }
 let x=await req('/api/households','POST',{name:'EG',area_m2:60,occupants:2,active:true});assert.equal(x.status,201);
 const id=x.value.id;
 x=await req('/api/households','POST',{name:'OG',area_m2:100,occupants:3,active:true});const id2=x.value.id;
 const gasTariff={
  kind:'gas',provider:'Gaswerk',valid_from:'2025-01-01',
  unit_price_eur:'0.12',base_month_eur:'9',
  gas_calorific_kwh_m3:11.2,gas_condition_factor:0.95,
  contract_start:'2025-01-01',contract_end:'2025-12-31',
  cancellation_deadline:'2025-11-15',reminder_days:42,cancellation_done:false
 };
 x=await req('/api/tariffs','POST',gasTariff);assert.equal(x.status,201);const tariffId=x.value.id;
 x=await req('/api/tariffs','POST',{...gasTariff,gas_calorific_kwh_m3:''});
 assert.equal(x.status,400);
 // 100 m³ Hauptzähler, davon 30/50 m³ in den Haushalten.
 for(const [code,role,hhid,quantity] of [['HAUPT','main',null,100],['EGGAS','sub',id,30],['OGGAS','sub',id2,50]]){
   x=await req('/api/meters','POST',{code,name:code,kind:'gas',unit:'m³',role,household_id:hhid,multiplier:1,active:true});
   assert.equal(x.status,201);
   const meterId=x.value.id;
   for(const [day,value] of [['2025-01-01',0],['2025-12-31',quantity]]){
     x=await req('/api/readings','POST',{meter_id:meterId,date:day,value,note:''});
     assert.equal(x.status,201);
   }
 }
 x=await req('/api/meters','POST',{code:'BADGAS',name:'BAD',kind:'gas',unit:'kWh',role:'main',multiplier:1,active:true});
 assert.equal(x.status,400);
 x=await req('/api/invoices','POST',{
  provider:'Gaswerk',invoice_number:'GW-2025',kind:'gas',
  amount_eur:'106.40',period_start:'2025-01-01',period_end:'2025-12-31',
  distribution:'meter',common_key:'area',gas_tariff_id:tariffId
 });assert.equal(x.status,201);
 const invoiceId=x.value.id;
 x=await req('/api/invoices');const invoice=x.value.find(i=>i.id===invoiceId);
 assert.equal(invoice.gas_calorific_kwh_m3,11.2);
 assert.equal(invoice.gas_condition_factor,0.95);
 x=await req('/api/report?year=2025');assert.equal(x.status,200);
 assert.equal(x.value.invoices[0].gas.total_volume_m3,100);
 assert.equal(x.value.invoices[0].gas.total_energy_kwh,1064);
 assert.equal(x.value.totals.cost_cents,10640);

 // Nach 6 Monaten wurde der Dauerauftrag von 100 auf 130 Euro erhöht.
 x=await req('/api/standing-orders','POST',{household_id:id,amount_eur:'100.00',
  day_of_month:5,valid_from:'2025-01-01',note:'Alt'});assert.equal(x.status,201);
 x=await req('/api/standing-orders','POST',{household_id:id,amount_eur:'130.00',
  day_of_month:5,valid_from:'2025-07-01',note:'Erhöhung'});assert.equal(x.status,201);
 x=await req('/api/standing_orders');
 assert.equal(x.value.length,2);
 assert.equal(x.value.find(r=>r.valid_from==='2025-01-01').valid_until,'2025-06-30');
 x=await req('/api/report?year=2025');
 assert.equal(x.value.households.find(h=>h.id===id).paid_cents,6*10000+6*13000);
 assert.equal(x.value.standing_order_entries.length,12);
 x=await req('/api/payments','POST',{household_id:id,date:'2025-08-06',amount_eur:'150.00',note:'Bankbeleg'});
 assert.equal(x.status,201);
 x=await req('/api/report?year=2025');
 assert.equal(x.value.households.find(h=>h.id===id).paid_cents,6*10000+5*13000+15000);
 assert.equal(x.value.standing_order_entries.length,11);
 x=await req('/api/standing-orders','POST',{household_id:id,amount_eur:'140.00',
  day_of_month:5,valid_from:'2025-07-01',note:'Duplikat'});
 assert.equal(x.status,400);
 x=await req('/api/backup');assert.equal(x.status,200);
 assert.equal(x.value.tables.standing_orders.length,2);
});
