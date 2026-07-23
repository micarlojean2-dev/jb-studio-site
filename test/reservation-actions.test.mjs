import assert from 'node:assert/strict';
import { __test } from '../api/reservations.js';

const reservation = {
  clientId: 'bella-luna-spa', actionToken: 'c0b3021e-04a6-46c0-a99c-8b3bb6609aa5',
  nombre: 'Prueba', servicio: 'Masaje', fecha: '2026-08-10', hora: '10:00',
  partySize: '', specialRequests: '<alergia & aceite>',
};
const client = { businessName: 'Bella & Luna', color: '#123456' };

const cancelUrl = __test.reservationActionUrl(reservation, 'cancel');
const rescheduleUrl = __test.reservationActionUrl(reservation, 'reschedule');
assert.match(cancelUrl, /action=cancel/);
assert.match(cancelUrl, /reservation=c0b3021e/);
assert.match(rescheduleUrl, /action=reschedule/);
const html = __test.reservationEmailHtml(client, reservation);
assert.match(html, /Peticiones especiales/);
assert.match(html, /&lt;alergia &amp; aceite&gt;/);
assert.match(html, /Cancelar/);
assert.match(html, /Reagendar/);

const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../api/reservations.js', import.meta.url), 'utf8'));
assert.match(source, /action !== 'reschedule' && \(!nombre \|\| !fecha \|\| !hora\)/,
  'secure rescheduling bypasses the creation-only name requirement');
const assistant = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../asistente.html', import.meta.url), 'utf8'));
assert.match(assistant, /if \(emailAction\) addMsg\('bot', emailAction\.action === 'cancel'/,
  'email action prompt is shown independently of a saved chat history');

console.log('Reservation action links and confirmation email verified');
