import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function test() {
  console.log('=== TEST: stripe.subscriptions.create con tok_chargeDeclined ===');
  console.log('tok_chargeDeclined -> card decline error when charge is attempted');
  console.log('');

  const nowSec = Math.floor(Date.now() / 1000);
  const tc = await stripe.testHelpers.testClocks.create({ frozen_time: nowSec });

  const cust = await stripe.customers.create({ name: 'Fail at Charge', email: 'fail@test.com', test_clock: tc.id });
  console.log('Customer:', cust.id);

  // Approach 1: tok_chargeDeclined as card token in SetupIntent
  let pm;
  try {
    pm = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: 'tok_chargeDeclined' },
    });
    console.log('PM created:', pm.id);
    await stripe.paymentMethods.attach(pm.id, { customer: cust.id });
    await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: pm.id } });
    console.log('PM attached OK');
  } catch(e) {
    console.log('PM create/attach FAILED:', e.message);
    console.log('');
    console.log('tok_chargeDeclined fails at attach time - not usable for this test');
  }

  if (!pm) {
    // Approach 2: payment_behavior: 'default_incomplete' with no PM
    console.log('');
    console.log('Trying: subscription with default_incomplete (no PM attached)');
    try {
      const sub = await stripe.subscriptions.create({
        customer: cust.id,
        items: [{ price: 'price_1TtgGUBwbj79Pav2Vmh1q8iM' }],
        trial_period_days: 10,
        payment_behavior: 'default_incomplete',
        trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } },
        metadata: { test: '1' },
      });
      console.log('Sub created (no PM):', sub.id, 'status=', sub.status);

      // Advance clock to day 11 - Stripe should attempt to charge and fail
      const t11 = nowSec + Math.floor(11 * 86400);
      await stripe.testHelpers.testClocks.advance(tc.id, { frozen_time: t11 });
      await new Promise(r => setTimeout(r, 2000));
      const s = await stripe.subscriptions.retrieve(sub.id);
      console.log('Day 11 status:', s.status, 'past_due=', s.past_due);
      const evs = await stripe.events.list({ limit: 20 });
      evs.data.filter(e => e.type.includes('invoice')).forEach(e => {
        const i = e.data.object;
        console.log(' ', e.type, '| inv=', i.id, '| status=', i.status, '| attempts=', i.attempt_count);
      });

      await stripe.subscriptions.cancel(sub.id);
    } catch(e) {
      console.log('Subscription create failed:', e.message);
    }
  }

  // Approach 3: Use PaymentIntent to verify card and then use it
  console.log('');
  console.log('=== TEST: SetupIntent -> payment_method con 4000000000000002 (generic_decline) ===');
  const tc2 = await stripe.testHelpers.testClocks.create({ frozen_time: nowSec });
  const cust2 = await stripe.customers.create({ name: 'SetupIntent Test', email: 'si@test.com', test_clock: tc2.id });

  try {
    // Create a SetupIntent - this is for setting up future payments
    // Stripe validates the card but doesn't charge it
    const si = await stripe.setupIntents.create({
      payment_method_types: ['card'],
      usage: 'off_session',
    });
    console.log('SetupIntent created:', si.id, 'status=', si.status);

    // Try to use the card with decline in a way that validates but doesn't charge
    // The card 4000000000000002 should fail when Stripe tries to verify it
    // But SetupIntents don't automatically fail for insufficient_funds at setup time
    // They only fail when confirmed with a payment method

    // Alternative: Create subscription and manually trigger a charge
    // For that we need the subscription to be active first

    const sub3 = await stripe.subscriptions.create({
      customer: cust2.id,
      items: [{ price: 'price_1TtgGUBwbj79Pav2Vmh1q8iM' }],
      trial_period_days: 10,
      payment_behavior: 'default_incomplete',
      trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
      metadata: { test: '3' },
    });
    console.log('Sub created (default_incomplete):', sub3.id, 'status=', sub3.status);

    // Now add a PM with failing card using stripe.customers.update
    // Actually, we can't add a PM to an existing subscription as default
    // But we can update the customer's default payment method
    const pm2 = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: 'tok_visa' }, // valid for now
    });
    await stripe.paymentMethods.attach(pm2.id, { customer: cust2.id });
    await stripe.customers.update(cust2.id, { invoice_settings: { default_payment_method: pm2.id } });

    // Advance clock past trial
    const t11 = nowSec + Math.floor(11 * 86400);
    await stripe.testHelpers.testClocks.advance(tc2.id, { frozen_time: t11 });
    await new Promise(r => setTimeout(r, 2000));

    const s3 = await stripe.subscriptions.retrieve(sub3.id);
    console.log('Day 11 (active sub + PM):', s3.status, 'past_due=', s3.past_due);

    const evs3 = await stripe.events.list({ limit: 20 });
    evs3.data.filter(e => e.type.includes('invoice')).forEach(e => {
      const i = e.data.object;
      console.log(' ', e.type, '| inv=', i.id, '| status=', i.status, '| attempts=', i.attempt_count);
    });

    await stripe.subscriptions.cancel(sub3.id);
  } catch(e) {
    console.log('Error:', e.message);
  }

  await stripe.customers.del(cust.id).catch(() => {});
  await stripe.customers.del(cust2.id).catch(() => {});
  await stripe.testHelpers.testClocks.del(tc.id).catch(() => {});
  await stripe.testHelpers.testClocks.del(tc2.id).catch(() => {});
  console.log('\nDone');
}

test().catch(console.error);
