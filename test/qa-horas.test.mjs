// QA — Categoría E: horas. Frontend (chat-core: resolverHora vía extractBooking)
// desambigua AM/PM con el horario real del negocio y PIDE aclaración cuando no
// puede decidir; nunca inventa. Backend (normalizeHora) pasa a 24h para ordenar.
// Invariante: una hora inválida (25:00) nunca se guarda; una hora ambigua se
// pregunta, no se adivina.
// Ejecutar: node test/qa-horas.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;
const { __test } = await import('../api/reservations.js');
const { normalizeHora } = __test;

// Horario tipo spa: L-V 10:00-19:00, sábado 10:00-16:00, domingo cerrado.
const BH = {
  monday:    { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  tuesday:   { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  wednesday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  thursday:  { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  friday:    { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  saturday:  { enabled: true, ranges: [{ start: '10:00', end: '16:00' }] },
  sunday:    { enabled: false, ranges: [] },
};
const MENU = [{ nombre: 'Masaje Relajante' }];

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };

const hora = (t) => { const r = CORE.extractBooking(t, MENU, BH, 'es'); return { hora: r.hora, amb: r.__horaAmbigua }; };

console.log('E1. Horas ambiguas requieren AM/PM explícito');
{
  ok(!hora('a las 5').hora && hora('a las 5').amb, '"a las 5" pide AM/PM');
  ok(!hora('a las 11').hora && hora('a las 11').amb, '"a las 11" pide AM/PM');
  ok(!hora('a las 2').hora && hora('a las 2').amb, '"a las 2" pide AM/PM');
  ok(hora('a las 12').hora === '12:00 PM', '"a las 12" → 12:00 PM (mediodía)');
}

console.log('E2. Formatos explícitos');
{
  ok(hora('5 pm').hora === '5:00 PM', '"5 pm" → 5:00 PM');
  ok(hora('a las 17:00').hora === '17:00', '"17:00" → 17:00 (24h sin duda)');
  ok(hora('a las 9 am').hora === '9:00 AM', '"9 am" → 9:00 AM (aunque esté cerrado: lo dijo la persona)');
  ok(hora('a las 3:30 pm').hora === '3:30 PM', '"3:30 pm" → conserva minutos');
}

console.log('E3. Ambigüedad → pregunta, no inventa');
{
  // 8: 8am (cerrado) y 8pm (cerrado) → ninguna encaja → ambigua → preguntar.
  const r8 = hora('a las 8');
  ok(!r8.hora && r8.amb && r8.amb.n === 8, '"a las 8" (8am/8pm ambos cerrados) → pide aclaración');
  // Sin horario configurado, cualquier hora AM/PM es ambigua.
  const rSinBH = CORE.extractBooking('a las 4', MENU, null, 'es');
  ok(!rSinBH.hora && rSinBH.__horaAmbigua, 'sin horario: "a las 4" pide aclaración');
}

console.log('E4. Bare number sin contexto NO se captura como hora');
{
  ok(hora('5').hora === undefined && !hora('5').amb, '"5" suelto no se toma como hora (evita capturar cualquier número)');
}

console.log('E5. Horas inválidas nunca se guardan (backend)');
{
  ok(normalizeHora('25:00') === '', '"25:00" → "" (fuera de rango)');
  ok(normalizeHora('99') === '', '"99" → ""');
  ok(normalizeHora('abc') === '', 'texto sin número → ""');
  ok(normalizeHora('') === '', 'vacío → ""');
}

console.log('E6. Coherencia frontend↔backend (lo mostrado ↔ lo ordenado en 24h)');
{
  const casos = [
    ['5:00 PM', '17:00'], ['11:00 AM', '11:00'], ['17:00', '17:00'],
    ['12:00 PM', '12:00'], ['12:00 AM', '00:00'], ['3:30 PM', '15:30'], ['9:00 AM', '09:00'],
  ];
  for (const [visible, iso] of casos) {
    ok(normalizeHora(visible) === iso, `"${visible}" → ${iso}`);
  }
}

console.log('E7. Cambio de hora durante la reserva (categoría G)');
{
  // Se captura una hora y luego el cliente la cambia: gana la última.
  const acc = {};
  Object.assign(acc, CORE.extractBooking('a las 5 pm', MENU, BH, 'es'));
  Object.assign(acc, CORE.extractBooking('mejor a las 3 pm', MENU, BH, 'es'));
  ok(acc.hora === '3:00 PM', 'cambiar de 5pm a 3pm → queda 3:00 PM');
}

console.log('E8. Hora explícita no se confunde con personas (regresión auditoría)');
{
  const r = CORE.extractBooking('Somos 4 para el 30 de julio a las 7 pm', MENU, BH, 'es');
  ok(r.personas === '4' && r.hora === '7:00 PM', 'personas=4 y "a las 7 pm" conserva 7:00 PM');
  ok(hora('7pm').hora === '7:00 PM', '"7pm" sin espacio se reconoce como hora explícita');
}

console.log(fallos === 0 ? '\n✅ QA horas: todas pasan' : `\n❌ QA horas: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
