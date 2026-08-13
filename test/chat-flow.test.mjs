import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
}
function throws(fn, message) {
  try { fn(); ok(false, message); } catch (_) { ok(true, message); }
}
function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

console.log('1. Inicio y transiciones guiadas');
{
  const flow = createBookingFlow({ config: { clientId: 'test-spa' } });
  ok(flow.getState().step === STEPS.CHAT, 'el estado inicial es CHAT');
  ok(flow.startBooking().step === STEPS.SERVICE_SELECTION, 'START_BOOKING lleva a SERVICE_SELECTION');
  ok(flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje relajante' }).step === STEPS.DATE_SELECTION,
    'SELECT_SERVICE lleva a DATE_SELECTION');
  ok(flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' }).step === STEPS.TIME_SELECTION,
    'SELECT_DATE lleva a TIME_SELECTION');
  ok(flow.dispatch({ type: EVENTS.SELECT_TIME, time: '16:00' }).step === STEPS.CUSTOMER_DATA,
    'SELECT_TIME lleva a CUSTOMER_DATA');
}

console.log('\n2. Flujo completo hasta confirmación');
{
  const flow = createBookingFlow({ config: { clientId: 'test-spa' } });
  flow.dispatch({ type: EVENTS.START_BOOKING });
  flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje relajante' });
  flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
  flow.dispatch({ type: EVENTS.SELECT_TIME, time: '16:00' });
  flow.dispatch({
    type: EVENTS.SET_CUSTOMER_DATA,
    customer: { name: 'Ana Prueba', phone: '5551234567', email: 'ana@example.com' },
    specialRequests: '',
  });
  ok(flow.dispatch({ type: EVENTS.SHOW_SUMMARY }).step === STEPS.SUMMARY, 'SHOW_SUMMARY lleva a SUMMARY');
  ok(flow.dispatch({ type: EVENTS.REQUEST_CONFIRMATION }).step === STEPS.CONFIRMATION,
    'REQUEST_CONFIRMATION lleva a CONFIRMATION');
  const confirmed = flow.dispatch({ type: EVENTS.CONFIRM_BOOKING });
  ok(confirmed.step === STEPS.CONFIRMED, 'CONFIRM_BOOKING lleva a CONFIRMED');
  ok(confirmed.service === 'Masaje relajante' && confirmed.customer.email === 'ana@example.com',
    'la confirmación conserva los datos capturados');
}

console.log('\n3. Contratos de transiciones y estado');
{
  const flow = createBookingFlow({ config: { clientId: 'test-spa' } });
  throws(() => flow.dispatch({ type: EVENTS.REQUEST_CONFIRMATION }),
    'no permite CHAT → CONFIRMATION');
  flow.startBooking();
  throws(() => flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' }),
    'no permite SERVICE_SELECTION → TIME_SELECTION');
  throws(() => flow.setState({ version: 2, step: STEPS.CONFIRMATION, service: null, date: null, time: null, customer: {}, specialRequests: null }),
    'no permite restaurar CONFIRMATION sin campos requeridos');
}

console.log('\n4. Persistencia v2 aislada');
{
  const storage = memoryStorage();
  const flow = createBookingFlow({ config: { clientId: 'test-spa' }, storage });
  flow.startBooking();
  flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje relajante' });
  const key = 'jba_test-spa_booking_v2';
  ok(storage.getItem(key) !== null, 'persiste solo en la llave v2');

  const restored = createBookingFlow({ config: { clientId: 'test-spa' }, storage });
  ok(restored.init().step === STEPS.DATE_SELECTION, 'init restaura el estado v2 persistido');
  ok(restored.getState().service === 'Masaje relajante', 'restore conserva el servicio');
}

console.log('\n4.1 Namespaces de almacenamiento por superficie');
{
  const storage = memoryStorage();
  const assistant = createBookingFlow({ config: { clientId: 'same-client', storageNamespace: 'jba' }, storage });
  const widget = createBookingFlow({ config: { clientId: 'same-client', storageNamespace: 'jbw' }, storage });
  assistant.startBooking();
  widget.startBooking();
  assistant.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje' });
  ok(storage.getItem('jba_same-client_booking_v2') !== null, 'asistente persiste en namespace jba');
  ok(storage.getItem('jbw_same-client_booking_v2') !== null, 'widget persiste en namespace jbw');
  ok(createBookingFlow({ config: { clientId: 'same-client', storageNamespace: 'jbw' }, storage }).init().step === STEPS.SERVICE_SELECTION,
    'widget restaura únicamente su propio namespace');
}

