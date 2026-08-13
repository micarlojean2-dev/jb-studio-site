// Test: Structured slots returned by availabilityContextBlock in api/client-chat.js
import assert from 'node:assert/strict';

const { __test } = await import('../api/client-chat.js');
const { availabilityContextBlock } = __test;

const mockClient = {
  businessName: 'Spa Test',
  templateId: 'spa',
  businessHours: {
    monday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] },
    tuesday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] },
    wednesday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] },
    thursday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] },
    friday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] },
    saturday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] },
    sunday: { enabled: false, ranges: [] }
  },
  timezone: 'America/Los_Angeles'
};

async function runTests() {
  console.log('Running availability-slots.test.mjs...');

  // 1. Query with availability keyword AND recognizable date
  const messagesWithDate = [
    { role: 'user', content: '¿qué horarios tienen disponibles el sábado?' }
  ];
  const resWithDate = await availabilityContextBlock(mockClient, 'test-spa', messagesWithDate, false);

  assert.ok(resWithDate && typeof resWithDate === 'object', 'Returns object { promptText, slots }');
  assert.ok(resWithDate.promptText.includes('DISPONIBILIDAD REAL EN TIEMPO REAL'), 'Contains availability prompt text');
  assert.ok(Array.isArray(resWithDate.slots), 'slots property is an array');
  assert.ok(resWithDate.slots.length > 0, 'slots array is non-empty');
  assert.ok(resWithDate.slots.length <= 8, 'slots array is capped at maximum 8 items');
  assert.equal(resWithDate.slots[0], '10:00 AM', 'First slot matches opening time');

  // 2. Query WITHOUT availability keyword
  const messagesGeneral = [
    { role: 'user', content: 'Hola, ¿dónde están ubicados?' }
  ];
  const resGeneral = await availabilityContextBlock(mockClient, 'test-spa', messagesGeneral, false);
  assert.equal(resGeneral.slots, null, 'slots is null when not an availability query');
  assert.equal(resGeneral.promptText, '', 'promptText is empty string');

  // 3. Query with availability keyword but NO date
  const messagesNoDate = [
    { role: 'user', content: '¿qué horarios tienen disponibles?' }
  ];
  const resNoDate = await availabilityContextBlock(mockClient, 'test-spa', messagesNoDate, false);
  assert.equal(resNoDate.slots, null, 'slots is null when no date is recognized');
  assert.equal(resNoDate.promptText, '', 'promptText is empty string');

  console.log('✅ All availability-slots tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
