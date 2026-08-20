import { Redis } from '@upstash/redis';
import { sendBillingAlertEmail as _sendBillingAlertEmail } from '../lib/reservation-emails.js';
import { initSentry, captureApiException } from '../lib/sentry.js';

initSentry();

const LOG = '[api/trial-expiry-fallback]';

function getRealRedis() {
  return new Redis({
    url:  process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

async function getAllClients(redis) {
  const keys = await redis.keys('client:*');
  if (!keys.length) return [];
  return keys.length === 1
    ? [await redis.get(keys[0])]
    : await redis.mget(...keys);
}

async function updateClient(redis, clientId, patch) {
  const current = await redis.get(`client:${clientId}`);
  if (!current) return false;
  await redis.set(`client:${clientId}`, Object.assign({}, current, patch));
  return true;
}

export async function runTrialExpiryFallback({ redis, sendBillingAlertEmail = _sendBillingAlertEmail, logger = console, now = Date.now(), dry = false } = {}) {
  const store = redis || getRealRedis();
  const log = logger;

  const result = {
    scanned: 0,
    skippedActiveFalse: 0,
    skippedNoTrial: 0,
    skippedNotYetExpired: 0,
    skippedAlreadyPaid: 0,
    paused: [],
    errors: [],
  };

  const clients = await getAllClients(store);

  for (const client of clients) {
    if (!client || typeof client !== 'object') continue;
    result.scanned++;

    const cid = client.id || '(unknown)';

    if (client.active !== true) {
      result.skippedActiveFalse++;
      log.log(`${LOG} [${cid}] skipped — active=${client.active}`);
      continue;
    }

    if (client.trialEnabled !== true) {
      result.skippedNoTrial++;
      continue;
    }

    if (client.paymentStatus === 'paid') {
      result.skippedAlreadyPaid++;
      continue;
    }

    const trialEnd = client.trial_end;
    if (!trialEnd) continue;

    const trialEndMs = Number(trialEnd) * 1000;
    if (!Number.isFinite(trialEndMs)) continue;

    if (trialEndMs > now) {
      result.skippedNotYetExpired++;
      continue;
    }

    const patch = {
      active:        false,
      paymentStatus: 'paused',
      paymentFailed: false,
    };

    if (dry) {
      log.log(`${LOG} [DRY] [${cid}] would pause — trial_end=${new Date(trialEndMs).toISOString()}, previous paymentStatus=${client.paymentStatus}`);
    } else {
      await updateClient(store, cid, patch);
      log.log(`${LOG} [${cid}] PAUSED — trial_end=${new Date(trialEndMs).toISOString()}, previous paymentStatus=${client.paymentStatus}`);
      try {
        await sendBillingAlertEmail(client, 'subscription_paused', { clientId: cid });
      } catch (e) {
        log.error(`${LOG} email error for ${cid}:`, e.message);
        result.errors.push({ clientId: cid, error: e.message });
      }
    }

    result.paused.push({ id: cid, trialEnd: new Date(trialEndMs).toISOString(), ...(dry && { dry: true }) });
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dry = req.query?.dry === '1' || req.query?.dry === 'true';
  const now = Date.now();

  console.log(`${LOG} starting (dry=${dry})`);

  try {
    const store = getRealRedis();
    const results = {
      scanned: 0,
      skippedActiveFalse: 0,
      skippedNoTrial: 0,
      skippedNotYetExpired: 0,
      skippedAlreadyPaid: 0,
      paused: [],
      errors: [],
    };

    const clients = await getAllClients(store);

    for (const client of clients) {
      if (!client || typeof client !== 'object') continue;
      results.scanned++;

      const cid = client.id || '(unknown)';

      if (client.active !== true) {
        results.skippedActiveFalse++;
        console.log(`${LOG} [${cid}] skipped — active=${client.active}`);
        continue;
      }

      if (client.trialEnabled !== true) {
        results.skippedNoTrial++;
        continue;
      }

      if (client.paymentStatus === 'paid') {
        results.skippedAlreadyPaid++;
        continue;
      }

      const trialEnd = client.trial_end;
      if (!trialEnd) continue;

      const trialEndMs = Number(trialEnd) * 1000;
      if (!Number.isFinite(trialEndMs)) continue;

      if (trialEndMs > now) {
        results.skippedNotYetExpired++;
        continue;
      }

      const patch = {
        active:        false,
        paymentStatus: 'paused',
        paymentFailed: false,
      };

      if (dry) {
        console.log(`${LOG} [DRY] [${cid}] would pause — trial_end=${new Date(trialEndMs).toISOString()}`);
        results.paused.push({ id: cid, dry: true, trialEnd: new Date(trialEndMs).toISOString() });
      } else {
        await updateClient(store, cid, patch);
        console.log(`${LOG} [${cid}] PAUSED — trial_end=${new Date(trialEndMs).toISOString()}, previous paymentStatus=${client.paymentStatus}`);
        try {
          await _sendBillingAlertEmail(client, 'subscription_paused', { clientId: cid });
        } catch (e) {
          console.error(`${LOG} email error for ${cid}:`, e.message);
          results.errors.push({ clientId: cid, error: e.message });
        }
        results.paused.push({ id: cid, trialEnd: new Date(trialEndMs).toISOString() });
      }
    }

    console.log(`${LOG} done — scanned=${results.scanned}, paused=${results.paused.length}`);

    return res.status(200).json({
      ok: true,
      dry,
      timestamp: new Date().toISOString(),
      summary: {
        scanned:             results.scanned,
        skippedActiveFalse:   results.skippedActiveFalse,
        skippedNoTrial:       results.skippedNoTrial,
        skippedAlreadyPaid:   results.skippedAlreadyPaid,
        skippedNotYetExpired: results.skippedNotYetExpired,
        paused:              results.paused.length,
      },
      pausedClients: results.paused,
      errors: results.errors,
    });
  } catch (err) {
    console.error(`${LOG} error:`, err.message);
    captureApiException(err, { feature: 'trial_expiry_fallback', route: '/api/trial-expiry-fallback' });
    return res.status(500).json({ error: 'Trial expiry fallback failed', detail: err.message });
  }
}
