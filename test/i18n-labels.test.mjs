// Regression: customer-facing labels and reservation-action texts come from
// code, are template-aware, and never mix languages. [i18n determinista]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const C = window.JBChatCore;

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

// Restaurant dish label, both languages.
check(C.summaryLabel({ templateId: 'restaurant' }, 'servicio', 'es') === 'Platillo', 'es restaurant dish = Platillo');
check(C.summaryLabel({ templateId: 'restaurant' }, 'servicio', 'en') === 'Dish', 'en restaurant dish = Dish');
// Barber keeps service wording.
check(C.summaryLabel({ templateId: 'barber' }, 'servicio', 'es') === 'Servicio', 'es barber = Servicio');
// Required Spanish/English label set.
const es = ['nombre','servicio','personas','fecha','hora','telefono','email','specialRequests']
  .map((f) => C.summaryLabel({ templateId: 'restaurant' }, f, 'es'));
assert.deepEqual(es, ['Nombre','Platillo','Personas','Fecha','Hora','Teléfono','Correo','Peticiones especiales']);
count++;
const en = ['nombre','servicio','personas','fecha','hora','telefono','email','specialRequests']
  .map((f) => C.summaryLabel({ templateId: 'restaurant' }, f, 'en'));
assert.deepEqual(en, ['Name','Dish','People','Date','Time','Phone','Email','Special requests']);
count++;

// Reservation-action texts: no cross-language leakage. Every ES string must be
// free of the tell-tale English tokens and vice-versa.
const ES = C.reservaTextos('es');
const EN = C.reservaTextos('en');
const enWords = /\b(you|your|the|reservation|cancel(led)?|change|please|now|people|modify|keep)\b/i;
const esWords = /\b(tu|tus|reserva|cancel(ar|ada)|cambiar|personas|modifica|mantener|correo|hora)\b/i;
for (const k of Object.keys(ES)) {
  // Some values are pure emoji/punctuation prefixes; only test the ones with letters.
  if (/[a-zñáéíóú]/i.test(ES[k])) check(!enWords.test(ES[k]), `ES text "${k}" has no English words: ${ES[k]}`);
  if (/[a-z]/i.test(EN[k])) check(!esWords.test(EN[k]), `EN text "${k}" has no Spanish words: ${EN[k]}`);
}

// English booking dates must be captured, or an English reservation can never
// complete (the flow keeps asking for the date). [i18n / EN booking]
const menu = [{ nombre: 'Classic Burger' }];
for (const [text, expect] of [
  ['this Friday', 'this Friday'], ['Friday', 'Friday'], ['tomorrow', 'tomorrow'],
  ['today', 'today'], ['next monday', 'next monday'], ['day after tomorrow', 'day after tomorrow'],
  ['Book a table for 2 this Friday at 1:00 PM', 'this Friday'],
]) {
  const o = C.extractBooking(text, menu, {}, 'en', { templateId: 'restaurant' });
  check(o.fecha === expect, `EN date captured from "${text}" -> ${o.fecha}`);
}
// Spanish dates unchanged.
check(C.extractBooking('el viernes', menu, {}, 'es', { templateId: 'restaurant' }).fecha === 'el viernes', 'ES date still works');

console.log(`i18n-labels.test.mjs: ${count} checks passed`);
