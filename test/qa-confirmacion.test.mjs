import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');

function confirmationFlow(confirmBooking) {
  const flow = createBookingFlow({ config: { clientId: 'confirmation-v2' }, request: { confirmBooking } });
  flow.startBooking();
  flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje' });
  flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
  flow.dispatch({ type: EVENTS.SELECT_TIME, time: '16:00' });
  flow.dispatch({ type: EVENTS.SET_CUSTOMER_DATA, customer: { name: 'Ana Prueba', phone: '5551234567', email: 'ana@example.com' }, specialRequests: '' });
  flow.dispatch({ type: EVENTS.SHOW_SUMMARY });
  flow.dispatch({ type: EVENTS.REQUEST_CONFIRMATION });
  return flow;
}

console.log('Confirmación V2');
{
  const flow = confirmationFlow(() => Promise.resolve({ ok: false, motivo: 'ocupado' }));
  await flow.confirmBooking();
  assert.equal(flow.getState().step, STEPS.CONFIRMATION);
  console.log('  ✓ un rechazo del backend no confirma la reserva');
}

{
  let calls = 0;
  const flow = confirmationFlow(() => { calls++; return Promise.resolve({ ok: true }); });
  await Promise.all([flow.confirmBooking(), flow.confirmBooking()]);
  assert.equal(calls, 1);
  assert.equal(flow.getState().step, STEPS.CONFIRMED);
  console.log('  ✓ solo la confirmación V2 con ok:true completa el flujo una vez');
}
