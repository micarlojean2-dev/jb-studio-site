import { Redis } from '@upstash/redis';
import { initSentry, captureApiException, Sentry } from '../lib/sentry.js';

let redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method === 'GET' && req.query?.test_alert === 'true') {
    const claimed = await redis.set('sentry:manual-alert-test', '1', { nx: true, ex: 3600 });
    if (claimed) {
      initSentry();
      captureApiException(new Error('PRUEBA MANUAL - ignorar, no es un error real'), {
        feature: 'manual_alert_test',
        route: '/api/health',
        extra: { test: true },
      });
      await Sentry.flush(2000);
    }
  }

  let redisOk = false;
  try {
    const pingResult = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
    ]);
    if (pingResult === 'PONG' || pingResult) {
      redisOk = true;
    }
  } catch (err) {
    redisOk = false;
  }

  const timestamp = new Date().toISOString();
  if (req.method === 'HEAD') return res.status(200).end();

  if (redisOk) {
    return res.status(200).json({ status: 'ok', timestamp });
  } else {
    return res.status(200).json({ status: 'degraded', timestamp });
  }
}

export const __test = {
  setRedisForTests(value) { redis = value; },
};
