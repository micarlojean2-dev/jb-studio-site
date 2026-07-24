// Regression: the menu marker follows the CUSTOMER's intent, never the
// assistant's own wording. A confirmation/goodbye that names a dish must not
// flash the menu; an explicit request must. [BUG-3]
import assert from 'node:assert/strict';
const { __test } = await import('../api/client-chat.js');
const { menuDecision } = __test;

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }
const shows = (msg, opts) => menuDecision(msg, Object.assign({ catalogEnabled: true }, opts));

// Should SHOW (user actually asked)
for (const msg of [
  'quiero ver el menú', '¿me muestras la carta?', '¿cuánto cuesta la hamburguesa?',
  '¿qué platillos tienen?', 'can I see the menu?', 'muéstrame las fotos', '¿tienen catálogo?',
  'what do you have?', 'how much is it?',
]) check(shows(msg) === true, `shows for: ${msg}`);

// Should NOT show (closing / confirmation / refusal / unrelated) — the classic
// post-confirmation "disfruta tu Hamburguesa Clásica" case lives in assistant
// text, which menuDecision never sees, so only user text matters here.
for (const msg of [
  'eso era todo, gracias', 'perfecto, muchas gracias', 'ok gracias, hasta luego',
  'ya no quiero nada más', 'no quiero postre', 'sí, confirmar', 'listo, gracias',
  '¿dónde están ubicados?', 'que tengan buen día',
]) check(shows(msg) === false, `hides for: ${msg}`);

// Mid-booking: an incidental dish mention does not flash the menu; an explicit
// menu request still does.
check(shows('quiero una hamburguesa clásica', { bookingActive: true }) === false, 'mid-booking incidental dish hides');
check(shows('muéstrame el menú primero', { bookingActive: true }) === true, 'mid-booking explicit menu shows');

// Catalog disabled: never show.
check(menuDecision('quiero ver el menú', { catalogEnabled: false }) === false, 'catalog disabled hides');

console.log(`menu-gating.test.mjs: ${count} checks passed`);
