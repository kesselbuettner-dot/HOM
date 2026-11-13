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
function allocInvoice(invoice, households, meters, readings) {
  const active = households.filter(h=>h.active);
  if (invoice.household_id) {
    if (!households.some(h=>h.id===invoice.household_id)) throw new Error('Zugeordneter Haushalt nicht gefunden.');
    return { shares: { [invoice.household_id]: invoice.amount_cents }, notes: [], method: 'direkt' };
  }
  if (!active.length) throw new Error('Keine aktiven Haushalte zum Abrechnen vorhanden.');
  let weights, notes=[];
  if (invoice.distribution === 'meter') {
    const relevant = meters.filter(m => m.kind === invoice.kind && m.active);
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
  } else if (invoice.distribution === 'custom') {
    const custom = JSON.parse(invoice.custom_weights||'{}');
    weights = active.map(h=>[h.id, Number(custom[h.id]||0)]);
  } else {
    weights = commonWeights(active, invoice.distribution);
  }
  if (weights.reduce((s,[,w])=>s+w,0) <= 0) throw new Error('Die Umlage hat keine positiven Gewichte.');
  return { shares:splitCents(invoice.amount_cents,weights), notes, method:invoice.distribution };
}
function yearReport(year, { households, meters, readings, invoices, payments }) {
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
      result.invoices.push({id:inv.id,kind:inv.kind,provider:inv.provider,amount_cents:inv.amount_cents,period_start:inv.period_start,period_end:inv.period_end,shares:al.shares,notes:al.notes});
    } catch(e) {result.warnings.push(`Rechnung #${inv.id} (${inv.provider}): ${e.message}`);}
  }
  for (const p of payments.filter(p=>p.date.slice(0,4)===String(year))) {
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
module.exports={ validDate, readingAt, consumption, commonWeights, allocInvoice, yearReport, forecast };
