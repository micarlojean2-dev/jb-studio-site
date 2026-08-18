import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');
const root = new URL('..', import.meta.url);
const assistant = readFileSync(new URL('asistente.html', root), 'utf8');
const widget = readFileSync(new URL('widget.js', root), 'utf8');

console.log('Contrato conversacional V2');
for (const [name, source] of [['asistente', assistant], ['widget', widget]]) {
  assert.match(source, /interpretation\) \|\| null/);
  assert.match(source, /intent = interp \? interp\.intent : 'unknown'/);
  assert.match(source, /start(?:Widget)?BookingFlowV2\(lang/);
  assert.doesNotMatch(source, /\b(bookingData|bookingStep|BOOKING_SESS|askBookingTurn|showBookingSummary|submitBooking)\b/);
  console.log(`  ✓ ${name} usa intent estructurado y arranque V2 sin motor legacy`);
}

const flow = createBookingFlow({ config: { clientId: 'conversational-v2', templateId: 'barber', staff: [{ name: 'Ana' }] } });
flow.startBooking();
flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Corte' });
assert.equal(flow.getState().step, STEPS.BARBER_SELECTION);
flow.dispatch({ type: EVENTS.SELECT_BARBER, barberPreference: 'Ana' });
assert.equal(flow.getState().barberPreference, 'Ana');
console.log('  ✓ el flujo guiado conserva la selección de barbero');
