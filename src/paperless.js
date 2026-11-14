'use strict';
// Nur Server-seitiger Zugriff auf das Archiv. Keine Tokens/OCR-Texte an den Browser.
const crypto=require('node:crypto');
const PRIVATE_HOST=/^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+)$/i;
function error(message,status=400){return Object.assign(new Error(message),{status});}
function positiveId(value,label='Dokument'){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0||String(value).trim()!==String(n))throw error(label+': ungültige ID.');
  return n;
}
function ids(value){
  if(!/^\d+(,\d+)*$/.test(String(value||'')))return [];
  const numbers=String(value).split(',').map(Number);
  return [...new Set(numbers)].filter(n=>Number.isSafeInteger(n)&&n>0);
}
function createClient(config=process.env,send=globalThis.fetch){
  const raw=String(config.HOM_PAPERLESS_URL||'').trim();
  const token=String(config.HOM_PAPERLESS_TOKEN||'').trim();
  const release=ids(config.HOM_PAPERLESS_RELEASE_TAG_ID);
  const categories=ids(config.HOM_PAPERLESS_CATEGORY_TAG_IDS);
  let base,configError='';
  if(raw){
    try{base=new URL(raw);}catch{configError='Ungültige Paperless-Serveradresse.';}
    if(base){
      const host=base.hostname.replace(/^\[|\]$/g,'');
      if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||
         !base.hostname||base.pathname!=='/'&&base.pathname!==''){
        configError='Ungültige Paperless-Serveradresse.';
      }
      // HTTP nur für interne Docker-/LAN-Ziele, nie unverschlüsselt zum öffentlichen Server.
      if(base.protocol==='http:'&&!PRIVATE_HOST.test(host))
        configError='Paperless ohne HTTPS ist nur im Heimnetz erlaubt.';
    }
  }
  const ready=Boolean(!configError&&base&&token&&release.length===1&&categories.length>0);
  const categorySet=new Set(categories);
  // Die Prüfung wird an die konkrete Kombination aus Server, Dienst-Token und Tags gebunden.
  // Bei jeder Änderung muss erneut eine bekannte private Dokument-ID negativ getestet werden.
  function fingerprint(){
    if(!ready)return null;
    return crypto.createHash('sha256').update(JSON.stringify([base.origin,token,release[0],categories.slice().sort((a,b)=>a-b)])).digest('hex');
  }
  function status(){return {provider:'Paperless-ngx',configured:ready,read_only:true,release_tag_configured:release.length===1,categories_configured:categories.length>0,configuration_error:configError||null};}
  function requireReady(){
    if(!ready)throw error('Paperless noch nicht eingerichtet: URL, Token, Freigabe-Tag-ID und Kategorien fehlen.',503);
  }
  function pathUrl(path,params){
    const url=new URL(path,base);
    if(params)for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
    return url;
  }
  async function request(path,params){
    requireReady();
    let resp;
    try{
      resp=await send(pathUrl(path,params),{
        headers:{Authorization:'Token '+token,Accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(8000)
      });
    }catch{throw error('Paperless ist zurzeit nicht erreichbar.',502);}
    if(resp.status===401||resp.status===403)throw error('Paperless verweigert den Lesezugriff. Archivberechtigungen prüfen.',502);
    if(resp.status===404)throw error('Dokument im Archiv nicht gefunden.',404);
    if(!resp.ok)throw error('Paperless lieferte einen Fehler.',502);
    return resp;
  }
  async function limited(resp,max){
    const reader=resp.body?.getReader();
    if(!reader)throw error('Leere Antwort des Dokumentenarchivs.',502);
    let size=0;const chunks=[];
    try{
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>max)throw error('Die Antwort des Dokumentenarchivs ist zu groß.',502);
        chunks.push(Buffer.from(value));
      }
    }finally{reader.releaseLock();}
    return Buffer.concat(chunks);
  }
  async function json(path,params){
    const resp=await request(path,params);
    try{return JSON.parse((await limited(resp,2*1024*1024)).toString('utf8'));}
    catch(e){if(e?.status)throw e;throw error('Ungültige Antwort des Dokumentenarchivs.',502);}
  }
  function allowed(doc){
    const tags=Array.isArray(doc?.tags)?doc.tags.map(Number):[];
    return tags.includes(release[0])&&tags.some(id=>categorySet.has(id))&&Number.isSafeInteger(Number(doc?.id));
  }
  function publicDocument(doc){
    return {id:Number(doc.id),title:String(doc.title||'Dokument').slice(0,180),
      created:String(doc.created||'').slice(0,10),source:'paperless'};
  }
  async function search(q=''){
    requireReady();
    const query=String(q||'').trim();
    if(query.length>100)throw error('Suchbegriff zu lang.');
    // Filter auch serverseitig durchsetzen. Die API-Abfrage ist nur ein zusätzlicher Filter.
    const answer=await json('/api/documents/',{page_size:50,tags__id__all:release[0],...(query?{query}:{})});
    if(!Array.isArray(answer.results))throw error('Unerwartete Dokumentenliste.',502);
    return answer.results.filter(allowed).slice(0,30).map(publicDocument);
  }
  async function document(id){
    const documentId=positiveId(id);
    const doc=await json('/api/documents/'+documentId+'/');
    if(Number(doc.id)!==documentId||!allowed(doc))throw error('Dieses Dokument ist nicht für HOM freigegeben.',403);
    return publicDocument(doc);
  }
  async function preview(id){
    const safe=await document(id); // Bei jedem Abruf erneut Berechtigung und Tags prüfen
    const response=await request('/api/documents/'+safe.id+'/preview/');
    const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(type!=='application/pdf')throw error('Die Paperless-Vorschau ist kein PDF.',502);
    const len=Number(response.headers.get('content-length')||0);
    if(len>16*1024*1024)throw error('Die Paperless-Vorschau ist zu groß.',502);
    const data=await limited(response,16*1024*1024);
    if(data.subarray(0,5).toString()!=='%PDF-')throw error('Ungültige PDF-Vorschau.',502);
    return data;
  }
  async function privateProbe(id){
    requireReady();
    const docId=positiveId(id);
    let resp;
    try{
      resp=await send(pathUrl('/api/documents/'+docId+'/'),{
        headers:{Authorization:'Token '+token,Accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(8000)
      });
    }catch{throw error('Paperless ist nicht erreichbar.',502);}
    try{
      if(resp.status===403||resp.status===404)return {denied:true};
      if(resp.status===200)return {denied:false};
      throw error('Berechtigungsprüfung fehlgeschlagen.',502);
    }finally{await resp.body?.cancel().catch(()=>{});}
  }
  return {status,fingerprint,search,document,preview,privateProbe};
}
module.exports={createClient,positiveId};
