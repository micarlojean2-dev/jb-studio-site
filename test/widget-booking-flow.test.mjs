import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const root = join(import.meta.dirname, '..');
const source = readFileSync(join(root, 'widget.js'), 'utf8');
const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
}

function readyFlow(config, confirmBooking) {
  const flow = createBookingFlow({ config, request: { confirmBooking } });
  flow.startBooking();
  flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: config.templateId === 'restaurant' ? 'Cena' : 'Masaje' });
  if (config.templateId === 'restaurant') flow.dispatch({ type: EVENTS.SELECT_PEOPLE, people: 2 });
  flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-20' });
  flow.dispatch({ type: EVENTS.SELECT_TIME, time: '16:00' });
  flow.dispatch({ type: EVENTS.SET_CUSTOMER_DATA, customer: { name: 'Ana Prueba', phone: '5551234567', email: 'ana@example.com' }, specialRequests: '' });
  flow.dispatch({ type: EVENTS.SHOW_SUMMARY });
  flow.dispatch({ type: EVENTS.REQUEST_CONFIRMATION });
  return flow;
}

console.log('1. Cableado widget v2');
ok(source.includes("flow.src = API + '/chat-flow.js'"), 'widget carga chat-flow.js');
ok(source.includes("storageNamespace: 'jbw'"), 'widget usa namespace jbw');
ok(source.includes('function startWidgetBookingFlowV2('), 'widget define inicio v2');
ok(source.includes('function restoreWidgetBookingFlowV2()'), 'widget define restore v2');
ok(source.includes("request: { availableDates: widgetFlowRequestDates, slots: widgetFlowRequestSlots, confirmBooking: widgetFlowConfirmBooking }"), 'widget conecta los tres adaptadores backend');
ok(source.includes('if (startWidgetBookingFlowV2(lang'), 'nueva reserva intenta v2 antes de fallback');
ok(source.includes('barberPreference: state.barberPreference'), 'widget envía la preferencia de barbero a disponibilidad y creación');
ok(source.includes('foodPreferences: state.foodPreferences') && source.includes('tablePreference: state.tablePreference'), 'widget envía preferencias opcionales de restaurante');
ok(source.includes('function renderAvailabilitySlots('), 'widget separa slots de disponibilidad general del renderer legacy');
ok(source.includes('captureWidgetBookingV2Event('), 'widget registra telemetría v2 sin datos del cliente');
ok(source.includes('if (!FLOW) return false;'), 'restore depende únicamente de V2');

console.log('\n2. Secuencias Spa y Restaurante');
{
  const spa = readyFlow({ clientId: 'widget-spa', storageNamespace: 'jbw' }, () => Promise.resolve({ ok: true }));
  ok(spa.getState().step === STEPS.CONFIRMATION, 'Spa llega a CONFIRMATION bajo el controlador compartido');
  const restaurant = readyFlow({ clientId: 'widget-restaurant', templateId: 'restaurant', storageNamespace: 'jbw' }, () => Promise.resolve({ ok: true }));
  ok(restaurant.getState().people === 2 && restaurant.getState().step === STEPS.CONFIRMATION, 'Restaurante requiere personas antes de fecha');
}

console.log('\n3. Errores y confirmación');
{
  const rejected = readyFlow({ clientId: 'widget-error', storageNamespace: 'jbw' }, () => Promise.resolve({ ok: false, motivo: 'ocupado' }));
  await rejected.confirmBooking();
  ok(rejected.getState().step === STEPS.CONFIRMATION, 'rechazo backend permanece en v2');
  const network = readyFlow({ clientId: 'widget-network', storageNamespace: 'jbw' }, () => Promise.reject(new Error('network')));
  try { await network.confirmBooking(); } catch (_) {}
  ok(network.getState().step === STEPS.CONFIRMATION, 'error de red permanece en v2');
  let calls = 0;
  const duplicate = readyFlow({ clientId: 'widget-duplicate', storageNamespace: 'jbw' }, () => { calls++; return new Promise(resolve => setTimeout(() => resolve({ ok: true, duplicate: true }), 10)); });
  await Promise.all([duplicate.confirmBooking(), duplicate.confirmBooking()]);
  ok(calls === 1 && duplicate.getState().step === STEPS.CONFIRMED, 'doble confirmación hace una sola petición');
}

console.log('\n4. Retirada legacy');
{
  const v2Block = source.slice(source.indexOf('function renderWidgetBookingFlow'), source.indexOf('function showTyping'));
  ok(!/askBookingTurn\(|showBookingSummary\(|submitBooking\(/.test(v2Block), 'adaptador v2 no llama funciones legacy');
  ok(!/\b(bookingStep|bookingData|bookingPending|bookingReview|BOOKING_SESS|askBookingTurn|showBookingSummary|submitBooking)\b/.test(source), 'no quedan estado ni funciones legacy');
}

console.log('\n5. Inicio V2 sin fallback');
{
  const bookingIntent = source.slice(source.indexOf("intent === 'booking'"), source.indexOf('// Pregunta general'));
  ok(bookingIntent.includes('if (startWidgetBookingFlowV2(lang'), 'una reserva nueva intenta únicamente V2');
  ok(!bookingIntent.includes('askBookingTurn('), 'fallo de inicio V2 no entra al motor legacy');
  ok(bookingIntent.includes('No pudimos iniciar la reserva'), 'fallo de inicio V2 muestra un error recuperable');
}

console.log(failures ? `\n❌ ${failures} prueba(s) fallaron` : '\n✅ widget v2: cableado, estados, errores y aislamiento legacy verificados');
process.exit(failures ? 1 : 0);
