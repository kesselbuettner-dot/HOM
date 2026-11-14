'use strict';
/** Hauskosten-Manager: lokale HTTP-App mit SQLite, ohne npm-Abhängigkeiten. Node >=22.13 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {db,all,insert,del,snapshot,atomic,dataPath}=require('./src/db');
const {parseMoney,positiveNumber,euro}=require('./src/money');
const {validDate,yearReport,forecast,standingOrderEntries,contractAlerts}=require('./src/calc');
const {createXlsx}=require('./src/xlsx');
const {linesToPdf}=require('./src/pdf');
const auth=require('./src/auth');
const paperless=require('./src/paperless').createClient();
const HOST=process.env.HOST||'127.0.0.1', PORT=Number(process.env.PORT||4317);
const allowedOrigins=new Set([`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`,...(process.env.HOM_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)]);
const ROOT=path.join(__dirname,'public');
// Erst die Konten und bestehende Sitzungen laden. Vor init() ist auth.enabled
// immer false, selbst wenn HOM_PASSWORD_HASH korrekt gesetzt wurde.
auth.init(db);
if(!auth.enabled && !['127.0.0.1','localhost','::1'].includes(HOST)) {
  throw new Error('NAS-/Netzwerkbetrieb ohne eingerichteten Administrator ist aus Sicherheitsgründen gesperrt. Bitte HOM_PASSWORD_HASH für die Ersteinrichtung hinterlegen.');
}
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
function optionalDate(v,label){return v===null||v===undefined||v===''?null:day(v,label);}
function gasFactors(v){
  const calorific=v.gas_calorific_kwh_m3,condition=v.gas_condition_factor;
  if((calorific==null||calorific==='')&&(condition==null||condition===''))
    return {gas_calorific_kwh_m3:null,gas_condition_factor:null};
  if(calorific==null||calorific===''||condition==null||condition==='')
    fail('Für Gas müssen Brennwert und Zustandszahl gemeinsam hinterlegt werden.');
  const a=real(calorific,'Brennwert',30),b=real(condition,'Zustandszahl',2);
  if(a<1||b<0.1)fail('Brennwert oder Zustandszahl unplausibel.');
  return {gas_calorific_kwh_m3:a,gas_condition_factor:b};
}
function validate(table,v) {
 switch(table){
 case 'households':return {name:text(v.name,'Haushaltsname',100),area_m2:real(v.area_m2,'Wohnfläche',100000),occupants:Math.floor(real(v.occupants,'Personenzahl',1000)),active:v.active===false||v.active==='0'?0:1};
 case 'meters':{
   const role=v.role==='main'?'main':'sub'; const assigned=role==='main'?null:assertRef('households',v.household_id);
   const category=kind(v.kind),unit=text(v.unit,'Einheit',16);
   if(category==='gas'&&unit!=='m³')fail('Gaszähler werden in m³ abgelesen; bitte m³ wählen.');
   return {code:text(v.code,'Zählernummer',80),name:text(v.name,'Zählername',100),kind:category,unit,role,household_id:assigned,multiplier:real(v.multiplier||1,'Zählerfaktor',1000000),active:v.active===false||v.active==='0'?0:1};
 }
 case 'readings':{
   const r=real(v.value,'Zählerstand',1e12);const scaled=Math.round(r*1000);
   if(!Number.isSafeInteger(scaled))fail('Zählerstand ist zu groß.');
   return {meter_id:assertRef('meters',v.meter_id),date:day(v.date,'Ablesedatum'),value_milli:scaled,note:text(v.note,'Bemerkung',500,false)};
 }
 case 'tariffs':{
   const category=kind(v.kind),gas=category==='gas'?gasFactors(v):{gas_calorific_kwh_m3:null,gas_condition_factor:null};
   if(category==='gas'&&!gas.gas_calorific_kwh_m3)fail('Beim neuen Gastarif bitte Brennwert und Zustandszahl eintragen.');
   const contractStart=optionalDate(v.contract_start,'Vertragsbeginn');
   const contractEnd=optionalDate(v.contract_end,'Vertragsende');
   const deadline=optionalDate(v.cancellation_deadline,'Kündigungstermin');
   if(contractStart&&contractEnd&&contractStart>contractEnd)fail('Vertragsbeginn liegt nach Vertragsende.');
   if(deadline&&contractEnd&&deadline>contractEnd)fail('Kündigungstermin darf nicht nach dem Vertragsende liegen.');
   const days=v.reminder_days===null||v.reminder_days===undefined||v.reminder_days===''?42:Number(v.reminder_days);
   if(!Number.isSafeInteger(days)||days<0||days>365)fail('Erinnerungsvorlauf muss zwischen 0 und 365 Tagen liegen.');
   return {kind:category,provider:text(v.provider,'Versorger',120),valid_from:day(v.valid_from,'Gültig ab'),
     unit_price_eur:real(v.unit_price_eur,'Arbeitspreis',10000),base_month_eur:real(v.base_month_eur,'Grundpreis',100000),
     ...gas,contract_start:contractStart,contract_end:contractEnd,cancellation_deadline:deadline,
     reminder_days:days,cancellation_done:v.cancellation_done===true||v.cancellation_done==='1'?1:0,
     note:text(v.note,'Bemerkung',500,false),paperless_document_id:v.paperless_document_id?Number(v.paperless_document_id):null};
 }
 case 'invoices':{
   const start=day(v.period_start,'Zeitraum von'),end=day(v.period_end,'Zeitraum bis');if(start>end)fail('Rechnungszeitraum ist umgekehrt.');
   const distribution=distributions.includes(v.distribution)?v.distribution:null;if(!distribution)fail('Ungültiger Umlageschlüssel.');
   const ck=['area','persons','equal'].includes(v.common_key)?v.common_key:'area';
   let custom={};if(distribution==='custom'){
     const incoming=v.custom_weights||{};
     if(typeof incoming!=='object'||Array.isArray(incoming)||incoming===null)fail('Individuelle Gewichte müssen ein Objekt sein.');
     for (const [key,value] of Object.entries(incoming)){if(!/^\d+$/.test(key))fail('Ungültiger Haushaltschlüssel.');assertRef('households',key);custom[key]=real(value,'Individuelles Gewicht',1000000);}
   }
   const category=kind(v.kind),gasTariffId=category==='gas'?optRef('tariffs',v.gas_tariff_id):null;
   let factors={gas_calorific_kwh_m3:null,gas_condition_factor:null};
   if(gasTariffId){
     const tariff=db.prepare('SELECT * FROM tariffs WHERE id=?').get(gasTariffId);
     if(tariff.kind!=='gas')fail('Ausgewählter Tarif ist kein Gastarif.');
     if(tariff.valid_from>end)fail('Der Gastarif beginnt erst nach dem Rechnungszeitraum.');
     factors=gasFactors(tariff);
   }
   if(category==='gas'&&distribution==='meter'&&!v.household_id&&!gasTariffId)
     fail('Für eine neue Gasabrechnung nach Zählerständen bitte den Gastarif mit Brennwert/Zustandszahl auswählen.');
   if(gasTariffId&&!factors.gas_calorific_kwh_m3)
     fail('Im ausgewählten Gastarif fehlen Brennwert und Zustandszahl.');
   return {provider:text(v.provider,'Rechnungssteller',150),invoice_number:text(v.invoice_number,'Rechnungsnummer',100,false),kind:category,
     period_start:start,period_end:end,amount_cents:parseMoney(v.amount_eur),distribution,common_key:ck,
     household_id:optRef('households',v.household_id),custom_weights:JSON.stringify(custom),
     gas_tariff_id:gasTariffId,...factors,note:text(v.note,'Bemerkung',1000,false),
     paperless_document_id:v.paperless_document_id?Number(v.paperless_document_id):null};
 }
 case 'payments':return {household_id:assertRef('households',v.household_id),date:day(v.date,'Zahlungsdatum'),amount_cents:parseMoney(v.amount_eur),note:text(v.note,'Bemerkung',300,false)};
 case 'standing_orders':{
   const from=day(v.valid_from,'Gültig ab'),until=optionalDate(v.valid_until,'Gültig bis');
   if(from.slice(8)!=='01')fail('Dauerauftrag beginnt am ersten Kalendertag des Gültigkeitsmonats.');
   if(until&&until.slice(0,7)<from.slice(0,7))fail('Das Ende liegt vor dem Beginn.');
   const due=Number(v.day_of_month);
   if(!Number.isSafeInteger(due)||due<1||due>31)fail('Abbuchtungstag muss zwischen 1 und 31 liegen.');
   const amount=parseMoney(v.amount_eur);
   if(amount<=0)fail('Der monatliche Abschlag muss positiv sein.');
   return {household_id:assertRef('households',v.household_id),valid_from:from,valid_until:until,
     day_of_month:due,amount_cents:amount,note:text(v.note,'Bemerkung',300,false)};
 }
 default:fail('Unbekannter Datentyp.');
 }
}
function parseBody(req,limit=8*1024*1024){return new Promise((resolve,reject)=>{
  const chunks=[];let total=0;req.on('data',chunk=>{total+=chunk.length;if(total>limit){reject(Object.assign(new Error('Datei oder Anfrage zu groß (8 MB).'),{status:413}));req.destroy();}else chunks.push(chunk);});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch(e){reject(Object.assign(new Error('Ungültige JSON-Eingabe.'),{status:400}));}});req.on('error',reject);
});}
function paperlessApproved(){
  const fingerprint=paperless.fingerprint();
  return Boolean(fingerprint&&db.prepare("SELECT value FROM settings WHERE key='paperless_approval_fingerprint'").get()?.value===fingerprint);
}
function requirePaperlessApproval(){
  if(!paperless.status().configured)fail('Paperless nicht vollständig konfiguriert.',503);
  if(!paperlessApproved())fail('Paperless ist noch nicht freigegeben. Admin: Unter Hauseinstellungen zuerst ein bekanntes privates Archivdokument als Negativtest prüfen.',403);
}
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
   for(const [k,unit,base,values] of [['strom','kWh',18000,[6500,8000,2500]],['wasser','m³',380000,[120000,160000,80000]],['gas','m³',5000000,[1800000,2200000,800000]]]){
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
function houseTitle(){
  return db.prepare("SELECT value FROM settings WHERE key='house_title'").get()?.value||'Villa Kunterbunt';
}
function serveLogin(res){
  const safeTitle=houseTitle().replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const html=fs.readFileSync(path.join(ROOT,'login.html'),'utf8').replaceAll('{{HOUSE_TITLE}}',safeTitle);
  res.writeHead(200,{
    'Content-Type':'text/html; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  }); res.end(html);
}

async function handle(req,res){
 try{
   // Requests strictly limited to loopback via listener and expected Host; prevents DNS rebinding.
   const hostname=(req.headers.host||'').split(':')[0].toLowerCase();
   if(!['127.0.0.1','localhost'].includes(hostname))fail('Nur localhost ist erlaubt.',403);
   if(!['GET','POST','PATCH','DELETE'].includes(req.method))fail('Methode nicht erlaubt.',405);
   if(req.method!=='GET' && req.headers.origin && !allowedOrigins.has(req.headers.origin))fail('Ungültiger Ursprung.',403);
   const u=new URL(req.url,`http://${req.headers.host}`);
   const p=u.pathname;
   if (p==='/healthz' && req.method==='GET') {
     res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}); return res.end('ok');
   }
   if (auth.enabled) {
     if (p==='/login' && req.method==='GET') {
       if (auth.isAuthenticated(db,req)) return auth.redirect(res,'/');
       return serveLogin(res);
     }
     if (p==='/login' && req.method==='POST') return await auth.login(db,req,res);
     if (p==='/logout' && req.method==='POST') return auth.logout(db,req,res);
     if (['/login.css','/login.js'].includes(p) && req.method==='GET') return serveStatic(p,res);
     if (!auth.isAuthenticated(db,req)) {
       if(p.startsWith('/api/')) return send(res,401,{error:'Bitte zuerst anmelden.'});
       return auth.redirect(res,'/login');
     }
   }
   if(p.startsWith('/api/')){
     const user=auth.currentUser(db,req);
     if(req.method==='GET'&&p==='/api/paperless/status')
       return send(res,200,{...paperless.status(),verified:paperlessApproved()});
     if(req.method==='GET'&&p==='/api/paperless/documents'){
       requirePaperlessApproval();
       const list=await paperless.search(u.searchParams.get('q')||'');
       return send(res,200,{documents:list});
     }
     const previewMatch=p.match(/^\/api\/paperless\/documents\/(\d+)\/preview$/);
     if(req.method==='GET'&&previewMatch){
       requirePaperlessApproval();
       const binary=await paperless.preview(previewMatch[1]);
       res.writeHead(200,{
         'Content-Type':'application/pdf','Content-Disposition':'inline; filename="HOM-Beleg.pdf"',
         'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
         'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'"
       });return res.end(binary);
     }
     if(req.method==='POST'&&p==='/api/paperless/test-private'){
       if(user?.role!=='admin')fail('Nur Administratoren dürfen Archivberechtigungen prüfen.',403);
       const values=await parseBody(req);
       const result=await paperless.privateProbe(values.document_id);
       if(result.denied){
         db.prepare("INSERT INTO settings (key,value) VALUES ('paperless_approval_fingerprint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(paperless.fingerprint());
       }else{
         db.prepare("DELETE FROM settings WHERE key='paperless_approval_fingerprint'").run();
       }
       return send(res,200,result);
     }
     if(req.method==='GET'&&p==='/api/contracts/alerts')return send(res,200,{alerts:contractAlerts(all('tariffs'))});
     if(req.method==='GET'&&p==='/api/standing-orders/preview'){
       const y=Number(u.searchParams.get('year')||YEAR);
       if(!Number.isInteger(y)||y<2000||y>2200)fail('Ungültiges Jahr.');
       return send(res,200,{entries:standingOrderEntries(all('standing_orders'),all('payments'),y,{dueOnly:false})});
     }
     if(req.method==='POST'&&p==='/api/standing-orders'){
       const body=await parseBody(req),clean=validate('standing_orders',body);
       const changeMonth=clean.valid_from.slice(0,7);
       const newEndMonth=clean.valid_until?.slice(0,7)||'9999-12';
       const existing=db.prepare('SELECT * FROM standing_orders WHERE household_id=? ORDER BY valid_from').all(clean.household_id);
       // Feste Monatsintervalle, also kein überlappender Abschlag für einen Haushalt.
       for(const old of existing){
         const a=old.valid_from.slice(0,7),b=old.valid_until?.slice(0,7)||'9999-12';
         if(a>=changeMonth&&a<=newEndMonth)
           fail('Ab diesem Monat existiert schon ein Dauerauftrag. Bitte einen späteren Monat wählen oder den zukünftigen Eintrag löschen.');
       }
       const prevMonthEnd=new Date(Date.UTC(Number(changeMonth.slice(0,4)),Number(changeMonth.slice(5,7))-1,0)).toISOString().slice(0,10);
       const newId=atomic(()=>{
         for(const old of existing){
           const b=old.valid_until?.slice(0,7)||'9999-12';
           if(old.valid_from.slice(0,7)<changeMonth&&b>=changeMonth)
             db.prepare('UPDATE standing_orders SET valid_until=? WHERE id=?').run(prevMonthEnd,old.id);
         }
         return insert('standing_orders',clean);
       });
       return send(res,201,{ok:true,id:newId});
     }
     if(req.method==='GET'&&p==='/api/auth/me')
       return send(res,200,{user:auth.publicUser(user),auth_enabled:auth.enabled,house_title:houseTitle()});
     if(req.method==='POST'&&p==='/api/auth/password'){
       const body=await parseBody(req);
       return send(res,200,await auth.changePassword(db,req,body.current_password,body.new_password));
     }
     if(p==='/api/settings'){
       if(req.method==='GET')return send(res,200,{house_title:houseTitle()});
       if(req.method==='PATCH'){
         if(user?.role!=='admin')fail('Nur Administratoren dürfen Hauseinstellungen ändern.',403);
         const body=await parseBody(req);
         const title=text(body.house_title,'Haustitel',100);
         if(title.length<2||/[\x00-\x1F\x7F]/.test(title))fail('Haustitel muss mindestens zwei sichtbare Zeichen haben.');
         db.prepare("INSERT INTO settings (key,value) VALUES ('house_title',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(title);
         return send(res,200,{house_title:title});
       }
     }
     if(p==='/api/users'){
       if(user?.role!=='admin')fail('Nur Administratoren dürfen Benutzer verwalten.',403);
       if(req.method==='GET')return send(res,200,{users:auth.listUsers(db)});
       if(req.method==='POST'){
         const body=await parseBody(req);
         return send(res,201,{user:await auth.createUser(db,body)});
       }
     }
     const userMatch=p.match(/^\/api\/users\/(\d+)$/);
     if(userMatch&&req.method==='PATCH'){
       if(user?.role!=='admin')fail('Nur Administratoren dürfen Benutzer verwalten.',403);
       const body=await parseBody(req);
       return send(res,200,{user:await auth.updateUser(db,id(userMatch[1]),body)});
     }
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
           Hinweise:[['Abrechnung',year],['Hinweis','Rechnungen werden dem Jahr des Perioden-Enddatums zugeordnet.'],...(r.assumptions||[]).map(w=>['Dauerauftrag',w]),...r.warnings.map(w=>['Warnung',w])],
           Gasumrechnung:[['Rechnung','Versorger','Von','Bis','Brennwert kWh/m³','Zustandszahl','m³','kWh'],
             ...r.invoices.filter(i=>i.gas).map(i=>[i.id,i.provider,i.period_start,i.period_end,i.gas.calorific_kwh_m3,i.gas.condition_factor,i.gas.total_volume_m3,i.gas.total_energy_kwh])],
           Dauerauftraege:[['Datum','Haushalt-ID','Abschlag EUR','Hinweis'],
             ...(r.standing_order_entries||[]).map(e=>[e.date,e.household_id,e.amount_cents/100,'Planmäßig, nicht bankbestätigt'])]
         };
         return download(res,`Hauskosten-${year}.xlsx`,createXlsx(sheets),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
       }
       const householdId=u.searchParams.get('household')?id(u.searchParams.get('household')):null;
       if(householdId&&!r.households.some(h=>h.id===householdId))fail('Haushalt nicht gefunden.',404);
       const pdfHouseholds=householdId?r.households.filter(h=>h.id===householdId):r.households;
       const sections=[{text:`${houseTitle()} – Jahresabrechnung ${year}`,size:14,bold:true,gap:35},...pdfHouseholds.flatMap(h=>[
         {text:h.name,size:13,bold:true},{text:`Kosten: ${euro(h.cost_cents)} EUR | Abschlaege: ${euro(h.paid_cents)} EUR | Saldo: ${euro(h.balance_cents)} EUR`,size:11},
         ...Object.entries(h.by_kind).map(([k,v])=>({text:`   ${k}: ${euro(v)} EUR`,size:10,gap:17})),
         ...(householdId?r.invoices.filter(i=>i.shares[h.id]>0).flatMap(i=>[
         {text:`   Rechnung ${i.id}: ${i.provider}, ${i.kind}, ${euro(i.shares[h.id])} EUR`,size:9,gap:17},
         ...(i.gas?.households?.find(g=>g.id===h.id)?[
           {text:`   Gas: ${i.gas.households.find(g=>g.id===h.id).volume_m3.toFixed(3)} m3 = ${i.gas.households.find(g=>g.id===h.id).energy_kwh.toFixed(3)} kWh (Brennwert ${i.gas.calorific_kwh_m3}, Zustandszahl ${i.gas.condition_factor})`,size:9,gap:17}
         ]:[])
       ]):[]),
         {text:'',gap:12}
       ]),{text:householdId?`Haushalt gesamt: ${euro(pdfHouseholds[0].cost_cents)} EUR | Abschlaege: ${euro(pdfHouseholds[0].paid_cents)} EUR`:`Gesamt: ${euro(r.totals.cost_cents)} EUR | Abschlaege: ${euro(r.totals.paid_cents)} EUR`,size:12,bold:true},
         {text:'Die Aufteilung erfolgt gemaess den gespeicherten Umlageschluesseln. Rechnungen gehoeren zum Jahr ihres Perioden-Enddatums.',size:9},
         ...(r.assumptions||[]).map(a=>({text:a.replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue'),size:9})),...r.warnings.map(w=>({text:`ACHTUNG: ${w}`,size:9}))];
       return download(res,`Hauskosten-${year}${householdId?'-Haushalt-'+householdId:''}.pdf`,linesToPdf(houseTitle(),sections),'application/pdf');
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
       // Alte Backups ohne Daueraufträge bleiben wiederherstellbar.
       if(!body.tables.standing_orders)body.tables.standing_orders=[];
       const keys=['households','meters','readings','tariffs','invoices','payments','standing_orders'];
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
     const match=p.match(/^\/api\/(households|meters|readings|tariffs|invoices|payments|standing_orders)(?:\/(\d+))?$/);
     if(match){
       const table=match[1],entryId=match[2]?id(match[2]):null;
       if(req.method==='GET'&&!entryId)return send(res,200,all(table));
       if(req.method==='DELETE'&&entryId){
         const inv=table==='invoices'?db.prepare('SELECT attachment_file FROM invoices WHERE id=?').get(entryId):null;
         const changed=del(table,entryId);if(!changed)fail('Nicht gefunden.',404);
         if(inv?.attachment_file){try{fs.unlinkSync(path.join(dataPath,'attachments',path.basename(inv.attachment_file)));}catch{}}
         return send(res,200,{ok:true});
       }
       if(req.method==='POST'&&!entryId&&table!=='standing_orders'){
         const body=await parseBody(req);
         const clean=validate(table,body);
         if((table==='invoices'||table==='tariffs')&&clean.paperless_document_id!==null){
           requirePaperlessApproval();
           const doc=await paperless.document(clean.paperless_document_id);
           clean.paperless_document_id=doc.id;
         }
         if(table==='invoices'&&clean.invoice_number){
           const duplicate=db.prepare('SELECT id FROM invoices WHERE provider=? AND invoice_number=?').get(clean.provider,clean.invoice_number);
           if(duplicate)fail('Diese Rechnungsnummer ist bei diesem Rechnungssteller bereits erfasst.');
         }
         const newId=insert(table,clean);
         if(table==='invoices'&&body.attachment){try{attachment(newId,body.attachment);}catch(e){del('invoices',newId);throw e;}}
         return send(res,201,{ok:true,id:newId});
       }
       if(req.method==='PATCH'&&entryId&&table!=='standing_orders'){
         const existing=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(entryId);
         if(!existing)fail('Nicht gefunden.',404);
         const body=await parseBody(req);
         const clean=validate(table,body);
         if((table==='invoices'||table==='tariffs')&&clean.paperless_document_id!==null){
           const doc=await paperless.document(clean.paperless_document_id);
           clean.paperless_document_id=doc.id;
         }
         if(table==='invoices'&&existing.gas_tariff_id&&clean.gas_tariff_id===existing.gas_tariff_id&&existing.gas_calorific_kwh_m3&&existing.gas_condition_factor){
           // Beim späteren Bearbeiten der Rechnung historische Gasfaktoren nicht überschreiben.
           clean.gas_calorific_kwh_m3=existing.gas_calorific_kwh_m3;
           clean.gas_condition_factor=existing.gas_condition_factor;
         }
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
