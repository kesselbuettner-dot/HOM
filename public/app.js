'use strict';
const $=id=>document.getElementById(id);
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&quot;'}[c]));
const currency=c=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format((c||0)/100);
const number=n=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:3}).format(n||0);
const dateDE=s=>s?new Date(`${s}T12:00:00`).toLocaleDateString('de-DE'):'–';
const moneyInput=n=>((n||0)/100).toFixed(2);
const kinds={strom:'Strom',gas:'Gas',wasser:'Wasser',abwasser:'Abwasser',heizung:'Heizung',warmwasser:'Warmwasser',muell:'Müll',versicherung:'Versicherung',grundsteuer:'Grundsteuer',internet:'Internet & Telefon',sonstiges:'Sonstige Kosten'};
const methods={meter:'Nach Unterzählern',area:'Wohnfläche',persons:'Personen',equal:'Gleichmäßig',custom:'Individuelle Gewichte'};
const labels={dashboard:'Übersicht',households:'Haushalte',meters:'Zähler & Stände',tariffs:'Tarife',invoices:'Rechnungen',payments:'Abschläge',report:'Jahresabrechnung',forecast:'Kostenprognose',backup:'Datensicherung',users:'Benutzerverwaltung',settings:'Hauseinstellungen',profile:'Mein Konto'};
const KindsOptions=Object.entries(kinds).map(([value,label])=>({value,label}));
let db={households:[],meters:[],readings:[],tariffs:[],invoices:[],payments:[],standing_orders:[],provider_installments:[]},report=null;
let account=null, houseTitle='Villa Kunterbunt', users=[];
let view='dashboard', year=new Date().getFullYear(), modalType='', editingID=null, forecastResult=null, timer;
const root=$('content');
function notify(message,error=false){const toast=$('toast');toast.textContent=message;toast.style.background=error?'#a34242':'#14343e';toast.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('show'),5000);}
async function api(url,options={}) { const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}}); if(!r.ok){let msg;try{msg=(await r.json()).error;}catch{msg=r.statusText;}throw new Error(msg||'Unbekannter Serverfehler.');}return r.json();}
function isAdmin(){return account?.role==='admin';}
function updateHouseShell(){
  $('headerHouseTitle').textContent=houseTitle;
  $('brandHouseTitle').textContent=houseTitle;
  $('accountName').textContent=account?.display_name||'';
  $('navUsers').hidden=!isAdmin();
  $('navSettings').hidden=!isAdmin();
  document.title=houseTitle+' · Hauskosten-Manager';
}
async function loadUsers(){const response=await api('/api/users');users=response.users;}
async function refresh(){try{const [data,result,session]=await Promise.all([api('/api/state'),api(`/api/report?year=${year}`),api('/api/auth/me')]);db=data;report=result;account=session.user;houseTitle=session.house_title||'Villa Kunterbunt';if(view==='users'&&isAdmin())await loadUsers();updateHouseShell();render();}catch(err){notify(err.message,true);root.innerHTML=`<div class="notice error">${E(err.message)}</div>`;}}
function go(name){if((name==='users'||name==='settings')&&!isAdmin()){notify('Nur Administratoren.',true);return;}view=name;document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));$('crumbLabel').textContent=labels[name];$('sidebar').classList.remove('open');if(name==='users')loadUsers().then(render).catch(e=>notify(e.message,true));else render();window.scrollTo({top:0,behavior:'instant'});}
function page(title,subtitle,actions=''){return `<div class="page-head"><div><div class="eyebrow">${E(houseTitle)} · ${year}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></div>`;}
function addButton(type,label='Neuer Eintrag'){return `<button class="btn primary" data-add="${type}">＋ ${E(label)}</button>`;}
function empty(icon,title,detail,button=''){return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${detail}</p>${button}</div>`;}
function table(head,rows,none){return rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr>${head.map(h=>`<th>${E(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:(none||empty('◇','Noch keine Einträge','Mit „Neuer Eintrag“ beginnen.'));}
function tr(cells){return `<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`;}
function badge(label,kind=''){return `<span class="pill ${kind}">${E(label)}</span>`;}
function editBtn(type,id){return `<button class="btn secondary small" data-edit="${type}" data-id="${id}">Bearbeiten</button>`;}
function delBtn(type,id){return `<button class="btn danger small" data-del="${type}" data-id="${id}" title="Diesen Eintrag löschen">Löschen</button>`;}
function topStats(){const m=report.totals;return `<div class="stat-grid">
  ${[["Abgerechnete Kosten",currency(m.cost_cents),'▤',`Rechnungen im Jahr ${year}`],["Erhaltene Abschläge",currency(m.paid_cents),'◎','Gebuchte Zahlungen'],["Offener Saldo",currency(m.balance_cents),'↗',m.balance_cents>=0?'Noch auszugleichen':'Guthaben'],["Haushalte",String(db.households.filter(h=>h.active).length),'⌂','Aktive Wohneinheiten']].map(s=>`<div class="card stat"><div class="stat-icon">${s[2]}</div><div class="stat-label">${s[0]}</div><div class="stat-value">${s[1]}</div><div class="stat-meta">${s[3]}</div></div>`).join('')}</div>`;}
function dateDiffDays(a,b){
 return Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
}
function contractReminders(){
 const today=new Date(),day=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
 return (db.tariffs||[]).filter(t=>t.cancellation_deadline&&!t.cancellation_done)
 .map(t=>({...t,days_left:dateDiffDays(t.cancellation_deadline,day)}))
 .filter(t=>t.days_left<=Number(t.reminder_days??42))
 .sort((a,b)=>a.days_left-b.days_left);
}
function remindersCard(){
 const reminders=contractReminders();
 if(!reminders.length)return '';
 return '<section class="card contract-reminders"><div class="card-head"><div><h2>Vertragskündigungen</h2><p>Fällige Termine aus Euren Tarifen</p></div>'+badge(String(reminders.length)+' Hinweise','warn')+'</div>'+
 reminders.map(t=>'<div class="contract-reminder"><span class="contract-icon">'+(t.days_left<0?'!':'◷')+'</span><div><b>'+E(t.provider)+' – '+E(kinds[t.kind]||t.kind)+'</b><div class="tiny muted">Kündigungstermin: '+dateDE(t.cancellation_deadline)+(t.contract_end?' · Ende '+dateDE(t.contract_end):'')+'</div></div><strong class="'+(t.days_left<0?'overdue-text':'')+'">'+(t.days_left<0?Math.abs(t.days_left)+' Tage überfällig':t.days_left===0?'Heute fällig':'Noch '+t.days_left+' Tage')+'</strong></div>').join('')+
 '<p class="muted tiny" style="margin-top:12px">Nur Erinnerungen im HOM-Dashboard, keine automatische Kündigung oder E-Mail.</p><button class="btn secondary small" data-nav="tariffs">Tarife prüfen</button></section>';
}
function gasInfo(i){
 if(i.kind!=='gas')return '';
 if(i.gas)return '<div class="tiny muted">'+number(i.gas.total_volume_m3)+' m³ ≈ '+number(i.gas.total_energy_kwh)+' kWh</div>';
 return '<div class="tiny muted">Gasumrechnung nicht hinterlegt</div>';
}
function dashboard(){
  const costs=Object.entries(report.kinds).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(...costs.map(x=>x[1]),1);
  const overdue=report.warnings.length;
  const noHouse=db.households.length===0;
  return page('Alles im Blick','Verbräuche, Kosten und die Verteilung auf Eure Haushalte.',addButton('reading','Zählerstand eintragen')+addButton('invoice','Rechnung erfassen'))+
  (noHouse?`<div class="notice info"><b>Willkommen!</b> Legt zunächst Eure Haushalte an oder ladet fiktive Beispieldaten, um die Anwendung zu erkunden. <button class="btn secondary small" data-demo>Beispieldaten laden</button></div>`:'')+
  (overdue?`<div class="notice error">⚠ <b>Abrechnung unvollständig:</b> ${E(report.warnings[0])} <button class="btn secondary small" data-nav="report">Details ansehen</button></div>`:'')+
  remindersCard()+topStats()+`<div class="dashboard-grid"><div class="stack"><section class="card"><div class="card-head"><div><h2>Kosten nach Kategorie</h2><p>Abgerechnete Lieferantenrechnungen ${year}</p></div>${badge('Alle Kosten')}</div>${costs.length?`<div class="bar-chart">${costs.slice(0,7).map(([kind,c])=>`<div class="bar-column"><div class="bar" style="height:${Math.max(4,Math.round(c/max*127))}px" title="${E(kind)} ${currency(c)}"></div><small>${E(kinds[kind]||kind)}</small></div>`).join('')}</div><p class="chart-caption">Basis: Rechnungen mit Periodenende im Jahr ${year}</p>`:empty('▤','Noch keine Kosten','Erfasst Rechnungen, um die Auswertung zu starten.')}</section>
  <section class="card"><div class="card-head"><div><h2>Aktuelle Rechnungen</h2><p>Die letzten erfassten Belege</p></div><button class="btn secondary small" data-nav="invoices">Alle anzeigen</button></div>${table(['Lieferant','Kategorie','Zeitraum','Betrag'],db.invoices.slice(0,5).map(i=>tr([`<b>${E(i.provider)}</b>`,badge(kinds[i.kind]||i.kind,'neutral'),`${dateDE(i.period_start)} – ${dateDE(i.period_end)}`,`<b>${currency(i.amount_cents)}</b>`])),empty('▤','Keine Rechnungen','Erfasst Eure erste Rechnung.'))}</section></div>
  <div class="stack"><section class="card"><div class="card-head"><div><h2>Kosten je Haushalt</h2><p>Aktuelles Abrechnungsjahr</p></div></div>${report.households.length?`<div class="meter-stack">${report.households.map(h=>`<div><div class="split-line"><span class="name">${E(h.name)}</span><span class="value">${currency(h.cost_cents)}</span></div><div class="meter-track" style="margin-top:10px"><span style="width:${report.totals.cost_cents?Math.max(1,Math.round(h.cost_cents/report.totals.cost_cents*100)):0}%"></span></div></div>`).join('')}</div><div class="mini-stat"><span class="muted">Gesamtkosten</span><b>${currency(report.totals.cost_cents)}</b></div>`:empty('⌂','Keine Haushalte','Legt zunächst Wohneinheiten an.')}</section>
  <section class="card"><div class="card-head"><h2>In drei Schritten starten</h2></div><div class="legend-list"><div>① <b>Haushalte</b> mit Fläche und Personen anlegen</div><div>② <b>Zähler</b> und Ablesewerte erfassen</div><div>③ <b>Rechnungen</b> samt Umlageschlüssel hinterlegen</div></div><p class="report-footnote">Danach erzeugt die Jahresabrechnung automatisch Kostenanteile, Nachzahlungen und Guthaben.</p><button class="btn secondary" style="margin-top:15px" data-nav="report">Zur Jahresabrechnung →</button></section></div></div>`;
}
function households(){return page('Haushalte','Wohneinheiten, Wohnfläche und Personenzahl verwalten.',addButton('household','Haushalt anlegen'))+`<section class="card">${table(['Haushalt','Wohnfläche','Personen','Status','Aktion'],db.households.map(h=>tr([`<strong>${E(h.name)}</strong>`,`${number(h.area_m2)} m²`,number(h.occupants),badge(h.active?'Aktiv':'Inaktiv',h.active?'':'neutral'),`<div class="table-actions">${editBtn('household',h.id)}${delBtn('households',h.id)}</div>`])),empty('⌂','Noch keine Haushalte','Für die Kostenverteilung zunächst Haushalte anlegen.',addButton('household','Haushalt anlegen')))}</section><div class="notice info" style="margin-top:18px">Wohnflächen und Personen werden in dieser Version als aktuelle Werte verwendet. Bei Bewohnerwechsel oder veränderten Flächen bitte getrennte Abrechnungszeiträume prüfen.</div>`;}
function meters(){
  const rows=db.meters.map(m=>{const hs=db.households.find(h=>h.id===m.household_id);const entries=db.readings.filter(r=>r.meter_id===m.id).sort((a,b)=>b.date.localeCompare(a.date));return tr([`<strong>${E(m.name)}</strong><div class="tiny muted">${E(m.code)}</div>`,badge(kinds[m.kind]||m.kind),m.role==='main'?badge('Hauptzähler','neutral'):E(hs?.name||'–'),entries.length?`${number(entries[0].value_milli/1000)} ${E(m.unit)}<div class="tiny muted">${dateDE(entries[0].date)}</div>`:'–',`<div class="table-actions"><button class="btn secondary small" data-add="reading" data-meter="${m.id}">Ablesen</button>${editBtn('meter',m.id)}${delBtn('meters',m.id)}</div>`]);});
  const rd=db.readings.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12).map(r=>{const m=db.meters.find(m=>m.id===r.meter_id);return tr([dateDE(r.date),E(m?.name||'?'),`${number(r.value_milli/1000)} ${E(m?.unit||'')}`,`<div class="table-actions">${editBtn('reading',r.id)}${delBtn('readings',r.id)}</div>`]);});
  return page('Zähler & Verbräuche','Haupt- und Unterzähler anlegen und Ablesungen dokumentieren.',addButton('meter','Zähler anlegen')+addButton('reading','Stand eintragen'))+`<section class="card"><div class="card-head"><div><h2>Zählerübersicht</h2><p>Zähler mit den letzten gespeicherten Ständen</p></div></div>${table(['Zähler','Art','Zuordnung','Letzter Stand','Aktion'],rows)}</section><section class="card" style="margin-top:20px"><div class="card-head"><h2>Letzte Ablesungen</h2></div>${table(['Datum','Zähler','Stand','Aktion'],rd)}</section><div class="notice info" style="margin-top:20px">Für eine verbrauchsbasierte Abrechnung sind Ablesungen am Anfang und Ende des Rechnungszeitraums nötig. Zwischenwerte können interpoliert werden; nach außen wird nie extrapoliert.</div>`;
}
function tariffs(){
 return page('Tarife & Verträge','Auch Internet-/Telefonverträge, monatliche Anbieterrechnungen und Kündigungstermine verwalten.',
    addButton('tariff','Tarif oder Vertrag erfassen'))+
 '<section class="card">'+table(['Versorger','Kostenart','Gültigkeit / Laufzeit','Arbeitspreis','Gasfaktoren','Kündigung','Aktion'],
 (db.tariffs||[]).map(t=>tr([
   '<b>'+E(t.provider)+'</b>',E(kinds[t.kind]||t.kind),
   'Ab '+dateDE(t.valid_from)+'<div class="tiny muted">Abrechnung: '+({monthly:'monatlich',annual:'jährlich',other:'abweichend'}[t.billing_frequency]||'jährlich')+'</div>'+(t.contract_start?'<div class="tiny muted">Start '+dateDE(t.contract_start)+'</div>':'')+
   (t.contract_end?'<div class="tiny muted">Ende '+dateDE(t.contract_end)+'</div>':''),
   t.kind==='internet'?'<strong>'+number(t.base_month_eur)+' € / Monat</strong><div class="tiny muted">Vertragspauschale</div>':
   number(t.unit_price_eur)+' € / Einheit<div class="tiny muted">'+number(t.base_month_eur)+' € Grundpreis/Monat</div>',
   t.kind==='gas'?(t.gas_calorific_kwh_m3?number(t.gas_calorific_kwh_m3)+' kWh/m³ × '+number(t.gas_condition_factor):'Nicht hinterlegt'):'–',
   t.cancellation_deadline?(dateDE(t.cancellation_deadline)+(t.cancellation_done?' ✓ Erledigt':'')+'<div class="tiny muted">Erinnerung '+Number(t.reminder_days??42)+' Tage vorher</div>'):'–',
   '<div class="table-actions">'+paperlessPreviewLink(t.paperless_document_id)+editBtn('tariff',t.id)+delBtn('tariffs',t.id)+'</div>'
 ])))+'</section>'+
 '<div class="notice info" style="margin-top:18px">Gas: m³ am Zähler ablesen; Brennwert und Zustandszahl hier eintragen. Bei der Gasrechnung wird der Tarif gewählt, die Faktoren bleiben in der Rechnung historisch gespeichert. Die Gesamtkosten ergeben sich weiterhin aus dem tatsächlichen Rechnungsbetrag.</div>'+
 '<section class="card" style="margin-top:18px"><div class="card-head"><h2>Vertragsvergleich</h2></div><p class="muted">CHECK24 bietet einen externen Strom- und Gasvergleich. Eine automatische Tarifpreis-API ist derzeit nicht angebunden.</p><a href="https://www.check24.de/strom-gas/" target="_blank" rel="noopener noreferrer" class="btn secondary">Strom und Gas bei CHECK24 vergleichen ↗</a></section>';
}
function invoices(){return page('Rechnungen & Belege','Lieferantenrechnungen mit Abrechnungszeitraum, Umlage und optionaler PDF-Anlage.',addButton('invoice','Rechnung erfassen'))+`<section class="card">${table(['Rechnungssteller','Kategorie','Zeitraum','Umlage','Betrag','Beleg','Aktion'],db.invoices.map(i=>tr([`<b>${E(i.provider)}</b><div class="tiny muted">${E(i.invoice_number)}</div>`,E(kinds[i.kind]||i.kind),`${dateDE(i.period_start)}<br>${dateDE(i.period_end)}`,E(i.household_id?'Direkt':methods[i.distribution]||i.distribution),`<strong>${currency(i.amount_cents)}</strong>${i.kind==='gas'&&i.gas_calorific_kwh_m3?'<div class="tiny muted">Brennwert '+number(i.gas_calorific_kwh_m3)+' × '+number(i.gas_condition_factor)+'</div>':''}`,(i.attachment_file?`<a href="/api/attachment?id=${i.id}" class="inline-link">PDF ↧</a>`:'')+(i.paperless_document_id?paperlessPreviewLink(i.paperless_document_id):'')||'–',`<div class="table-actions">${editBtn('invoice',i.id)}${delBtn('invoices',i.id)}</div>`])),empty('▤','Noch keine Rechnungen','Für die Abrechnung zunächst Rechnungen erfassen.',addButton('invoice','Rechnung erfassen')))}</section><div class="notice info" style="margin-top:18px">Eine Rechnung zählt zu dem Jahr, in dem ihr Abrechnungszeitraum endet. Für eine rechtlich verbindliche Heizkostenabrechnung muss die Heizkostenverordnung gesondert geprüft werden.</div>`;}
function payments(){
 const schedules=(db.standing_orders||[]).slice().sort((a,b)=>b.valid_from.localeCompare(a.valid_from));
 const scheduleRows=schedules.map(o=>{
  const h=db.households.find(x=>x.id===o.household_id);
  return tr(['<strong>'+E(h?.name||'?')+'</strong>',currency(o.amount_cents),String(o.day_of_month)+'. des Monats',
    dateDE(o.valid_from)+(o.valid_until?' bis '+dateDE(o.valid_until):' · laufend'),
    E(o.note||''),delBtn('standing_orders',o.id)]);
 });
 const manual=db.payments.slice().sort((a,b)=>b.date.localeCompare(a.date));
 const expected=report.standing_order_entries||[];
 const autoRows=expected.slice(-18).reverse().map(x=>{
  const h=db.households.find(z=>z.id===x.household_id);
  return tr([dateDE(x.date),E(h?.name||'?'),'<span class="pill">Dauerauftrag (planmäßig)</span>',currency(x.amount_cents)]);
 });
 return page('Abschläge & Daueraufträge','Regelmäßige Abschläge mit historisierten Betragsänderungen und einzelne Zahlungen.',
    addButton('standing_order','Dauerauftrag / Erhöhung')+addButton('payment','Einzelzahlung buchen'))+
 '<section class="card"><div class="card-head"><h2>Monatliche Daueraufträge</h2></div>'+
 table(['Haushalt','Monatsbetrag','Abbuchung','Gültig ab / bis','Bemerkung','Aktion'],scheduleRows,
   empty('◎','Noch kein Dauerauftrag','Legt einen monatlichen Abschlag an.'))+
 '<p class="muted tiny" style="margin-top:16px">Bei einer Erhöhung einen neuen Dauerauftrag mit späterem Startmonat anlegen. Die vorherige Version endet automatisch am Vormonatsende. Ältere Monate bleiben unverändert.</p></section>'+
 '<div class="two-col" style="margin-top:18px"><section class="card"><h2>Planmäßige Daueraufträge '+year+'</h2>'+
 table(['Fällig','Haushalt','Typ','Betrag'],autoRows,empty('◎','Keine fälligen Monatsabschläge','Nur bis zum aktuellen Datum fällige Zahlungen werden berücksichtigt.'))+
 '<p class="muted tiny">Planmäßig verbucht, ohne Bankbestätigung. Bei einer manuellen Zahlung im selben Monat wird der Dauerauftrag nicht zusätzlich berücksichtigt.</p></section>'+
 '<section class="card"><h2>Einzelzahlungen</h2>'+
 table(['Datum','Haushalt','Bemerkung','Betrag','Aktion'],manual.map(p=>{const h=db.households.find(x=>x.id===p.household_id);return tr([
 dateDE(p.date),'<strong>'+E(h?.name||'?')+'</strong>',E(p.note||'Abschlag'),currency(p.amount_cents),
 '<div class="table-actions">'+editBtn('payment',p.id)+delBtn('payments',p.id)+'</div>']);}))+'</section></div>';
}
function reportPage(){
 const hRows=report.households.map(h=>tr([`<strong>${E(h.name)}</strong>`,`${number(h.area_m2)} m²`,number(h.occupants),currency(h.cost_cents),currency(h.paid_cents),badge((h.balance_cents>=0?'Nachzahlung ':'Guthaben ')+currency(Math.abs(h.balance_cents)),h.balance_cents>0?'warn':'') ,`<a class="inline-link" href="/api/report.pdf?year=${year}&household=${h.id}">PDF ↧</a>` ]));
 return page('Jahresabrechnung','Automatische, nachvollziehbare Kostenaufteilung je Haushalt.',`<a href="/api/report.pdf?year=${year}" class="btn primary">↓ PDF exportieren</a><a href="/api/report.xlsx?year=${year}" class="btn secondary">↓ Excel</a><a href="/api/report.csv?year=${year}" class="btn secondary">↓ CSV</a><button class="btn secondary" data-print>⎙ Drucken</button>`)+
  (report.warnings.length?`<div class="notice error"><b>Achtung – Abrechnung unvollständig.</b><ul>${report.warnings.map(w=>`<li>${E(w)}</li>`).join('')}</ul></div>`:'')+
  (report.assumptions?.length?`<div class="notice info">${report.assumptions.map(E).join(' ')}</div>`:'')+
  `<section class="card report-print"><div class="report-header"><div class="eyebrow">${E(houseTitle)}</div><h2>Abrechnung ${year}</h2><span class="muted">Stand: ${new Date().toLocaleDateString('de-DE')}</span></div>
   <div class="report-total"><div><small class="muted">Abzurechnende Gesamtkosten</small><br><b>${currency(report.totals.cost_cents)}</b></div><div><small class="muted">Geleistete Vorauszahlungen</small><br><b>${currency(report.totals.paid_cents)}</b></div><div><small class="muted">Offener Saldo</small><br><b>${currency(report.totals.balance_cents)}</b></div></div>
   <h2>Verteilung nach Haushalt</h2>${table(['Haushalt','Fläche','Personen','Kosten','Vorauszahlung','Ergebnis','PDF'],hRows,empty('◎','Noch keine Daten','Erfasst erst Haushalte und Rechnungen.'))}
   <h2 style="margin-top:32px">Kostenarten</h2>${table(['Kostenart','Gesamtkosten'],Object.entries(report.kinds).map(([k,v])=>tr([E(kinds[k]||k),`<b>${currency(v)}</b>`])))}
   <h2 style="margin-top:32px">Verteilte Rechnungen</h2>${table(['Lieferant','Zeitraum','Kostenart','Betrag'],report.invoices.map(i=>tr([E(i.provider),`${dateDE(i.period_start)} – ${dateDE(i.period_end)}`,E(kinds[i.kind]||i.kind)+(i.gas?'<div class="tiny muted">'+number(i.gas.total_volume_m3)+' m³ → '+number(i.gas.total_energy_kwh)+' kWh</div>':''),currency(i.amount_cents)])))}
   <p class="report-footnote">Ein positiver Saldo bedeutet Nachzahlung, ein negativer Saldo ein Guthaben. Die Verteilung basiert auf den hinterlegten Umlageschlüsseln und den Zählerdaten. Bei fehlerhaften oder fehlenden Werten wird die entsprechende Rechnung ausdrücklich nicht einberechnet. Jahreszuordnung nach Rechnungs-Periodenende. Dies ist eine private Rechenhilfe, keine geprüfte rechtsverbindliche Nebenkostenabrechnung.</p>
  </section>`;
}
function forecastPage(){return page('Kostenprognose','Was kostet das Haus in den nächsten Jahren? Szenarien statt erfundener Zukunftspreise.',`<button class="btn primary" data-run-forecast>↻ Prognose berechnen</button>`)+`<div class="forecast-grid"><section class="card"><div class="card-head"><div><h2>Szenarien-Vergleich</h2><p>Jahreskosten auf Basis des Abrechnungsjahres ${year}</p></div></div><div id="forecastChart">${empty('⌁','Prognose berechnen','Wählt rechts Eure Annahmen.')}</div></section><section class="card"><h2>Annahmen einstellen</h2><p class="muted tiny">Preise und Verbrauch lassen sich getrennt verändern.</p><div class="form-fields" style="display:grid;gap:18px;margin-top:20px"><div class="field"><label for="priceGrowth">Preissteigerung pro Jahr (%)</label><input id="priceGrowth" type="number" value="3" step="0.5" min="-50" max="100"></div><div class="field"><label for="consumptionGrowth">Verbrauchsänderung pro Jahr (%)</label><input id="consumptionGrowth" type="number" value="0" step="0.5" min="-50" max="100"></div><div class="field"><label for="forecastHorizon">Zeitraum</label><select id="forecastHorizon"><option value="1">1 Jahr</option><option value="3">3 Jahre</option><option value="5" selected>5 Jahre</option><option value="10">10 Jahre</option></select></div><button class="btn secondary" data-run-forecast>Berechnen</button></div><div class="notice info" style="margin-top:20px">Optimistisch = 2 Prozentpunkte weniger Preissteigerung; pessimistisch = 3 Prozentpunkte mehr. Diese Annahmen sind frei wählbar, keine Marktprognose.</div></section></div><section class="card" style="margin-top:20px"><h2>Voraussichtliche Kosten je Haushalt</h2><div id="forecastTable" style="margin-top:18px">${empty('⌁','Noch keine Berechnung','Prognose oben starten.')}</div></section>`;}
function backupPage(){return page('Datensicherung','Eure Daten gehören Euch – lokal sichern, wiederherstellen und exportieren.',`<a class="btn primary" href="/api/backup">↓ Vollständiges Backup</a>`)+`<div class="two-col"><section class="card"><h2>Lokale Sicherung herunterladen</h2><p class="muted">Eine JSON-Datei mit Stammdaten, Rechnungen, Zahlungen, Zählerständen und PDF-Belegen als eingebettete Daten. Privat aufbewahren!</p><a class="btn primary" style="margin-top:10px" href="/api/backup">Backup erstellen</a></section><section class="card"><h2>Sicherung wiederherstellen</h2><p class="muted">Achtung: Vorhandene Einträge werden vollständig ersetzt. Zuerst ein eigenes Backup herunterladen.</p><div class="field" style="margin:18px 0"><label for="restoreFile">Hauskosten-Backup (.json)</label><input type="file" id="restoreFile" accept=".json,application/json"></div><button class="btn danger" data-restore>Backup einspielen</button></section></div><div class="notice info" style="margin-top:20px">Standardmäßig ist der Server ausschließlich unter 127.0.0.1 erreichbar. Eure Datenbank liegt im Ordner <code>data</code>; für einen vollständigen manuellen Umzug bei beendetem Server kann auch dieser Ordner gesichert werden.</div>`;}

function usersPage(){
  if(!isAdmin())return page('Kein Zugriff','Diese Funktion steht nur Administratoren zur Verfügung.');
  const rows=users.map(u=>tr([
    '<strong>'+E(u.display_name)+'</strong><div class="muted tiny">@'+E(u.username)+'</div>',
    u.role==='admin'?badge('Administrator'):badge('Mitglied'),
    u.active?badge('Aktiv','success'):badge('Deaktiviert','error'),
    '<button class="btn secondary small" data-user-edit="'+u.id+'">Bearbeiten</button>'
  ]));
  return page('Benutzerverwaltung','Eigene Zugänge für die Familie. Alle aktiven Mitglieder dürfen die Hauskosten vollständig bearbeiten.')+
  '<div class="two-col"><section class="card"><div class="card-head"><h2 id="userFormTitle">Benutzer anlegen</h2></div>'+
  '<form id="manageUserForm" class="admin-form">'+
  '<input type="hidden" name="id" value="">'+
  '<div class="field"><label for="newUsername">Benutzername</label><input id="newUsername" name="username" autocomplete="off" minlength="3" maxlength="32" pattern="[a-zA-Z0-9._-]+" required></div>'+
  '<div class="field"><label for="newDisplayName">Anzeigename</label><input id="newDisplayName" name="display_name" maxlength="80" required></div>'+
  '<div class="field"><label for="newUserRole">Berechtigung</label><select id="newUserRole" name="role"><option value="user">Mitglied (alle Hausdaten bearbeiten)</option><option value="admin">Administrator (zusätzlich Nutzer & Einstellungen)</option></select></div>'+
  '<div class="field"><label for="newUserActive">Status</label><select id="newUserActive" name="active"><option value="true">Aktiv</option><option value="false">Deaktiviert</option></select></div>'+
  '<div class="field"><label for="newUserPassword">Passwort</label><input id="newUserPassword" name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required><div class="help">Mindestens 10 Zeichen. Beim Bearbeiten leer lassen, wenn das Passwort unverändert bleiben soll.</div></div>'+
  '<div class="admin-actions"><button class="btn primary" type="submit" id="saveUserButton">Benutzer anlegen</button> <button class="btn secondary" type="button" data-user-new>Zurücksetzen</button></div></form></section>'+
  '<section class="card"><div class="card-head"><h2>Benutzerkonten</h2>'+badge(String(users.length)+' Konten')+'</div>'+
  table(['Person','Rolle','Status','Aktion'],rows,empty('♙','Noch keine weiteren Benutzer','Erstellt links einen Zugang.'))+
  '<p class="muted tiny" style="margin-top:18px">Der letzte aktive Administrator kann nicht deaktiviert werden. Beim Passwortwechsel werden bestehende Sitzungen dieses Benutzers beendet.</p></section></div>';
}
function settingsPage(){
  if(!isAdmin())return page('Kein Zugriff','Diese Funktion steht nur Administratoren zur Verfügung.');
  return page('Hauseinstellungen','Die Hausbezeichnung wird auf der Startseite, bei der Anmeldung und in PDF-Abrechnungen verwendet.')+
  '<section class="card setting-card"><h2>Hausbezeichnung</h2>'+
  '<form id="houseSettingsForm" class="admin-form">'+
  '<div class="field"><label for="houseTitleField">Titel Eures Hauses</label>'+
  '<input id="houseTitleField" name="house_title" minlength="2" maxlength="100" required value="'+E(houseTitle)+'">'+
  '<div class="help">Beispielsweise „Villa Kunterbunt“, „Haus am Garten“ oder eine eigene Bezeichnung.</div></div>'+
  '<button class="btn primary" type="submit">Haustitel speichern</button></form></section>'+
  '<section class="card setting-card" style="margin-top:20px"><h2>Dokumentenarchiv – Paperless-ngx</h2>'+
  '<p class="muted">Technischer Lesebenutzer <b>hom-archiv</b>. Nur Dokumente mit HOM-Freigabe und erlaubter Hauskostenkategorie; Token ausschließlich auf der NAS in der Docker-Umgebung. Papermerge ist nicht verbunden.</p>'+
  '<button type="button" class="btn secondary" data-paperless-status>Verbindung prüfen</button><p id="paperlessStatus" class="muted tiny"></p>'+
  '<form id="paperlessPrivacyForm" class="admin-form"><div class="field"><label for="privateDocumentId">Private Dokument-ID als Negativtest (z. B. Lohnabrechnung)</label>'+
  '<input id="privateDocumentId" name="private_document_id" type="number" min="1" step="1" required>'+
  '<div class="help">Bei korrekten Paperless-Rechten wird der Zugriff mit dem Dienstkonto verweigert. Ohne bestandenen Test nicht produktiv nutzen.</div></div>'+
  '<button class="btn secondary" type="submit">Privatzugriff testen</button><p id="paperlessPrivacyResult" class="muted tiny" role="status"></p></form></section>';
}
function profilePage(){
  return page('Mein Konto','Hier könnt Ihr Euer eigenes Passwort ändern.')+
  '<section class="card setting-card"><h2>'+E(account?.display_name||'Konto')+'</h2>'+
  '<p class="muted">Benutzer: '+E(account?.username||'')+' · '+(isAdmin()?'Administrator':'Mitglied')+'</p>'+
  '<form id="changePasswordForm" class="admin-form">'+
  '<div class="field"><label for="oldPassword">Bisheriges Passwort</label><input id="oldPassword" name="current_password" type="password" autocomplete="current-password" required></div>'+
  '<div class="field"><label for="newPassword">Neues Passwort</label><input id="newPassword" name="new_password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></div>'+
  '<button class="btn primary" type="submit">Passwort ändern</button></form></section>';
}
function editUser(id){
  const u=users.find(x=>x.id===id);
  if(!u)return;
  const form=$('manageUserForm');
  form.elements.id.value=String(u.id);
  form.elements.username.value=u.username;
  form.elements.username.readOnly=true;
  form.elements.display_name.value=u.display_name;
  form.elements.role.value=u.role;
  form.elements.active.value=String(Boolean(u.active));
  form.elements.password.value='';
  form.elements.password.required=false;
  $('userFormTitle').textContent='Benutzer bearbeiten: '+u.username;
  $('saveUserButton').textContent='Änderungen speichern';
  form.scrollIntoView({behavior:'smooth',block:'start'});
}
function newUserForm(){
  const form=$('manageUserForm');
  if(!form)return;
  form.reset();
  form.elements.id.value='';
  form.elements.username.readOnly=false;
  form.elements.password.required=true;
  $('userFormTitle').textContent='Benutzer anlegen';
  $('saveUserButton').textContent='Benutzer anlegen';
}
async function saveManagedUser(form){
  const fd=new FormData(form),editId=fd.get('id');
  const data={username:fd.get('username'),display_name:fd.get('display_name'),role:fd.get('role'),active:fd.get('active')==='true'};
  const password=fd.get('password');
  if(password)data.password=password;
  if(!editId&&!password)throw new Error('Bitte ein Startpasswort mit mindestens 10 Zeichen eingeben.');
  await api('/api/users'+(editId?'/'+editId:''),{method:editId?'PATCH':'POST',body:JSON.stringify(data)});
  notify(editId?'Benutzer aktualisiert.':'Benutzer erstellt.');
  await refresh();
}
async function submitHouseSettings(form){
  const value=new FormData(form).get('house_title');
  const result=await api('/api/settings',{method:'PATCH',body:JSON.stringify({house_title:value})});
  houseTitle=result.house_title;
  updateHouseShell();render();
  notify('Haustitel gespeichert.');
}
async function submitOwnPassword(form){
  const values=Object.fromEntries(new FormData(form));
  await api('/api/auth/password',{method:'POST',body:JSON.stringify(values)});
  form.reset();notify('Passwort geändert. Andere Sitzungen dieses Benutzers wurden beendet.');
}

function render(){
  root.innerHTML=({dashboard,households,meters,tariffs,invoices,payments,report:reportPage,forecast:forecastPage,backup:backupPage,users:usersPage,settings:settingsPage,profile:profilePage}[view]||dashboard)();
  if(view==='forecast')runForecast().catch(e=>notify(e.message,true));
}
function optionHTML(options,selected){return options.map(o=>`<option value="${E(o.value)}" ${String(selected)===String(o.value)?'selected':''}>${E(o.label)}</option>`).join('');}
const choices=arr=>arr.map(value=>({value,label:value}));
const hhOpts=()=>db.households.map(h=>({value:h.id,label:h.name}));
const meterOpts=()=>db.meters.map(m=>({value:m.id,label:`${m.name} (${m.code})`}));
function field(name,label,type='text',opts={}){
 let content='';const required=opts.required===false?'':'required';const value=opts.value??'';
 if(type==='select')content=`<select name="${name}" id="fld-${name}" ${required}>${opts.empty===false?'':`<option value="">Bitte wählen</option>`}${optionHTML(opts.options||[],value)}</select>`;
 else if(type==='textarea')content=`<textarea name="${name}" id="fld-${name}" ${required}>${E(value)}</textarea>`;
 else content=`<input name="${name}" id="fld-${name}" type="${type}" ${required} ${type==='number'?`min="${opts.min??0}" step="${opts.step??'any'}"`:''} ${type==='file'?'accept="application/pdf,.pdf"':''} ${value&&type!=='file'?`value="${E(value)}"`:''}>`;
 return `<div class="field ${opts.wide?'wide':''}" data-field="${name}"><label for="fld-${name}">${E(label)}</label>${content}${opts.help?`<div class="help">${E(opts.help)}</div>`:''}</div>`;
}
function paperlessField(preset={}){
 const id=Number(preset.paperless_document_id)||'';
 return '<div class="field wide"><label>Archivbeleg (Paperless-ngx, optional)</label>'+
 '<input type="hidden" id="paperlessSelectedId" name="paperless_document_id" value="'+id+'">'+
 '<div class="paperless-attach-actions"><button type="button" class="btn secondary" data-paperless-open>Dokument aus Paperless wählen</button>'+
 '<button type="button" class="btn secondary" data-paperless-clear>Verknüpfung entfernen</button></div>'+
 '<div class="help" id="paperlessSelectionInfo">'+(id?'Verknüpftes Archivdokument #'+id:'Noch kein Archivdokument ausgewählt')+
 ' · Keine PDF-Kopie in HOM</div></div>';
}
function paperlessPreviewLink(id){
 return id?'<a class="inline-link" href="/api/paperless/documents/'+Number(id)+'/preview" target="_blank" rel="noopener noreferrer">Archiv ↗</a>':'';
}
async function loadPaperlessResults(){
 const query=$('paperlessQuery').value||'';
 $('paperlessResults').textContent='Suche läuft …';
 try{
  const result=await api('/api/paperless/documents?q='+encodeURIComponent(query));
  const docs=result.documents||[];
  $('paperlessResults').innerHTML=docs.length?docs.map(d=>
   '<div class="paperless-result"><div><b>'+E(d.title)+'</b><div class="tiny muted">'+E(d.created||'')+
   ' · #'+Number(d.id)+'</div></div><div class="paperless-actions">'+paperlessPreviewLink(d.id)+
   '<button type="button" class="btn primary small" data-paperless-choose="'+Number(d.id)+
   '" data-title="'+E(d.title)+'">Auswählen</button></div></div>'
  ).join(''):'<p class="muted">Keine ausdrücklich für HOM freigegebenen Dokumente gefunden.</p>';
 }catch(error){$('paperlessResults').textContent=error.message;}
}
function selectPaperlessDocument(id,title){
 const input=$('paperlessSelectedId');
 if(!input)return;
 input.value=String(id);
 $('paperlessSelectionInfo').textContent='Verknüpft: '+title+' (#'+id+')';
 $('paperlessDialog').close();
}
function clearPaperlessDocument(){
 if(!$('paperlessSelectedId'))return;
 $('paperlessSelectedId').value='';
 $('paperlessSelectionInfo').textContent='Keine Archivverknüpfung ausgewählt';
}
async function verifyPaperlessPermissions(form){
 const id=form.elements.private_document_id.value;
 const result=await api('/api/paperless/test-private',{method:'POST',body:JSON.stringify({document_id:id})});
 const out=$('paperlessPrivacyResult');
 if(out)out.textContent=result.denied?
 'Erfolgreich: HOM-Archivbenutzer kann dieses private Dokument nicht abrufen.':
 'UNSICHER: Der Archivbenutzer kann dieses private Dokument abrufen! Bitte Dokumentrechte in Paperless korrigieren, bevor Ihr die Integration verwendet.';
 if(result.denied){
   $('paperlessStatus').textContent='Paperless ist nach bestandenem Privatzugriffstest freigegeben.';
 }else{
   $('paperlessStatus').textContent='UNSICHER: Archivzugriff wurde gesperrt. Dienstbenutzerrechte korrigieren.';
   notify('Archivzugriff ist zu weit gefasst!',true);
 }
}

function modalFields(type,preset={}) {
 const today=new Date().toISOString().slice(0,10),ym=`${year}-01-01`,ye=`${year}-12-31`;
 switch(type){
 case 'household':return field('name','Bezeichnung / Familie')+field('area_m2','Wohnfläche (m²)','number',{step:0.01})+field('occupants','Personenanzahl','number',{min:0,step:1,value:1})+field('active','Status','select',{options:[{value:'1',label:'Aktiv'},{value:'0',label:'Inaktiv'}],empty:false,value:'1'});
 case 'meter':return field('code','Zählernummer')+field('name','Bezeichnung')+field('kind','Energie- / Kostenart','select',{options:KindsOptions})+field('unit','Einheit','select',{options:choices(['kWh','m³','MWh','l','Stück'])})+field('role','Zählertyp','select',{options:[{value:'main',label:'Hauptzähler'},{value:'sub',label:'Unterzähler'}],empty:false,value:'sub'})+field('household_id','Zugeordneter Haushalt','select',{options:hhOpts()})+field('multiplier','Zählerfaktor','number',{value:1,min:0,step:0.001,help:'Normalerweise 1; ggf. Messwandlerfaktor.'})+field('active','Status','select',{options:[{value:'1',label:'Aktiv'},{value:'0',label:'Inaktiv'}],empty:false,value:'1'});
 case 'reading':return field('meter_id','Zähler','select',{options:meterOpts(),value:preset.meter_id||''})+field('date','Ablesedatum','date',{value:today})+field('value','Zählerstand','number',{step:0.001})+field('note','Bemerkung','textarea',{required:false,wide:true});
 case 'tariff':return field('provider','Versorger')+field('kind','Kostenart','select',{options:KindsOptions})+
   field('valid_from','Tarif gültig ab','date',{value:ym})+
   field('unit_price_eur','Arbeitspreis pro kWh bzw. Einheit (€)','number',{step:0.0001})+
   field('base_month_eur','Grundpreis pro Monat (€)','number',{step:0.01})+
   '<div class="field wide gas-hint hidden" id="gasTariffHint"><b>Gasumrechnung</b> – Brennwert und Zustandszahl aus der Gasrechnung eingeben. Zählerstände bleiben in m³.</div>'+
   field('gas_calorific_kwh_m3','Brennwert (kWh/m³)','number',{required:false,step:0.0001,min:1})+
   field('gas_condition_factor','Zustandszahl','number',{required:false,step:0.000001,min:0.1})+
   field('contract_start','Vertragsbeginn (optional)','date',{required:false})+
   field('contract_end','Vertragsende (optional)','date',{required:false})+
   field('cancellation_deadline','Spätester Kündigungstermin (optional)','date',{required:false,help:'Bitte Datum aus den Vertragsbedingungen eintragen; HOM berechnet keine Rechtsfristen.'})+
   field('reminder_days','Erinnerung ab (Tage vorher)','number',{value:42,min:0,step:1})+
   field('cancellation_done','Kündigung','select',{options:[{value:'0',label:'Offen'},{value:'1',label:'Erledigt'}],empty:false,value:'0'})+
   field('note','Bemerkung','textarea',{required:false,wide:true})+paperlessField(preset);
 case 'invoice':return field('provider','Rechnungssteller')+field('invoice_number','Rechnungsnummer','text',{required:false})+field('kind','Kostenart','select',{options:KindsOptions})+
   field('gas_tariff_id','Gastarif für Brennwert und Zustandszahl','select',{required:false,options:(db.tariffs||[]).filter(t=>t.kind==='gas'&&t.gas_calorific_kwh_m3&&t.gas_condition_factor).map(t=>({value:t.id,label:t.provider+' · ab '+dateDE(t.valid_from)+' · '+number(t.gas_calorific_kwh_m3)+' kWh/m³ × '+number(t.gas_condition_factor)})),help:'Bei Gasabrechnung nach Zählerständen erforderlich. Faktoren werden in der Rechnung unveränderlich übernommen.'})+field('amount_eur','Gesamtbetrag der Rechnung (€)','number',{step:0.01})+field('period_start','Leistungszeitraum von','date',{value:ym})+field('period_end','Leistungszeitraum bis','date',{value:ye})+
   field('distribution','Umlageschlüssel','select',{options:Object.entries(methods).map(([value,label])=>({value,label})),empty:false,value:'area'})+
   field('household_id','Direkt einem Haushalt zuweisen (optional)','select',{options:hhOpts(),required:false})+
   field('common_key','Gemeinschaftsverbrauch nach','select',{options:[{value:'area',label:'Wohnfläche'},{value:'persons',label:'Personen'},{value:'equal',label:'Gleiche Teile'}],empty:false,value:'area',help:'Relevant bei Haupt- und Unterzählern.'})+
   `<div class="field wide hidden" id="customWeights"><label>Individuelle Gewichte pro Haushalt</label>${db.households.filter(h=>h.active).map(h=>`<div class="split-line" style="gap:10px;margin:5px 0"><span>${E(h.name)}</span><input style="max-width:110px" type="number" name="weight_${h.id}" value="1" min="0" step="any"></div>`).join('')}</div>`+
   field('attachment','PDF-Rechnung (optional, max. 5 MB)','file',{required:false,wide:true})+
   paperlessField(preset)+field('note','Bemerkung','textarea',{required:false,wide:true});
 case 'payment':return field('household_id','Haushalt','select',{options:hhOpts()})+field('date','Zahlungsdatum','date',{value:today})+field('amount_eur','Gezahlter Betrag (€)','number',{step:0.01})+
 field('note','Bemerkung','textarea',{value:'Einzelzahlung',required:false,wide:true,help:'Eine manuell erfasste Zahlung ersetzt den planmäßigen Dauerauftrag im selben Monat.'});
 case 'standing_order':return field('household_id','Haushalt','select',{options:hhOpts()})+
   field('amount_eur','Monatlicher Abschlag (€)','number',{step:0.01,min:0.01})+
   field('day_of_month','Tag der Abbuchung (1–31)','number',{value:1,min:1,step:1,help:'Bei Monaten mit weniger Tagen gilt der letzte Kalendertag.'})+
   field('valid_from','Gültig ab (1. des Monats)','date',{value:today.slice(0,7)+'-01',help:'Bei einer Erhöhung ab neuem Monat eingeben. Der alte Betrag endet automatisch im Vormonat.'})+
   field('valid_until','Gültig bis (optional)','date',{required:false})+
   field('note','Bemerkung','textarea',{required:false,wide:true});
 }
 return '';
}
function openModal(type,preset={},editId=null){
 if(['reading','meter','payment','invoice','standing_order'].includes(type)&&db.households.length===0){notify('Bitte zuerst einen Haushalt anlegen.',true);return;}
 if(type==='reading'&&!db.meters.length){notify('Bitte zuerst einen Zähler anlegen.',true);return;}
 modalType=type;editingID=editId;$('dialogTitle').textContent={household:'Haushalt anlegen',meter:'Zähler anlegen',reading:'Zählerstand erfassen',tariff:'Tarif erfassen',invoice:'Rechnung erfassen',payment:'Abschlag erfassen',standing_order:'Dauerauftrag anlegen / Betrag erhöhen'}[type];$('formFields').className='form-grid';$('formFields').innerHTML=modalFields(type,preset);
 if(editId){
  $('dialogTitle').textContent='Eintrag bearbeiten';
  const fields=$('entryForm').elements;
  for(const [key,val] of Object.entries(preset)){
    if(fields.namedItem(key)&&val!==null&&val!==undefined)fields.namedItem(key).value=String(val);
  }
  if(type==='reading')fields.namedItem('value').value=String(preset.value_milli/1000);
  if(type==='invoice'){
    fields.namedItem('amount_eur').value=moneyInput(preset.amount_cents);
    const weights=JSON.parse(preset.custom_weights||'{}');for(const [key,val] of Object.entries(weights))if(fields.namedItem('weight_'+key))fields.namedItem('weight_'+key).value=String(val);
  }
  if(type==='payment')fields.namedItem('amount_eur').value=moneyInput(preset.amount_cents);
 }
 $('formDialog').showModal();updateModalFields();
}
function updateModalFields(){
 const f=$('entryForm'),category=f.elements.kind?.value;
 if(modalType==='meter'){
   const main=f.elements.role?.value==='main',h=f.querySelector('[data-field="household_id"]');
   if(h){h.classList.toggle('hidden',main);f.elements.household_id.required=!main;}
   const unit=f.elements.unit;
   if(unit){
     if(category==='gas')unit.value='m³';
     for(const choice of unit.options)choice.disabled=category==='gas'&&choice.value!=='m³';
   }
 }
 if(modalType==='tariff'){
   const gas=category==='gas';
   $('gasTariffHint')?.classList.toggle('hidden',!gas);
   for(const key of ['gas_calorific_kwh_m3','gas_condition_factor']){
     const fieldNode=f.querySelector('[data-field="'+key+'"]');
     fieldNode?.classList.toggle('hidden',!gas);
     f.elements[key].required=gas;
   }
 }
 if(modalType==='invoice'){
   const isMeter=f.elements.distribution?.value==='meter',custom=f.elements.distribution?.value==='custom';
   const ck=f.querySelector('[data-field="common_key"]');
   if(ck)ck.classList.toggle('hidden',!isMeter);
   $('customWeights')?.classList.toggle('hidden',!custom);
   const gas=category==='gas',gasNode=f.querySelector('[data-field="gas_tariff_id"]');
   gasNode?.classList.toggle('hidden',!gas);
   f.elements.gas_tariff_id.required=gas&&isMeter&&!f.elements.household_id?.value;
   if(!gas)f.elements.gas_tariff_id.value='';
 }
}
async function formSubmit(evt){evt.preventDefault();let data={};const form=$('entryForm');const fd=new FormData(form);for(const [k,v] of fd.entries())if(k!=='attachment'&&!k.startsWith('weight_'))data[k]=v;
 if(modalType==='meter'&&data.role==='main')data.household_id=null;
 if(modalType==='invoice'){
   data.custom_weights={};for(const [k,v] of fd.entries())if(k.startsWith('weight_'))data.custom_weights[k.slice(7)]=v;
   const file=fd.get('attachment');if(file&&file.size){if(file.size>5*1024*1024){notify('Die PDF-Datei darf maximal 5 MB groß sein.',true);return;}if(!file.name.toLowerCase().endsWith('.pdf')){notify('Nur PDF-Dateien sind erlaubt.',true);return;}
     const buffer=await file.arrayBuffer();const bytes=new Uint8Array(buffer);let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.slice(offset,offset+8192));data.attachment={name:file.name,base64:btoa(binary)};
   }
 }
 const route={household:'households',meter:'meters',reading:'readings',tariff:'tariffs',invoice:'invoices',payment:'payments',standing_order:'standing-orders'}[modalType];
 try{await api(`/api/${route}${editingID?'/'+editingID:''}`,{method:editingID?'PATCH':'POST',body:JSON.stringify(data)});$('formDialog').close();notify('Eintrag erfolgreich gespeichert.');await refresh();}catch(e){notify(e.message,true);}
}
async function removeEntry(table,id){const name={households:'Haushalt',meters:'Zähler',readings:'Ablesung',tariffs:'Tarif',invoices:'Rechnung',payments:'Zahlung',standing_orders:'Dauerauftrag'}[table];if(!confirm(table==='standing_orders'?'Dauerauftrag und damit alle bisher daraus abgeleiteten Monatsabschläge wirklich entfernen? Alte Abrechnungen können sich ändern.':`${name} #${id} wirklich löschen?`))return;
 try{await api(`/api/${table}/${id}`,{method:'DELETE'});notify(`${name} gelöscht.`);await refresh();}catch(e){notify(e.message,true);}}
