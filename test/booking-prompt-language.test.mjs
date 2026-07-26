// Regression: during an active booking turn, the model replied in Spanish
// even for English-configured clients. Root cause: the booking-mode prompt
// block appended in api/client-chat.js was 100% hardcoded Spanish, never
// restated the language directive set at the top of the system prompt, and
// gave a literal Spanish example phrase for the model to say verbatim — so a
// later, more specific instruction overrode the earlier English directive.
//
// The first fix attempt referenced the base prompt's local `langDirective`
// const from outside its scope, which throws "langDirective is not defined"
// at request time (a 500 on every booking turn) — a bug a source-text check
// alone can't see. The real fix factors it into langDirectiveFor(client), a
// small shared helper called from both places, exercised here directly.
// [BUG-BOOKING-LANG]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { __test } from '../api/client-chat.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'api/client-chat.js'), 'utf8');

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

// The helper must actually run (catches scope bugs like the ReferenceError
// above) and produce the right directive per language.
check(__test.langDirectiveFor({ language: 'en' }).includes('Always reply in English'),
  'langDirectiveFor(en) returns the English directive');
check(__test.langDirectiveFor({ language: 'es' }).includes('Responde SIEMPRE en español'),
  'langDirectiveFor(es) returns the Spanish directive');

// Isolate the booking-mode prompt block (from "ESTÁS AYUDANDO A AGENDAR" to
// its closing template-literal backtick).
const start = src.indexOf('ESTÁS AYUDANDO A AGENDAR UNA CITA AHORA MISMO.');
check(start !== -1, 'booking-mode prompt block exists');
const end = src.indexOf('`;', start);
const block = src.slice(start, end);

// The language directive must be restated inside the booking-mode block, not
// only at the top of the base prompt, so it cannot be drowned out by the
// booking-specific instructions that follow it.
check(src.slice(Math.max(0, start - 60), start).includes('${langDirectiveFor(client)}'),
  'the booking-mode block restates the language directive right before its instructions');

// The model must not be handed a literal Spanish sentence to reproduce
// verbatim for the "ready to confirm" turn — that biased it into Spanish
// regardless of the client's configured language.
check(!block.includes('¡Perfecto! Te muestro el resumen para confirmar'),
  'no literal Spanish example sentence for the "ready to confirm" turn');
check(/en el idioma indicado arriba/.test(block),
  'the "ready to confirm" instruction defers to the language directive instead of a fixed-language example');

console.log(`booking-prompt-language.test.mjs: ${count} checks passed`);
