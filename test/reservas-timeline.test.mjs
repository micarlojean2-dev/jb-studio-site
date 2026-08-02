// Rediseño del Panel del Dueño / Agenda de Reservas (reservas.html):
// clasificación temporal (future/today/tomorrow/past/cancelled/invalid),
// orden (futuras arriba, pasadas abajo), y que "Próximas citas" ya no
// cuenta citas pasadas. Ejecución real: carga el HTML real en jsdom
// (mismo patrón que test/panel.test.mjs) y llama a las funciones reales,
// nunca las reimplementa.
// Ejecutar: node test/reservas-timeline.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'reservas.html'), 'utf8');

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://jbstudio.app/reservas/timeline-test' });
const { window } = dom;

// "Ahora" fijo: 2026-01-15 03:00 UTC. En America/Los_Angeles (UTC-8, sin
// horario de verano en enero) son las 19:00 del día 14 — "hoy" para ese
// negocio es el 14. En Asia/Tokyo (UTC+9) son las 12:00 del día 15 — "hoy"
// para ese negocio es el 15. Mismo instante real, "hoy" distinto según
// reservation.timezone — así se prueba que NO se usa una sola fecha global.
const FIXED_NOW = Date.UTC(2026, 0, 15, 3, 0);
window.Date.now = () => FIXED_NOW;

console.log('1. reservationTemporalState() — clasificación por día, respetando reservation.timezone');
{
  const LA = 'America/Los_Angeles';
  const TOKYO = 'Asia/Tokyo';
  ok(window.reservationTemporalState({ estado: 'confirmada', fechaISO: '2026-01-14', horaISO: '10:00', timezone: LA }) === 'today',
    'LA: 14 de enero es "hoy" para ese negocio (aunque en UTC ya sea 15)');
  ok(window.reservationTemporalState({ estado: 'confirmada', fechaISO: '2026-01-14', horaISO: '10:00', timezone: TOKYO }) === 'past',
    'Tokyo: el MISMO 14 de enero es "ayer" para ese otro negocio (timezone distinto)');
  ok(window.reservationTemporalState({ estado: 'confirmada', fechaISO: '2026-01-15', horaISO: '10:00', timezone: TOKYO }) === 'today',
    'Tokyo: 15 de enero es "hoy" para ese negocio');
  ok(window.reservationTemporalState({ estado: 'confirmada', fechaISO: '2026-01-15', horaISO: '10:00', timezone: LA }) === 'tomorrow',
    'LA: 15 de enero es "mañana" para ese negocio');
  ok(window.reservationTemporalState({ estado: 'confirmada', fechaISO: '2026-01-20', horaISO: '10:00', timezone: LA }) === 'future',
    'una fecha varios días después es "future"');
  ok(window.reservationTemporalState({ estado: 'confirmada', fechaISO: '2026-01-01', horaISO: '10:00', timezone: LA }) === 'past',
    'una fecha ya pasada es "past"');
  ok(window.reservationTemporalState({ estado: 'cancelada', fechaISO: '2026-01-20', horaISO: '10:00', timezone: LA }) === 'cancelled',
    'cancelada gana siempre, aunque la fecha sea futura');
  ok(window.reservationTemporalState({ estado: 'rechazada', fechaISO: '2026-01-01', horaISO: '10:00', timezone: LA }) === 'cancelled',
    'rechazada también se clasifica como cancelled');
  ok(window.reservationTemporalState({ estado: 'confirmada', fechaISO: '', horaISO: '', timezone: '' }) === 'invalid',
    'sin fecha/timezone válidos, es "invalid" (reservas legacy incompletas)');
  ok(window.reservationTemporalState(null) === 'invalid', 'no revienta con null');
}