async function runForecast(){if(view!=='forecast')return;
 const price=$('priceGrowth')?.value||3,cons=$('consumptionGrowth')?.value||0,horizon=Number($('forecastHorizon')?.value||5);
 forecastResult=await api(`/api/forecast?year=${year}&price=${encodeURIComponent(price)}&consumption=${encodeURIComponent(cons)}`);
 const scenarios=forecastResult.scenarios,peak=Math.max(...scenarios.flatMap(s=>s.years.slice(0,horizon).map(y=>y.total_cents)),1);
 $('forecastChart').innerHTML=report.totals.cost_cents===0?empty('⌁','Noch keine Basisdaten','Erfasst zuerst Rechnungen für das gewählte Jahr.'): `<div class="forecast-bars">${scenarios[1].years.slice(0,horizon).map((d,i)=>`<div class="bar-column"><div class="bar" title="${d.year}: ${currency(d.total_cents)}" style="height:${Math.max(3,Math.round(d.total_cents/peak*220))}px"></div><small>${d.year}</small></div>`).join('')}</div><p class="chart-caption">Balken: Basis-Szenario · optimistisch und pessimistisch in der Tabelle</p><div class="legend-list" style="margin-top:15px">${scenarios.map(s=>`<div class="split-line"><span>${E(s.name)}</span><strong>${currency(s.years[horizon-1].total_cents)}</strong></div>`).join('')}</div>`;
 const basis=scenarios.find(s=>s.name==='Basis');
 const byHouse=table(['Haushalt','Basisjahr',...basis.years.slice(0,horizon).map(y=>String(y.year))],report.households.map(h=>tr([`<strong>${E(h.name)}</strong>`,currency(h.cost_cents),...basis.years.slice(0,horizon).map(y=>currency(y.households.find(x=>x.id===h.id)?.cost_cents||0))])));
 const scen=table(['Jahr',...scenarios.map(s=>s.name)],scenarios[0].years.slice(0,horizon).map((y,i)=>tr([`<strong>${y.year}</strong>`,...scenarios.map(s=>currency(s.years[i].total_cents))])));
 $('forecastTable').innerHTML=byHouse+`<h2 style="margin-top:30px">Gesamtszenarien</h2>`+scen;
}
async function restoreData(){const file=$('restoreFile')?.files?.[0];if(!file){notify('Bitte eine Sicherungsdatei auswählen.',true);return;}if(file.size>35*1024*1024){notify('Backup zu groß.',true);return;}
 if(!confirm('ACHTUNG: Alle derzeitigen Daten werden durch die Sicherung ersetzt! Zuvor eigenes Backup heruntergeladen?'))return;
 if(!confirm('Letzte Bestätigung: Datenbank unwiderruflich überschreiben?'))return;
 try{const obj=JSON.parse(await file.text());obj.confirm='RESTORE';await api('/api/restore',{method:'POST',body:JSON.stringify(obj)});notify('Sicherung wiederhergestellt.');await refresh();}catch(e){notify(e.message,true);}}
