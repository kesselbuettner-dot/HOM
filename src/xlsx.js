'use strict';
// Minimaler OpenXML-XLSX-Export, ohne externe Abhängigkeiten.
const zlib=require('node:zlib');
const escapeXml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
let table=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);return c>>>0;});
function crc32(data) {let c=0xFFFFFFFF;for(let i=0;i<data.length;i++)c=table[(c^data[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function zip(entries) {
  const chunks=[], dir=[];let offset=0;
  for(const [name,body] of Object.entries(entries)){
    const filename=Buffer.from(name), raw=Buffer.from(body), compressed=zlib.deflateRawSync(raw);
    const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(8,8);head.writeUInt32LE(crc32(raw),14);head.writeUInt32LE(compressed.length,18);head.writeUInt32LE(raw.length,22);head.writeUInt16LE(filename.length,26);
    chunks.push(head,filename,compressed);
    const d=Buffer.alloc(46);d.writeUInt32LE(0x02014b50,0);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt16LE(8,10);d.writeUInt32LE(crc32(raw),16);d.writeUInt32LE(compressed.length,20);d.writeUInt32LE(raw.length,24);d.writeUInt16LE(filename.length,28);d.writeUInt32LE(offset,42);dir.push(d,filename);
    offset+=head.length+filename.length+compressed.length;
  }
  const dirsize=dir.reduce((s,b)=>s+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(dirsize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,...dir,end]);
}
function colName(i) { let name='';for(i++;i;i=Math.floor((i-1)/26))name=String.fromCharCode(65+(i-1)%26)+name;return name; }
function sheet(rows) {return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="17"/><sheetData>${rows.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>{const ref=colName(c)+(r+1);return typeof v==='number'&&Number.isFinite(v)?`<c r="${ref}"><v>${v}</v></c>`:`<c r="${ref}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData></worksheet>`;}
function createXlsx(sheets) {
  const names=Object.keys(sheets);
  const entries={
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name,i)=>`<sheet name="${escapeXml(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`
  };
  names.forEach((name,i)=>entries[`xl/worksheets/sheet${i+1}.xml`]=sheet(sheets[name]));
  return zip(entries);
}
module.exports={createXlsx};
