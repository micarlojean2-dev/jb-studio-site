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

// edge cases del nombre en el paso CUSTOMER_DATA (extractNameHighConfidence).
const parseName = (t) => CORE.parseCustomerDraft(t, { name: null, phone: null, email: null }).name;
ok(parseName('mi nombre es Mike') === 'Mike', 'name parser extracts plain "mi nombre es X"');
ok(parseName('Soy Carlos y quiero una cita') === 'Carlos', 'name parser cuts "y quiero una cita" after the name');
ok(parseName('Soy Pedro y necesito algo rápido') === 'Pedro', 'name parser cuts "y necesito algo" after the name');
ok(parseName('Me llamo Luis, quisiera reservar mañana') === 'Luis', 'name parser cuts "quisiera reservar" after the name');
ok(parseName('soy Ana y tengo alergia al gluten') === 'Ana', 'name parser cuts "y tengo alergia" after the name');
ok(parseName('mi nombre es') === null, 'name parser does not store the trigger phrase as a name');
ok(parseName('me llamo') === null, 'name parser does not store "me llamo" alone as a name');
process.exit(fallos ? 1 : 0);
