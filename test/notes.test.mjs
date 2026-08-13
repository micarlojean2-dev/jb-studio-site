// Marker sanitation and name parsing remain shared UI safeguards.
import { readFileSync } from 'node:fs';

const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const CORE = window.JBChatCore;
let fallos = 0;
const ok = (condition, message) => { if (condition) console.log('  ✓', message); else { console.error('  ✗', message); fallos++; } };

ok(!CORE.limpiarMarcadores('Ok [NOTA: prefiero silencio]').includes('[NOTA:'), 'internal note markers stay hidden');
ok(CORE.extractBooking('me llamo María José de la Cruz', [], null, 'es').nombre === 'María José de la Cruz', 'modification parser keeps complete name');
ok(CORE.extractBooking('soy alérgico a los aceites', [], null, 'es').nombre === undefined, 'preference is not a name');
process.exit(fallos ? 1 : 0);
