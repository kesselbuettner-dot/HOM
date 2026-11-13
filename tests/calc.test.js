'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseMoney,splitCents}=require('../src/money');
const {readingAt,consumption,allocInvoice,yearReport,forecast}=require('../src/calc');
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
