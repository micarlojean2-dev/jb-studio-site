import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const raw = await redis.get('client:live-test-barberia');
const client = typeof raw === 'string' ? JSON.parse(raw) : raw;
console.log('active BEFORE:', client.active);
client.active = false;
await redis.set('client:live-test-barberia', JSON.stringify(client));
console.log('active AFTER:', client.active);
console.log('done');
