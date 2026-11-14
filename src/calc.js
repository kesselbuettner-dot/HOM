'use strict';
const { splitCents } = require('./money');

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  return !isNaN(dt.getTime()) && dt.toISOString().slice(0,10) === s;
}
function timestamp(s) { return Date.parse(`${s}T00:00:00Z`); }
/** Ablesung wird auf den gewünschten Tag linear zwischen zwei echten Ablesungen interpoliert. Keine Extrapolation. */
function readingAt(rows, day) {
  if (!validDate(day)) throw new Error('Ungültiges Datum.');
  const ordered = rows.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const exact = ordered.find(r => r.date === day);
  if (exact) return Number(exact.value_milli);
  const prev = ordered.filter(r=>r.date < day).at(-1);
  const next = ordered.find(r=>r.date > day);
  if (!prev || !next) return null;
  const weight = (timestamp(day)-timestamp(prev.date)) / (timestamp(next.date)-timestamp(prev.date));
  return Math.round(Number(prev.value_milli) + (Number(next.value_milli)-Number(prev.value_milli))*weight);
}
function consumption(rows, start, end) {
  const a = readingAt(rows, start), b = readingAt(rows, end);
  return a === null || b === null ? null : b - a;
}
function commonWeights(households, method) {
  return households.map(h=>[h.id,
    method === 'area' ? Number(h.area_m2) : method === 'persons' ? Number(h.occupants) : 1]);
}
function dateMs(day){return Date.parse(day+'T00:00:00Z');}
function monthEnd(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate();}
function standingOrderEntries(orders,manualPayments,year,{today=new Date().toISOString().slice(0,10),dueOnly=true}={}){
  const entries=[];
  const recordedMonths=new Set(manualPayments.map(p=>p.household_id+':'+p.date.slice(0,7)));
  for(const rule of orders||[]){
    for(let month=1;month<=12;month++){
      const ym=year+'-'+String(month).padStart(2,'0');
      if(ym<rule.valid_from.slice(0,7)||rule.valid_until&&ym>rule.valid_until.slice(0,7))continue;
      const date=ym+'-'+String(Math.min(Number(rule.day_of_month),monthEnd(year,month))).padStart(2,'0');
      if(dueOnly&&date>today)continue;
      // Manually posted payment in the same month takes precedence; no double counting.
      if(recordedMonths.has(rule.household_id+':'+ym))continue;
      entries.push({household_id:rule.household_id,date,amount_cents:Number(rule.amount_cents),
        note:rule.note||'Monatlicher Dauerauftrag (planmäßig, nicht bankbestätigt)',standing_order_id:rule.id,source:'standing_order'});
    }
  }
  entries.sort((a,b)=>a.date.localeCompare(b.date)||a.household_id-b.household_id);
  return entries;
}
/** Monatliche Auszahlungen an Versorger sind nur ein Zahlungsplan.
 * Sie werden NICHT erneut als Hauskosten/Haushaltsabschläge abgerechnet. */
