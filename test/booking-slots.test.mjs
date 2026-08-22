import assert from 'node:assert/strict';
import { __test } from '../api/reservations.js';

const { getAvailableSlots, getAvailableDates } = __test;
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
}

const mondayHours = { monday: { enabled: true, ranges: [{ start: '10:00', end: '13:00' }] } };
const base = {
  active: true,
  timezone: 'UTC',
  businessHours: mondayHours,
  minNoticeHours: 0,
  capacityPerSlot: 1,
  reservationIntervalMinutes: 30,
};
const DATE = '2026-07-20'; // Monday

console.log('1. SPA — duración, ocupación y buffer');
{
  const spa = {
    ...base,
    templateId: 'spa',
    bufferMinutes: 30,
    menu: [{ nombre: 'Facial', duracion: '60 min' }],
  };
  const open = getAvailableSlots(spa, DATE, 'Facial', null, [], 0);
  ok(open.ok && open.slots[0].value === '10:00', 'Spa devuelve slots canónicos para servicio válido');
  ok(open.date.label === 'Lunes 20 de julio', 'Spa devuelve etiqueta de fecha en español');

  const occupied = [{ estado: 'confirmada', fechaISO: DATE, horaISO: '10:00', servicio: 'Facial', duracion: 60 }];
  const withReservation = getAvailableSlots(spa, DATE, 'Facial', null, occupied, 0);
  ok(!withReservation.slots.some(slot => slot.value === '10:00'), 'Spa elimina el slot ocupado');
  ok(!withReservation.slots.some(slot => slot.value === '10:30'), 'Spa aplica buffer al eliminar slots solapados');
  ok(withReservation.slots.some(slot => slot.value === '11:30'), 'Spa ofrece el primer slot después de duración más buffer');
}

console.log('\n2. BARBERÍA — servicio, duración y capacidad');
{
  const barber = {
    ...base,
    templateId: 'barber',
    capacityPerSlot: 1,
    menu: [{ nombre: 'Corte', duracion: '60 min' }],
  };
  const open = getAvailableSlots(barber, DATE, 'Corte', null, [], 0);
  ok(open.ok && open.slots.some(slot => slot.value === '10:00'), 'Barbería devuelve slots para servicio válido');
  const occupied = [{ estado: 'pendiente', fechaISO: DATE, horaISO: '10:00', servicio: 'Corte', duracion: 60 }];
  const blocked = getAvailableSlots(barber, DATE, 'Corte', null, occupied, 0);
  ok(!blocked.slots.some(slot => slot.value === '10:00' || slot.value === '10:30'), 'Barbería aplica duración y capacidad a los slots');
}

console.log('\n3. RESTAURANTE — personas requeridas y slots');
{
  const restaurant = {
    ...base,
    templateId: 'restaurant',
    reservationDuration: '60 min',
    menu: [{ nombre: 'Mesa estándar' }],
  };
  const missingPeople = getAvailableSlots(restaurant, DATE, '', null, [], 0);
  ok(!missingPeople.ok && missingPeople.motivo === 'personas_invalidas', 'Restaurante requiere personas');
  const textPeople = getAvailableSlots(restaurant, DATE, '', '2', [], 0);
  ok(!textPeople.ok && textPeople.motivo === 'personas_invalidas', 'Restaurante requiere personas como número JSON');
  const open = getAvailableSlots(restaurant, DATE, '', 2, [], 0);
  ok(open.ok && open.slots.length > 0 && open.slots[0].value === '10:00', 'Restaurante devuelve slots con personas válidas');
}

console.log('\n4. Errores de contrato y disponibilidad');
{
  const spa = { ...base, templateId: 'spa', menu: [{ nombre: 'Facial', duracion: '60 min' }] };
  ok(getAvailableSlots(spa, 'mañana', 'Facial', null, [], 0).motivo === 'fecha_invalida', 'rechaza fecha no ISO');
  ok(getAvailableSlots(spa, DATE, 'Masaje inventado', null, [], 0).motivo === 'servicio_invalido', 'rechaza servicio inexistente');
  const closed = {
    ...spa,
    businessHours: {
      monday: { enabled: false, ranges: [] },
      tuesday: { enabled: true, ranges: [{ start: '10:00', end: '13:00' }] },
    },
  };
  ok(getAvailableSlots(closed, DATE, 'Facial', null, [], 0).motivo === 'dia_cerrado', 'rechaza día cerrado');
  const full = [{ estado: 'confirmada', fechaISO: DATE, horaISO: '10:00', servicio: 'Facial', duracion: 180 }];
  const noSlots = getAvailableSlots(spa, DATE, 'Facial', null, full, 0);
  ok(noSlots.ok && noSlots.slots.length === 0, 'devuelve lista vacía cuando no quedan slots');
}

