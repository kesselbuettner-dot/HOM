'use strict';
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const dataPath = process.env.HAUSKOSTEN_DATA ? path.resolve(process.env.HAUSKOSTEN_DATA) : path.join(__dirname,'..','data');
fs.mkdirSync(path.join(dataPath,'attachments'),{recursive:true});
const db = new DatabaseSync(path.join(dataPath,'hauskosten.sqlite'));
db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS households (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, area_m2 REAL NOT NULL DEFAULT 0,
 occupants INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS meters (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 kind TEXT NOT NULL, unit TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('main','sub')),
 household_id INTEGER REFERENCES households(id) ON DELETE RESTRICT,
 multiplier REAL NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
 CHECK((role='main' AND household_id IS NULL) OR (role='sub' AND household_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS readings (
 id INTEGER PRIMARY KEY, meter_id INTEGER NOT NULL REFERENCES meters(id) ON DELETE RESTRICT,
 date TEXT NOT NULL, value_milli INTEGER NOT NULL CHECK(value_milli>=0), note TEXT NOT NULL DEFAULT '',
 UNIQUE(meter_id,date)
);
CREATE TABLE IF NOT EXISTS tariffs (
 id INTEGER PRIMARY KEY, kind TEXT NOT NULL, provider TEXT NOT NULL,
 valid_from TEXT NOT NULL, unit_price_eur REAL NOT NULL CHECK(unit_price_eur>=0),
 base_month_eur REAL NOT NULL DEFAULT 0 CHECK(base_month_eur>=0), note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS invoices (
 id INTEGER PRIMARY KEY, provider TEXT NOT NULL, invoice_number TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), distribution TEXT NOT NULL,
 common_key TEXT NOT NULL DEFAULT 'area', household_id INTEGER REFERENCES households(id) ON DELETE RESTRICT,
 custom_weights TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '',
 attachment_name TEXT, attachment_file TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 date TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS standing_orders (
 id INTEGER PRIMARY KEY,
 household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
 valid_from TEXT NOT NULL,
 valid_until TEXT,
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
function addMissingColumns(table,definitions){
  const known=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
  for(const [name,definition] of Object.entries(definitions)) {
    if(!known.has(name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}
// Additive Schema-Migration – bestehende Beträge, Zählerstände und Benutzer bleiben unverändert.
addMissingColumns('tariffs',{
  gas_calorific_kwh_m3:'REAL',
  gas_condition_factor:'REAL',
  contract_start:'TEXT',
  contract_end:'TEXT',
  cancellation_deadline:'TEXT',
  reminder_days:'INTEGER NOT NULL DEFAULT 42',
  cancellation_done:'INTEGER NOT NULL DEFAULT 0'
});
addMissingColumns('invoices',{
  gas_calorific_kwh_m3:'REAL',
  gas_condition_factor:'REAL',
  gas_tariff_id:'INTEGER'
});
function all(table) {
  const valid=['households','meters','readings','tariffs','invoices','payments','standing_orders','settings'];
  if (!valid.includes(table)) throw new Error('Ungültige Tabelle.');
  return db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
}
function snapshot() { return Object.fromEntries(['households','meters','readings','tariffs','invoices','payments','standing_orders'].map(k=>[k,all(k)])); }
function insert(table,values) {
  if (!['households','meters','readings','tariffs','invoices','payments','standing_orders'].includes(table)) throw new Error('Ungültiger Datentyp.');
  const keys=Object.keys(values);if(!keys.length)throw new Error('Keine Angaben.');
  const stmt=db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
  const rv=stmt.run(...Object.values(values));return Number(rv.lastInsertRowid);
}
function del(table,id) {
  if (!['households','meters','readings','tariffs','invoices','payments','standing_orders'].includes(table)) throw new Error('Ungültiger Datentyp.');
  return Number(db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id).changes);
}
function atomic(fn) { db.exec('BEGIN IMMEDIATE'); try {const r=fn(); db.exec('COMMIT');return r;} catch(e){db.exec('ROLLBACK');throw e;} }
module.exports={db,all,insert,del,snapshot,atomic,dataPath};
