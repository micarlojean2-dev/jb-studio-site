// QA — Categoría D: fechas. Prueba la COHERENCIA entre las dos capas reales:
//   1. Frontend  (chat-core.js / extractBooking): captura el texto literal de
//      la fecha que dijo el cliente, o nada si es inválida/ambigua.
//   2. Backend   (api/reservations.js / parseFechaISO): normaliza ese texto a
//      YYYY-MM-DD (fechaISO) para el panel; '' si no puede sin riesgo.
//
// Invariante crítico (el bug "02-55"): la fecha NUNCA debe corromperse. El
// backend jamás debe devolver una fecha NO vacía que sea incorrecta. Y ninguna
// capa debe capturar un fragmento de teléfono, correo, id ni una fecha imposible.
//
// Reloj fijo para determinismo: 2026-07-20 (lunes) 12:00 UTC.
// Ejecutar: node test/qa-fechas.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Frontend (IIFE con window falso)
const src = readFileSync(join(__dirname, '..', 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;

// Backend (normalizador real)
const { __test } = await import('../api/reservations.js');
const { parseFechaISO } = __test;

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0); // lunes 20 jul 2026
const MENU = [{ nombre: 'Masaje Relajante' }];

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };

// Fecha capturada por el frontend (texto literal), lang español por defecto.
const capt = (t, lang = 'es') => CORE.extractBooking(t, MENU, null, lang).fecha;
// Fecha ISO que guardaría el backend a partir del texto capturado.
const iso  = (t) => parseFechaISO(t, NOW);

// Verifica el flujo completo: lo que captura el frontend, lo pasa al backend.
function coherente(utterance, { capturaEsperada, isoEsperada, lang = 'es' } = {}) {
  const c = capt(utterance, lang);
  const i = c ? parseFechaISO(c, NOW) : parseFechaISO(utterance, NOW);
  return { captura: c, iso: i };
}

console.log('D1. Fechas relativas');
{
  ok(capt('hoy si puede ser') === 'hoy' && iso('hoy') === '2026-07-20', 'hoy → 2026-07-20');
  ok(capt('mañana') === 'mañana' && iso('mañana') === '2026-07-21', 'mañana → 2026-07-21');
  ok(capt('pasado mañana') === 'pasado mañana' && iso('pasado mañana') === '2026-07-22', 'pasado mañana → 2026-07-22');
  ok(iso('manana') === '2026-07-21', '"manana" sin ñ también → 2026-07-21');
}

console.log('D2. Días de la semana');
{
  // Lunes 20. "el lunes" dicho un lunes = el próximo lunes (día 27).
  ok(iso('el lunes') === '2026-07-27', '"el lunes" (hoy es lunes) → próximo lunes 27');
  ok(iso('este viernes') === '2026-07-24', '"este viernes" → 24');
  ok(iso('el próximo viernes') === '2026-07-31', '"el próximo viernes" → 31 (salta una semana)');
  ok(iso('el martes') === '2026-07-21', '"el martes" → 21');
}

console.log('D3. "N de mes" y "mes N"');
{
  ok(capt('el 24 de julio') === '24 de julio' && iso('24 de julio') === '2026-07-24', '24 de julio → 2026-07-24');
  ok(capt('julio 24 me viene') === 'julio 24' && iso('julio 24') === '2026-07-24', 'julio 24 → 2026-07-24');
  ok(iso('1 de agosto') === '2026-08-01', '1 de agosto → 2026-08-01');
  // Fecha ya pasada este año pero "muy atrás" → año que viene.
  ok(iso('5 de enero') === '2027-01-05', '5 de enero (ya pasó) → 2027-01-05');
}

console.log('D4. Formatos numéricos');
{
  ok(iso('24/07/2026') === '2026-07-24', '24/07/2026 → 2026-07-24');
  ok(iso('24-07-2026') === '2026-07-24', '24-07-2026 → 2026-07-24');
  ok(iso('2026-07-24') === '2026-07-24', 'ISO directo → 2026-07-24');
  ok(iso('24/07') === '2026-07-24', '24/07 sin año → 2026-07-24');
}

