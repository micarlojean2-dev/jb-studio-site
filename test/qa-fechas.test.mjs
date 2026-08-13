// Date authority belongs to reservations API. Free-text parsing remains only
// for explicit modification and authenticated email rescheduling.
import { readFileSync } from 'node:fs';
import { __test } from '../api/reservations.js';

const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const CORE = window.JBChatCore;
const { parseFechaISO } = __test;
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
let fallos = 0;
const ok = (condition, message) => { if (condition) console.log('  ✓', message); else { console.error('  ✗', message); fallos++; } };

console.log('Reservations API date normalization');
for (const [input, expected] of [['hoy', '2026-07-20'], ['mañana', '2026-07-21'], ['el viernes', '2026-07-24'], ['24/07/2026', '2026-07-24'], ['07/24/2026', '2026-07-24']]) {
  ok(parseFechaISO(input, NOW) === expected, `${input} normalizes safely`);
}
for (const input of ['31 de febrero', '45/13/2026', '31/04/2026', '202-555-0147']) {
  ok(parseFechaISO(input, NOW) === '', `${input} is not a valid reservation date`);
}

console.log('Modification parser only forwards valid date text');
const cfg = { menu: [], businessHours: null, language: 'es' };
ok(CORE.buildModifyUpdate('cambiar al 24 de julio', cfg, {}).fecha === '24 de julio', 'email/modification parser keeps explicit date');
ok(CORE.buildModifyUpdate('cambiar al 31 de febrero', cfg, {}).fecha === undefined, 'invalid date is not forwarded');

process.exit(fallos ? 1 : 0);
