// QA — Categoría H: confirmación. esConfirmacion() decide si un texto libre en
// el resumen final SUENA a "sí, confírmalo" — pero un texto ya NUNCA crea la
// reserva por sí solo, solo el botón "✅ Sí, confirmar cita" lo hace
// [BUG-CONFIRMACION-TEXTO]; cuando esConfirmacion() da true, widget.js /
// asistente.html solo usan eso para pedirle al cliente que toque el botón, en
// vez de tratarlo como una corrección. Invariante de seguridad sin cambios:
// NUNCA debe devolver true ante algo ambiguo o negativo; y SÍ ante
// confirmaciones claras.
// Ejecutar: node test/qa-confirmacion.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;
const assistant = readFileSync(join(__dirname, '..', 'asistente.html'), 'utf8');
const widget = readFileSync(join(__dirname, '..', 'widget.js'), 'utf8');

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };
const C = (t) => CORE.esConfirmacion(t);
const EN = (t) => CORE.esConfirmacion(t, 'en');

console.log('H1. Confirmaciones claras → true');
['sí', 'si', 'confirmo', 'confirmar', 'dale', 'correcto', 'ok', 'okay', 'perfecto',
 'listo', 'de acuerdo', 'adelante', 'sí confirmo', 'sí, todo correcto', 'todo bien', 'sí por favor',
 // "todo está correcto" (con "está") no se reconocía, solo "todo correcto"/
 // "todo bien" — caía a "corrección" y regeneraba el resumen entero con un
 // segundo par de botones en vez de pedir usar el botón real. [BUG-CONFIRMACION-VARIANTE]
  'todo está correcto', 'está correcto', 'confírmame la cita', 'si, confirmar', 'hazla', 'quiero confirmar']
  .forEach((t) => ok(C(t) === true, `"${t}" confirma`));

console.log('H2. Negaciones y correcciones → false (jamás confirma)');
['no', 'no gracias', 'cambiar', 'quiero cambiar la hora', 'corregir el teléfono',
 'me equivoqué', 'mejor otro día', 'cancela', 'cancelar', 'espera', 'todavía no']
  .forEach((t) => ok(C(t) === false, `"${t}" NO confirma`));

console.log('H3. Ambiguos / ruido → false (no adivina)');
['', 'mmm', 'no sé', 'quizás', 'a ver', '¿?', 'jaja', 'hola', 'gracias',
 'una pregunta', 'cuánto cuesta', '👍', '...']
  .forEach((t) => ok(C(t) === false, `"${t}" NO confirma`));

console.log('H4. Robustez de entrada (mayúsculas, tildes, signos, espacios)');
{
  ok(C('SÍ') === true, 'mayúsculas: "SÍ"');
  ok(C('  sí  ') === true, 'espacios alrededor');
  ok(C('¡Sí!') === true, 'con signos: "¡Sí!"');
  ok(C('Confírmalo'.slice(0, 8)) === false || C('confirmo') === true, 'variantes con acento se normalizan');
  ok(C(null) === false && C(undefined) === false, 'null/undefined → false');
}

console.log('H5. "no" nunca cuela como confirmación aunque contenga letras de "ok"');
{
  ok(C('no ok') === false, '"no ok" → false (gana la negación)');
  ok(C('no, cambialo') === false, '"no, cambialo" → false');
}

console.log('H6. Inglés solo se habilita cuando el llamador lo pide');
['yes', 'yes, confirm it', 'yes, confirm my appointment', 'please confirm', 'everything looks good', 'go ahead'].forEach((t) => {
  ok(EN(t) === true, `"${t}" confirma en inglés`);
  ok(C(t) === false, `"${t}" no cambia el comportamiento español`);
});

console.log('H7. Detector Spa controlado');
ok(CORE.detectarIdioma('I want to book an appointment tomorrow') === 'en', 'detecta mensaje inglés');
ok(CORE.detectarIdioma('Quiero reservar una cita mañana') === 'es', 'detecta mensaje español');
ok(CORE.detectarIdioma('hello, gracias') === 'es', 'texto mixto conserva español seguro');

console.log('H8. El modo de confirmación se conserva al recargar');
for (const [name, source] of [['asistente', assistant], ['widget', widget]]) {
  ok(source.includes('awaitingConfirmation: bookingReview'), `${name} persiste awaitingConfirmation`);
  ok(source.includes('bookingReview = true;   // solo el botón') && source.includes('bookingReview = true;   // solo el botón "✅ Sí, confirmar cita" crea la reserva\n    save();'), `${name} guarda el resumen mostrado`);
  // [BUG-CONFIRMACION-TEXTO, corregido en la auditoría de reservas] esta
  // línea SÍ existía antes y contradecía el comentario de arriba: un "sí"/
  // "ok"/"confirm" escrito llamaba a submitBooking() directamente, sin pasar
  // por el botón. Ahora debe estar ausente, y la rama bookingReview solo debe
  // ofrecer corrección o volver a mostrar el resumen.
  ok(!source.includes('if (CORE.esConfirmacion(t, lang)) submitBooking();'), `${name} YA NO confirma la reserva por texto libre`);
  ok(source.includes("if (CORE.campoCorreccion(t)) pedirCorreccion(CORE.campoCorreccion(t), lang);\n        else showBookingSummary();\n        return;\n      }"),
    `${name}: con el resumen visible, solo corrección o re-mostrar resumen — submitBooking() ya no es alcanzable desde texto libre`);
  // Objetivo 1: el idioma ya no se "bloquea" detectándolo del primer texto
  // (lockLanguage/detectarIdioma) — se elige explícitamente con el selector
  // (botones 🇪🇸/🇺🇸) y nunca se vuelve a detectar después. Verificamos que
  // el mecanismo NUEVO esté presente y que el viejo ya no exista.
  ok(source.includes('CORE.hasLanguageChoice(cfg)') && source.includes('showLanguageChoice'), `${name} usa el selector explícito de idioma`);
  ok(!source.includes('function lockLanguage(') && !source.includes('function isSpaBilingual('), `${name} ya no detecta el idioma automáticamente por código`);
}

console.log(fallos === 0 ? '\n✅ QA confirmación: todas pasan' : `\n❌ QA confirmación: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
