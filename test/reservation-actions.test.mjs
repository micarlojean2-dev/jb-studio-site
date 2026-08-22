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
assert.match(cancelUrl, /#reservation=/);
assert.match(rescheduleUrl, /action=reschedule/);
const html = __test.reservationEmailHtml(client, reservation);
assert.match(html, /Peticiones especiales/);
assert.match(html, /&lt;alergia &amp; aceite&gt;/);
assert.match(html, /Cancelar/);
assert.match(html, /Reagendar/);

const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../api/reservations.js', import.meta.url), 'utf8'));
assert.match(source, /action !== 'reschedule' && action !== 'lookup' && action !== 'list' && action !== 'validate' && action !== 'slots' && action !== 'dates' && \(!nombre \|\| !fecha \|\| !hora\)/,
  'secure actions and read-only availability bypass the creation-only name requirement');
const assistant = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../asistente.html', import.meta.url), 'utf8'));
assert.match(assistant, /window\.location\.hash\.slice\(1\) \|\| window\.location\.search/,
  'email action tokens are read from URL fragments before query strings');
const widget = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../widget.js', import.meta.url), 'utf8'));
for (const [name, source] of [['asistente.html', assistant], ['widget.js', widget]]) {
  assert.match(source, /activeReservation\.actionToken = d\.reservation\.actionToken \|\| activeReservation\.actionToken/,
    `${name} stores the rotated token after rescheduling`);
  assert.doesNotMatch(source, /JSON\.stringify\(\{ clientId: clientId, contacto: cancelData\.contacto, fecha: cancelData\.fecha \}\)/,
    `${name} never sends contact plus date to cancel a reservation`);
  assert.match(source, /action: 'list', actionToken: activeReservation\.actionToken/,
    `${name} lists contact-bound reservations before chat cancellation or rescheduling`);
  assert.match(source, /selectedReservationId: selectedReservationId/,
    `${name} sends a selected reservation ID only after chat selection`);
  assert.match(source, /function (bookingFlowConfirmBooking|widgetFlowConfirmBooking)\(state\)/,
    `${name} creates new reservations through the V2 adapter`);
}
// Auditoría FASE 3: el prompt genérico fue reemplazado por un lookup de solo
// lectura + contexto real de la reserva (nombre/servicio/fecha/hora), que
// también corre independientemente de si hay historial guardado.
assert.match(assistant, /if \(emailAction\) \{\s*fetch\(API \+ '\/api\/reservations'/,
  'email action context lookup runs independently of a saved chat history');

// Cambio 1: reagendar por correo usa el calendario (rescheduleMode), nunca
// texto libre interpretado.
assert.match(assistant, /var rescheduleMode = false;/, 'asistente declara rescheduleMode');
assert.match(assistant, /function startRescheduleFlowV2\(lang, reservation\)/, 'asistente define el flujo de reagendar por calendario');
assert.match(assistant, /step: window\.JBChatFlow\.STEPS\.DATE_SELECTION/, 'el flujo de reagendar arranca directo en DATE_SELECTION');
assert.match(assistant, /rescheduleMode && emailAction\) body\.actionToken = emailAction\.token/, 'dates/slots en reagendar mandan el actionToken para excluir la reserva propia');
assert.match(assistant, /event\.type === window\.JBChatFlow\.EVENTS\.SELECT_TIME\) \{\s*\/\/[^]*?submitEmailAction\(\{ fecha: state\.date, hora: state\.time \}\)/, 'elegir hora en reagendar dispara submitEmailAction con la nueva fecha/hora');
assert.doesNotMatch(assistant, /if \(emailAction\) \{\s*addMsg\('user', t\);/, 'asistente no trata el texto del emailAction sin resguardo');
assert.match(assistant, /if \(rescheduleMode\) return;\s*addMsg\('user', t\);/, 'texto libre del emailAction queda bloqueado en modo reagendar');

const panel = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../reservas.html', import.meta.url), 'utf8'));
assert.match(panel, /var API\s*=\s*window\.location\.origin/,
  'panel fetches APIs from its current Preview or production deployment');

console.log('Reservation action links and confirmation email verified');