function providerInstallmentEntries(orders,tariffs,year,{today=new Date().toISOString().slice(0,10),dueOnly=true}={}){
  const byId=new Map((tariffs||[]).map(t=>[Number(t.id),t]));
  const rows=[];
  for(const rule of orders||[]){
    const tariff=byId.get(Number(rule.tariff_id));
    if(!tariff)continue;
    for(let month=1;month<=12;month++){
      const ym=year+'-'+String(month).padStart(2,'0');
      if(ym<rule.valid_from.slice(0,7)||(rule.valid_until&&ym>rule.valid_until.slice(0,7)))continue;
      const date=ym+'-'+String(Math.min(Number(rule.day_of_month),monthEnd(year,month))).padStart(2,'0');
      if(dueOnly&&date>today)continue;
      rows.push({tariff_id:rule.tariff_id,provider:tariff.provider,kind:tariff.kind,
        date,amount_cents:Number(rule.amount_cents),provider_installment_id:rule.id,
        note:rule.note||'',source:'provider_installment',confirmed:false});
    }
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.tariff_id-b.tariff_id);
  return rows;
}
function contractAlerts(tariffs,today=new Date().toISOString().slice(0,10)){
  return (tariffs||[]).filter(t=>t.cancellation_deadline&&!t.cancellation_done)
    .map(t=>({...t,days_left:Math.round((dateMs(t.cancellation_deadline)-dateMs(today))/86400000)}))
    .filter(t=>t.days_left<=Number(t.reminder_days??42))
    .sort((a,b)=>a.days_left-b.days_left);
}
function allocInvoice(invoice, households, meters, readings) {
  const active = households.filter(h=>h.active);
  if (invoice.household_id) {
    if (!households.some(h=>h.id===invoice.household_id)) throw new Error('Zugeordneter Haushalt nicht gefunden.');
    return { shares: { [invoice.household_id]: invoice.amount_cents }, notes: [], method: 'direkt' };
  }
  if (!active.length) throw new Error('Keine aktiven Haushalte zum Abrechnen vorhanden.');
  let weights, notes=[],gasDetails=null;
  if (invoice.distribution === 'meter') {
    const relevant = meters.filter(m => m.kind === invoice.kind && m.active);
    if(invoice.kind==='gas'&&invoice.gas_calorific_kwh_m3&&invoice.gas_condition_factor&&relevant.some(m=>m.unit!=='m³')) {
      throw new Error('Gas-Abrechnung mit Umrechnung erfordert m³ als Einheit für alle beteiligten Gaszähler.');
    }
    const privateMeters = relevant.filter(m=>m.household_id && m.role==='sub');
    const mainMeters = relevant.filter(m=>m.role==='main');
    const amounts = Object.fromEntries(active.map(h=>[h.id,0]));
    for (const m of privateMeters) {
      const r = consumption(readings.filter(x=>x.meter_id===m.id),invoice.period_start,invoice.period_end);
      if (r === null) throw new Error(`Ablesewerte fehlen für Unterzähler „${m.name}“ an den Periodengrenzen (oder zur Interpolation davor und danach).`);
      if (r < 0) throw new Error(`Zählerstand rückläufig: ${m.name}. Zählerwechsel separat berücksichtigen.`);
      if (amounts[m.household_id] !== undefined) amounts[m.household_id] += r * Number(m.multiplier||1);
    }
    const privateTotal = Object.values(amounts).reduce((a,b)=>a+b,0);
    if (!privateMeters.length) throw new Error(`Für ${invoice.kind} sind keine Haushalts-Unterzähler angelegt.`);
    if (mainMeters.length > 1) throw new Error(`Für ${invoice.kind} existieren mehrere Hauptzähler; bitte Abrechnung aufteilen.`);
    if (mainMeters.length===1) {
      const master = mainMeters[0];
      const mainValue = consumption(readings.filter(x=>x.meter_id===master.id),invoice.period_start,invoice.period_end);
      if (mainValue === null) throw new Error(`Ablesewerte fehlen für Hauptzähler „${master.name}“.`);
      const total = mainValue * Number(master.multiplier||1);
      if (total < privateTotal - 0.000001) throw new Error('Summe der Unterzähler ist größer als Hauptzählerverbrauch.');
      const residual = Math.max(0, total-privateTotal);
      if (residual > 0) {
        const common = commonWeights(active,invoice.common_key||'area');
        const sum = common.reduce((s,[,w])=>s+w,0);
        if (sum <= 0) throw new Error('Gemeinschaftsverbrauch kann nicht verteilt werden (fehlende Flächen/Personen).');
        for (const [id,w] of common) amounts[id] += residual * w/sum;
        notes.push(`Gemeinschaftsverbrauch: ${(residual/1000).toFixed(3)} ${master.unit}, nach ${invoice.common_key==='persons'?'Personen':invoice.common_key==='equal'?'gleichen Anteilen':'Wohnfläche'} verteilt.`);
      }
    } else {
      notes.push('Kein Hauptzähler hinterlegt; Verteilung ausschließlich anhand der erfassten Unterzähler.');
    }
    weights = active.map(h=>[h.id,amounts[h.id]]);
    if(invoice.kind==='gas'){
      const calorific=Number(invoice.gas_calorific_kwh_m3),condition=Number(invoice.gas_condition_factor);
      if(calorific>0&&condition>0){
        const gas={calorific_kwh_m3:calorific,condition_factor:condition,
          total_volume_m3:0,total_energy_kwh:0,households:[]};
        for(const [householdId,valueMilli] of weights){
          const volume_m3=Number((valueMilli/1000).toFixed(3));
          const energy_kwh=Number((volume_m3*calorific*condition).toFixed(3));
          gas.households.push({id:householdId,volume_m3,energy_kwh});
          gas.total_volume_m3+=volume_m3;
          gas.total_energy_kwh+=energy_kwh;
        }
        gas.total_volume_m3=Number(gas.total_volume_m3.toFixed(3));
        gas.total_energy_kwh=Number(gas.total_energy_kwh.toFixed(3));
        notes.push('Gasumrechnung: '+gas.total_volume_m3.toFixed(3)+' m³ × '+calorific+' kWh/m³ × '+condition+
          ' = '+gas.total_energy_kwh.toFixed(3)+' kWh (Rechnungsfaktoren).');
        gasDetails=gas;
      }else{
        notes.push('Gas in m³ verteilt; Brennwert/Zustandszahl fehlen. Keine kWh-Umrechnung für diese Rechnung.');
      }
    }
  } else if (invoice.distribution === 'custom') {
    const custom = JSON.parse(invoice.custom_weights||'{}');
    weights = active.map(h=>[h.id, Number(custom[h.id]||0)]);
  } else {
    weights = commonWeights(active, invoice.distribution);
  }
  if (weights.reduce((s,[,w])=>s+w,0) <= 0) throw new Error('Die Umlage hat keine positiven Gewichte.');
  return { shares:splitCents(invoice.amount_cents,weights), notes, method:invoice.distribution,gas:gasDetails };
}
function yearReport(year, { households, meters, readings, invoices, payments, standing_orders=[], tariffs=[], provider_installments=[] },today=new Date().toISOString().slice(0,10)) {
  const hh = households.filter(h=>h.active || invoices.some(i=>i.household_id===h.id) || payments.some(p=>p.household_id===h.id));
  const result = { year, households:hh.map(h=>({id:h.id,name:h.name,area_m2:h.area_m2,occupants:h.occupants,cost_cents:0,paid_cents:0,balance_cents:0,by_kind:{}})), invoices:[], warnings:[], totals:{cost_cents:0,paid_cents:0,balance_cents:0}, kinds:{} };
  for (const inv of invoices.filter(i=>i.period_end.slice(0,4)===String(year))) {
    try {
      const al=allocInvoice(inv,households,meters,readings);
      for (const h of result.households) {
        const amount=al.shares[h.id]||0;
        h.cost_cents+=amount; h.by_kind[inv.kind]=(h.by_kind[inv.kind]||0)+amount;
      }
      result.totals.cost_cents+=inv.amount_cents;
      result.kinds[inv.kind]=(result.kinds[inv.kind]||0)+inv.amount_cents;
      result.invoices.push({id:inv.id,kind:inv.kind,provider:inv.provider,amount_cents:inv.amount_cents,period_start:inv.period_start,period_end:inv.period_end,shares:al.shares,notes:al.notes,gas:al.gas||null});
    } catch(e) {result.warnings.push(`Rechnung #${inv.id} (${inv.provider}): ${e.message}`);}
  }
  const providerRecurring=providerInstallmentEntries(provider_installments,tariffs,year,{today,dueOnly:false});
  result.provider_installment_entries=providerRecurring;
  result.provider_installment_totals={planned_cents:providerRecurring.reduce((sum,row)=>sum+row.amount_cents,0)};
  const recurring=standingOrderEntries(standing_orders,payments,year,{today});
  result.standing_order_entries=recurring;
  result.assumptions=recurring.length?['Monatliche Daueraufträge werden bis zum Fälligkeitstag als planmäßig bezahlt angenommen; keine Bankbestätigung vorhanden. Manuelle Abschläge im selben Monat haben Vorrang.']:[];
  for (const p of [...payments,...recurring].filter(p=>p.date.slice(0,4)===String(year))) {
    const h=result.households.find(h=>h.id===p.household_id);
    if(h) {h.paid_cents+=p.amount_cents; result.totals.paid_cents+=p.amount_cents;}
  }
  result.households.forEach(h=>h.balance_cents=h.cost_cents-h.paid_cents);
  result.totals.balance_cents=result.totals.cost_cents-result.totals.paid_cents;
  if (result.warnings.length) result.warnings.unshift('Nicht zugeordnete Rechnungen sind in der Kostensumme nicht enthalten. Abrechnung ist unvollständig.');
  return result;
}
function forecast(report, { priceGrowth = 3, consumptionGrowth = 0 } = {}) {
  const pg=Number(priceGrowth)/100, cg=Number(consumptionGrowth)/100;
  if (![pg,cg].every(Number.isFinite) || pg < -0.5 || pg > 1 || cg < -0.5 || cg > 1) throw new Error('Prognoseannahmen müssen zwischen -50 % und +100 % liegen.');
  const scenarios=[{name:'Optimistisch',offset:-2},{name:'Basis',offset:0},{name:'Pessimistisch',offset:3}];
  return { baseYear:report.year, assumptions:{priceGrowth,consumptionGrowth}, scenarios:scenarios.map(sc=>({ name:sc.name, years:Array.from({length:10},(_,i)=>{
    const n=i+1;
    const factor=(1+Math.max(-.9,pg+sc.offset/100))**n*(1+cg)**n;
    return {year:report.year+n,total_cents:Math.round(report.totals.cost_cents*factor),households:report.households.map(h=>({id:h.id,name:h.name,cost_cents:Math.round(h.cost_cents*factor)}))};
  }) }))};
}
module.exports={ validDate, readingAt, consumption, commonWeights, standingOrderEntries, providerInstallmentEntries, contractAlerts, allocInvoice, yearReport, forecast };
