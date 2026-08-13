// Regressions retained after V2 migration: safe rendering and modification parsing.
import { readFileSync } from 'node:fs';

const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const CORE = window.JBChatCore;
const cfg = { menu: [{ nombre: 'Masaje Relajante' }], businessHours: null, language: 'es' };
let fallos = 0;
const ok = (condition, message) => { if (condition) console.log('  ✓', message); else { console.error('  ✗', message); fallos++; } };

ok(CORE.buildModifyUpdate('mike,mike@example.com 2067421261 mejor mañana a las 2 pm', cfg, {}).hora === '2:00 PM', 'email-style reschedule keeps explicit time');
ok(CORE.extractBooking('me llamo Ana y prefiero silencio', [], null, 'es').nombre === 'Ana', 'name parser stops before preference');
ok(CORE.limpiarMarcadores('texto [RESERVA_CONFIRMADA] [NOTA: silencio]') === 'texto', 'internal markers never render');
process.exit(fallos ? 1 : 0);