function register(){
 for(const y of Array.from({length:16},(_,i)=>new Date().getFullYear()-8+i))$('yearPick').add(new Option(y,y));$('yearPick').value=String(year);
 $('yearPick').addEventListener('change',e=>{year=Number(e.target.value);refresh();});
 document.addEventListener('click',async e=>{
   const target=e.target.closest('button,a');if(!target)return;
   if(target.dataset.paperlessOpen!==undefined){
     $('paperlessDialog').showModal();$('paperlessResults').textContent='Bitte Suchbegriff eingeben.';return;
   }
   if(target.dataset.paperlessChoose){
     selectPaperlessDocument(Number(target.dataset.paperlessChoose),target.dataset.title||'Dokument');return;
   }
   if(target.dataset.paperlessClear!==undefined){clearPaperlessDocument();return;}
   if(target.dataset.paperlessStatus!==undefined){
     try{const data=await api('/api/paperless/status');
       $('paperlessStatus').textContent=data.verified?'Paperless ist nach bestandenem Privatzugriffstest freigegeben.':
         data.configured?'Paperless konfiguriert, aber noch GESPERRT: Zuerst den Privatzugriffstest mit einer bekannten vertraulichen Dokument-ID durchführen.':
         'Noch nicht eingerichtet. Benötigt URL, technischen API-Token, HOM-Freigabe-Tag-ID und erlaubte Kategorien in der NAS-.env.';}
     catch(error){notify(error.message,true);}return;
   }
   if(target.dataset.userEdit){editUser(Number(target.dataset.userEdit));return;}
   if(target.dataset.userNew!==undefined){newUserForm();return;}
   if(target.dataset.nav){go(target.dataset.nav);return;}
   if(target.dataset.add){openModal(target.dataset.add,{meter_id:target.dataset.meter});return;}
   if(target.dataset.del){await removeEntry(target.dataset.del,Number(target.dataset.id));return;}
   if(target.dataset.edit){
     const tbl={household:'households',meter:'meters',reading:'readings',tariff:'tariffs',invoice:'invoices',payment:'payments'}[target.dataset.edit];
     const existing=db[tbl].find(x=>x.id===Number(target.dataset.id));
     if(existing)openModal(target.dataset.edit,existing,existing.id);return;
   }
   if(target.dataset.print){window.print();return;}
   if(target.dataset.runForecast){runForecast().catch(err=>notify(err.message,true));return;}
   if(target.dataset.restore!==undefined){await restoreData();return;}
   if(target.dataset.demo!==undefined){if(confirm('Nur fiktive Beispieldaten laden? Dies ist nur möglich, wenn die Datenbank noch leer ist.'))try{await api('/api/demo',{method:'POST',body:'{}'});notify('Demodaten für 2026 geladen.');year=2026;$('yearPick').value='2026';await refresh();}catch(e){notify(e.message,true);}return;}
 });
 document.addEventListener('submit',async event=>{
   const form=event.target;
   if(!['manageUserForm','houseSettingsForm','changePasswordForm','paperlessSearchForm','paperlessPrivacyForm'].includes(form.id))return;
   event.preventDefault();
   try{
     if(form.id==='paperlessSearchForm')await loadPaperlessResults();
     else if(form.id==='paperlessPrivacyForm')await verifyPaperlessPermissions(form);
     else if(form.id==='manageUserForm')await saveManagedUser(form);
     else if(form.id==='houseSettingsForm')await submitHouseSettings(form);
     else await submitOwnPassword(form);
   }catch(error){notify(error.message,true);}
 });
 $('formFields').addEventListener('change',updateModalFields);
 $('entryForm').addEventListener('submit',formSubmit);
 $('closeModal').addEventListener('click',()=>$('formDialog').close());$('cancelModal').addEventListener('click',()=>$('formDialog').close());
 $('paperlessClose').addEventListener('click',()=>$('paperlessDialog').close());
 $('mobileMenu').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
}
register();refresh();