console.log('\n5. Fechas autoritativas');
{
  const spa = { ...base, templateId: 'spa', menu: [{ nombre: 'Facial', duracion: '60 min' }] };
  const dates = getAvailableDates(spa, 'Facial', null, [], new Date('2026-07-20T00:00:00Z'));
  ok(dates.ok && dates.dates[0].value === DATE, 'devuelve la primera fecha con slots reales');
  ok(dates.dates[0].label === 'Lunes 20 de julio', 'devuelve etiqueta autoritativa de fecha');
  const closed = { ...spa, businessHours: { monday: { enabled: false, ranges: [] } } };
  const noDates = getAvailableDates(closed, 'Facial', null, [], new Date('2026-07-20T00:00:00Z'));
  ok(noDates.ok && noDates.dates.length === 0, 'omite días sin slots válidos');
  const restaurant = { ...base, templateId: 'restaurant', reservationDuration: '60 min', menu: [{ nombre: 'Mesa estándar' }] };
  ok(getAvailableDates(restaurant, '', null, [], new Date('2026-07-20T00:00:00Z')).dates.length === 0,
    'Restaurante no ofrece fechas sin personas válidas');
  ok(getAvailableDates(restaurant, '', 2, [], new Date('2026-07-20T00:00:00Z')).dates.length > 0,
    'Restaurante ofrece fechas con personas válidas');
}

console.log('\n6. Preferencia de barbero en disponibilidad guiada');
{
  const barber = { ...base, templateId: 'barber', menu: [{ nombre: 'Corte', duracion: '60 min' }], staff: [{ id: 'ana', name: 'Ana', businessHours: mondayHours }] };
  const occupied = [{ estado: 'confirmada', fechaISO: DATE, horaISO: '10:00', servicio: 'Corte', duracion: 60, barberPreference: 'Ana' }];
  const any = getAvailableSlots(barber, DATE, 'Corte', null, occupied, 0);
  const preferred = getAvailableSlots({ ...barber, __reservationBarberPreference: 'Ana' }, DATE, 'Corte', null, occupied, 0);
  ok(!any.slots.some(slot => slot.value === '10:00'), 'Sin preferencia conserva la capacidad global existente');
  ok(!preferred.slots.some(slot => slot.value === '10:00'), 'La preferencia filtra slots ocupados del barbero elegido');
}

console.log('\n7. Buffer (tiempo de limpieza) aplica a las 3 plantillas');
{
  // El buffer se suma a la duración ocupada para cualquier tipo de negocio,
  // no solo spa (fix de bufferMinutesFor). Una reserva a las 10:00 con 60 min
  // de duración + 30 de buffer debe bloquear 10:00-11:30 para los 3.
  const occupied = [{ estado: 'confirmada', fechaISO: DATE, horaISO: '10:00', servicio: 'S', duracion: 60 }];
  const casos = [
    ['spa', { ...base, templateId: 'spa', bufferMinutes: 30, menu: [{ nombre: 'S', duracion: '60 min' }] }],
    ['barber', { ...base, templateId: 'barber', bufferMinutes: 30, menu: [{ nombre: 'S', duracion: '60 min' }] }],
    ['restaurant', { ...base, templateId: 'restaurant', bufferMinutes: 30, menu: [{ nombre: 'S', duracion: '60 min' }], reservationDuration: '60 min' }],
  ];
  for (const [nombre, client] of casos) {
    const people = client.templateId === 'restaurant' ? 2 : null;
    const res = getAvailableSlots(client, DATE, 'S', people, occupied, 0);
    ok(res.ok, `${nombre}: devuelve slots`);
    ok(!res.slots.some(s => s.value === '10:00' || s.value === '10:30' || s.value === '11:00'), `${nombre}: bloquea 10:00-11:30 por duración+buffer`);
    ok(res.slots.some(s => s.value === '11:30'), `${nombre}: ofrece 11:30 (tras duración 60 + buffer 30)`);
  }
}

console.log(failures ? `\n❌ ${failures} prueba(s) fallaron` : '\n✅ slots guiados: contratos y disponibilidad autoritativa verificados');
process.exit(failures ? 1 : 0);
