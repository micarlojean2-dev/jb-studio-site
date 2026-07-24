#!/usr/bin/env node
/**
 * JB Studio — Stripe setup (plan único: JB Studio Pro, $65/mes)
 *
 * Idempotente: crea el Product y el Price SOLO si no existen ya (los busca por
 * metadata). Volver a ejecutarlo NO duplica nada. Imprime el STRIPE_PRO_PRICE_ID.
 *
 * Usar EXCLUSIVAMENTE en TEST MODE:  export STRIPE_SECRET_KEY=sk_test_...
 * Ejecutar: node scripts/setup-stripe.mjs
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

if (!process.env.STRIPE_SECRET_KEY) {
  for (const file of ['.env.test', '.env.local']) {
    try {
      const env = readFileSync(resolve(process.cwd(), file), 'utf-8');
      for (const line of env.split('\n')) {
        const [k, ...v] = line.split('=');
        if (k && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
      }
    } catch { /* skip */ }
  }
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('❌  STRIPE_SECRET_KEY no está definido. Exporta la clave de TEST:\n   export STRIPE_SECRET_KEY=sk_test_...');
  process.exit(1);
}
if (!key.startsWith('sk_test_')) {
  console.error('🛑  Esta configuración es SOLO para Test Mode. STRIPE_SECRET_KEY debe empezar con sk_test_.');
  process.exit(1);
}

const { default: Stripe } = await import('stripe');
const stripe = new Stripe(key);

const PRODUCT_NAME  = 'JB Studio Pro';
const AMOUNT_CENTS  = 6500;          // $65.00
const CURRENCY      = 'usd';
const PLAN_META     = 'jb-studio-pro';

console.log('Configurando el plan único en Stripe (Test Mode)…\n');

// ── Product (reutiliza el existente por metadata) ──────────────────────────
let product;
const existingProducts = await stripe.products.search({ query: `metadata['plan']:'${PLAN_META}'`, limit: 1 });
if (existingProducts.data.length) {
  product = existingProducts.data[0];
  console.log(`↺  Product ya existía: ${product.id} (${product.name})`);
} else {
  product = await stripe.products.create({ name: PRODUCT_NAME, metadata: { plan: PLAN_META } });
  console.log(`✅  Product creado: ${product.id} (${product.name})`);
}

// ── Price (reutiliza uno recurrente mensual de $65 sobre ese product) ──────
let price;
const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
price = prices.data.find(p =>
  p.recurring?.interval === 'month' && p.unit_amount === AMOUNT_CENTS && p.currency === CURRENCY);
if (price) {
  console.log(`↺  Price ya existía: ${price.id} ($${(price.unit_amount / 100).toFixed(2)}/mes)`);
} else {
  price = await stripe.prices.create({
    product: product.id,
    unit_amount: AMOUNT_CENTS,
    currency: CURRENCY,
    recurring: { interval: 'month' },
    metadata: { plan: PLAN_META },
  });
  console.log(`✅  Price creado: ${price.id} ($65.00/mes)`);
}

console.log('\n═══════════════════════════════════════');
console.log('Configura esta variable (Preview / Test Mode), sin exponer otras claves:\n');
console.log(`STRIPE_PRO_PRICE_ID=${price.id}`);
console.log('\nEl trial de 7 días se aplica en el Checkout (trial_period_days), no en el Price.');