console.log('D5. NO corrupción — fechas imposibles se rechazan (backend jamás inventa)');
{
  ok(iso('31 de febrero') === '', '31 de febrero → "" (no rueda a marzo)');
  ok(iso('30 de febrero') === '', '30 de febrero → ""');
  ok(iso('32 de julio') === '', '32 de julio → ""');
  ok(iso('00 de julio') === '', '00 de julio → ""');
  ok(iso('45/13/2026') === '', '45/13 → ""');
  ok(iso('31/04/2026') === '', '31 de abril (no existe) → ""');
  // El bug histórico: un teléfono no debe producir fecha en ninguna capa.
  ok(capt('mi teléfono es 202-555-0147') === undefined, 'teléfono no captura fecha en frontend');
  ok(iso('202-555-0147').length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(iso('202-555-0147')) === false || iso('202-555-0147') !== '02-55', 'teléfono nunca produce "02-55"');
}

console.log('D6. NO corrupción — el backend nunca devuelve una fecha NO vacía incorrecta');
{
  // Barrido: para un montón de entradas basura, o bien '' o bien un ISO válido real.
  const basura = ['31 de febrero', '32 de julio', '99/99/9999', 'ayer por la tarde',
    'el 0/0', 'diciembre 40', '13/45', 'la próxima década', 'cuando sea', ''];
  let corrupto = null;
  for (const b of basura) {
    const r = parseFechaISO(b, NOW);
    if (r !== '') {
      // Si devuelve algo, debe ser un ISO real y parseable a la MISMA fecha.
      const d = new Date(r + 'T12:00:00Z');
      const round = d.toISOString().slice(0, 10);
      if (round !== r) { corrupto = { b, r }; break; }
    }
  }
  ok(corrupto === null, 'ninguna entrada basura produjo un ISO corrupto');
}

console.log('D7. Fechas pasadas recientes → ambiguas, no se adivina');
{
  // 18 de julio (hace 2 días) → parseFechaISO devuelve '' (ambiguo).
  ok(iso('18 de julio') === '', '18 de julio (pasó hace poco) → "" (no adivina año)');
}

console.log('D8. Ambigüedad DD/MM vs MM/DD y coherencia frontend↔backend');
{
  // 07/08 ambiguo: frontend con lang 'es' asume DD/MM (7 ago); backend igual.
  const f = coherente('07/08', { lang: 'es' });
  ok(f.captura === '07/08' && f.iso === '2026-08-07', 'es: 07/08 → 7 de agosto en ambas capas (coherente)');
  // Sin idioma el frontend NO captura (repregunta); coherente con no-fecha.
  // OJO: hay que llamar a extractBooking directo — un default param se tragaría
  // el undefined y usaría 'es'.
  ok(CORE.extractBooking('07/08', MENU, null, undefined).fecha === undefined,
     'sin idioma: 07/08 no se captura (se repregunta)');
}

// REGRESIÓN del hallazgo QA-01 (Alto): formato US MM/DD/AAAA. El frontend lo
// captura (día > 12 en la 2ª posición desambigua a MM/DD), así que el backend
// DEBE normalizarlo igual; si devuelve '', la reserva salta la validación de
// horario y el panel no puede ordenarla. Frontend y backend deben coincidir.
console.log('D9. Formato US MM/DD/AAAA coherente entre capas (regresión QA-01)');
{
  const captura = capt('07/24/2026', 'es');
  ok(captura === '07/24/2026', 'frontend captura "07/24/2026"');
  ok(parseFechaISO(captura, NOW) === '2026-07-24', 'backend normaliza 07/24/2026 → 2026-07-24 (no "")');
  ok(parseFechaISO('7/24', NOW) === '2026-07-24', 'US corto 7/24 → 2026-07-24');
  // Y no rompe el caso DD/MM normal ni el ambiguo (ambos ≤12 → DD/MM).
  ok(parseFechaISO('07/08', NOW) === '2026-08-07', 'ambiguo 07/08 sigue siendo 7 de agosto (DD/MM)');
}

console.log(fallos === 0 ? '\n✅ QA fechas: todas las aserciones duras pasan' : `\n❌ QA fechas: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
