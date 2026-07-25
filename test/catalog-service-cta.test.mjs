// Regression: service cards must carry a clear booking CTA and the gallery
// must be labeled as general photos, so a linked service image is never
// confused with the unlabeled business gallery. [BLOQUE-1-GALERIA]
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

// 1. Single source of truth: the copy lives in chat-core.js only.
check(CORE.galleryHeading('es') === 'Galería del negocio', 'gallery heading (es)');
check(CORE.galleryHeading('en') === 'Business gallery', 'gallery heading (en)');
check(CORE.bookServiceLabel('es') === 'Reservar este servicio', 'book label (es)');
check(CORE.bookServiceLabel('en') === 'Book this service', 'book label (en)');

// 2. The click message must contain a real booking trigger so the click
//    reliably starts the booking flow instead of just "interest" chit-chat.
const BOOKING_TRIGGERS = /reservar|agendar|cita|quiero ir|disponibilidad|appointment|reserve|reservation|book(?:ing)?|table|reserva|hora libre|turno|quiero una cita/i;
check(BOOKING_TRIGGERS.test(CORE.bookServiceMessage('Manicura', 'es', false)), 'es service message triggers booking intent');
check(BOOKING_TRIGGERS.test(CORE.bookServiceMessage('Burger', 'en', true)), 'en restaurant message triggers booking intent');
check(CORE.bookServiceMessage('Manicura', 'es', false) === 'Quiero reservar: Manicura', 'es message names the exact service');
check(CORE.bookServiceMessage('', 'es', false).indexOf('este servicio') !== -1, 'es message falls back to a generic service name');

// 3. Both rendering surfaces must consume the shared CORE functions (not a
//    locally re-typed copy of the wording), so widget.js and asistente.html
//    can never drift apart the way CORRECCION_RE did.
for (const file of ['asistente.html', 'widget.js']) {
  const source = readFileSync(join(root, file), 'utf8');
  check(/CORE\.galleryHeading\(cfg\.language\)/.test(source), `${file} uses the shared gallery heading`);
  check(/CORE\.bookServiceLabel\(cfg\.language\)/.test(source), `${file} uses the shared book-service label`);
  check(/CORE\.bookServiceMessage\(item\.nombre, cfg\.language, cfg\.templateId === 'restaurant'\)/.test(source), `${file} uses the shared book-service message`);
}

console.log(`catalog-service-cta.test.mjs: ${count} checks passed`);
