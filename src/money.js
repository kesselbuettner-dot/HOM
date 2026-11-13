'use strict';

/** Centgenaue Beträge und deterministische Restcentverteilung. */
function parseMoney(input) {
  const str = String(input ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(str)) throw new Error('Ungültiger Geldbetrag (max. 2 Nachkommastellen).');
  const [euros, dec = ''] = str.split('.');
  const cents = Number(euros) * 100 + Number(dec.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Geldbetrag außerhalb des erlaubten Bereichs.');
  return cents;
}
function euro(cents) { return (cents / 100).toFixed(2); }
function positiveNumber(v, label, { zero = true } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (!zero && n === 0)) throw new Error(`${label}: ungültiger Wert.`);
  return n;
}
function splitCents(cents, entries) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Ungültiger Centbetrag.');
  if (!entries.length) throw new Error('Keine Empfänger für die Verteilung vorhanden.');
  const weights = entries.map(([id, weight]) => [Number(id), Number(weight)]);
  if (weights.some(([,w]) => !Number.isFinite(w) || w < 0)) throw new Error('Umlagegewichte müssen positiv sein.');
  const total = weights.reduce((s,[,w]) => s + w, 0);
  if (total <= 0) throw new Error('Keine positiven Umlagegewichte vorhanden.');
  const initial = weights.map(([id, w]) => {
    const exact = cents * (w / total);
    return { id, share: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let rest = cents - initial.reduce((s, x) => s + x.share, 0);
  initial.sort((a,b) => b.remainder - a.remainder || a.id - b.id);
  for (let i = 0; i < rest; i++) initial[i].share++;
  return Object.fromEntries(initial.map(x => [String(x.id), x.share]));
}
module.exports = { parseMoney, euro, positiveNumber, splitCents };
