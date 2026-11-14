'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('HOM: Paperless-Suche und Belegverknüpfung prüfen Freigabe bei jedem Zugriff',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hom-paperless-http-'));
 const records=[{id:12,title:'Gas',created:'2026-01-01',tags:[99,3]},{id:13,title:'Privat',tags:[3]}];
 const upstream=http.createServer((req,res)=>{
  const uri=new URL(req.url,'http://localhost').pathname;
  if(req.headers.authorization!=='Token mock-service'){res.writeHead(401);return res.end();}
  if(uri==='/api/documents/'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({results:records}));}
  const match=uri.match(/^\/api\/documents\/(\d+)\/$/);
  if(match){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(records.find(d=>d.id===Number(match[1]))||{}));}
  if(uri==='/api/documents/12/preview/'){res.setHeader('Content-Type','application/pdf');return res.end('%PDF-1.4\nMock');}
  res.writeHead(404);res.end();
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 process.env.HOST='127.0.0.1';
 process.env.HAUSKOSTEN_DATA=dir;
 process.env.HOM_PAPERLESS_URL='http://127.0.0.1:'+upstream.address().port;
 process.env.HOM_PAPERLESS_TOKEN='mock-service';
 process.env.HOM_PAPERLESS_RELEASE_TAG_ID='99';
 process.env.HOM_PAPERLESS_CATEGORY_TAG_IDS='3';
 delete process.env.HOM_PASSWORD_HASH;
 const {server}=require('../server');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>upstream.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 async function call(url,method='GET',body){
  const r=await fetch(base+url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())};
 }
 let x=await call('/api/paperless/status');assert.equal(x.data.configured,true);
 x=await call('/api/paperless/documents');assert.deepEqual(x.data.documents.map(d=>d.id),[12]);
 x=await call('/api/paperless/documents/13/preview');assert.equal(x.status,403);
 x=await call('/api/paperless/documents/12/preview');assert.equal(x.status,200);assert.equal(x.data.subarray(0,5).toString(),'%PDF-');
 x=await call('/api/households','POST',{name:'Wohnung',area_m2:70,occupants:2});assert.equal(x.status,201);
 const tariff={kind:'strom',provider:'Test',valid_from:'2026-01-01',unit_price_eur:0.3,base_month_eur:12};
 x=await call('/api/tariffs','POST',{...tariff,paperless_document_id:13});assert.equal(x.status,403);
 x=await call('/api/tariffs','POST',{...tariff,paperless_document_id:12});assert.equal(x.status,201);
 x=await call('/api/tariffs');assert.equal(x.data[0].paperless_document_id,12);
 x=await call('/api/paperless/test-private','POST',{document_id:13});assert.equal(x.data.denied,false);
});
