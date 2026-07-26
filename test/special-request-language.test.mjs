// Regression: during an English booking, the special-request question mixed
// languages for the beauty (default) and barber templates — "¿Tienes alguna
// sensibilidad, alergia, embarazo, lesión o petición especial? Write "No" if
// you do not have one." Root cause: widget.js and asistente.html each
// hardcoded this question with an English branch only for the restaurant
// template. Fixed by moving it into chat-core.js's specialRequestsQuestion(),
// the single source of truth both surfaces now call. [BUG-BOOKING-LANG]
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

const enWords = /\b(you|your|do|have|any|please|write)\b/i;
const esWords = /\b(tienes|alguna|petición|especial|escribe|ninguna)\b/i;

for (const templateId of ['restaurant', 'barber', 'beauty', undefined]) {
  const es = CORE.specialRequestsQuestion(templateId, 'es');
  const en = CORE.specialRequestsQuestion(templateId, 'en');
  check(!enWords.test(es), `es question for "${templateId}" has no English words: ${es}`);
  check(!esWords.test(en), `en question for "${templateId}" has no Spanish words: ${en}`);
}

// widget.js and asistente.html must call the shared function instead of
// hardcoding their own per-template question again.
for (const file of ['widget.js', 'asistente.html']) {
  const fsrc = readFileSync(join(root, file), 'utf8');
  check(fsrc.includes('CORE.specialRequestsQuestion(cfg.templateId, lang)'),
    `${file} delegates the special-request question to CORE.specialRequestsQuestion`);
  check(!fsrc.includes('¿Tienes alguna sensibilidad, alergia, embarazo, lesión o petición especial?'),
    `${file} no longer hardcodes the special-request question inline`);
}

console.log(`special-request-language.test.mjs: ${count} checks passed`);
