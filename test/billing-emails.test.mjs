import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendBillingAlertEmail } from '../lib/reservation-emails.js';

test('sendBillingAlertEmail - handles billing alert types correctly', async () => {
  const mockClient = {
    id: 'barberia-el-corte-fino',
    businessName: 'Barbería El Corte Fino',
    ownerEmail: 'owner@barberia.com',
    color: '#0d9488',
    panelToken: 'token123'
  };

  // Without API key
  delete process.env.RESEND_API_KEY;
  const resNoKey = await sendBillingAlertEmail(mockClient, 'payment_failed');
  assert.equal(resNoKey.attempted, false);
  assert.equal(resNoKey.error, 'RESEND_API_KEY missing');

  // With API key
  process.env.RESEND_API_KEY = 're_test_dummy';
  const resFailed = await sendBillingAlertEmail(mockClient, 'payment_failed', {
    clientId: 'barberia-el-corte-fino',
    gracePeriodEndsAt: '2026-08-15'
  });
  assert.equal(resFailed.attempted, true);
  assert.deepEqual(resFailed.recipients, ['owner@barberia.com']);

  const resPaused = await sendBillingAlertEmail(mockClient, 'subscription_paused', {
    clientId: 'barberia-el-corte-fino'
  });
  assert.equal(resPaused.attempted, true);
  assert.deepEqual(resPaused.recipients, ['owner@barberia.com']);

  const resTrial = await sendBillingAlertEmail(mockClient, 'trial_ending_soon', {
    clientId: 'barberia-el-corte-fino',
    trialEnd: '2026-08-20T12:00:00.000Z'
  });
  assert.equal(resTrial.attempted, true);
  assert.deepEqual(resTrial.recipients, ['owner@barberia.com']);
});
