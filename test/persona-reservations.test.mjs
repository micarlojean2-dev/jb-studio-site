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
const { validarReserva, configuredStaff, duplicateReservation, reservationTemplate } = __test;
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
};

const hours = {
  monday: { enabled: true, ranges: [{ start: '09:00', end: '19:00' }] },
};

console.log('1. Shared chat requirements and extraction');
{
  const restaurant = { templateId: 'restaurant' };
  const barber = { templateId: 'barber', staff: [{ id: 'ana', name: 'Ana' }] };
  ok(CORE.bookingRequirements(restaurant, {}).join(',') === 'nombre,contacto,fecha,hora,personas',
    'restaurant requires name, contact, date/time and party size only');
  ok(CORE.bookingRequirements(barber, {}).join(',') === 'nombre,contacto,fecha,hora,servicio',
    'barber requires name, contact, date/time and service');
  ok(CORE.bookingRequirements({}, {}).join(',') === 'nombre,telefono,email,fecha,hora,servicio',
    'legacy Spa/Bella requirements are unchanged');
  const table = CORE.extractBooking('Somos 4, mesa junto a la ventana', [], hours, 'es', restaurant);
  ok(table.personas === '4' && table.tablePreference === 'mesa junto a la ventana',
    'restaurant extracts party size and table preference');
  const cut = CORE.extractBooking('Quiero corte con Ana', [{ nombre: 'Corte' }], hours, 'es', barber);
  ok(cut.servicio === 'Corte' && cut.barberPreference === 'Ana', 'barber extracts configured preference');
  ok(CORE.CAMPO_MENCIONADO.some(([re, field]) => field === 'barberPreference' && re.test('cambiar barbero')),
    'barber preference can be cleared during a pre-submit change');
}

console.log('2. Server-side persona validation');
{
  const restaurant = { templateId: 'restaurant', businessHours: hours, menu: [], capacityPerSlot: 2 };
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
  ok(duplicateReservation([{ ...same, estado: 'pendiente', telefono: '15550100' }], same),
    'same active contact/date/time is a duplicate');
  ok(!duplicateReservation([{ ...same, estado: 'cancelada' }], same), 'cancelled reservation may be booked again');
  ok(validarReserva(restaurant, '2026-07-20', '10:00', '', 0, []).ok,
    'restaurant does not require a Spa service for availability validation');
  const timedRestaurant = { ...restaurant, capacityPerSlot: 1, reservationDuration: '60 min' };
  ok(validarReserva(timedRestaurant, '2026-07-20', '10:30', '', 0,
    [{ estado: 'pendiente', fechaISO: '2026-07-20', horaISO: '10:00', duracion: 60 }]).motivo === 'sin_disponibilidad',
  'configured restaurant duration participates in capacity overlap checks');
}

if (failures) process.exit(1);
console.log('✅ Persona reservation rules verified');
