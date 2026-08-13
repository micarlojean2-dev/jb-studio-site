import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EVENTS, createBookingFlow } = require('../chat-flow.js');
const root = new URL('..', import.meta.url);
const assistant = readFileSync(new URL('asistente.html', root), 'utf8');
const widget = readFileSync(new URL('widget.js', root), 'utf8');

console.log('Contexto de reserva V2');
for (const [name, source] of [['asistente', assistant], ['widget', widget]]) {
  assert.match(source, /reservationContext: CORE\.buildReservationContext\(activeReservation\)/);
  assert.match(source, /actionToken: activeReservation\.actionToken/);
  assert.match(source, /function submitModify\(/);
  assert.match(source, /function submitActiveCancel\(/);
  console.log(`  ✓ ${name} envía contexto real y mantiene acciones autenticadas`);
}

const flow = createBookingFlow({ config: { clientId: 'language-v2' } });
flow.startBooking();
flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje' });
flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
flow.dispatch({ type: EVENTS.SELECT_TIME, time: '16:00' });
flow.dispatch({ type: EVENTS.SET_CUSTOMER_DATA, customer: { name: 'Ana Prueba', phone: '5551234567', email: 'ana@example.com' }, specialRequests: '' });
assert.equal(flow.getState().customer.email, 'ana@example.com');
console.log('  ✓ datos del cliente llegan al estado V2 antes de confirmar');
