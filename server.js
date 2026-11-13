'use strict';
/** Hauskosten-Manager: lokale HTTP-App mit SQLite, ohne npm-Abhängigkeiten. Node >=22.13 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {db,all,insert,del,snapshot,atomic,dataPath}=require('./src/db');
const {parseMoney,positiveNumber,euro}=require('./src/money');
const {validDate,yearReport,forecast}=require('./src/calc');
const {createXlsx}=require('./src/xlsx');
const {linesToPdf}=require('./src/pdf');
const HOST=process.env.HOST||'127.0.0.1', PORT=Number(process.env.PORT||4317);
const allowedOrigins=new Set([`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`,...(process.env.HOM_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)]);
const ROOT=path.join(__dirname,'public');
const kinds=['strom','gas','wasser','abwasser','heizung','warmwasser','muell','versicherung','grundsteuer','sonstiges'];
const distributions=['meter','area','persons','equal','custom'];
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function text(v,label,max=200,required=true){const s=String(v??'').trim();if(required&&!s)fail(`${label} fehlt.`);if(s.length>max)fail(`${label} zu lang.`);return s;}
function day(v,label){if(!validDate(v))fail(`${label}: Datum muss JJJJ-MM-TT sein.`);return v;}
function id(v,label='ID'){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)fail(`${label} ungültig.`);return n;}
function kind(v){if(!kinds.includes(v))fail('Ungültige Kostenart.');return v;}
function real(v,label,max=100000000){const n=positiveNumber(v,label);if(n>max)fail(`${label} zu groß.`);return n;}
function assertRef(table,v){const n=id(v);if(!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(n))fail(`Datensatz in ${table} nicht gefunden.`);return n;}
function optRef(table,v){return v===null||v===undefined||v===''?null:assertRef(table,v);}
function validate(table,v) {
 switch(table){
 case 'households':return {name:text(v.name,'Haushaltsname',100),area_m2:real(v.area_m2,'Wohnfläche',100000),occupants:Math.floor(real(v.occupants,'Personenzahl',1000)),active:v.active===false||v.active==='0'?0:1};
 case 'meters':{
   const role=v.role==='main'?'main':'sub'; const assigned=role==='main'?null:assertRef('households',v.household_id);
   return {code:text(v.code,'Zählernummer',80),name:text(v.name,'Zählername',100),kind:kind(v.kind),unit:text(v.unit,'Einheit',16),role,household_id:assigned,multiplier:real(v.multiplier||1,'Zählerfaktor',1000000),active:v.active===false||v.active==='0'?0:1};
 }
 case 'readings':{
   const r=real(v.value,'Zählerstand',1e12);const scaled=Math.round(r*1000);
   if(!Number.isSafeInteger(scaled))fail('Zählerstand ist zu groß.');
   return {meter_id:assertRef('meters',v.meter_id),date:day(v.date,'Ablesedatum'),value_milli:scaled,note:text(v.note,'Bemerkung',500,false)};
 }
 case 'tariffs':return {kind:kind(v.kind),provider:text(v.provider,'Versorger',120),valid_from:day(v.valid_from,'Gültig ab'),unit_price_eur:real(v.unit_price_eur,'Arbeitspreis',10000),base_month_eur:real(v.base_month_eur,'Grundpreis',100000),note:text(v.note,'Bemerkung',500,false)};
 case 'invoices':{
   const start=day(v.period_start,'Zeitraum von'),end=day(v.period_end,'Zeitraum bis');if(start>end)fail('Rechnungszeitraum ist umgekehrt.');
   const distribution=distributions.includes(v.distribution)?v.distribution:null;if(!distribution)fail('Ungültiger Umlageschlüssel.');
   const ck=['area','persons','equal'].includes(v.common_key)?v.common_key:'area';
   let custom={};if(distribution==='custom'){
     const incoming=v.custom_weights||{};
     if(typeof incoming!=='object'||Array.isArray(incoming)||incoming===null)fail('Individuelle Gewichte müssen ein Objekt sein.');
     for (const [key,value] of Object.entries(incoming)){if(!/^\d+$/.test(key))fail('Ungültiger Haushaltschlüssel.');assertRef('households',key);custom[key]=real(value,'Individuelles Gewicht',1000000);}
   }
   return {provider:text(v.provider,'Rechnungssteller',150),invoice_number:text(v.invoice_number,'Rechnungsnummer',100,false),kind:kind(v.kind),period_start:start,period_end:end,amount_cents:parseMoney(v.amount_eur),distribution,common_key:ck,household_id:optRef('households',v.household_id),custom_weights:JSON.stringify(custom),note:text(v.note,'Bemerkung',1000,false)};
 }
 case 'payments':return {household_id:assertRef('households',v.household_id),date:day(v.date,'Zahlungsdatum'),amount_cents:parseMoney(v.amount_eur),note:text(v.note,'Bemerkung',300,false)};
 default:fail('Unbekannter Datentyp.');
 }
}
function parseBody(req,limit=8*1024*1024){return new Promise((resolve,reject)=>{
  const chunks=[];let total=0;req.on('data',chunk=>{total+=chunk.length;if(total>limit){reject(Object.assign(new Error('Datei oder Anfrage zu groß (8 MB).'),{status:413}));req.destroy();}else chunks.push(chunk);});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch(e){reject(Object.assign(new Error('Ungültige JSON-Eingabe.'),{status:400}));}});req.on('error',reject);
});}
function report(year){if(!Number.isInteger(year)||year<2000||year>2200)fail('Ungültiges Abrechnungsjahr.');return yearReport(year,snapshot());}
function attachment(invoiceId,attachmentObj){
 if(!attachmentObj)return null;
 const name=text(attachmentObj.name,'PDF-Dateiname',140);
 if(!name.toLowerCase().endsWith('.pdf'))fail('Nur PDF-Rechnungen sind erlaubt.');
 const base64=text(attachmentObj.base64,'PDF-Daten',8*1024*1024);
 if(!/^[a-zA-Z0-9+/]*={0,2}$/.test(base64))fail('Ungültige PDF-Daten.');
 const bin=Buffer.from(base64,'base64');
 if(bin.length>5*1024*1024||bin.length<8||bin.subarray(0,5).toString()!=='%PDF-')fail('Keine gültige PDF-Datei oder über 5 MB.');
 const filename=`${invoiceId}-${crypto.randomUUID()}.pdf`;
 fs.writeFileSync(path.join(dataPath,'attachments',filename),bin,{flag:'wx',mode:0o600});
 db.prepare('UPDATE invoices SET attachment_name=?, attachment_file=? WHERE id=?').run(name,filename,invoiceId);
 return filename;
}
function demo(){
 if(['households','meters','readings','invoices','payments','tariffs'].some(x=>all(x).length))fail('Demodaten können nur in einer leeren Datenbank geladen werden.');
 atomic(()=>{
   const a=insert('households',{name:'Wohnung Erdgeschoss',area_m2:86,occupants:2,active:1});
   const b=insert('households',{name:'Wohnung Obergeschoss',area_m2:112,occupants:3,active:1});
   const c=insert('households',{name:'Einliegerwohnung',area_m2:58,occupants:1,active:1});
   let idx=0;
   for(const [k,unit,base,values] of [['strom','kWh',18000,[6500,8000,2500]],['wasser','m³',380000,[120000,160000,80000]],['gas','kWh',50000000,[18000000,22000000,8000000]]]){
     const main=insert('meters',{code:`DEMO-${++idx}`,name:`${k} Hauptzähler`,kind:k,unit,role:'main',household_id:null,multiplier:1,active:1});
     for(const [date,val] of [['2026-01-01',0],['2026-12-31',base]])insert('readings',{meter_id:main,date,value_milli:val,note:'Beispielwert'});
     [a,b,c].forEach((h,i)=>{
       const m=insert('meters',{code:`DEMO-${++idx}`,name:`${k} Wohnung ${i+1}`,kind:k,unit,role:'sub',household_id:h,multiplier:1,active:1});
       for(const [date,val] of [['2026-01-01',0],['2026-12-31',values[i]]])insert('readings',{meter_id:m,date,value_milli:val,note:'Beispielwert'});
     });
   }
   for(const [k,provider,amount] of [['strom','Muster-Energie AG',243000],['wasser','Muster-Wasserwerke',76000],['gas','Muster-Gas GmbH',410000],['abwasser','Muster-Kommune',59000]]){
     insert('invoices',{provider,invoice_number:'DEMO-2026',kind:k,period_start:'2026-01-01',period_end:'2026-12-31',amount_cents:amount,distribution:k==='abwasser'?'persons':'meter',common_key:'area',household_id:null,custom_weights:'{}',note:'FIKTIVE DEMODATEN'});
   }
   [[a,29000],[b,38000],[c,20000]].forEach(([h,monthly])=>{for(let i=1;i<=12;i++)insert('payments',{household_id:h,date:`2026-${String(i).padStart(2,'0')}-05`,amount_cents:monthly,note:'Demo-Abschlag'});});
   insert('tariffs',{kind:'strom',provider:'Muster-Energie AG',valid_from:'2026-01-01',unit_price_eur:0.32,base_month_eur:15,note:'Demotarif, nur zur Veranschaulichung'});
 });
}
const ct={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
function serveStatic(url,res){
  const requested=url==='/'?'/index.html':url;
  const p=path.resolve(ROOT,'.'+decodeURIComponent(requested));
  if(!p.startsWith(ROOT+path.sep))fail('Ungültiger Pfad.',403);
  if(!fs.existsSync(p)||!fs.statSync(p).isFile())fail('Nicht gefunden.',404);
  res.writeHead(200,{'Content-Type':ct[path.extname(p)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
  fs.createReadStream(p).pipe(res);
}
function download(res,filename,body,type){res.writeHead(200,{'Content-Type':type,'Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
const YEAR=new Date().getFullYear();
async function handle(req,res){
 try{
   // Requests strictly limited to loopback via listener and expected Host; prevents DNS rebinding.
   const hostname=(req.headers.host||'').split(':')[0].toLowerCase();
   if(!['127.0.0.1','localhost'].includes(hostname))fail('Nur localhost ist erlaubt.',403);
   if(!['GET','POST','PATCH','DELETE'].includes(req.method))fail('Methode nicht erlaubt.',405);
   if(req.method!=='GET' && req.headers.origin && !allowedOrigins.has(req.headers.origin))fail('Ungültiger Ursprung.',403);
   const u=new URL(req.url,`http://${req.headers.host}`);
   const p=u.pathname;
   if(p.startsWith('/api/')){
     if(req.method==='GET'&&p==='/api/state')return send(res,200,{...snapshot(),year:YEAR});
     if(req.method==='GET'&&p==='/api/report')return send(res,200,report(Number(u.searchParams.get('year')||YEAR)));
     if(req.method==='GET'&&p==='/api/forecast')return send(res,200,forecast(report(Number(u.searchParams.get('year')||YEAR)),{priceGrowth:Number(u.searchParams.get('price')??3),consumptionGrowth:Number(u.searchParams.get('consumption')??0)}));
     if(req.method==='GET'&&p==='/api/attachment'){
       const row=db.prepare('SELECT attachment_file,attachment_name FROM invoices WHERE id=?').get(id(u.searchParams.get('id')));
       if(!row?.attachment_file)fail('Keine PDF-Anlage.',404);
       const file=path.join(dataPath,'attachments',path.basename(row.attachment_file));
       if(!fs.existsSync(file))fail('PDF nicht vorhanden.',404);
       const clean=(row.attachment_name||'rechnung.pdf').replace(/["\\\/\r\n]/g,'_');
       res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${clean.replace(/[^\x20-\x7E]/g,'_')}"`,'X-Content-Type-Options':'nosniff'});
       return fs.createReadStream(file).pipe(res);
     }
     if(req.method==='GET'&&['/api/report.csv','/api/report.xlsx','/api/report.pdf'].includes(p)){
       const year=Number(u.searchParams.get('year')||YEAR),r=report(year);
       if(p.endsWith('.csv')){
         const cols=[['Haushalt','Kosten EUR','Abschläge EUR','Nachzahlung (+) / Guthaben (-) EUR'],...r.households.map(h=>[h.name,euro(h.cost_cents),euro(h.paid_cents),euro(h.balance_cents)]),['Gesamt',euro(r.totals.cost_cents),euro(r.totals.paid_cents),euro(r.totals.balance_cents)]];
         const csv='\uFEFF'+cols.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
         return download(res,`Hauskosten-${year}.csv`,Buffer.from(csv),'text/csv; charset=utf-8');
       }
       if(p.endsWith('.xlsx')){
         const sheets={
           Abrechnung:[['Jahr',year],[],['Haushalt','Wohnfläche m²','Personen','Kosten EUR','Abschläge EUR','Saldo EUR'],...r.households.map(h=>[h.name,h.area_m2,h.occupants,h.cost_cents/100,h.paid_cents/100,h.balance_cents/100]),[],['Gesamt','','',r.totals.cost_cents/100,r.totals.paid_cents/100,r.totals.balance_cents/100]],
           Rechnungen:[['Rechnung','Lieferant','Kostenart','Von','Bis','Betrag EUR'],...r.invoices.map(i=>[i.id,i.provider,i.kind,i.period_start,i.period_end,i.amount_cents/100])],
           Hinweise:[['Abrechnung',year],['Hinweis','Rechnungen werden dem Jahr des Perioden-Enddatums zugeordnet.'],...r.warnings.map(w=>['Warnung',w])]
         };
         return download(res,`Hauskosten-${year}.xlsx`,createXlsx(sheets),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
       }
       const householdId=u.searchParams.get('household')?id(u.searchParams.get('household')):null;
       if(householdId&&!r.households.some(h=>h.id===householdId))fail('Haushalt nicht gefunden.',404);
       const pdfHouseholds=householdId?r.households.filter(h=>h.id===householdId):r.households;
       const sections=[{text:`Jahresabrechnung ${year}`,size:14,bold:true,gap:35},...pdfHouseholds.flatMap(h=>[
         {text:h.name,size:13,bold:true},{text:`Kosten: ${euro(h.cost_cents)} EUR | Abschlaege: ${euro(h.paid_cents)} EUR | Saldo: ${euro(h.balance_cents)} EUR`,size:11},
         ...Object.entries(h.by_kind).map(([k,v])=>({text:`   ${k}: ${euro(v)} EUR`,size:10,gap:17})),
         ...(householdId?r.invoices.filter(i=>i.shares[h.id]>0).map(i=>({text:`   Rechnung ${i.id}: ${i.provider}, ${i.kind}, ${euro(i.shares[h.id])} EUR`,size:9,gap:17})):[]),
         {text:'',gap:12}
       ]),{text:householdId?`Haushalt gesamt: ${euro(pdfHouseholds[0].cost_cents)} EUR | Abschlaege: ${euro(pdfHouseholds[0].paid_cents)} EUR`:`Gesamt: ${euro(r.totals.cost_cents)} EUR | Abschlaege: ${euro(r.totals.paid_cents)} EUR`,size:12,bold:true},
         {text:'Die Aufteilung erfolgt gemaess den gespeicherten Umlageschluesseln. Rechnungen gehoeren zum Jahr ihres Perioden-Enddatums.',size:9},...r.warnings.map(w=>({text:`ACHTUNG: ${w}`,size:9}))];
       return download(res,`Hauskosten-${year}${householdId?'-Haushalt-'+householdId:''}.pdf`,linesToPdf('Hauskosten-Manager',sections),'application/pdf');
     }
     if(req.method==='GET'&&p==='/api/backup'){
       const tables=snapshot();const files={};
       for(const inv of tables.invoices)if(inv.attachment_file){const filepath=path.join(dataPath,'attachments',path.basename(inv.attachment_file));if(fs.existsSync(filepath))files[inv.attachment_file]=fs.readFileSync(filepath).toString('base64');}
       return download(res,`Hauskosten-Backup-${new Date().toISOString().slice(0,10)}.json`,Buffer.from(JSON.stringify({format:'hauskosten-backup-v1',created:new Date().toISOString(),tables,files},null,2)),'application/json; charset=utf-8');
     }
     if(req.method==='POST'&&p==='/api/demo') {demo();return send(res,201,{ok:true});}
     if(req.method==='POST'&&p==='/api/restore'){
       const body=await parseBody(req,40*1024*1024);
       if(body.confirm!=='RESTORE'||body.format!=='hauskosten-backup-v1'||!body.tables||!body.files)fail('Ungültiges Sicherungsformat oder Bestätigung.');
       const keys=['households','meters','readings','tariffs','invoices','payments'];
       for(const key of keys)if(!Array.isArray(body.tables[key])||body.tables[key].length>30000)fail('Ungültige Sicherungstabelle: '+key);
       const attachmentFiles={};
       for(const [name,data] of Object.entries(body.files)){
         if(!/^[a-zA-Z0-9-]+\.pdf$/.test(name))fail('Ungültiger Dateiname in Sicherung.');
         const bin=Buffer.from(data,'base64');if(bin.subarray(0,5).toString()!=='%PDF-'||bin.length>5*1024*1024)fail('Beschädigter Anhang in Sicherung.');attachmentFiles[name]=bin;
       }
       atomic(()=>{
         for(const table of [...keys].reverse())db.exec(`DELETE FROM ${table}`);
         for(const table of keys){for(const row of body.tables[table]){
           const columns=Object.keys(row).filter(k=>/^[a-z_]+$/.test(k));
           // columns can be trusted only if present in the local schema
           const allowed=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
           if(columns.some(c=>!allowed.includes(c)))fail('Unbekannte Sicherungsspalte.');
           db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(k=>row[k]));
         }}
       });
       for(const [name,data] of Object.entries(attachmentFiles))fs.writeFileSync(path.join(dataPath,'attachments',name),data);
       return send(res,200,{ok:true});
     }
     const match=p.match(/^\/api\/(households|meters|readings|tariffs|invoices|payments)(?:\/(\d+))?$/);
     if(match){
       const table=match[1],entryId=match[2]?id(match[2]):null;
       if(req.method==='GET'&&!entryId)return send(res,200,all(table));
       if(req.method==='DELETE'&&entryId){
         const inv=table==='invoices'?db.prepare('SELECT attachment_file FROM invoices WHERE id=?').get(entryId):null;
         const changed=del(table,entryId);if(!changed)fail('Nicht gefunden.',404);
         if(inv?.attachment_file){try{fs.unlinkSync(path.join(dataPath,'attachments',path.basename(inv.attachment_file)));}catch{}}
         return send(res,200,{ok:true});
       }
       if(req.method==='POST'&&!entryId){
         const body=await parseBody(req);
         const clean=validate(table,body);
         if(table==='invoices'&&clean.invoice_number){
           const duplicate=db.prepare('SELECT id FROM invoices WHERE provider=? AND invoice_number=?').get(clean.provider,clean.invoice_number);
           if(duplicate)fail('Diese Rechnungsnummer ist bei diesem Rechnungssteller bereits erfasst.');
         }
         const newId=insert(table,clean);
         if(table==='invoices'&&body.attachment){try{attachment(newId,body.attachment);}catch(e){del('invoices',newId);throw e;}}
         return send(res,201,{ok:true,id:newId});
       }
       if(req.method==='PATCH'&&entryId){
         const existing=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(entryId);
         if(!existing)fail('Nicht gefunden.',404);
         const body=await parseBody(req);
         const clean=validate(table,body);
         if(table==='invoices'&&clean.invoice_number){
           const duplicate=db.prepare('SELECT id FROM invoices WHERE provider=? AND invoice_number=? AND id<>?').get(clean.provider,clean.invoice_number,entryId);
           if(duplicate)fail('Diese Rechnungsnummer ist bei diesem Rechnungssteller bereits erfasst.');
         }
         const keys=Object.keys(clean);
         db.prepare(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...Object.values(clean),entryId);
         if(table==='invoices'&&body.attachment){
           const prior=existing.attachment_file;
           attachment(entryId,body.attachment);
           if(prior){try{fs.unlinkSync(path.join(dataPath,'attachments',path.basename(prior)));}catch{}}
         }
         return send(res,200,{ok:true,id:entryId});
       }
     }
     fail('API-Endpunkt nicht gefunden.',404);
   }
   if(req.method!=='GET')fail('Methode nicht erlaubt.',405);
   return serveStatic(p,res);
 }catch(e){
   if(e?.code==='SQLITE_CONSTRAINT_UNIQUE')return send(res,400,{error:'Ein Eintrag mit diesem Datum oder dieser Zählernummer existiert bereits.'});
   if(e?.code?.startsWith?.('SQLITE_CONSTRAINT') || /FOREIGN KEY constraint failed|UNIQUE constraint failed|CHECK constraint failed/i.test(e?.message||''))return send(res,400,{error:'Datensatz wird noch verwendet oder verletzt eine Datenbankregel.'});
   const status=e.status||500;
   if(status===500)console.error('[Fehler]',e);
   if(!res.headersSent)send(res,status,{error:status===500?'Interner Fehler. Details stehen im Terminal.':e.message});
 }
}
const server=http.createServer(handle);
if(require.main===module)server.listen(PORT,HOST,()=>console.log(`\nHauskosten-Manager gestartet: http://${HOST}:${PORT}\nDaten: ${dataPath}\nMit Strg+C beenden.\n`));
module.exports={server,handle,demo,validate};
