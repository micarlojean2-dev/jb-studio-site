import { spawn } from 'child_process';
import http from 'http';

// Create temporary API route api/_verify_stripe_checkout.js
import fs from 'fs';
fs.writeFileSync('/Users/mike/jb-studio-site/api/_verify_stripe_checkout.js', `
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const priceId = process.env.STRIPE_PRICE_PRO;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: 'spa',
      customer_email: 'test@example.com',
      metadata: { clientId: 'spa' },
      subscription_data: { metadata: { clientId: 'spa' }, trial_period_days: 10 },
      success_url: 'https://jbstudio.app/success?client=spa',
      cancel_url: 'https://jbstudio.app/cancel',
    });

    return res.status(200).json({
      success: true,
      priceIdUsed: priceId,
      sessionId: session.id,
      sessionUrl: session.url,
      livemode: session.livemode,
      payment_status: session.payment_status,
      status: session.status
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      code: err.code,
      type: err.type
    });
  }
}
`);

const dev = spawn('npx', ['vercel', 'dev', '--listen', '4006', '--yes'], {
  cwd: '/Users/mike/jb-studio-site',
  stdio: ['ignore', 'pipe', 'pipe']
});

await new Promise(resolve => setTimeout(resolve, 6000));

try {
  const res = await fetch('http://localhost:4006/api/_verify_stripe_checkout');
  const data = await res.json();
  console.log('=== VERIFICATION RESULT ===');
  console.log(JSON.stringify(data, null, 2));
} catch (err) {
  console.error('ERROR:', err);
} finally {
  dev.kill();
  try { fs.unlinkSync('/Users/mike/jb-studio-site/api/_verify_stripe_checkout.js'); } catch (e) {}
  process.exit(0);
}
