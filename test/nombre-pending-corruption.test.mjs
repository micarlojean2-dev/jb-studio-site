// Regression: while "nombre" was the pending booking field, any bare free
// text was accepted as the customer's name — a price question, a bare "No",
// or a confirmation phrase like "sí, todo correcto" all got stored verbatim
// as Nombre, confirmed live three times during Bloque 2 testing:
//   Nombre: Oye, ¿cuánto cuesta el tratamiento facial?
//   Nombre: No
//   Nombre: sí, todo correcto
// Root cause: valorValido('nombre', t) had no real-vs-not check and always
// returned true, so widget.js/asistente.html's bare-answer fallback accepted
// anything. [BUG-NOMBRE-PENDIENTE]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

// The three exact reproduced cases must be rejected as a name.
check(CORE.valorValido('nombre', 'Oye, ¿cuánto cuesta el tratamiento facial?') === false,
  'a price question is not a valid name');
check(CORE.valorValido('nombre', 'No') === false, 'a bare "No" is not a valid name');
check(CORE.valorValido('nombre', 'sí, todo correcto') === false,
  'a confirmation phrase is not a valid name');
check(CORE.valorValido('nombre', 'how much is the facial treatment?') === false,
  'an English price question is not a valid name');

// Real names still work.
check(CORE.valorValido('nombre', 'Mike Standly') === true, 'a real name is still accepted');
check(CORE.valorValido('nombre', 'Ana') === true, 'a short real name is still accepted');

console.log(`nombre-pending-corruption.test.mjs: ${count} checks passed`);
