import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function main() {
  console.log('=== STRIPE CUSTOMER PORTAL CONFIG ===\n');

  // 1. List all portal configurations
  let configs;
  try {
    configs = await stripe.billingPortal.configurations.list({ limit: 10 });
    console.log('Configurations found:', configs.data.length);
    configs.data.forEach(c => {
      console.log('  ID:', c.id);
      console.log('  Name:', c.metadata?.name || c.display_name || '(default)');
      console.log('  Active:', c.active);
      console.log('  Default:', c.is_default);
      console.log('  ---');
    });
  } catch(e) {
    console.log('Error listing configs:', e.message);
  }

  // 2. Also get the default portal session config
  console.log('\n=== CUSTOMER PORTAL SETTINGS (via accounts) ===');
  try {
    // Try to get the connected account's portal settings
    // This would require the secret key with proper permissions
    // Let's try listing business profiles
    const account = await stripe.accounts.retrieve();
    console.log('Account:', account.id, 'type=', account.type);
  } catch(e) {
    console.log('Account retrieve error:', e.message);
  }

  // 3. Check if we can see any portal-related info from customers
  const customers = await stripe.customers.list({ limit: 3 });
  console.log('\n=== SAMPLE CUSTOMERS (for portal reference) ===');
  for (const c of customers.data) {
    console.log('Customer:', c.id, '| email=', c.email, '| currency=', c.currency);
    if (c.invoice_settings?.default_payment_method) {
      console.log('  Default PM:', c.invoice_settings.default_payment_method);
    }
  }

  // 4. Check subscriptions to understand the default behavior
  console.log('\n=== ACTIVE SUBSCRIPTIONS (to understand current state) ===');
  const subs = await stripe.subscriptions.list({ limit: 5, status: 'active' });
  subs.data.forEach(s => {
    console.log('  Sub:', s.id, '| cust=', s.customer, '| status=', s.status);
    console.log('    default_pm=', s.default_payment_method);
    console.log('    collection_method=', s.collection_method);
    console.log('    trial_end=', s.trial_end ? new Date(s.trial_end * 1000).toISOString() : 'none');
  });

  // 5. Try to get the portal configuration that would be used for a session
  // stripe.billingPortal.sessions.create doesn't require a config ID if default exists
  console.log('\n=== TEST: Can we create a portal session? ===');
  try {
    if (customers.data.length > 0) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: 'https://jbstudio.app',
      });
      console.log('Portal session OK:', session.id);
      console.log('Session URL:', session.url);
    }
  } catch(e) {
    console.log('Portal session error:', e.message);
  }
}

main().catch(console.error);
