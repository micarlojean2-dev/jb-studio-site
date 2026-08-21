import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const CORE = window.JBChatCore;
const require = createRequire(import.meta.url);
const { STEPS, EVENTS, createBookingFlow } = require('../chat-flow.js');

assert.equal(typeof CORE.missingCustomerField, 'function');
assert.equal(typeof CORE.askMissingCustomerField, 'function');
assert.equal(CORE.missingCustomerField({ name: null, phone: null, email: null }), 'name');
assert.equal(CORE.askMissingCustomerField('phone', 'es'), '¿Cuál es tu número de teléfono de contacto?');

const draft = { name: null, phone: null, email: null };
let customerDataRendered = false;
const flow = createBookingFlow({
  config: { clientId: 'chat-core-booking' },
  render: {
    render(state) {
      if (state.step === STEPS.CUSTOMER_DATA) {
        customerDataRendered = true;
        assert.equal(CORE.missingCustomerField(draft), 'name');
        assert.equal(CORE.askMissingCustomerField('name', 'es'), '¿Cuál es tu nombre completo?');
      }
    },
  },
});

flow.startBooking();
flow.dispatch({ type: EVENTS.SELECT_SERVICE, service: 'Corte' });
flow.dispatch({ type: EVENTS.SELECT_DATE, date: '2026-08-21' });
assert.doesNotThrow(() => flow.dispatch({ type: EVENTS.SELECT_TIME, time: '16:00' }));
assert.equal(flow.getState().step, STEPS.CUSTOMER_DATA);
assert.equal(customerDataRendered, true);

console.log('chat-core booking exports and SELECT_TIME renderer path verified');
