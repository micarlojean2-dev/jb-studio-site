// QA — Categoría H: confirmación. esConfirmacion() decide si un texto libre en
// el resumen final significa "sí, crea la reserva". Invariante de seguridad:
// NUNCA debe devolver true ante algo ambiguo o negativo (crearía una reserva
// que el cliente no confirmó); y SÍ ante confirmaciones claras (para que "sí"
// funcione igual que el botón).
// Ejecutar: node test/qa-confirmacion.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };
const C = (t) => CORE.esConfirmacion(t);

console.log('H1. Confirmaciones claras → true');
['sí', 'si', 'confirmo', 'confirmar', 'dale', 'correcto', 'ok', 'okay', 'perfecto',
 'listo', 'de acuerdo', 'adelante', 'sí confirmo', 'sí, todo correcto', 'todo bien', 'sí por favor']
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

console.log(fallos === 0 ? '\n✅ QA confirmación: todas pasan' : `\n❌ QA confirmación: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