console.log('\n2. reservationTimestamp() — envuelve reservaUtcMs(), no reimplementa el parseo');
{
  const r = { fechaISO: '2026-01-15', horaISO: '10:00', timezone: 'UTC' };
  ok(window.reservationTimestamp(r) === window.reservaUtcMs(r.fechaISO, r.horaISO, r.timezone),
    'reservationTimestamp(r) devuelve exactamente lo mismo que reservaUtcMs(r.fechaISO, r.horaISO, r.timezone)');
  ok(window.reservationTimestamp({ fechaISO: 'no-valida', horaISO: '10:00', timezone: 'UTC' }) === null,
    'null ante una fecha inválida');
}

console.log('\n3. sortReservations() — futuras (más cercana primero) arriba, pasadas (más reciente primero) abajo');
{
  // Reproduce EXACTAMENTE el bug reportado: con el sort viejo (por
  // fechaISO/horaISO ascendente sobre la lista sin filtrar pasadas), una
  // cita vieja podía aparecer antes que una de mañana. Con
  // reservationTemporalState()+sortReservations(), las futuras van
  // siempre primero, sin importar qué tan vieja sea la más antigua.
  const list = [
    { nombre: 'Hace 1 mes',  estado: 'confirmada', fechaISO: '2025-12-15', horaISO: '10:00', timezone: 'UTC' },
    { nombre: 'Mañana 9am',  estado: 'confirmada', fechaISO: '2026-01-16', horaISO: '09:00', timezone: 'UTC' },
    { nombre: 'Hoy 15:00',   estado: 'confirmada', fechaISO: '2026-01-15', horaISO: '15:00', timezone: 'UTC' },
    { nombre: 'Ayer',        estado: 'confirmada', fechaISO: '2026-01-14', horaISO: '10:00', timezone: 'UTC' },
    { nombre: '5 agosto',    estado: 'confirmada', fechaISO: '2026-08-05', horaISO: '10:00', timezone: 'UTC' },
    { nombre: 'Hace 3 dias', estado: 'confirmada', fechaISO: '2026-01-12', horaISO: '10:00', timezone: 'UTC' },
    { nombre: 'Hoy 10:00',   estado: 'confirmada', fechaISO: '2026-01-15', horaISO: '10:00', timezone: 'UTC' },
  ];
  const sorted = window.sortReservations(list).map((r) => r.nombre);
  ok(sorted.indexOf('Hoy 10:00') < sorted.indexOf('Hoy 15:00'), 'dentro de "hoy", 10:00 antes que 15:00 (más cercana primero)');
  ok(sorted.indexOf('Hoy 15:00') < sorted.indexOf('Mañana 9am'), 'hoy 15:00 antes que mañana 9am');
  ok(sorted.indexOf('Mañana 9am') < sorted.indexOf('5 agosto'), 'mañana antes que una fecha lejana futura');
  // Las 4 futuras/hoy ocupan las primeras 4 posiciones — ninguna pasada se cuela entre ellas.
  ok(sorted.slice(0, 4).every((n) => ['Hoy 10:00', 'Hoy 15:00', 'Mañana 9am', '5 agosto'].includes(n)),
    'las 4 futuras/hoy están todas antes que cualquier pasada (el bug original ya no ocurre)');
  ok(sorted.indexOf('Ayer') < sorted.indexOf('Hace 3 dias'), 'entre pasadas: ayer antes que hace 3 días (más reciente primero)');
  ok(sorted.indexOf('Hace 3 dias') < sorted.indexOf('Hace 1 mes'), 'hace 3 días antes que hace 1 mes');
  ok(sorted.indexOf('5 agosto') < sorted.indexOf('Ayer'), 'toda futura/hoy va antes que cualquier pasada');
}

