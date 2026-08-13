// QA de horas: el parser solo protege modificación explícita y reagendado por
// email. Las nuevas reservas V2 eligen slots devueltos por reservations API.
import { readFileSync } from 'node:fs';
import { __test } from '../api/reservations.js';

const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const CORE = window.JBChatCore;
const { normalizeHora } = __test;
const BH = {
  monday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  saturday: { enabled: true, ranges: [{ start: '10:00', end: '16:00' }] },
};
const cfg = { menu: [], businessHours: BH, language: 'es' };
let fallos = 0;
const ok = (condition, message) => { if (condition) console.log('  ✓', message); else { console.error('  ✗', message); fallos++; } };
const update = text => CORE.buildModifyUpdate(text, cfg, {});

console.log('Modification parser resolves a single valid meridiem');
ok(update('cambiar a las 5').hora === '5:00 PM', '5 resolves to 5:00 PM');
ok(update('cambiar a las 11').hora === '11:00 AM', '11 resolves to 11:00 AM');
ok(update('cambiar a las 2').hora === '2:00 PM', '2 resolves to 2:00 PM');

console.log('Modification parser requests clarification when needed');
const ambiguous = update('cambiar a las 8');
ok(!ambiguous.hora && ambiguous.__horaAmbigua?.n === 8, '8 remains ambiguous when both options are closed');
ok(update('cambiar a las 4').__horaAmbigua === undefined && update('cambiar a las 4').hora === '4:00 PM', '4 resolves from hours');

console.log('Explicit and backend-normalized times remain valid');
ok(update('cambiar a las 3:30 pm').hora === '3:30 PM', 'explicit minutes are preserved');
ok(update('cambiar a las 9 am').hora === undefined, 'out-of-hours time is not submitted');
for (const [visible, iso] of [['5:00 PM', '17:00'], ['11:00 AM', '11:00'], ['3:30 PM', '15:30']]) {
  ok(normalizeHora(visible) === iso, `${visible} normalizes to ${iso}`);
}
ok(normalizeHora('25:00') === '', 'invalid backend time is rejected');

process.exit(fallos ? 1 : 0);
