'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseMoney,splitCents}=require('../src/money');
const {readingAt,consumption,standingOrderEntries,contractAlerts,allocInvoice,yearReport,forecast}=require('../src/calc');
const hh=[{id:1,name:'EG',area_m2:50,occupants:2,active:1},{id:2,name:'OG',area_m2:100,occupants:3,active:1}];
test('Euro centgenau einlesen',()=>{assert.equal(parseMoney('12,34'),1234);assert.equal(parseMoney('0.01'),1);assert.throws(()=>parseMoney('1.234'));});
test('Restcent werden deterministisch verteilt',()=>{assert.deepEqual(splitCents(100,[[1,1],[2,1],[3,1]]),{'1':34,'2':33,'3':33});assert.equal(Object.values(splitCents(12345,[[1,2],[2,3],[3,5]])).reduce((a,b)=>a+b),12345);});
test('Ablesungen werden interpoliert, nicht extrapoliert',()=>{const r=[{date:'2026-01-01',value_milli:10000},{date:'2026-01-11',value_milli:30000}];assert.equal(readingAt(r,'2026-01-06'),20000);assert.equal(consumption(r,'2026-01-01','2026-01-11'),20000);assert.equal(readingAt(r,'2026-02-01'),null);});
test('Haupt- und Unterzähler mit Gemeinschaftsverbrauch verteilen',()=>{
 const meters=[{id:1,name:'Haupt',kind:'strom',unit:'kWh',role:'main',active:1,multiplier:1},{id:2,name:'EG',kind:'strom',role:'sub',household_id:1,active:1,multiplier:1},{id:3,name:'OG',kind:'strom',role:'sub',household_id:2,active:1,multiplier:1}];
 const readings=[{meter_id:1,date:'2026-01-01',value_milli:0},{meter_id:1,date:'2026-12-31',value_milli:100000},{meter_id:2,date:'2026-01-01',value_milli:0},{meter_id:2,date:'2026-12-31',value_milli:30000},{meter_id:3,date:'2026-01-01',value_milli:0},{meter_id:3,date:'2026-12-31',value_milli:50000}];
 const i={id:1,amount_cents:12000,kind:'strom',period_start:'2026-01-01',period_end:'2026-12-31',distribution:'meter',common_key:'area',household_id:null};
 const result=allocInvoice(i,hh,meters,readings);assert.equal(Object.values(result.shares).reduce((a,b)=>a+b),12000);
 assert.equal(result.shares[1],4400);assert.equal(result.shares[2],7600);
 assert.match(result.notes[0],/Gemeinschaftsverbrauch/);
});
test('Unvollständige Zählerstände erzeugen Fehler, keine erfundenen Werte',()=>{const i={id:1,amount_cents:3000,kind:'strom',period_start:'2026-01-01',period_end:'2026-12-31',distribution:'meter'};assert.throws(()=>allocInvoice(i,hh,[{id:2,name:'EG',kind:'strom',role:'sub',household_id:1,active:1}],[{meter_id:2,date:'2026-01-01',value_milli:0}]),/fehlen/);});
test('Jahresbericht: Kosten = Summe Haushalte; positive Salden als Nachzahlung',()=>{
 const result=yearReport(2026,{households:hh,meters:[],readings:[],invoices:[{id:1,provider:'A',kind:'strom',period_start:'2026-01-01',period_end:'2026-12-31',amount_cents:10001,distribution:'area',household_id:null}],payments:[{id:1,household_id:1,date:'2026-06-01',amount_cents:2000}]});
 assert.equal(result.totals.cost_cents,10001);assert.equal(result.totals.paid_cents,2000);assert.equal(result.totals.balance_cents,8001);assert.equal(result.households.reduce((s,h)=>s+h.cost_cents,0),10001);assert.equal(result.households.reduce((s,h)=>s+h.balance_cents,0),8001);
});
test('Eine nicht abrechenbare Rechnung wird ausdrücklich gemeldet',()=>{const r=yearReport(2026,{households:hh,meters:[],readings:[],payments:[],invoices:[{id:1,provider:'X',kind:'wasser',period_start:'2026-01-01',period_end:'2026-12-31',amount_cents:5000,distribution:'meter'}]});assert.equal(r.totals.cost_cents,0);assert(r.warnings.length>=1);});
test('Prognose mit Szenarien und wiederholbaren Annahmen',()=>{const r={year:2026,totals:{cost_cents:100000},households:[{id:1,name:'EG',cost_cents:60000}]};const result=forecast(r,{priceGrowth:3,consumptionGrowth:1});assert.equal(result.scenarios.length,3);assert.equal(result.scenarios[0].years.length,10);assert(result.scenarios[0].years[4].total_cents<result.scenarios[2].years[4].total_cents);});

