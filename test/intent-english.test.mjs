// Regression: an implicit English booking intent ("I want a manicure on
// Sunday") must trigger the structured booking flow the same way its Spanish
// equivalent does, instead of silently falling back to free chat. [BUG-INTENT-EN]
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

// The catalog stores service names in Spanish only ("Manicura"), so an
// English word like "manicure" won't match it — that's a separate, larger
// catalog-i18n gap, not this bug. To isolate the intent-detection fix, use
// the literal catalog name (as a Spanish-speaking business's English-typing
// customer might, e.g. copy-pasting the menu) so extractBooking finds it.
const menu = [{ nombre: 'Manicura' }];
const hours = { monday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] } };

function parece(t) {
  const extraido = CORE.extractBooking(t, menu, hours, 'en', {});
  return CORE.pareceReserva(t, extraido);
}

check(parece('I want a Manicura on Sunday at 2pm') === true, '"I want" + service + date triggers the booking flow');
check(parece("I'd like a Manicura tomorrow") === true, '"I\'d like" triggers the booking flow');
check(parece('I need a Manicura next Tuesday') === true, '"I need" triggers the booking flow');
check(parece('Can I get a Manicura on Tuesday') === true, '"Can I" triggers the booking flow');
check(parece('quiero una manicura el domingo') === true, 'the Spanish equivalent still works (no regression)');
check(parece('the Manicura looks nice') === false, 'a plain mention with no intent word and no date/time does not trigger it');

console.log(`intent-english.test.mjs: ${count} checks passed`);