console.log('\n4. displayStatus() — "Pasada" es SOLO visual, nunca toca r.estado');
{
  const r = { estado: 'confirmada', fechaISO: '2026-01-01', horaISO: '10:00', timezone: 'UTC' };
  const status = window.displayStatus(r);
  ok(status.cls === 'pasada' && status.txt === 'Pasada', 'una confirmada vencida se MUESTRA como "Pasada"');
  ok(r.estado === 'confirmada', 'el campo real r.estado sigue siendo "confirmada" — displayStatus() no lo mutó');

  const cancelada = { estado: 'cancelada', fechaISO: '2020-01-01', horaISO: '10:00', timezone: 'UTC' };
  ok(window.displayStatus(cancelada).cls === 'cancelada', 'cancelada gana sobre "pasada" aunque también sea vieja');

  const reprogramadaFutura = { estado: 'reprogramada', fechaISO: '2026-01-20', horaISO: '10:00', timezone: 'UTC' };
  ok(window.displayStatus(reprogramadaFutura).cls === 'reprogramada', 'reprogramada futura se sigue mostrando como reprogramada');

  const reprogramadaVieja = { estado: 'reprogramada', fechaISO: '2026-01-01', horaISO: '10:00', timezone: 'UTC' };
  ok(window.displayStatus(reprogramadaVieja).cls === 'pasada', 'reprogramada vencida se muestra como pasada (visual), sin tocar estado');
  ok(reprogramadaVieja.estado === 'reprogramada', 'r.estado de la reprogramada vieja sigue intacto');
}

console.log('\n5. filtered() — nuevos filtros: todas/próximas/hoy/mañana/pasadas/canceladas');
{
  window.allData = [
    { nombre: 'Futura',  estado: 'confirmada', fechaISO: '2026-01-20', horaISO: '10:00', timezone: 'UTC' },
    { nombre: 'Hoy',     estado: 'confirmada', fechaISO: '2026-01-15', horaISO: '10:00', timezone: 'UTC' },
    { nombre: 'Manana',  estado: 'confirmada', fechaISO: '2026-01-16', horaISO: '10:00', timezone: 'UTC' },
    { nombre: 'Pasada',  estado: 'confirmada', fechaISO: '2026-01-01', horaISO: '10:00', timezone: 'UTC' },
    { nombre: 'Cancel',  estado: 'cancelada',  fechaISO: '2026-01-20', horaISO: '10:00', timezone: 'UTC' },
    { nombre: 'Legacy',  estado: 'confirmada', fecha: 'algún día' }, // sin fechaISO/timezone: invalid
  ];

  window.activeFilter = 'todas';
  ok(window.filtered().length === 6, 'Todas devuelve las 6 reservas sin filtrar');

  window.activeFilter = 'proximas';
  const proximas = window.filtered().map((r) => r.nombre);
  ok(proximas.includes('Futura') && proximas.includes('Hoy') && proximas.includes('Manana'), 'Próximas incluye future/today/tomorrow');
  ok(!proximas.includes('Pasada') && !proximas.includes('Cancel'), 'Próximas NO incluye pasadas ni canceladas');
  ok(proximas.includes('Legacy'), 'Próximas sigue mostrando reservas legacy sin fecha válida (compatibilidad, no desaparecen)');

  window.activeFilter = 'hoy';
  ok(window.filtered().map((r) => r.nombre).join(',') === 'Hoy', 'Hoy devuelve solo la de hoy');

  window.activeFilter = 'manana';
  ok(window.filtered().map((r) => r.nombre).join(',') === 'Manana', 'Mañana devuelve solo la de mañana');

  window.activeFilter = 'pasadas';
  ok(window.filtered().map((r) => r.nombre).join(',') === 'Pasada', 'Pasadas devuelve solo la vencida');

  window.activeFilter = 'canceladas';
  ok(window.filtered().map((r) => r.nombre).join(',') === 'Cancel', 'Canceladas devuelve solo la cancelada');
}

