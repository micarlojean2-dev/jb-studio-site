// Plan único: el webhook traduce cada subscription.status de Stripe al estado
// local exacto (active + paymentStatus) y guarda los campos del panel. [STRIPE]
import assert from 'node:assert/strict';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy_for_unit_test';
const { __test } = await import('../api/stripe-webhook.js');
const { subscriptionPatch, isoFull } = __test;

let count = 0;
function check(v, m) { assert.ok(v, m); count++; }

const t = (unix) => new Date(unix * 1000).toISOString();
function sub(status, extra = {}) {
  return Object.assign({
    id: 'sub_1', customer: 'cus_1', status,
    items: { data: [{ price: { id: 'price_pro' } }] },
    trial_start: 1000000000, trial_end: 1000604800,        // +7 días
    current_period_start: 1000000000, current_period_end: 1000604800,
    cancel_at_period_end: false, canceled_at: null,
  }, extra);
}

// Mapeo de estados
const trial = subscriptionPatch(sub('trialing'));
check(trial.active === true && trial.paymentStatus === 'trialing' && trial.paymentFailed === false, 'trialing → active+trialing');
check(trial.stripePriceId === 'price_pro', 'captures stripePriceId');
check(trial.trialEndsAt === t(1000604800) && trial.currentPeriodEnd === t(1000604800), 'stores trial/period end as ISO');
check(trial.nextPaymentAt === t(1000604800), 'nextPaymentAt = current_period_end');

const active = subscriptionPatch(sub('active'));
check(active.active === true && active.paymentStatus === 'active', 'active → active+active');

const pastDue = subscriptionPatch(sub('past_due'));
check(pastDue.active === true && pastDue.paymentStatus === 'past_due' && pastDue.paymentFailed === true, 'past_due keeps access');

const unpaid = subscriptionPatch(sub('unpaid'));
check(unpaid.active === false && unpaid.paymentStatus === 'unpaid', 'unpaid → inactive+unpaid');

const canceled = subscriptionPatch(sub('canceled', { canceled_at: 1000700000 }));
check(canceled.active === false && canceled.paymentStatus === 'canceled' && canceled.canceledAt === t(1000700000), 'canceled → inactive+canceled+canceledAt');

const incomplete = subscriptionPatch(sub('incomplete'));
check(incomplete.active === false && incomplete.paymentStatus === 'incomplete', 'incomplete → inactive+incomplete');

const scheduled = subscriptionPatch(sub('active', { cancel_at_period_end: true }));
check(scheduled.cancelAtPeriodEnd === true && scheduled.active === true, 'cancelAtPeriodEnd captured, access kept');

check(isoFull(0) === null && isoFull(null) === null, 'isoFull null-safe');

console.log(`stripe-webhook.test.mjs: ${count} checks passed`);
