// Auditoría FASE 2 — elimina los caminos fail-open de validarReserva() donde
// una fecha/hora que el sistema no podía interpretar terminaba en ok:true en
// vez de un rechazo. Prueba contra las funciones reales de api/reservations.js
// (__test), no reimplementadas. Documenta también que la configuración
// incompleta del NEGOCIO (no del cliente) sigue sin bloquear, a propósito.
import assert from 'node:assert/strict';

const { __test } = await import('../api/reservations.js');
const { validarReserva, normalizeHora, parseFechaISO } = __test;

const HOY = new Date('2026-07-20T12:00:00Z').getTime(); // lunes

const clienteConHorario = {
  templateId: 'spa', capacityPerSlot: 5, reservationIntervalMinutes: 15,
  businessHours: {
    monday:    { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    tuesday:   { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    wednesday: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    thursday:  { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    friday:    { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    saturday:  { enabled: false, ranges: [] },
    sunday:    { enabled: false, ranges: [] },
  },
  menu: [{ nombre: 'Masaje', duracion: '60' }],
};

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); failures++; } };

console.log('1) Fail-open eliminado — fecha inválida/vacía debe RECHAZAR, nunca ok:true');
{
  const r1 = validarReserva(clienteConHorario, '', '10:00', 'Masaje', HOY, []);
  ok(r1.ok === false, `fechaISO vacío -> ok:false (fue ok:${r1.ok})`);
  ok(r1.motivo === 'fecha_invalida', `motivo correcto (fue "${r1.motivo}")`);

  // Fecha imposible que ni siquiera parseFechaISO llegaría a aceptar hoy
  // (ver bloque 3), pero se prueba también a nivel de validarReserva por si
  // alguna vez llega un fechaISO='' desde otro origen.
  const r2 = validarReserva(clienteConHorario, undefined, '10:00', 'Masaje', HOY, []);
  ok(r2.ok === false && r2.motivo === 'fecha_invalida', 'fechaISO undefined -> también rechaza');
}

console.log('2) Fail-open eliminado — hora inválida/vacía debe RECHAZAR, nunca ok:true');
{
  const r1 = validarReserva(clienteConHorario, '2026-07-21', '', 'Masaje', HOY, []);
  ok(r1.ok === false, `horaISO vacío -> ok:false (fue ok:${r1.ok})`);
  ok(r1.motivo === 'hora_invalida', `motivo correcto (fue "${r1.motivo}")`);

  // "8:99 PM": el caso literal reportado en la auditoría.
  const horaDe899PM = normalizeHora('8:99 PM');
  ok(horaDe899PM === '', `normalizeHora('8:99 PM') === '' (fue "${horaDe899PM}")`);
  const r2 = validarReserva(clienteConHorario, '2026-07-21', horaDe899PM, 'Masaje', HOY, []);
  ok(r2.ok === false && r2.motivo === 'hora_invalida', '"8:99 PM" -> nunca crea la reserva, se rechaza de punta a punta');
}

console.log('3) normalizeHora() — minutos >59 se rechazan directamente en el origen');
{
  ok(normalizeHora('8:99 PM') === '', '"8:99 PM" -> \'\'');
  ok(normalizeHora('12:60 AM') === '', '"12:60 AM" -> \'\'');
  ok(normalizeHora('3:75') === '', '"3:75" -> \'\'');
  // Casos válidos existentes NO deben romperse.
  ok(normalizeHora('8:30 PM') === '20:30', '"8:30 PM" sigue -> "20:30" (no se rompe el caso normal)');
  ok(normalizeHora('7:00 p. m.') === '19:00', 'formato tipográfico "p. m." sigue funcionando');
  ok(normalizeHora('9') === '09:00', '"9" sigue -> "09:00"');
  ok(normalizeHora('25:00') === '', 'hora >23 sigue rechazándose (ya existía)');
  ok(normalizeHora('') === '', 'vacío sigue -> \'\' (ya existía)');
}

console.log('4) parseFechaISO() — fechas ISO imposibles ya NO se aceptan literales');
{
  ok(parseFechaISO('2026-02-30', HOY) === '', '"2026-02-30" (30 de febrero no existe) -> \'\'');
  ok(parseFechaISO('2026-13-01', HOY) === '', '"2026-13-01" (mes 13 no existe) -> \'\'');
  ok(parseFechaISO('2026-04-31', HOY) === '', '"2026-04-31" (abril no tiene 31) -> \'\'');
  ok(parseFechaISO('2026-02-29', HOY) === '', '"2026-02-29" (2026 no es bisiesto) -> \'\'');
  // Fechas reales, incluida la real forma "ISO" válida, no deben romperse.
  ok(parseFechaISO('2026-07-18', HOY) === '2026-07-18', 'fecha ISO real sigue aceptándose tal cual');
  ok(parseFechaISO('2026-02-28', HOY) === '2026-02-28', 'último día real de un febrero no bisiesto sigue aceptándose');
  ok(parseFechaISO('2024-02-29', HOY) === '2024-02-29', '29 de febrero SÍ existe en un año bisiesto (2024) y se acepta');
}

console.log('5) Formatos incorrectos / texto no reconocible — deben rechazarse (fecha) o preguntar de nuevo, nunca inventar');
{
  ok(parseFechaISO('el mes que viene', HOY) === '', 'texto no reconocible -> \'\' (ya existía, se confirma que sigue así)');
  ok(parseFechaISO('', HOY) === '', 'fecha vacía -> \'\'');
  const r = validarReserva(clienteConHorario, parseFechaISO('el mes que viene', HOY), '10:00', 'Masaje', HOY, []);
  ok(r.ok === false && r.motivo === 'fecha_invalida', 'de punta a punta: texto de fecha no reconocible termina rechazando la reserva, no creándola');
}

console.log('6) Configuración no verificable del NEGOCIO se rechaza (fail-closed)');
{
  // Sin businessHours en absoluto.
  const clienteSinHorario = { templateId: 'spa', menu: [{ nombre: 'Masaje', duracion: '60' }] };
  const r1 = validarReserva(clienteSinHorario, '2026-07-21', '10:00', 'Masaje', HOY, []);
  ok(r1.ok === false && r1.motivo === 'horario_no_verificable', `negocio sin businessHours configurado -> se rechaza (fue ok:${r1.ok}, motivo:${r1.motivo})`);

  // Día marcado unknown (el dueño nunca confirmó ese horario).
  const clienteDiaUnknown = {
    templateId: 'spa', menu: [{ nombre: 'Masaje', duracion: '60' }],
    businessHours: { monday: { enabled: false, unknown: true, ranges: [] } },
  };
  const r2 = validarReserva(clienteDiaUnknown, '2026-07-20', '10:00', 'Masaje', HOY, []); // 2026-07-20 es lunes
  ok(r2.ok === false && r2.motivo === 'horario_no_verificable', `día unknown (nunca confirmado) -> se rechaza (fue ok:${r2.ok}, motivo:${r2.motivo})`);

  // Contraste explícito: la fecha/hora sigue siendo del CLIENTE y sigue
  // rechazándose aunque el negocio tenga configuración incompleta -- las dos
  // cosas son independientes.
  const r3 = validarReserva(clienteSinHorario, '', '10:00', 'Masaje', HOY, []);
  ok(r3.ok === false && r3.motivo === 'fecha_invalida', 'incluso con negocio sin horario, una fecha ilegible del cliente SÍ se rechaza (son cosas distintas)');
}

console.log(failures ? `\n${failures} fallo(s)` : '\nTodas las pruebas de validación fail-closed pasan');
if (failures) process.exit(1);
