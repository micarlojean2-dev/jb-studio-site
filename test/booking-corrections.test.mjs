import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreSource = readFileSync(join(root, 'chat-core.js'), 'utf8');
const assistant = readFileSync(join(root, 'asistente.html'), 'utf8');
const widget = readFileSync(join(root, 'widget.js'), 'utf8');
const win = {};
new Function('window', coreSource)(win);
const CORE = win.JBChatCore;

let checks = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log('  ✓', message);
}

console.log('Correcciones de reserva');
['Juan Pérez', 'María José', 'Jean-Baptiste'].forEach((name) => {
  ok(CORE.valorValido('nombre', name), `acepta el nombre "${name}"`);
});
['ya te lo dije', 'eso mismo', 'te dije antes', 'como te dije'].forEach((reply) => {
  ok(!CORE.valorValido('nombre', reply), `rechaza la frase conversacional "${reply}"`);
});
ok(CORE.campoCorreccion('el correo está mal') === 'email', 'detecta corrección de correo');
ok(CORE.campoCorreccion('me equivoqué con el teléfono') === 'telefono', 'detecta corrección de teléfono');
ok(CORE.campoCorreccion('el nombre está incorrecto') === 'nombre', 'detecta corrección de nombre');
ok(CORE.campoCorreccion('perdón, el correo lo puse mal') === 'email', 'detecta la variante “lo puse mal”');

const menu = [{ nombre: 'Masaje Relajante' }];
ok(CORE.extractBooking('micarlojean2@gmail.com', menu, null, 'es').email === 'micarlojean2@gmail.com', 'extrae el nuevo correo');
ok(CORE.extractBooking('206-742-1261', menu, null, 'es').telefono === '206-742-1261', 'extrae el nuevo teléfono');
ok(CORE.extractBooking('me llamo María López', menu, null, 'es').nombre === 'María López', 'extrae el nuevo nombre');
ok(CORE.extractBooking('quiero reservar Masaje Relajante mañana a las 2 pm', menu, null, 'es').servicio === 'Masaje Relajante', 'la captura normal de reserva sigue activa');

for (const [name, source] of [['asistente', assistant], ['widget', widget]]) {
  ok(source.includes('function pedirCorreccion(campo, lang)'), `${name} pide exclusivamente el campo corregido`);
  ok(source.includes("delete bookingData[campo];\n    bookingStep = 1;\n    bookingPending = campo;"), `${name} borra el valor anterior y deja el campo pendiente`);
  ok(source.includes('else if (CORE.campoCorreccion(t)) pedirCorreccion(CORE.campoCorreccion(t), lang);'), `${name} permite corregir desde el resumen`);
  // ETAPA 2: la detección de corrección ya no ocurre sobre `traidos` de
  // CORE.extractBooking() (regex, síncrono) sino sobre `mergeResult.traidos`
  // de CORE.mergeBookingEntities() (a partir de interpretation.entities de
  // la IA, dentro de askBookingTurn) — el nombre de la variable cambió, la
  // garantía de comportamiento ("¿el campo que mencionó la corrección
  // realmente llegó con valor nuevo?") es idéntica.
  ok(source.includes('if (campoCorreccionDetectado && mergeResult.traidos.indexOf(campoCorreccionDetectado) === -1)'), `${name} mantiene el botón de modificar y las correcciones sin valor`);
}

console.log(`✅ Correcciones de reserva verificadas (${checks} checks)`);
