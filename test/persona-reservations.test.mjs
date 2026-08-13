// Deterministic coverage for the additive restaurant/barber reservation rules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { __test } from '../api/reservations.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;
  const { validarReserva, configuredStaff, duplicateReservationKey, reservationTemplate } = __test;
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
};

const hours = {
  monday: { enabled: true, ranges: [{ start: '09:00', end: '19:00' }] },
};

console.log('1. V2 reservation surfaces and modification parser');
{
  const restaurant = { templateId: 'restaurant' };
  const barber = { templateId: 'barber', staff: [{ id: 'ana', name: 'Ana' }] };
  const update = CORE.buildModifyUpdate('Somos 4 para mañana a las 3 pm', { ...restaurant, menu: [], businessHours: hours }, {});
  ok(update.partySize === '4' && update.fecha === 'mañana' && update.hora === '3:00 PM',
    'explicit modification parses changed date, time, and party size');
  const entityUpdate = CORE.buildModifyUpdateFromEntities({ service: 'Corte', date: null, time: '10 am', name: null, email: null, phone: null, people: null, notes: null }, { ...barber, menu: [{ nombre: 'Corte' }], businessHours: hours }, {}, '');
  ok(entityUpdate.servicio === 'Corte' && entityUpdate.hora === '10:00 AM',
    'conversational reschedule validates structured entities');
}

console.log('2. Server-side persona validation');
{
  const restaurant = { templateId: 'restaurant', businessHours: hours, menu: [], capacityPerSlot: 2, reservationDuration: '60 min' };
  const barber = {
    templateId: 'barber', businessHours: hours, menu: [{ nombre: 'Corte', duracion: '60 min' }],
    staff: [{ id: 'ana', name: 'Ana', businessHours: hours }], capacityPerSlot: 2,
  };
  ok(reservationTemplate({ config: { templateId: 'restaurant' } }) === 'restaurant',
    'template id can come from client config');
  ok(validarReserva({ ...barber, __reservationBarberPreference: 'Nadie' }, '2026-07-20', '10:00', 'Corte', 0, []).motivo === 'barbero_no_disponible',
    'unknown configured barber preference is rejected');
  const canonical = { ...barber, staff: [{ id: 'ana', name: 'Ana', businessHours: hours }], barbers: [{ id: 'luis', name: 'Luis' }] };
  ok(configuredStaff(canonical)[0].name === 'Ana' && configuredStaff({ templateId: 'barber', barbers: [{ name: 'Luis' }] })[0].name === 'Luis',
    'client.staff tiene prioridad y los registros legacy barbers siguen funcionando');
  const unavailable = { ...barber, staff: [{ id: 'ana', name: 'Ana', businessHours: { monday: { enabled: false, ranges: [] } } }], __reservationBarberPreference: 'Ana' };
  ok(validarReserva(unavailable, '2026-07-20', '10:00', 'Corte', 0, []).motivo === 'barbero_no_disponible',
    'el barbero existente se rechaza cuando no esta disponible');
  const occupied = [{ estado: 'pendiente', fechaISO: '2026-07-20', horaISO: '10:00', servicio: 'Corte', barberPreference: 'Ana' }];
  ok(validarReserva({ ...barber, __reservationBarberPreference: 'Ana' }, '2026-07-20', '10:30', 'Corte', 0, occupied).motivo === 'barbero_no_disponible',
    'same barber cannot be double-booked during the service duration');
  const same = { fechaISO: '2026-07-20', horaISO: '10:00', telefono: '+1 555 0100', email: '' };
  ok(duplicateReservationKey([{ ...same, estado: 'pendiente', telefono: '15550100' }], same) !== null,
    'same active contact/date/time is a duplicate');
  ok(duplicateReservationKey([{ ...same, estado: 'cancelada' }], same) === null, 'cancelled reservation may be booked again');
  ok(validarReserva(restaurant, '2026-07-20', '10:00', '', 0, []).ok,
    'restaurant does not require a Spa service for availability validation');
  const timedRestaurant = { ...restaurant, capacityPerSlot: 1, reservationDuration: '60 min' };
  ok(validarReserva(timedRestaurant, '2026-07-20', '10:30', '', 0,
    [{ estado: 'pendiente', fechaISO: '2026-07-20', horaISO: '10:00', duracion: 60 }]).motivo === 'sin_disponibilidad',
  'configured restaurant duration participates in capacity overlap checks');
  ok(validarReserva({ ...restaurant, reservationIntervalMinutes: 30 }, '2026-07-20', '10:15', '', 0, []).motivo === 'intervalo_invalido',
    'backend rejects starts outside the configured reservation interval');
  const spa = {
    templateId: 'spa', businessHours: hours,
    menu: [{ nombre: 'Facial', duracion: '60 min' }], capacityPerSlot: 1, bufferMinutes: 15,
  };
  const spaExisting = [{ estado: 'confirmada', fechaISO: '2026-07-20', horaISO: '10:00', servicio: 'Facial', duracion: 60 }];
  ok(validarReserva(spa, '2026-07-20', '11:00', 'Facial', 0, spaExisting).motivo === 'sin_disponibilidad',
    'Spa: 60 min más 15 min de preparación bloquea los siguientes 75 minutos');
  ok(validarReserva(spa, '2026-07-20', '11:15', 'Facial', 0, spaExisting).ok,
    'Spa: la siguiente cita queda disponible al terminar los 75 minutos');
  const spaThreeSlots = [...spaExisting, ...spaExisting, ...spaExisting];
  ok(validarReserva({ ...spa, capacityPerSlot: 3 }, '2026-07-20', '10:00', 'Facial', 0, spaThreeSlots).motivo === 'sin_disponibilidad',
    'Spa: capacidad 3 permite tres citas simultáneas y rechaza la cuarta');
  ok(validarReserva({ ...spa, templateId: undefined, bufferMinutes: undefined }, '2026-07-20', '11:00', 'Facial', 0, spaExisting).ok,
    'clientes antiguos sin buffer conservan ocupación de solo 60 minutos');
  const spaClosing = {
    ...spa, businessHours: { monday: { enabled: true, ranges: [{ start: '10:00', end: '17:00' }] } }, bufferMinutes: 30,
  };
  ok(validarReserva(spaClosing, '2026-07-20', '15:30', 'Facial', 0, []).ok &&
    validarReserva(spaClosing, '2026-07-20', '15:45', 'Facial', 0, []).motivo === 'no_cabe_antes_del_cierre',
    'Spa: servicio más preparación debe terminar antes del cierre');
}

