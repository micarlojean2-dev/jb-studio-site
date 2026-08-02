// Regression: the menu marker follows the CUSTOMER's intent, never the
// assistant's own wording. A confirmation/goodbye that names a dish must not
// flash the menu; an explicit request must. [BUG-3]
import assert from 'node:assert/strict';
const { __test } = await import('../api/client-chat.js');
const { menuDecision, galleryDecision, markerDecisions } = __test;

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }
const shows = (msg, opts) => menuDecision(msg, Object.assign({ catalogEnabled: true }, opts));

// Should SHOW (user actually asked to browse: pide servicios, pregunta qué
// ofrecen, o el equivalente de un botón de catálogo)
for (const msg of [
  'quiero ver el menú', '¿me muestras la carta?',
  '¿qué platillos tienen?', 'can I see the menu?', '¿tienen catálogo?',
  'what do you have?', 'quiero ver los servicios', '¿qué servicios ofrecen?', '¿qué venden?',
]) check(shows(msg) === true, `shows for: ${msg}`);

// Regression: asking for photos/the gallery/the place is a DIFFERENT request
// from the service catalog — it must show only the gallery, never force the
// whole catalog open by itself. Before, "foto"/"imagen" lived inside
// MENU_EXPLICIT, so a bare photo request also flashed all the service cards;
// and "quiero ver el lugar" / "enséñame la galería" matched nothing at all,
// so the assistant showed no photos even when 5 real images existed.
// [BUG-FOTOS-GALERIA]
for (const msg of [
  'muéstrame las fotos del spa', 'quiero ver el lugar', '¿tienen imágenes?',
  'enséñame la galería', 'quiero ver fotos de los servicios', 'muéstrame las fotos',
  'quiero conocer el spa',
]) check(galleryDecision(msg) === true, `gallery shows for: ${msg}`);
for (const msg of [
  'quiero ver el menú', 'quiero ver los servicios', '¿cuánto cuesta el masaje?', 'hola buenas',
]) check(galleryDecision(msg) === false, `gallery hides for: ${msg}`);
// A bare photo request no longer flags the service catalog by itself.
check(shows('muéstrame las fotos') === false, 'bare photo request does not open the full catalog');
check(shows('¿tienen imágenes?') === false, 'bare image request does not open the full catalog');
const catalogOnly = markerDecisions('quiero ver los servicios', { catalogEnabled: true });
check(catalogOnly.showMenu === true && catalogOnly.showGallery === false, 'catalog request renders only the catalog');

// Should NOT show (closing / confirmation / refusal / unrelated) — the classic
// post-confirmation "disfruta tu Hamburguesa Clásica" case lives in assistant
// text, which menuDecision never sees, so only user text matters here.
for (const msg of [
  'eso era todo, gracias', 'perfecto, muchas gracias', 'ok gracias, hasta luego',
  'ya no quiero nada más', 'no quiero postre', 'sí, confirmar', 'listo, gracias',
  '¿dónde están ubicados?', 'que tengan buen día',
]) check(shows(msg) === false, `hides for: ${msg}`);

// Regression: a follow-up question about the ALREADY-CHOSEN item ("precio",
// "servicio", "tratamiento" are generic words that show up naturally in any
// such follow-up) must NOT re-show the whole catalog — only a genuine
// "show me the catalog" request does. Bug reproduced live: asking "¿cuánto
// dura ese servicio?" right after picking one re-flashed all the service
// cards. [BUG-CATALOGO-REPETIDO]
for (const msg of [
  '¿cuánto cuesta la hamburguesa?', 'how much is it?', '¿cuánto dura ese servicio?',
  '¿y el precio?', 'ese tratamiento me interesa', 'quiero saber más de ese producto',
]) check(shows(msg) === false, `does not re-show catalog for follow-up: ${msg}`);

// Mid-booking: an incidental dish mention does not flash the menu; an explicit
// menu request still does.
check(shows('quiero una hamburguesa clásica', { bookingActive: true }) === false, 'mid-booking incidental dish hides');
check(shows('muéstrame el menú primero', { bookingActive: true }) === true, 'mid-booking explicit menu shows');

// Catalog disabled: never show.
check(menuDecision('quiero ver el menú', { catalogEnabled: false }) === false, 'catalog disabled hides');

console.log(`menu-gating.test.mjs: ${count} checks passed`);

// Regression: DeepSeek retired 'deepseek-chat' — the resolver must map the dead
// name (and empty) to a currently-valid model, but keep an explicit valid one. [BUG-MODEL]
const { resolveDeepseekModel } = __test;
if (resolveDeepseekModel('deepseek-chat') !== 'deepseek-v4-flash') throw new Error('deepseek-chat must map to deepseek-v4-flash');
if (resolveDeepseekModel('') !== 'deepseek-v4-flash') throw new Error('empty model must map to deepseek-v4-flash');
if (resolveDeepseekModel(undefined) !== 'deepseek-v4-flash') throw new Error('undefined model must map to deepseek-v4-flash');
if (resolveDeepseekModel('deepseek-v4-pro') !== 'deepseek-v4-pro') throw new Error('explicit valid model must be kept');
console.log('deepseek model resolver: 4 checks passed');
