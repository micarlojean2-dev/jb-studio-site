import { sendBillingAlertEmail } from '../lib/reservation-emails.js';

async function main() {
  console.log('--- TEST 1: Rendering payment_failed email ---');
  const mockClient = {
    id: 'barberia-el-corte-fino',
    businessName: 'Barbería El Corte Fino',
    ownerEmail: 'test-owner@example.com',
    color: '#0d9488',
    panelToken: 'token123',
    language: 'es'
  };

  process.env.RESEND_API_KEY = 're_test_dummy_key';

  const res1 = await sendBillingAlertEmail(mockClient, 'payment_failed', {
    clientId: mockClient.id,
    gracePeriodEndsAt: '2026-08-15'
  });

  console.log('Result 1 (payment_failed):', res1);

  console.log('\n--- TEST 2: Rendering subscription_paused email ---');
  const res2 = await sendBillingAlertEmail(mockClient, 'subscription_paused', {
    clientId: mockClient.id
  });

  console.log('Result 2 (subscription_paused):', res2);
}

main().catch(console.error);