test('Gas: m³ werden mit faktischen Tarifwerten nach kWh umgerechnet, Kosten werden nicht doppelt berechnet',()=>{
 const meters=[{id:10,name:'Gas Haupt',kind:'gas',unit:'m³',role:'main',active:1,multiplier:1},
  {id:11,name:'Gas EG',kind:'gas',unit:'m³',role:'sub',household_id:1,active:1,multiplier:1},
  {id:12,name:'Gas OG',kind:'gas',unit:'m³',role:'sub',household_id:2,active:1,multiplier:1}];
 const readings=[{meter_id:10,date:'2026-01-01',value_milli:0},{meter_id:10,date:'2026-12-31',value_milli:100000},
 {meter_id:11,date:'2026-01-01',value_milli:0},{meter_id:11,date:'2026-12-31',value_milli:30000},
 {meter_id:12,date:'2026-01-01',value_milli:0},{meter_id:12,date:'2026-12-31',value_milli:50000}];
 const inv={id:9,provider:'Gasversorger',kind:'gas',amount_cents:10640,period_start:'2026-01-01',period_end:'2026-12-31',
  distribution:'meter',common_key:'area',gas_calorific_kwh_m3:11.2,gas_condition_factor:0.95};
 const result=allocInvoice(inv,hh,meters,readings);
 assert.equal(result.gas.total_volume_m3,100);
 assert.equal(result.gas.total_energy_kwh,1064);
 assert.equal(result.gas.households[0].volume_m3,36.667);
 assert.equal(Object.values(result.shares).reduce((a,b)=>a+b),10640);
 assert.equal(result.shares[1],3907);
 assert.equal(result.shares[2],6733);
 const report=yearReport(2026,{households:hh,meters,readings,invoices:[inv],payments:[],standing_orders:[]});
 assert.equal(report.invoices[0].gas.total_energy_kwh,1064);
 assert.equal(report.totals.cost_cents,10640);
 assert.throws(()=>allocInvoice(inv,hh,meters.map(m=>({...m,unit:'kWh'})),readings),/m³/);
});
test('Daueraufträge: Monatsbeträge historisiert, Folgemonate, manueller Abschlag ersetzt geplanten',()=>{
 const schedules=[
  {id:1,household_id:1,amount_cents:10000,day_of_month:5,valid_from:'2025-01-01',valid_until:'2025-06-30'},
  {id:2,household_id:1,amount_cents:13000,day_of_month:5,valid_from:'2025-07-01',valid_until:null}
 ];
 const manual=[{id:20,household_id:1,date:'2025-08-06',amount_cents:14000,note:'Kontobestätigt'}];
 const entries=standingOrderEntries(schedules,manual,2025,{today:'2025-12-31'});
 assert.equal(entries.length,11);
 assert.equal(entries.find(x=>x.date==='2025-06-05').amount_cents,10000);
 assert.equal(entries.find(x=>x.date==='2025-07-05').amount_cents,13000);
 assert.equal(entries.some(x=>x.date==='2025-08-05'),false);
 const report=yearReport(2025,{households:hh,meters:[],readings:[],invoices:[],payments:manual,standing_orders:schedules},'2025-12-31');
 assert.equal(report.households[0].paid_cents,6*10000+5*13000+14000);
 assert.equal(report.households[1].paid_cents,0);
 assert.equal(report.assumptions.length,1);
 const partial=standingOrderEntries(schedules,[],2025,{today:'2025-07-04'});
 assert.equal(partial.length,6);
});
test('Daueraufträge: Abbuchung am 31. auf Monatsende begrenzen; spätere Jahre nicht vorzeitig bezahlen',()=>{
 const schedules=[{id:1,household_id:1,amount_cents:5000,day_of_month:31,valid_from:'2024-01-01'}];
 const entries=standingOrderEntries(schedules,[],2024,{today:'2024-02-29'});
 assert.deepEqual(entries.map(x=>x.date),['2024-01-31','2024-02-29']);
 assert.equal(standingOrderEntries(schedules,[],2027,{today:'2026-11-14'}).length,0);
});
test('Kündigungserinnerungen: Vorlauf, überfällige Termine und erledigte Verträge',()=>{
 const t=[{provider:'Gas A',cancellation_deadline:'2026-11-20',reminder_days:42,cancellation_done:0},
  {provider:'Strom B',cancellation_deadline:'2026-10-20',reminder_days:30,cancellation_done:0},
  {provider:'Erledigt',cancellation_deadline:'2026-11-20',reminder_days:42,cancellation_done:1},
  {provider:'Später',cancellation_deadline:'2027-07-20',reminder_days:42,cancellation_done:0}];
 const alerts=contractAlerts(t,'2026-11-14');
 assert.deepEqual(alerts.map(t=>t.provider),['Strom B','Gas A']);
 assert.equal(alerts[0].days_left,-25);
 assert.equal(alerts[1].days_left,6);
});
