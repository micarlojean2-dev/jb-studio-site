import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');

function readyFlow() {
  const flow = createBookingFlow({ config: { clientId: 'corrections-v2' } });
  flow.startBooking();
  flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje relajante' });
  flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
  flow.dispatch({ type: EVENTS.SELECT_TIME, time: '16:00' });
  flow.dispatch({
    type: EVENTS.SET_CUSTOMER_DATA,
    customer: { name: 'María López', phone: '2067421261', email: 'maria@example.com' },
    specialRequests: '',
  });
  flow.dispatch({ type: EVENTS.SHOW_SUMMARY });
  return flow;
}

console.log('Correcciones V2 de reserva');
{
  const flow = readyFlow();
  flow.dispatch({ type: EVENTS.EDIT_DATE });
  assert.equal(flow.getState().step, STEPS.DATE_SELECTION);
  assert.equal(flow.getState().date, null);
  assert.equal(flow.getState().time, null);
  assert.equal(flow.getState().service, 'Masaje relajante');
  assert.equal(flow.getState().customer.email, 'maria@example.com');
  console.log('  ✓ EDIT_DATE limpia solo fecha y hora dependiente');
}

{
  const flow = readyFlow();
  flow.dispatch({ type: EVENTS.EDIT_TIME });
  assert.equal(flow.getState().step, STEPS.TIME_SELECTION);
  assert.equal(flow.getState().time, null);
  assert.equal(flow.getState().date, '2026-08-20');
  console.log('  ✓ EDIT_TIME conserva fecha, servicio y cliente');
}

{
  const flow = readyFlow();
  flow.dispatch({ type: EVENTS.EDIT_CUSTOMER });
  flow.dispatch({
    type: EVENTS.SET_CUSTOMER_DATA,
    customer: { name: 'María López', phone: '2067421261', email: 'nueva@example.com' },
    specialRequests: 'Sin perfume',
  });
  flow.dispatch({ type: EVENTS.SHOW_SUMMARY });
  assert.equal(flow.getState().customer.email, 'nueva@example.com');
  assert.equal(flow.getState().specialRequests, 'Sin perfume');
  console.log('  ✓ EDIT_CUSTOMER actualiza solo los datos del cliente');
}

console.log('✅ Correcciones V2 verificadas');
