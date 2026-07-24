// Regression: the email result is truthful. A send reports its messageId; a
// provider error is surfaced (never faked as sent); multiple owners each get a
// messageId; a missing RESEND_API_KEY warns instead of silently skipping. [BUG-2]
import assert from 'node:assert/strict';
import { __test } from '../api/reservations.js';
const { sendReservationEmails } = __test;

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

const client = { businessName: 'QA Resto', color: '#1a4a2e', notificationEmails: ['owner1@qa.test', 'owner2@qa.test'] };
const reservation = { clientId: 'c1', nombre: 'QA', email: 'customer@qa.test', servicio: 'Burger', partySize: 2, fecha: '2026-07-24', hora: '1:00 PM', specialRequests: 'No cheese', actionToken: 't', };

// 1) Provider succeeds → per-recipient messageIds, nothing faked.
{
  const sent = [];
  const resend = { emails: { send: async (a) => { sent.push(a.to); return { data: { id: 'msg_' + sent.length } }; } } };
  const r = await sendReservationEmails(client, reservation, 'created', { resend });
  check(r.customer.attempted && r.customer.sent && r.customer.messageId === 'msg_1', 'customer sent with messageId');
  check(r.owners.attempted && r.owners.sent, 'owners attempted+sent');
  check(r.owners.messageIds.length === 2, 'one messageId per owner (no shared bcc)');
  check(r.owners.recipients.length === 2, 'both owners targeted');
  check(sent.length === 3, 'exactly 3 sends (1 customer + 2 owners)');
}

// 2) Provider returns an error → NOT marked sent, error captured.
{
  const resend = { emails: { send: async () => ({ error: { message: 'domain not verified' } }) } };
  const r = await sendReservationEmails(client, reservation, 'created', { resend });
  check(r.customer.attempted && r.customer.sent === false && /domain not verified/.test(r.customer.error), 'provider error not faked as sent');
  check(r.owners.sent === false && r.owners.error, 'owner error surfaced');
}

// 3) No RESEND_API_KEY and no injected provider → warning, no fake send.
{
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const r = await sendReservationEmails(client, reservation, 'created');
  check(r.configured === false && /RESEND_API_KEY missing/.test(r.warning || ''), 'missing key warns, does not fake');
  check(r.customer.sent === false && r.owners.sent === false, 'nothing reported as sent when unconfigured');
  if (prev !== undefined) process.env.RESEND_API_KEY = prev;
}

console.log(`email-flow.test.mjs: ${count} checks passed`);
