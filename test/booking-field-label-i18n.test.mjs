// Regression: BOOKING_FIELD_LABEL_EN must exist in widget.js and asistente.html,
// cover all 9 booking field keys, and the fallback line must use it for English
// so "Could you share your hora?" becomes "Could you share your time?".
// [BUG-FIELD-LABEL-MIX]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

const EXPECTED_EN = {
  nombre: 'name', telefono: 'phone number', email: 'email', contacto: 'contact info',
  fecha: 'date', hora: 'time', servicio: 'service', personas: 'number of people', specialRequests: 'special requests',
};

for (const file of ['widget.js', 'asistente.html']) {
  const src = readFileSync(join(root, file), 'utf8');

  check(src.includes('BOOKING_FIELD_LABEL_EN'), `${file}: BOOKING_FIELD_LABEL_EN map exists`);

  for (const [k, v] of Object.entries(EXPECTED_EN)) {
    check(src.includes(`${k}: '${v}'`) || src.includes(`${k}: "${v}"`),
      `${file}: BOOKING_FIELD_LABEL_EN maps "${k}" → "${v}"`);
  }

  check(
    /BOOKING_FIELD_LABEL_EN\[faltan\[0\]\]/.test(src),
    `${file}: fallback references BOOKING_FIELD_LABEL_EN[faltan[0]]`
  );

  const buggyPattern = /lang\s*===\s*['"]en['"]\s*\?\s*['"]Could you share your \s['"]\s*\+\s*faltan\[0\]/;
  check(!buggyPattern.test(src), `${file}: old buggy pattern (untranslated field key) is gone`);
}

console.log(`booking-field-label-i18n.test.mjs: ${count} checks passed`);