console.log('\n6. renderSummary() — "Próximas citas" ya NO cuenta pasadas (el bug reportado)');
{
  window.allData = [
    { nombre: 'A', estado: 'confirmada', fechaISO: '2026-01-20', horaISO: '10:00', timezone: 'UTC' }, // futura: cuenta
    { nombre: 'B', estado: 'confirmada', fechaISO: '2026-01-01', horaISO: '10:00', timezone: 'UTC' }, // pasada: NO debe contar
    { nombre: 'C', estado: 'reprogramada', fechaISO: '2026-01-16', horaISO: '10:00', timezone: 'UTC' }, // futura reprogramada: cuenta
    { nombre: 'D', estado: 'cancelada', fechaISO: '2026-01-20', horaISO: '10:00', timezone: 'UTC' }, // cancelada: nunca cuenta
    { nombre: 'E', estado: 'pendiente', fechaISO: '2026-01-20', horaISO: '10:00', timezone: 'UTC' }, // pendiente: no es confirmada/reprogramada, no cuenta (comportamiento previo intacto)
  ];
  window.renderActivity = window.renderActivity || function () {};
  window.renderSummary();
  const upcomingEl = window.document.getElementById('summary-upcoming');
  ok(upcomingEl.textContent === '2', `"Próximas citas" cuenta 2 (A y C), no la pasada B ni la cancelada D (fue: ${upcomingEl.textContent})`);
  const cancelledEl = window.document.getElementById('summary-cancelled');
  ok(cancelledEl.textContent === '1', 'Canceladas sigue contando correctamente');

  // El bug tal cual se reportó: antes de este fix, una "confirmada" vieja
  // (B) se contaba igual que una futura porque solo se miraba r.estado.
  const bugConTemporalViejo = window.allData.filter((r) => r.estado === 'confirmada' || r.estado === 'reprogramada').length;
  ok(bugConTemporalViejo === 3 && Number(upcomingEl.textContent) < bugConTemporalViejo,
    'confirmamos que el cálculo viejo (solo por estado) SÍ incluía la pasada — el fix reduce el conteo correctamente');
}

console.log('\n7. Tarjeta: .is-past + badge "Pasada", sin desaparecer ni tocar estado:"confirmada"');
{
  window.allData = [
    { nombre: 'Cliente Viejo', servicio: 'Corte', estado: 'confirmada', fechaISO: '2026-01-01', horaISO: '10:00', hora: '10:00 AM', timezone: 'UTC' },
  ];
  window.activeFilter = 'proximas';
  window.render();
  ok(!window.document.getElementById('sheet').querySelector('.rcard'), 'la cita pasada correctamente NO aparece en "Próximas" (no es un desaparecimiento: es el filtro haciendo su trabajo)');

  window.activeFilter = 'todas';
  window.render();
  ok(!!window.document.getElementById('sheet').querySelector('.rcard'), 'la cita pasada NO desapareció de los datos: sigue existiendo y se ve en "Todas"');

  window.activeFilter = 'pasadas';
  window.render();
  const pastCard = window.document.getElementById('sheet').querySelector('.rcard');
  ok(pastCard && pastCard.classList.contains('is-past'), 'la tarjeta tiene la clase .is-past');
  ok(pastCard && pastCard.querySelector('.estado.pasada'), 'la tarjeta tiene el badge con clase .estado.pasada');
  ok(pastCard && pastCard.querySelector('.estado.pasada').textContent === 'Pasada', 'el badge dice "Pasada"');
  ok(window.allData[0].estado === 'confirmada', 'el dato real allData[0].estado sigue siendo "confirmada" tras renderizar (0 mutación)');
}

console.log('\n8. No se usa new Date(fecha + hora) para comparar reservas (rompe timezones)');
{
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  // Quita comentarios de línea antes de buscar: el propio código documenta
  // esta regla en un comentario ("nunca new Date(fecha+hora)"), que no debe
  // contarse como si fuera el patrón real que se está prohibiendo.
  const codeOnly = scriptMatch.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  ok(!/new Date\(\s*r\.fecha\s*\+/.test(codeOnly) && !/new Date\(\s*fecha(ISO)?\s*\+\s*hora/.test(codeOnly),
    'el código fuente (sin comentarios) no concatena fecha+hora en new Date(...) para decidir el orden/estado temporal');
}

console.log('');
if (fallos) { console.error(`❌ ${fallos} aserción(es) fallaron`); process.exit(1); }
console.log('✅ Timeline del panel de reservas verificado (clasificación, orden, resumen, timezone)');
