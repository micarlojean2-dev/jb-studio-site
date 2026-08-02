// Regression: identical confirmations map to one reservation. The fingerprint
// is stable across retries and distinguishes genuinely different bookings; the
// active-duplicate detector returns the existing key so the caller can answer
// with existingReservationId instead of stacking another. [BUG-4]
import assert from 'node:assert/strict';
import { __test } from '../api/reservations.js';
const { idempotencyFingerprint, duplicateReservationKey, releaseInactiveIdempotencyLock } = __test;

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

const base = { telefono: '555 123 4567', email: 'QA@Example.com', fechaISO: '2026-07-24', horaISO: '13:00', servicio: 'Hamburguesa Clásica', partySize: 2 };

// Stable: same booking (even with cosmetic phone/email/case differences) → same key.
const a = idempotencyFingerprint('c1', base);
const b = idempotencyFingerprint('c1', { ...base, telefono: '(555) 123-4567', email: 'qa@example.com' });
check(a === b, 'fingerprint stable across cosmetic contact differences');

// Different time → different key (a real second booking is allowed).
check(idempotencyFingerprint('c1', base) !== idempotencyFingerprint('c1', { ...base, horaISO: '14:00' }), 'different time → different fingerprint');
// Different client → different key.
check(idempotencyFingerprint('c1', base) !== idempotencyFingerprint('c2', base), 'different client → different fingerprint');

// Active-duplicate detection returns the matching key.
const existing = [
  { _key: 'reservations:c1:111', estado: 'cancelada', fechaISO: '2026-07-24', horaISO: '13:00', telefono: '5551234567' },
  { _key: 'reservations:c1:222', estado: 'confirmada', fechaISO: '2026-07-24', horaISO: '13:00', telefono: '5551234567', email: 'qa@example.com' },
];
const incoming = { fechaISO: '2026-07-24', horaISO: '13:00', telefono: '555-123-4567', email: '' };
check(duplicateReservationKey(existing, incoming) === 'reservations:c1:222', 'returns active duplicate key');
// A cancelled reservation is not a duplicate (slot is free again).
check(duplicateReservationKey([existing[0]], incoming) === null, 'cancelled reservation is not a duplicate');
// Different contact → not a duplicate even at same time.
check(duplicateReservationKey(existing, { fechaISO: '2026-07-24', horaISO: '13:00', telefono: '9999999999' }) === null, 'different contact is not a duplicate');

// A cancelled/rejected reservation must release its completed retry lock so the
// next identical confirmation can acquire it and create a new reservation.
{
  const data = new Map([
    ['idempo:c1:retry', 'reservations:c1:111'],
    ['reservations:c1:111', existing[0]],
  ]);
  const store = { get: async (key) => data.get(key), del: async (key) => data.delete(key) };
  check(await releaseInactiveIdempotencyLock(store, 'idempo:c1:retry') === true, 'cancelled reservation releases completed retry lock');
  check(!data.has('idempo:c1:retry'), 'cancelled reservation lock is removed');
}
{
  const data = new Map([
    ['idempo:c1:retry', 'reservations:c1:222'],
    ['reservations:c1:222', existing[1]],
  ]);
  const store = { get: async (key) => data.get(key), del: async (key) => data.delete(key) };
  check(await releaseInactiveIdempotencyLock(store, 'idempo:c1:retry') === false, 'active reservation retains completed retry lock');
  check(data.has('idempo:c1:retry'), 'active reservation lock remains in place');
}

console.log(`booking-idempotency.test.mjs: ${count} checks passed`);
