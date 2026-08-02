import { Redis } from '@upstash/redis';

const defaultRedis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Activity is intentionally independent from changes:{clientId}: that key is a
// digest queue and is deleted after mail delivery, while this is owner history.
export async function registrarActividad(clientId, evento, deps) {
  const redis = (deps && deps.redis) || defaultRedis;
  const activity = JSON.stringify(Object.assign({}, evento, { timestamp: Date.now() }));
  try {
    await redis.multi()
      .rpush(`activity:${clientId}`, activity)
      .ltrim(`activity:${clientId}`, -100, -1)
      .exec();
    return { ok: true };
  } catch (error) {
    console.error(`[lib/activity] no se pudo guardar actividad para ${clientId}:`, error.message);
    return { ok: false, error: error.message || 'unknown' };
  }
}
