import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');

function readyFlow(time) {
  const flow = createBookingFlow({ config: { clientId: 'time-precision-v2' } });
  flow.startBooking();
  flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje relajante' });
  flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
  flow.dispatch({ type: EVENTS.SELECT_TIME, time });
  flow.dispatch({
    type: EVENTS.SET_CUSTOMER_DATA,
    customer: { name: 'Ana Prueba', phone: '14155550100', email: 'ana@example.com' },
    specialRequests: '',
  });
  flow.dispatch({ type: EVENTS.SHOW_SUMMARY });
  return flow;
}

console.log('Precisión de hora V2');
const flow = readyFlow('20:30');
assert.equal(flow.getState().time, '20:30');
flow.dispatch({ type: EVENTS.EDIT_TIME });
assert.equal(flow.getState().step, STEPS.TIME_SELECTION);
flow.dispatch({ type: EVENTS.SELECT_TIME, time: '18:30' });
assert.equal(flow.getState().time, '18:30');
console.log('  ✓ el estado V2 preserva minutos exactos al seleccionar y editar hora');
