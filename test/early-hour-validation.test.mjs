import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { __test } from '../api/reservations.js';

const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');
const { validarReserva } = __test;
const hours = { monday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] } };
const client = {
  templateId: 'spa', timezone: 'UTC', minNoticeHours: 0, capacityPerSlot: 1,
  businessHours: hours, menu: [{ nombre: 'Masaje', duracion: '60' }],
};

console.log('Validación de horario V2');
const rejected = validarReserva(client, '2026-07-20', '23:00', 'Masaje', 0, []);
assert.equal(rejected.ok, false);
assert.equal(rejected.motivo, 'fuera_de_horario');
console.log('  ✓ backend rechaza horarios fuera de atención');

const flow = createBookingFlow({ config: { clientId: 'hour-v2' } });
flow.startBooking();
flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje' });
flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-07-20' });
flow.dispatch({ type: EVENTS.SELECT_TIME, time: '20:30' });
assert.equal(flow.getState().step, STEPS.CUSTOMER_DATA);
assert.equal(flow.getState().time, '20:30');
console.log('  ✓ V2 conserva exactamente la hora seleccionada para la validación autoritativa');
