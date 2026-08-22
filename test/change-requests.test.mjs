// Detección de intención de editar campos del resumen por chat.
// Cubre isChangeDateRequest/isChangeTimeRequest/isChangeCustomerRequest y
// confirma que no se solapan entre sí ni con isChangeServiceRequest.
import { readFileSync } from 'node:fs';

const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const CORE = window.JBChatCore;

let fallos = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.error('  ✗', msg); fallos++; }
}

function detect(t) {
  if (CORE.isChangeDateRequest(t)) return 'date';
  if (CORE.isChangeTimeRequest(t)) return 'time';
  if (CORE.isChangeCustomerRequest(t)) return 'customer';
  if (CORE.isChangeServiceRequest(t)) return 'service';
  return null;
}

const casos = [
  // ── fecha (ES) ──
  ['quiero cambiar la fecha', 'date'],
  ['puedes cambiar de día?', 'date'],
  ['otra fecha por favor', 'date'],
  ['quiero mover la cita de día', 'date'],
  ['quisiera cambiar el día', 'date'],
  // ── fecha (EN) ──
  ['I want to change the date', 'date'],
  ['another day', 'date'],
  ['can I pick a different day?', 'date'],
  // ── hora (ES) ──
  ['quiero cambiar la hora', 'time'],
  ['cambio de horario', 'time'],
  ['otra hora', 'time'],
  ['puedes atrasar la hora?', 'time'],
  // ── hora (EN) ──
  ['I want to change the time', 'time'],
  ['different slot please', 'time'],
  ['pick another time', 'time'],
  // ── datos (ES) ──
  ['quiero cambiar mis datos', 'customer'],
  ['corregir mi teléfono', 'customer'],
  ['mi email está mal', 'customer'],
  ['mi nombre quedó equivocado', 'customer'],
  // ── datos (EN) ──
  ['I need to change my details', 'customer'],
  ['fix my name', 'customer'],
  ['my email is wrong', 'customer'],
  // ── servicio (no debe solapar) ──
  ['quiero cambiar el servicio', 'service'],
  ['change the service', 'service'],
  ['quiero otro corte', 'service'],
  // ── negativos ──
  ['hola', null],
  ['¿qué hora tienen?', null],
  ['gracias', null],
  ['adelante', null],
];

console.log('\nDetección de intención de cambio por chat:');
for (const [texto, esperado] of casos) {
  const got = detect(texto);
  ok(got === esperado, `${JSON.stringify(texto)} → ${got} (esperado ${esperado})`);
}

console.log('\nSin solape entre campos:');
// "cambiar de hora" no debe activar servicio, "cambiar la fecha" no hora, etc.
ok(detect('quiero cambiar de hora') === 'time', '"cambiar de hora" → time, no service');
ok(detect('quiero cambiar de fecha') === 'date', '"cambiar de fecha" → date, no time');
ok(detect('quiero cambiar de servicio') === 'service', '"cambiar de servicio" → service');
ok(detect('change the date') === 'date', '"change the date" → date');
ok(detect('change the time') === 'time', '"change the time" → time');
ok(detect('change the service') === 'service', '"change the service" → service');

console.log(`\n${fallos === 0 ? '✅ Detección de cambio verificada' : `❌ ${fallos} fallo(s)`}`);
process.exit(fallos > 0 ? 1 : 0);
