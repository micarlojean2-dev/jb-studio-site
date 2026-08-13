// Regression coverage for extractBooking as the modification/email parser.
import { readFileSync } from 'node:fs';

const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const CORE = window.JBChatCore;
const cfg = { menu: [{ nombre: 'Masaje Relajante' }], businessHours: null, language: 'es' };
let fallos = 0;
const ok = (condition, message) => { if (condition) console.log('  ✓', message); else { console.error('  ✗', message); fallos++; } };

console.log('Modification/email date parser regression');
ok(CORE.buildModifyUpdate('cambiar al 24 de julio', cfg, {}).fecha === '24 de julio', 'keeps explicit date');
ok(CORE.buildModifyUpdate('mi teléfono es 202-555-0147', cfg, {}).fecha === undefined, 'phone never becomes a date');
ok(CORE.buildModifyUpdate('cambiar al 31 de febrero', cfg, {}).fecha === undefined, 'impossible date is rejected');
ok(CORE.buildModifyUpdate('mejor mañana a las 2 pm', cfg, {}).fecha === 'mañana', 'relative date remains available for rescheduling');
process.exit(fallos ? 1 : 0);