console.log('3. Active-reservation duplicate-attempt buttons never leak to free chat');
{
  // Regression, found live: after a duplicate booking attempt shows the
  // Modificar/Cancelar/Mantener buttons, a customer who types anything else
  // instead of tapping one fell straight through to the open-ended chat
  // model. With no idea a reservation was already pending a decision, the
  // model improvised its own fake "confirm with sí" loop ("¿Todo correcto?
  // Si me dices que sí, lo proceso") that can never create a real
  // reservation — exactly the invented-explanation failure mode.
  // [BUG-DUPLICADO-CHAT-LIBRE]
  for (const file of ['asistente.html', 'widget.js']) {
    const source = readFileSync(join(root, file), 'utf8');
    ok(/var dupPending = false;/.test(source), `${file} declares a dupPending gate`);
    ok(/dupPending = true;/.test(source), `${file} handleDuplicateAttempt() sets dupPending`);
    ok(/if \(dupPending\) \{/.test(source),
      `${file} refuses to fall through to free chat while dupPending is set`);
    const actionsFn = source.match(/function offerReservationActions\(lang\)[\s\S]*?\n  \}/)[0];
    ok(/irAlFondo\(msgsEl, true\)/.test(actionsFn),
      `${file} offerReservationActions() forces the real action buttons into view`);
    ok(/accionesBotones/.test(actionsFn) && /accionesBotones\.remove\(\)/.test(actionsFn),
      `${file} offerReservationActions() removes a stale button set before showing a new one`);
  }
}

if (failures) process.exit(1);
console.log('✅ Persona reservation rules verified');
