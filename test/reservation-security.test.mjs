// Security regressions exercise the real handlers with an in-memory Redis double.
import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL ||= 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'fake-token';
globalThis.fetch = async () => { throw new Error('network disabled in reservation security test'); };

const { default: reservationHandler, __test: reservationTest } = await import('../api/reservations.js');
const { default: cancellationHandler, __test: cancellationTest } = await import('../api/cancel-reservation.js');

function fakeRedis({ failGet = false, failKeys = false, failLock = false, failReservationWrite = false } = {}) {
  const data = new Map();
  const match = (pattern, key) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '.*')}$`).test(key);
  return {
    data,
    async get(key) { if (failGet) throw new Error('redis unavailable'); return data.get(key) ?? null; },
    async mget(...keys) { return keys.map((key) => data.get(key) ?? null); },
    async keys(pattern) { if (failKeys) throw new Error('redis unavailable'); return [...data.keys()].filter((key) => match(pattern, key)); },
    async set(key, value, options = {}) {
      if (options.nx && failLock) throw new Error('redis unavailable');
      if (options.nx && data.has(key)) return null;
      if (failReservationWrite && key.startsWith('reservations:')) throw new Error('redis write unavailable');
      data.set(key, value);
      return 'OK';
    },
    async del(key) { return data.delete(key) ? 1 : 0; },
    createScript() {
      return { async eval(keys, args) {
        if (data.get(keys[0]) === args[0]) return data.delete(keys[0]) ? 1 : 0;
        return 0;
      } };
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() {},
  };
}

const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  .map((day) => [day, { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] }]));
const client = {
  active: true,
  features: { reservations: true },
  timezone: 'UTC',
  minNoticeHours: 0,
  capacityPerSlot: 1,
  businessHours: hours,
  menu: [{ nombre: 'Masaje', duracion: '60 min' }],
};
const booking = (nombre, hora = '10:00') => ({
  method: 'POST', headers: { 'x-forwarded-for': `${nombre}.test` }, body: {
    clientId: 'secure-spa', nombre, telefono: '5551234567', email: `${nombre}@qa.test`,
    fecha: '2040-07-20', hora, servicio: 'Masaje', idempotencyKey: `request-${nombre}`,
  },
});
async function call(handler, req) { const res = response(); await handler(req, res); return res; }

console.log('1. Redis availability read failure does not create a reservation');
{
  const redis = fakeRedis({ failKeys: true });
  redis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(redis);
  const res = await call(reservationHandler, booking('redis-failure'));
  assert.equal(res.statusCode, 503);
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);
}

console.log('1b. Disabled reservation features reject creation, rescheduling, and cancellation');
{
  const redis = fakeRedis();
  redis.data.set('client:secure-spa', { ...client, features: { reservations: false, cancellation: false, rescheduling: false } });
  reservationTest.setRedisForTests(redis);
  cancellationTest.setRedisForTests(redis);

  const create = await call(reservationHandler, booking('feature-disabled'));
  assert.equal(create.body.ok, false);
  assert.equal(create.body.motivo, 'reservas_desactivadas');
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);

  const reschedule = await call(reservationHandler, {
    method: 'POST', headers: { 'x-forwarded-for': 'feature-reschedule.test' }, body: {
      clientId: 'secure-spa', action: 'reschedule', actionToken: 'unused-token', fecha: '2040-07-20', hora: '11:00',
    },
  });
  assert.equal(reschedule.body.ok, false);
  assert.equal(reschedule.body.motivo, 'reservas_desactivadas');

  const cancel = await call(cancellationHandler, {
    method: 'POST', headers: { 'x-forwarded-for': 'feature-cancel.test' }, body: {
      clientId: 'secure-spa', actionToken: 'unused-token',
    },
  });
  assert.equal(cancel.body.ok, false);
  assert.equal(cancel.body.motivo, 'cancelacion_desactivada');
  console.log('✓ disabled reservation features cannot create, reschedule, or cancel');
}

console.log('1c. Early validation rejects a service that runs past closing without creating a reservation');
{
  const redis = fakeRedis();
  const closingHours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    .map((day) => [day, { enabled: true, ranges: [{ start: '09:00', end: '21:00' }] }]));
  redis.data.set('client:secure-spa', { ...client, templateId: 'spa', businessHours: closingHours });
  reservationTest.setRedisForTests(redis);

  const validation = await call(reservationHandler, {
    method: 'POST', headers: { 'x-forwarded-for': 'early-closing.test' }, body: {
      clientId: 'secure-spa', action: 'validate', fecha: '2040-07-20', hora: '8:59 PM', servicio: 'Masaje',
    },
  });
  assert.equal(validation.statusCode, 200);
  assert.equal(validation.body.ok, false);
  assert.equal(validation.body.motivo, 'no_cabe_antes_del_cierre');
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);
  console.log('✓ early validation rejects 8:59 PM + 60 min before collecting contact data');
}

console.log('1d. Early validation rejects a restaurant table without a dish using its standard duration');
{
  const redis = fakeRedis();
  const closingHours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    .map((day) => [day, { enabled: true, ranges: [{ start: '10:00', end: '22:00' }] }]));
  redis.data.set('client:secure-restaurant', {
    ...client,
    templateId: 'restaurant',
    businessHours: closingHours,
    menu: [{ nombre: 'Plato de prueba', duracion: '' }],
    reservationDuration: '90 min',
  });
  reservationTest.setRedisForTests(redis);

  const validation = await call(reservationHandler, {
    method: 'POST', headers: { 'x-forwarded-for': 'restaurant-closing.test' }, body: {
      clientId: 'secure-restaurant', action: 'validate', fecha: '2040-07-20', hora: '8:45 PM', servicio: '',
    },
  });
  assert.equal(validation.statusCode, 200);
  assert.equal(validation.body.ok, false);
  assert.equal(validation.body.motivo, 'no_cabe_antes_del_cierre');
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);
  console.log('✓ early validation uses the restaurant standard 90 min duration without a dish');
}

console.log('2. Invalid times do not create a reservation');
{
  const redis = fakeRedis();
  redis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(redis);
  const res = await call(reservationHandler, booking('invalid-time', '8:99 PM'));
  assert.equal(res.body.ok, false);
  assert.equal(res.body.motivo, 'hora_invalida');
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);
}

console.log('3. Redis write failure does not create a reservation');
{
  const redis = fakeRedis({ failReservationWrite: true });
  redis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(redis);
  const res = await call(reservationHandler, booking('write-failure'));
  assert.equal(res.statusCode, 503);
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);
}

console.log('4. Concurrent bookings for one slot allow only one confirmation');
{
  const redis = fakeRedis();
  redis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(redis);
  const [a, b] = await Promise.all([call(reservationHandler, booking('alice')), call(reservationHandler, booking('bob'))]);
  assert.equal([a, b].filter((res) => res.statusCode === 201).length, 1);
  const reservationKeys = [...redis.data.keys()].filter((key) => key.startsWith('reservations:'));
  assert.equal(reservationKeys.length, 1);
  const storedReservation = redis.data.get(reservationKeys[0]);
  assert.equal(storedReservation.actionToken, undefined);
  assert.match(storedReservation.actionTokenHash, /^[a-f0-9]{64}$/);
  assert.ok(storedReservation.actionTokenExpiresAt);
}

console.log('5. Cancellation without a token is rejected');
{
  const redis = fakeRedis();
  redis.data.set('client:secure-spa', client);
  cancellationTest.setRedisForTests(redis);
  const res = await call(cancellationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'cancel.test' }, body: { clientId: 'secure-spa' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.found, false);
}

console.log('6. A valid token cancels once and cannot be reused');
{
  const redis = fakeRedis();
  const token = '8ab3d8fb-1699-440d-89b0-ef66c4ad8e3b';
  const key = 'reservations:secure-spa:1';
  redis.data.set('client:secure-spa', client);
  redis.data.set(key, {
    clientId: 'secure-spa', estado: 'confirmada', nombre: 'Token QA', fecha: '2040-07-20', hora: '10:00',
    email: '', actionTokenHash: cancellationTest.actionTokenHash(token), actionTokenExpiresAt: '2040-07-21T23:59:59.999Z', actionTokenUsedAt: null,
  });
  cancellationTest.setRedisForTests(redis);
  const req = { method: 'POST', headers: { 'x-forwarded-for': 'token.test' }, body: { clientId: 'secure-spa', actionToken: token } };
  const first = await call(cancellationHandler, req);
  const second = await call(cancellationHandler, req);
  assert.equal(first.body.found, true);
  assert.equal(second.body.found, false);
  assert.equal(redis.data.get(key).estado, 'cancelada');
  assert.ok(redis.data.get(key).actionTokenUsedAt);
}

console.log('7. Invalid, expired, and cross-client tokens cannot select reservations');
{
  const redis = fakeRedis();
  const token = 'secure-token';
  redis.data.set('client:secure-spa', client);
  redis.data.set('client:other-spa', client);
  redis.data.set('reservations:secure-spa:2', {
    estado: 'confirmada', actionTokenHash: reservationTest.actionTokenHash(token), actionTokenExpiresAt: '2040-07-21T23:59:59.999Z',
  });
  reservationTest.setRedisForTests(redis);
  assert.equal((await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'invalid-token.test' }, body: { clientId: 'secure-spa', action: 'lookup', actionToken: 'wrong' } })).body.found, false);
  assert.equal((await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'cross-token.test' }, body: { clientId: 'other-spa', action: 'lookup', actionToken: token } })).body.found, false);
  redis.data.get('reservations:secure-spa:2').actionTokenExpiresAt = '2000-01-01T00:00:00.000Z';
  assert.equal((await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'expired-token.test' }, body: { clientId: 'secure-spa', action: 'lookup', actionToken: token } })).body.found, false);
}

console.log('8. A legacy token migrates on use and rescheduling rotates it');
{
  const redis = fakeRedis();
  const legacyToken = 'legacy-token';
  const key = 'reservations:secure-spa:3';
  redis.data.set('client:secure-spa', client);
  redis.data.set(key, { clientId: 'secure-spa', estado: 'confirmada', nombre: 'Legacy', fecha: '2040-07-20', fechaISO: '2040-07-20', hora: '10:00', horaISO: '10:00', servicio: 'Masaje', duracion: 60, actionToken: legacyToken });
  reservationTest.setRedisForTests(redis);
  const lookup = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'legacy-lookup.test' }, body: { clientId: 'secure-spa', action: 'lookup', actionToken: legacyToken } });
  assert.equal(lookup.body.found, true);
  assert.equal(redis.data.get(key).actionToken, undefined);
  const rescheduled = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'legacy-reschedule.test' }, body: { clientId: 'secure-spa', action: 'reschedule', actionToken: legacyToken, fecha: '2040-07-20', hora: '11:00' } });
  assert.equal(rescheduled.body.ok, true);
  const nextToken = rescheduled.body.reservation.actionToken;
  assert.ok(nextToken && nextToken !== legacyToken);
  assert.equal((await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'old-token.test' }, body: { clientId: 'secure-spa', action: 'lookup', actionToken: legacyToken } })).body.found, false);
  assert.equal((await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'new-token.test' }, body: { clientId: 'secure-spa', action: 'lookup', actionToken: nextToken } })).body.found, true);
}

console.log('9. Redis failures fail closed during lookup, locks, and cancellation');
{
  const lookupRedis = fakeRedis({ failKeys: true });
  lookupRedis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(lookupRedis);
  const lookup = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'lookup-storage.test' }, body: { clientId: 'secure-spa', action: 'lookup', actionToken: 'x' } });
  assert.deepEqual(lookup.body, { error: 'storage_unavailable', retryable: true });

  const lockRedis = fakeRedis({ failLock: true });
  lockRedis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(lockRedis);
  assert.equal((await call(reservationHandler, booking('lock-failure'))).statusCode, 503);

  const cancelRedis = fakeRedis({ failGet: true });
  cancelRedis.data.set('client:secure-spa', client);
  cancellationTest.setRedisForTests(cancelRedis);
  const cancellation = await call(cancellationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'cancel-storage.test' }, body: { clientId: 'secure-spa', actionToken: 'x' } });
  assert.deepEqual(cancellation.body, { error: 'storage_unavailable', retryable: true });
}

console.log('10. Token expiry honors the business timezone');
{
  assert.equal(reservationTest.actionTokenExpiry('2040-07-20', 'America/Los_Angeles'), '2040-07-21T06:59:59.999Z');
}

console.log('11. Chat selection lists and manages only exact email-and-phone matches');
{
  const redis = fakeRedis();
  const token = 'chat-selection-token';
  const sourceKey = 'reservations:secure-spa:chat-source';
  const peerKey = 'reservations:secure-spa:chat-peer';
  const outsiderKey = 'reservations:secure-spa:chat-outsider';
  const base = {
    clientId: 'secure-spa', estado: 'confirmada', email: 'same@qa.test', telefono: '5551234567',
    fecha: '2040-07-20', fechaISO: '2040-07-20', horaISO: '10:00', servicio: 'Masaje', duracion: 60,
  };
  redis.data.set('client:secure-spa', client);
  redis.data.set(sourceKey, { ...base, nombre: 'Source', hora: '10:00', actionTokenHash: reservationTest.actionTokenHash(token), actionTokenExpiresAt: '2040-07-21T23:59:59.999Z', actionTokenUsedAt: null });
  redis.data.set(peerKey, { ...base, nombre: 'Peer', hora: '11:00', horaISO: '11:00' });
  redis.data.set(outsiderKey, { ...base, nombre: 'Outsider', email: 'other@qa.test', hora: '12:00', horaISO: '12:00' });
  reservationTest.setRedisForTests(redis);
  cancellationTest.setRedisForTests(redis);

  const list = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'chat-list.test' }, body: { clientId: 'secure-spa', action: 'list', actionToken: token } });
  assert.equal(list.body.found, true);
  assert.deepEqual(list.body.reservations.map((reservation) => Object.keys(reservation).sort()), [
    ['fecha', 'hora', 'reservationId', 'servicio'], ['fecha', 'hora', 'reservationId', 'servicio'],
  ]);
  assert.deepEqual(list.body.reservations.map((reservation) => reservation.reservationId).sort(), [peerKey, sourceKey].sort());

  const invalidList = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'chat-invalid.test' }, body: { clientId: 'secure-spa', action: 'list', actionToken: 'expired-or-invalid' } });
  assert.deepEqual(invalidList.body, { found: false });

  const crossReschedule = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'chat-reschedule.test' }, body: { clientId: 'secure-spa', action: 'reschedule', actionToken: token, selectedReservationId: outsiderKey, fecha: '2040-07-20', hora: '13:00' } });
  assert.deepEqual(crossReschedule.body, { found: false });
  assert.equal(redis.data.get(outsiderKey).hora, '12:00');

  const peerReschedule = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'chat-peer-reschedule.test' }, body: { clientId: 'secure-spa', action: 'reschedule', actionToken: token, selectedReservationId: peerKey, fecha: '2040-07-20', hora: '13:00' } });
  assert.equal(peerReschedule.body.ok, true);
  assert.equal(redis.data.get(peerKey).hora, '13:00');
  assert.equal((await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'chat-source-still-valid.test' }, body: { clientId: 'secure-spa', action: 'list', actionToken: token } })).body.found, true);

  const crossCancel = await call(cancellationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'chat-cancel.test' }, body: { clientId: 'secure-spa', actionToken: token, selectedReservationId: outsiderKey } });
  assert.deepEqual(crossCancel.body, { found: false });
  const peerCancel = await call(cancellationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'chat-peer-cancel.test' }, body: { clientId: 'secure-spa', actionToken: token, selectedReservationId: peerKey } });
  assert.equal(peerCancel.body.found, true);
  assert.equal(redis.data.get(peerKey).estado, 'cancelada');
  redis.data.get(sourceKey).actionTokenExpiresAt = '2000-01-01T00:00:00.000Z';
  const expiredList = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'chat-expired.test' }, body: { clientId: 'secure-spa', action: 'list', actionToken: token } });
  assert.deepEqual(expiredList.body, { found: false });
}

console.log('12. Chat selection shares the five-per-IP-per-hour reservation rate limit');
{
  const redis = fakeRedis();
  const token = 'rate-limit-list-token';
  redis.data.set('client:secure-spa', client);
  redis.data.set('reservations:secure-spa:rate-limit', {
    estado: 'confirmada', email: 'rate@qa.test', telefono: '5551234567',
    actionTokenHash: reservationTest.actionTokenHash(token), actionTokenExpiresAt: '2040-07-21T23:59:59.999Z', actionTokenUsedAt: null,
  });
  reservationTest.setRedisForTests(redis);
  const req = { method: 'POST', headers: { 'x-forwarded-for': 'chat-rate-limit.test' }, body: { clientId: 'secure-spa', action: 'list', actionToken: token } };
  for (let i = 0; i < 5; i++) assert.equal((await call(reservationHandler, req)).statusCode, 200);
  assert.equal((await call(reservationHandler, req)).statusCode, 429);
}

console.log('13. A reservation can only be rescheduled once (reagendado_limite)');
{
  const redis = fakeRedis();
  const token = 'one-reschedule-token';
  const key = 'reservations:secure-spa:one-reschedule';
  redis.data.set('client:secure-spa', client);
  redis.data.set(key, {
    clientId: 'secure-spa', estado: 'confirmada', nombre: 'Uno', fecha: '2040-07-20', fechaISO: '2040-07-20', hora: '10:00', horaISO: '10:00', servicio: 'Masaje', duracion: 60,
    email: '', actionTokenHash: reservationTest.actionTokenHash(token), actionTokenExpiresAt: '2040-07-21T23:59:59.999Z', actionTokenUsedAt: null,
  });
  reservationTest.setRedisForTests(redis);

  const first = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'one-reschedule-a.test' }, body: { clientId: 'secure-spa', action: 'reschedule', actionToken: token, fecha: '2040-07-20', hora: '12:00' } });
  assert.equal(first.body.ok, true, 'first reschedule succeeds');
  assert.equal(redis.data.get(key).estado, 'reprogramada', 'reservation becomes reprogramada');
  assert.ok(redis.data.get(key).fechaReprogramacion, 'fechaReprogramacion is set after first reschedule');
  // El primer reagendado rota el token; la segunda llamada debe rechazarse por
  // el límite, no por token inválido. Usamos un token fresco que aún matchea
  // el hash rotado para aislar el motivo.
  const rotated = first.body.reservation.actionToken;
  assert.ok(rotated && rotated !== token, 'token rotated after reschedule');
  const second = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'one-reschedule-b.test' }, body: { clientId: 'secure-spa', action: 'reschedule', actionToken: rotated, fecha: '2040-07-20', hora: '14:00' } });
  assert.equal(second.body.ok, false, 'second reschedule is rejected');
  assert.equal(second.body.motivo, 'reagendado_limite', 'rejection reason is reagendado_limite');
  assert.equal(redis.data.get(key).hora, '12:00', 'the second reschedule does not change the time');
}

console.log('14. Reagendar por calendario excluye la reserva propia de dates/slots');
{
  const redis = fakeRedis();
  const cap2 = { ...client, capacityPerSlot: 2 };
  const token = 'reschedule-self-token';
  const selfKey = 'reservations:secure-spa:self';
  const otherKey = 'reservations:secure-spa:other';
  redis.data.set('client:secure-spa', cap2);
  redis.data.set(selfKey, {
    clientId: 'secure-spa', estado: 'confirmada', nombre: 'Self', fecha: '2040-07-20', fechaISO: '2040-07-20', hora: '10:00', horaISO: '10:00', servicio: 'Masaje', duracion: 60,
    email: '', actionTokenHash: reservationTest.actionTokenHash(token), actionTokenExpiresAt: '2040-07-21T23:59:59.999Z', actionTokenUsedAt: null,
  });
  // Otra reserva en el mismo horario: con capacityPerSlot=2, sin excluir la
  // propia habría 2/2 ocupados y 10:00 no aparecería; excluyéndola queda 1/2
  // y el slot debe seguir visible.
  redis.data.set(otherKey, {
    clientId: 'secure-spa', estado: 'confirmada', nombre: 'Other', fecha: '2040-07-20', fechaISO: '2040-07-20', hora: '10:00', horaISO: '10:00', servicio: 'Masaje', duracion: 60, email: '',
  });
  reservationTest.setRedisForTests(redis);

  const slotsWithToken = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'self-slots.test' }, body: { clientId: 'secure-spa', action: 'slots', service: 'Masaje', date: '2040-07-20', actionToken: token } });
  assert.equal(slotsWithToken.statusCode, 200);
  assert.equal(slotsWithToken.body.ok, true);
  assert.ok(slotsWithToken.body.slots.some((s) => s.value === '10:00'), 'self reservation excluded: 10:00 remains available with capacityPerSlot=2');

  const slotsWithoutToken = await call(reservationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'plain-slots.test' }, body: { clientId: 'secure-spa', action: 'slots', service: 'Masaje', date: '2040-07-20' } });
  assert.equal(slotsWithoutToken.body.ok, true);
  assert.ok(!slotsWithoutToken.body.slots.some((s) => s.value === '10:00'), 'without exclusion, 10:00 is full (2/2)');
}

console.log('Reservation security handler tests verified');
