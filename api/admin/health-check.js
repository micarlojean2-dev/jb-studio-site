import { Redis } from '@upstash/redis';
import Stripe from 'stripe';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2024-04-10',
});

const PLAN_PRICES = { basic: 49, pro: 65 };

function auth(req) {
  const secret = process.env.HEALTHCHECK_SECRET;
  if (!secret) return false;
  const header = req.headers['authorization'] || '';
  const provided = header.replace(/^Bearer\s+/i, '').trim();
  return provided === secret;
}

async function getClientsFromRedis() {
  const keys = await redis.keys('client:*');
  if (!keys.length) return [];
  return keys.length === 1
    ? [await redis.get(keys[0])]
    : await redis.mget(...keys);
}

async function checkPaymentIssues() {
  const result = {
    ok: true,
    pastDueClients: [],
    failingClients: [],
    trialingEndingSoon: [],
    mrr: 0,
    activeClients: 0,
  };

  try {
    const clients = await getClientsFromRedis();
    const now = Date.now();
    const in48h = now + 48 * 60 * 60 * 1000;

    for (const client of clients) {
      if (!client || typeof client !== 'object') continue;
      if (client.active) {
        result.activeClients++;
        const price = PLAN_PRICES[client.plan] || 0;
        result.mrr += price;
      }
      if (client.paymentStatus === 'past_due') {
        result.pastDueClients.push(client.id || client.businessName || 'unknown');
      }
      if (client.paymentFailed === true) {
        result.failingClients.push(client.id || client.businessName || 'unknown');
      }
      if (
        client.paymentStatus === 'trialing' &&
        client.trial_end &&
        Number(client.trial_end) * 1000 <= in48h
      ) {
        result.trialingEndingSoon.push({
          id: client.id || client.businessName || 'unknown',
          trialEnd: new Date(Number(client.trial_end) * 1000).toISOString(),
        });
      }
    }

    result.ok = result.pastDueClients.length === 0 && result.failingClients.length === 0;
  } catch (err) {
    result.ok = false;
    result.error = err.message;
  }

  return result;
}

async function checkBusinessHealth() {
  const result = { ok: true, activeClients: 0, pausedClients: 0, pausedByStatus: {} };

  try {
    const clients = await getClientsFromRedis();
    for (const client of clients) {
      if (!client || typeof client !== 'object') continue;
      if (client.active) {
        result.activeClients++;
      } else {
        result.pausedClients++;
        const status = client.paymentStatus || 'unknown';
        result.pausedByStatus[status] = (result.pausedByStatus[status] || 0) + 1;
      }
    }
    result.ok = true;
  } catch (err) {
    result.ok = false;
    result.error = err.message;
  }

  return result;
}

async function checkChatbotCreator() {
  const result = { ok: false, redis: false, stripe: false, testClientCreated: false, testClientDeleted: false };

  try {
    await redis.ping();
    result.redis = true;
  } catch (err) {
    result.error = `redis: ${err.message}`;
    return result;
  }

  const testClockId = `hc_clk_${Date.now()}`;
  let testCustomerId = null;

  try {
    const clock = await stripe.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: 'healthcheck',
    });
    testClockId = clock.id;

    const customer = await stripe.customers.create({
      name: 'Health Check Test',
      email: 'healthcheck@jbstudio.app',
      metadata: { healthcheck: 'true' },
      test_clock: testClockId,
    });
    testCustomerId = customer.id;
    result.testClientCreated = true;

    await stripe.customers.del(customer.id);
    result.testClientDeleted = true;

    await stripe.testClocks.del(testClockId);
    result.stripe = true;
    result.ok = true;
  } catch (err) {
    result.error = `stripe: ${err.message}`;
    try {
      if (testCustomerId) await stripe.customers.del(testCustomerId).catch(() => {});
      await stripe.testClocks.del(testClockId).catch(() => {});
    } catch (_) {}
  }

  return result;
}

async function checkAIChat() {
  const result = { ok: false, openaiResponds: false, latencyMs: 0, recentErrors: [] };

  try {
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Respond with just the word "ok".' }],
        max_tokens: 3,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    result.latencyMs = Date.now() - start;

    if (response.ok) {
      result.openaiResponds = true;
      result.ok = true;
    } else {
      result.error = `openai status ${response.status}`;
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

async function checkInteractiveButtons() {
  const result = { ok: false, reservationFlow: null, buttonsRenderedByFrontend: true };

  try {
    const testClientId = 'barberia-el-corte-fino';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(
      `${process.env.APP_URL || 'https://jbstudio.app'}/api/client-config?id=${testClientId}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      if (data.features?.reservations) {
        result.reservationFlow = 'config retrieved';
        result.ok = true;
      } else {
        result.reservationFlow = 'reservations not enabled';
      }
    } else {
      result.error = `client-config returned ${resp.status}`;
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!auth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const [paymentIssues, businessHealth, chatbotCreator, aiChat, interactiveButtons] =
    await Promise.all([
      checkPaymentIssues(),
      checkBusinessHealth(),
      checkChatbotCreator(),
      checkAIChat(),
      checkInteractiveButtons(),
    ]);

  const allOk =
    paymentIssues.ok &&
    businessHealth.ok &&
    chatbotCreator.ok &&
    aiChat.ok &&
    interactiveButtons.ok;

  const body = {
    timestamp: new Date().toISOString(),
    checks: {
      paymentIssues,
      businessHealth,
      chatbotCreator,
      aiChat,
      interactiveButtons,
    },
  };

  return res.status(allOk ? 200 : 503).json(body);
}
