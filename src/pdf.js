'use strict';
// Einfacher mehrseitiger PDF-Bericht mit Helvetica/Windows-1252; für formale Abrechnungen ist der HTML-Druck zusätzlich verfügbar.
function cp1252(text) {
  const map={'€':0x80,'–':0x96,'—':0x97,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95};
  return Buffer.from(Array.from(String(text)).map(c=>map[c]||((c.charCodeAt(0)<=255)?c.charCodeAt(0):63)));
}
function esc(s) {return cp1252(s).toString('binary').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
function linesToPdf(title, sections) {
  const all=[{text:title, size:19, bold:true},{text:`Erstellt am ${new Date().toLocaleDateString('de-DE')} · Alle Beträge in Euro`,size:9},...sections];
  const pages=[];let page=[];let y=800;
  for(const line of all){const sz=line.size||11;const spacing=line.gap||22;
    if(y<70){pages.push(page);page=[];y=800;}
    let txt=String(line.text||'');
    if(txt.length>96){ // Einfaches Umbrechen für Berichte
      const words=txt.split(' '), wrapped=[]; let current='';
      for(const w of words){if((current+' '+w).length>93){wrapped.push(current);current=w;}else current=(current+' '+w).trim();}wrapped.push(current);
      for(const part of wrapped){if(y<70){pages.push(page);page=[];y=800;}page.push({text:part,y,size:sz,bold:line.bold});y-=sz+6;}
      y-=6;
    } else {page.push({text:txt,y,size:sz,bold:line.bold});y-=spacing;}
  }
  pages.push(page);
  let id=0;const objects=[];const add=obj=>{objects.push(obj);return ++id;};
  const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds=[];
  const pagesId=add('');
  for(const pageLines of pages){
    let content='0.12 0.2 0.29 rg\n';
    for(const l of pageLines)content+=`BT /F${l.bold?'2':'1'} ${l.size} Tf 45 ${l.y} Td (${esc(l.text)}) Tj ET\n`;
    const bin=Buffer.from(content,'binary');const stream=add(`<< /Length ${bin.length} >>\nstream\n${content}endstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[pagesId-1]=`<< /Type /Pages /Kids [${pageIds.map(x=>`${x} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalog=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0];let byteLen=parts[0].length;
  for(let i=0;i<objects.length;i++){offsets.push(byteLen);const buf=Buffer.from(`${i+1} 0 obj\n${objects[i]}\nendobj\n`,'binary');parts.push(buf);byteLen+=buf.length;}
  const xref=byteLen;let tail=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<offsets.length;i++)tail+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  tail+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(Buffer.from(tail,'ascii'));return Buffer.concat(parts);
}
module.exports={linesToPdf};
