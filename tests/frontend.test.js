'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function pageRender(){
 const src=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8').replace(/register\(\);refresh\(\);\s*$/,'');
 const ctx=vm.createContext({Intl,Date,Math,console,document:{getElementById:()=>({innerHTML:''})}});vm.runInContext(src,ctx);
 vm.runInContext(`db={households:[{id:1,name:'EG',area_m2:72,occupants:2,active:1}],meters:[],readings:[],tariffs:[],invoices:[],payments:[]};report={year:2026,households:[{id:1,name:'EG',area_m2:72,occupants:2,cost_cents:9800,paid_cents:9000,balance_cents:800,by_kind:{strom:9800}}],invoices:[],warnings:[],totals:{cost_cents:9800,paid_cents:9000,balance_cents:800},kinds:{strom:9800}};year=2026;`,ctx);
 return ctx;
}
test('Dashboard und Jahresabrechnung erzeugen die erwarteten HTML-Ansichten',()=>{
 const ctx=pageRender();const dashboard=vm.runInContext('dashboard()',ctx);const report=vm.runInContext('reportPage()',ctx);assert.match(dashboard,/Alles im Blick/);assert.match(dashboard,/EG/);assert.match(report,/Jahresabrechnung/);assert.match(report,/\bPDF\b/);assert.match(report,/Excel/);
});
test('Formulare für Rechnungen und Zähler lassen sich generieren',()=>{
 const ctx=pageRender();const invoice=vm.runInContext("modalFields('invoice')",ctx),meter=vm.runInContext("modalFields('meter')",ctx);assert.match(invoice,/PDF-Rechnung/);assert.match(invoice,/Umlageschlüssel/);assert.match(meter,/Zählerfaktor/);
});

test('Hausname und Benutzerverwaltung sind im Frontend sichtbar',()=>{
 const ctx=pageRender();
 vm.runInContext("houseTitle='Haus am Garten';account={id:1,username:'hom',display_name:'Administrator',role:'admin'};users=[{id:1,username:'hom',display_name:'Administrator',role:'admin',active:1}];",ctx);
 assert.match(vm.runInContext('dashboard()',ctx),/Haus am Garten/);
 assert.match(vm.runInContext('settingsPage()',ctx),/Haus am Garten/);
 assert.match(vm.runInContext('usersPage()',ctx),/Benutzerverwaltung/);
 assert.match(vm.runInContext('profilePage()',ctx),/Passwort ändern/);
 vm.runInContext("account.role='user'",ctx);
 assert.match(vm.runInContext('usersPage()',ctx),/Kein Zugriff/);
});
