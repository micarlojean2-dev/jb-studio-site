#!/usr/bin/env node
/**
 * JB Studio — Stripe product/price setup
 * Run once: node scripts/setup-stripe.mjs
 * Requires: STRIPE_SECRET_KEY in env or .env.local
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Try to load .env.local manually if STRIPE_SECRET_KEY not set
if (!process.env.STRIPE_SECRET_KEY) {
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8');
    for (const line of env.split('\n')) {
      const [k, ...v] = line.split('=');
      if (k && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
    }
  } catch { /* no .env.local, skip */ }
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('❌  STRIPE_SECRET_KEY not set. Export it first:\n   export STRIPE_SECRET_KEY=sk_test_...');
  process.exit(1);
}

const { default: Stripe } = await import('stripe');
const stripe = new Stripe(key);

const PLANS = [
  { name: 'JB Chatbot - Basic',   amount: 4500, plan: 'basic'   },
  { name: 'JB Chatbot - Pro',     amount: 6500, plan: 'pro'     },
  { name: 'JB Chatbot - Premium', amount: 9000, plan: 'premium' },
];

console.log('Creating Stripe products and prices...\n');

const results = [];

for (const p of PLANS) {
  const product = await stripe.products.create({
    name: p.name,
    metadata: { plan: p.plan },
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: p.amount,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: p.plan },
  });

  results.push({ plan: p.plan, productId: product.id, priceId: price.id });
  console.log(`✅  ${p.name}`);
  console.log(`    Product: ${product.id}`);
  console.log(`    Price:   ${price.id}\n`);
}

console.log('═══════════════════════════════════════');
console.log('Run these commands to set Vercel env vars:\n');
for (const r of results) {
  const envKey = `STRIPE_PRICE_${r.plan.toUpperCase()}`;
  console.log(`echo "${r.priceId}" | vercel env add ${envKey} production`);
}
console.log('\nThen redeploy: vercel --prod');
