import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');

console.log('Estados y preferencias V2');
{
  const restaurant = createBookingFlow({ config: { clientId: 'entities-restaurant', templateId: 'restaurant' } });
  restaurant.startBooking();
  restaurant.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Cena' });
  restaurant.dispatch({ type: EVENTS.SELECT_PEOPLE, people: 3 });
  restaurant.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
  restaurant.dispatch({ type: EVENTS.SELECT_TIME, time: '20:30' });
  restaurant.dispatch({ type: EVENTS.SET_RESTAURANT_PREFERENCES, foodPreferences: { remove: ['cebolla'] }, tablePreference: 'Ventana' });
  restaurant.dispatch({
    type: EVENTS.SET_CUSTOMER_DATA,
    customer: { name: 'Ana Prueba', phone: '5551234567', email: 'ana@example.com' },
    specialRequests: '',
  });
  restaurant.dispatch({ type: EVENTS.SHOW_SUMMARY });
  assert.equal(restaurant.getState().step, STEPS.SUMMARY);
  assert.equal(restaurant.getState().people, 3);
  assert.deepEqual(restaurant.getState().foodPreferences, { remove: ['cebolla'] });
  assert.equal(restaurant.getState().tablePreference, 'Ventana');
  console.log('  ✓ restaurante conserva personas y preferencias hasta el resumen');
}

{
  const barber = createBookingFlow({ config: { clientId: 'entities-barber', templateId: 'barber', staff: [{ name: 'Ana' }] } });
  barber.startBooking();
  barber.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Corte' });
  assert.equal(barber.getState().step, STEPS.BARBER_SELECTION);
  barber.dispatch({ type: EVENTS.SELECT_BARBER, barberPreference: 'Ana' });
  assert.equal(barber.getState().barberPreference, 'Ana');
  console.log('  ✓ barbería conserva la preferencia de profesional seleccionada');
}
