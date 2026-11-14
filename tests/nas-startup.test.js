'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const bcrypt=require('bcryptjs');
const repoRoot=path.join(__dirname,'..');

function bootstrap(env){
  return spawnSync(process.execPath,['-e',"require('./server')"],{
    cwd:repoRoot,env:{...process.env,...env},encoding:'utf8',timeout:20000
  });
}
test('NAS-Start: Auth initialisieren bevor der Netzwerkzugriff geprüft wird',()=>{
  const data=mkdtempSync(path.join(tmpdir(),'hom-nas-auth-test-'));
  const fresh=mkdtempSync(path.join(tmpdir(),'hom-nas-unauth-test-'));
  try{
    const hash=bcrypt.hashSync('SicheresAdminTestpasswort123!',4);
    // 1. NAS / Docker: Der Admin wird beim ersten Start angelegt.
    const initial=bootstrap({HAUSKOSTEN_DATA:data,HOST:'0.0.0.0',HOM_PASSWORD_HASH:hash});
    assert.equal(initial.status,0,initial.stderr);
    // 2. Bereits angelegter Admin: Neuladen aus SQLite funktioniert
    // auch wenn die Bootstrap-Variable später fehlt.
    const restarted=bootstrap({HAUSKOSTEN_DATA:data,HOST:'0.0.0.0',HOM_PASSWORD_HASH:''});
    assert.equal(restarted.status,0,restarted.stderr);
    // 3. Keine Benutzer und kein Hash: Das NAS darf niemals ungeschützt starten.
    const denied=bootstrap({HAUSKOSTEN_DATA:fresh,HOST:'0.0.0.0',HOM_PASSWORD_HASH:''});
    assert.notEqual(denied.status,0);
    assert.match(denied.stderr,/ohne eingerichteten Administrator/);
    // 4. Lokaler Entwicklungsbetrieb bleibt möglich.
    const local=bootstrap({HAUSKOSTEN_DATA:fresh,HOST:'127.0.0.1',HOM_PASSWORD_HASH:''});
    assert.equal(local.status,0,local.stderr);
  }finally{
    rmSync(data,{recursive:true,force:true});
    rmSync(fresh,{recursive:true,force:true});
  }
});
