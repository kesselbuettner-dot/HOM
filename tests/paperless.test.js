'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createClient}=require('../src/paperless');
const cfg={HOM_PAPERLESS_URL:'http://paperless:8000',HOM_PAPERLESS_TOKEN:'nur-test-token',
  HOM_PAPERLESS_RELEASE_TAG_ID:'99',HOM_PAPERLESS_CATEGORY_TAG_IDS:'3,4,5'};
const normal={id:12,title:'Gasrechnung',created:'2026-08-03',tags:[99,3],content:'Interner OCR-Geheimtext'};
const denied={id:13,title:'Lohnabrechnung Privat',tags:[200,3],content:'Geheim'};
let revoked=false,protectedAllowed=false;
let hits=[];
const mock=async (url,options)=>{
  const path=url.pathname;
  hits.push({path,headers:options.headers,redirect:options.redirect});
  if(path==='/api/documents/'){
    return Response.json({results:[normal,denied,{id:14,title:'Fremd',tags:[99,52]}]});
  }
  if(path==='/api/documents/12/')return Response.json(revoked?{...normal,tags:[3]}:normal);
  if(path==='/api/documents/13/')return protectedAllowed?Response.json(denied):new Response(null,{status:403});
  if(path==='/api/documents/12/preview/')
    return new Response(Buffer.from('%PDF-1.4\nMock-Beleg'),{headers:{'content-type':'application/pdf'}});
  return new Response(null,{status:404});
};
test('Die Anbindung bleibt ohne vollständige Konfiguration gesperrt',async()=>{
 const client=createClient({HOM_PAPERLESS_URL:cfg.HOM_PAPERLESS_URL,HOM_PAPERLESS_TOKEN:'',HOM_PAPERLESS_RELEASE_TAG_ID:'99',HOM_PAPERLESS_CATEGORY_TAG_IDS:'3'},mock);
 assert.equal(client.status().configured,false);
 await assert.rejects(client.search('gas'),{status:503});
 await assert.rejects(createClient({...cfg,HOM_PAPERLESS_CATEGORY_TAG_IDS:''},mock).search(),{status:503});
 assert.throws(()=>createClient({...cfg,HOM_PAPERLESS_URL:'http://example.com'},mock),/HTTPS/);
});
test('Nur HOM-Freigabe UND erlaubte Kategorie erscheinen – keine OCR und keine Token',async()=>{
 hits=[];revoked=false;
 const client=createClient(cfg,mock);
 const result=await client.search('gas');
 assert.deepEqual(result,[{id:12,title:'Gasrechnung',created:'2026-08-03',source:'paperless'}]);
 assert.equal(JSON.stringify(result).includes('Geheimtext'),false);
 assert.equal(JSON.stringify(result).includes(cfg.HOM_PAPERLESS_TOKEN),false);
 assert.equal(hits[0].headers.Authorization,'Token '+cfg.HOM_PAPERLESS_TOKEN);
 assert.equal(hits[0].redirect,'error');
 await assert.rejects(client.document(13),{status:502}); // Eigentlicher Dienstnutzer darf privat nicht sehen
 await assert.rejects(client.document(14),{status:404});
 const pdf=await client.preview(12);
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 revoked=true;
 await assert.rejects(client.preview(12),{status:403}); // Bereits verknüpfte Dokumente erneut prüfen
 assert.equal(hits.filter(h=>h.path.endsWith('/preview/')).length,1);
});
test('Negativtest erkennt zu breite Paperless-Berechtigungen und bestätigt gesperrte Dokumente',async()=>{
 const client=createClient(cfg,mock);
 protectedAllowed=false;
 assert.deepEqual(await client.privateProbe(13),{denied:true});
 protectedAllowed=true;
 assert.deepEqual(await client.privateProbe(13),{denied:false});
 protectedAllowed=false;
 await assert.rejects(client.privateProbe('1/../2'),{status:400});
});
test('Dokumente ohne erforderlichen Tag werden trotz API-Zugriff nicht freigegeben',async()=>{
 protectedAllowed=true;
 const client=createClient(cfg,mock);
 await assert.rejects(client.document(13),{status:403});
 protectedAllowed=false;
});
