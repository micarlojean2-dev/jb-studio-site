// Test del formateo de horarios en 12h para el texto que ve la IA (spaBusinessHoursText).
import assert from 'node:assert/strict';

const mod = await import('../api/client-chat.js');
const { to12h, spaBusinessHoursText } = mod.__test;

console.log('to12h — casos borde:');
const casos = [
  ['00:00', '12:00 AM'],
  ['12:00', '12:00 PM'],
  ['23:30', '11:30 PM'],
  ['09:05', '9:05 AM'],
  ['00:30', '12:30 AM'],
  ['13:15', '1:15 PM'],
];
for (const [input, esperado] of casos) {
  assert.equal(to12h(input), esperado, `to12h("${input}") = "${to12h(input)}" (esperado "${esperado}")`);
  console.log(`  ✓ to12h("${input}") → "${esperado}"`);
}
assert.equal(to12h('no-es-hora'), 'no-es-hora', 'to12h devuelve tal cual si no matchea el formato');
assert.equal(to12h(''), '', 'to12h de string vacío devuelve vacío');
assert.equal(to12h(null), null, 'to12h de null devuelve null');
console.log('  ✓ to12h no rompe con formatos inválidos');

console.log('\nspaBusinessHoursText — horarios en 12h:');
const bh = {
  monday: { enabled: true, ranges: [{ start: '09:47', end: '12:47' }] },
  tuesday: { enabled: false, ranges: [] },
};
const text = spaBusinessHoursText(bh, 'es');
assert.match(text, /Lunes: 9:47 AM–12:47 PM/, `el texto debe usar 12h con AM/PM (recibido: ${text.split('\n')[0]})`);
assert.match(text, /Martes: cerrado|Martes: Cerrado|Martes: cerrado/i, 'día cerrado se muestra como tal');
console.log('  ✓ spaBusinessHoursText formatea a 12h y maneja días cerrados');

console.log('\n✅ horarios en 12h verificados');