console.log('\n5. Edición, restaurante y restauración');
{
  const storage = memoryStorage();
  const restaurant = createBookingFlow({ config: { clientId: 'test-restaurant', templateId: 'restaurant' }, storage });
  restaurant.startBooking();
  restaurant.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Cena' });
  ok(restaurant.getState().step === STEPS.PEOPLE_SELECTION, 'Restaurante pide personas antes de fecha');
  restaurant.dispatch({ type: EVENTS.SELECT_PEOPLE, people: 3 });
  ok(restaurant.getState().step === STEPS.DATE_SELECTION, 'SELECT_PEOPLE lleva a DATE_SELECTION');
  restaurant.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
  restaurant.dispatch({ type: EVENTS.SELECT_TIME, time: '18:00' });
  restaurant.dispatch({ type: EVENTS.SET_CUSTOMER_DATA, customer: { name: 'Luis Prueba', phone: '5559876543', email: 'luis@example.com' }, specialRequests: '' });
  restaurant.dispatch({ type: EVENTS.SHOW_SUMMARY });
  restaurant.dispatch({ type: EVENTS.EDIT_TIME });
  ok(restaurant.getState().step === STEPS.TIME_SELECTION && restaurant.getState().date === '2026-08-20', 'EDIT_TIME conserva fecha');
  restaurant.dispatch({ type: EVENTS.SELECT_TIME, time: '19:00' });
  restaurant.dispatch({ type: EVENTS.SHOW_SUMMARY });
  restaurant.dispatch({ type: EVENTS.EDIT_SERVICE });
  ok(restaurant.getState().step === STEPS.SERVICE_SELECTION && restaurant.getState().date === null, 'EDIT_SERVICE limpia los datos dependientes');
  const restored = createBookingFlow({ config: { clientId: 'test-restaurant', templateId: 'restaurant' }, storage });
  ok(restored.init().step === STEPS.SERVICE_SELECTION, 'init restaura el paso editado');
}

console.log('\n6. Confirmación controlada por backend');
{
  function readyFlow(confirmBooking) {
    const flow = createBookingFlow({ config: { clientId: 'test-spa' }, request: { confirmBooking } });
    flow.startBooking();
    flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Masaje' });
    flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
    flow.dispatch({ type: EVENTS.SELECT_TIME, time: '16:00' });
    flow.dispatch({ type: EVENTS.SET_CUSTOMER_DATA, customer: { name: 'Ana Prueba', phone: '5551234567', email: 'ana@example.com' }, specialRequests: '' });
    flow.dispatch({ type: EVENTS.SHOW_SUMMARY });
    flow.dispatch({ type: EVENTS.REQUEST_CONFIRMATION });
    return flow;
  }
  const success = readyFlow(() => Promise.resolve({ ok: true }));
  await success.confirmBooking();
  ok(success.getState().step === STEPS.CONFIRMED, 'solo ok:true confirma el flujo');
  const rejected = readyFlow(() => Promise.resolve({ ok: false, motivo: 'ocupado' }));
  await rejected.confirmBooking();
  ok(rejected.getState().step === STEPS.CONFIRMATION, 'rechazo backend conserva CONFIRMATION');
  const failed = readyFlow(() => Promise.reject(new Error('network')));
  try { await failed.confirmBooking(); } catch (_) {}
  ok(failed.getState().step === STEPS.CONFIRMATION, 'error de red conserva CONFIRMATION');
  let calls = 0;
  const doubleClick = readyFlow(() => { calls++; return new Promise(resolve => setTimeout(() => resolve({ ok: true }), 10)); });
  await Promise.all([doubleClick.confirmBooking(), doubleClick.confirmBooking()]);
  ok(calls === 1 && doubleClick.getState().step === STEPS.CONFIRMED, 'doble confirmación comparte una sola petición');
}

console.log('\n7. Preferencias opcionales por plantilla');
{
  const restaurant = createBookingFlow({ config: { clientId: 'restaurant-preferences', templateId: 'restaurant' } });
  restaurant.startBooking();
  restaurant.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Cena' });
  restaurant.dispatch({ type: EVENTS.SELECT_PEOPLE, people: 2 });
  restaurant.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
  restaurant.dispatch({ type: EVENTS.SELECT_TIME, time: '18:00' });
  restaurant.dispatch({ type: EVENTS.SET_RESTAURANT_PREFERENCES, tablePreference: 'Terraza', foodPreferences: { remove: ['queso'] } });
  restaurant.dispatch({ type: EVENTS.SET_CUSTOMER_DATA, customer: { name: 'Ana Prueba', phone: '5551234567', email: 'ana@example.com' }, specialRequests: '', foodPreferences: { remove: ['queso'] }, tablePreference: 'Terraza' });
  ok(restaurant.getState().tablePreference === 'Terraza' && restaurant.getState().foodPreferences.remove[0] === 'queso', 'Restaurante conserva preferencias opcionales');

  const barber = createBookingFlow({ config: { clientId: 'barber-preferences', templateId: 'barber', staff: [{ name: 'Ana' }] } });
  barber.startBooking();
  barber.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Corte' });
  ok(barber.getState().step === STEPS.BARBER_SELECTION, 'Barbería con staff muestra selección opcional');
  barber.dispatch({ type: EVENTS.SELECT_BARBER, barberPreference: null });
  ok(barber.getState().step === STEPS.DATE_SELECTION && barber.getState().barberPreference === null, 'Cualquiera continúa sin preferencia');
  const selected = createBookingFlow({ config: { clientId: 'barber-selected', templateId: 'barber', staff: [{ name: 'Ana' }] } });
  selected.startBooking(); selected.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Corte' });
  selected.dispatch({ type: EVENTS.SELECT_BARBER, barberPreference: 'Ana' });
  ok(selected.getState().barberPreference === 'Ana', 'Barbería conserva el barbero elegido');
}

console.log(failures ? `\n❌ ${failures} prueba(s) fallaron` : '\n✅ chat-flow v2: estados, transiciones y persistencia aislada verificados');
process.exit(failures ? 1 : 0);
