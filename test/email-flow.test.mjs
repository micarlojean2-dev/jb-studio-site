// Regression: the email result is truthful. A send reports its messageId; a
// provider error is surfaced (never faked as sent); multiple owners each get a
// messageId; a missing RESEND_API_KEY warns instead of silently skipping. [BUG-2]
import assert from 'node:assert/strict';
import { destinatariosAviso, reservationEmailHtml, sendReservationEmails } from '../lib/reservation-emails.js';

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

const ownerEmail = 'mikestandlyjeanbaptiste@gmail.com';
const client = {
  businessName: 'QA Resto',
  color: '#1a4a2e',
  ownerEmail,
  notificationEmails: ['OWNER1@qa.test', ownerEmail, 'owner2@qa.test', ' owner1@qa.test '],
};
const reservation = { clientId: 'c1', nombre: 'QA', email: 'customer@qa.test', servicio: 'Burger', partySize: 2, fecha: '2026-07-24', hora: '1:00 PM', specialRequests: 'No cheese', actionToken: 't', };

// 1) Provider succeeds → per-recipient messageIds, nothing faked.
{
  const sent = [];
  const resend = { emails: { send: async (a) => { sent.push(a.to); return { data: { id: 'msg_' + sent.length } }; } } };
  const r = await sendReservationEmails(client, reservation, 'created', { resend });
  check(r.customer.attempted && r.customer.sent && r.customer.messageId === 'msg_1', 'customer sent with messageId');
  check(r.owners.attempted && r.owners.sent, 'owners attempted+sent');
  check(r.owners.messageIds.length === 3, 'one messageId per owner (no shared bcc)');
  check(r.owners.recipients.length === 3, 'owner plus distinct notification emails are targeted');
  check(r.owners.recipients[0] === ownerEmail, 'the configured owner receives the notification first');
  check(sent.includes(ownerEmail), 'the owner test email receives a notification');
  check(sent.length === 4, 'exactly 4 sends (1 customer + 3 owners)');
}

// Owner stays first and the combined recipient list never exceeds ten.
{
  const many = Array.from({ length: 12 }, (_, i) => `team${i}@qa.test`);
  const recipients = destinatariosAviso({ ownerEmail, notificationEmails: [ownerEmail, ...many] });
  check(recipients.length === 10, 'owner list is capped at ten recipients total');
  check(recipients[0] === ownerEmail, 'owner keeps first recipient priority when capped');
  check(new Set(recipients).size === recipients.length, 'owner recipient list has no duplicates');
}

// 4) All notification types use accurate copy; cancellation has no stale actions.
{
  const created = reservationEmailHtml(client, reservation, 'created');
  const rescheduled = reservationEmailHtml(client, reservation, 'rescheduled');
  const cancelled = reservationEmailHtml(client, reservation, 'cancelled');
  check(/Reserva confirmada/.test(created) && /Cancelar/.test(created), 'created email keeps action buttons');
  check(/Reserva reprogramada/.test(rescheduled) && /Reagendar/.test(rescheduled), 'rescheduled email keeps action buttons');
  check(/Reserva cancelada/.test(cancelled) && /La reserva fue cancelada\./.test(cancelled), 'cancelled email has cancellation copy');
  check(!/Reagendar|>Cancelar</.test(cancelled), 'cancelled email has no obsolete action buttons');
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

// 5) [CAMBIO 2] El dueño ve teléfono/email del cliente; el cliente no ve nada nuevo.
{
  const sentEmails = [];
  const resend = { emails: { send: async (a) => { sentEmails.push(a); return { data: { id: 'msg' } }; } } };
  const reservationConContacto = { ...reservation, telefono: '555-1234' };
  await sendReservationEmails(client, reservationConContacto, 'created', { resend });
  const ownerSends = sentEmails.filter((a) => a.to !== reservationConContacto.email);
  const customerSend = sentEmails.find((a) => a.to === reservationConContacto.email);
  check(ownerSends.length > 0 && ownerSends.every((a) => /<strong>Teléfono:<\/strong> 555-1234/.test(a.html)), 'el dueño ve el teléfono del cliente');
  check(ownerSends.every((a) => /<strong>Email:<\/strong> customer@qa\.test/.test(a.html)), 'el dueño ve el email del cliente');
  check(!!customerSend, 'el cliente sigue recibiendo su propio email');
  check(customerSend && !/Teléfono:/.test(customerSend.html) && !/<strong>Email:<\/strong>/.test(customerSend.html),
    'el email del cliente NO incluye las líneas de contacto (solo las ve el dueño)');
}

// 6) [CAMBIO 2] Sin teléfono ni email en la reserva no se generan líneas vacías.
{
  const sentEmails = [];
  const resend = { emails: { send: async (a) => { sentEmails.push(a); return { data: { id: 'msg' } }; } } };
  const reservationSinContacto = { ...reservation, telefono: '', email: '' };
  await sendReservationEmails(client, reservationSinContacto, 'created', { resend });
  check(sentEmails.length > 0, 'se intentó enviar al menos al dueño');
  check(sentEmails.every((a) => !/Teléfono:/.test(a.html) && !/<strong>Email:<\/strong>/.test(a.html)),
    'sin teléfono/email, no aparecen líneas "Teléfono:"/"Email:" vacías');
}

// 7) [CAMBIO 2] El teléfono/email del dueño usa el escapado HTML existente (esc()).
{
  const sentEmails = [];
  const resend = { emails: { send: async (a) => { sentEmails.push(a); return { data: { id: 'msg' } }; } } };
  const reservationConXSS = { ...reservation, telefono: '<script>1</script>', email: 'a<b>@qa.test' };
  await sendReservationEmails(client, reservationConXSS, 'created', { resend });
  const ownerSend = sentEmails.find((a) => a.to === ownerEmail);
  check(ownerSend && !/<script>1<\/script>/.test(ownerSend.html) && /&lt;script&gt;1&lt;\/script&gt;/.test(ownerSend.html),
    'el teléfono se escapa con la función esc() existente (sin HTML crudo)');
  check(ownerSend && /a&lt;b&gt;@qa\.test/.test(ownerSend.html), 'el email se escapa con la función esc() existente');
}

console.log(`email-flow.test.mjs: ${count} checks passed`);
