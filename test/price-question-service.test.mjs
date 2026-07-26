// Regression: asking the price/duration of a service must not silently swap
// the service already chosen for the booking in progress. [BUG-PRECIO-SERVICIO]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

const menu = [
  { nombre: 'Corte y peinado' },
  { nombre: 'Manicura' },
  { nombre: 'Tratamiento facial' },
];
const hours = { monday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] } };

// A price/duration question about a service must not select it.
check(CORE.extractBooking('cuanto cuesta el tratamiento facial?', menu, hours, 'es', {}).servicio === undefined,
  '"cuanto cuesta" does not select the named service');
check(CORE.extractBooking('¿que precio tiene la manicura?', menu, hours, 'es', {}).servicio === undefined,
  '"que precio" does not select the named service');
check(CORE.extractBooking('how much is the facial treatment?', menu, hours, 'en', {}).servicio === undefined,
  '"how much" does not select the named service');
check(CORE.extractBooking('cuanto dura el tratamiento facial?', menu, hours, 'es', {}).servicio === undefined,
  '"cuanto dura" does not select the named service');

// A plain selection (no price language) still works.
check(CORE.extractBooking('quiero el tratamiento facial', menu, hours, 'es', {}).servicio === 'Tratamiento facial',
  'a plain service mention still selects it');
check(CORE.extractBooking('manicura', menu, hours, 'es', {}).servicio === 'Manicura',
  'a bare service name still selects it');

console.log(`price-question-service.test.mjs: ${count} checks passed`);
