import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return; }
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, val] = m;
    if (!(key in process.env)) process.env[key] = val.replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(join(root, '.env.prod.pulled'));
loadEnvFile(join(root, '.env.production.local'));
loadEnvFile(join(root, '.env.local'));

import { Redis } from '@upstash/redis';
import handler from '../api/client-status.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

console.log('=== INSPECCIÓN REAL DE client:barberia-el-corte-fino EN REDIS ===\n');

const clientId = 'barberia-el-corte-fino';
let clientData = null;

try {
  clientData = await redis.get(`client:${clientId}`);
} catch (e) {
  console.error('Error al conectar a Redis:', e.message);
}

if (!clientData) {
  console.log(`⚠️  La clave "client:${clientId}" NO existe en Redis.`);
  console.log('Buscando claves existentes en Redis que coincidan con *barberia*...');
  try {
    const keys = await redis.keys('*barberia*');
    console.log('Claves halladas:', keys);
    if (keys.length > 0) {
      clientData = await redis.get(keys[0]);
      console.log(`\nDatos de la clave "${keys[0]}":`);
    }
  } catch (e) {}
}

if (clientData) {
  console.log('1. JSON Completo de Redis:');
  console.log(JSON.stringify(clientData, null, 2));

  console.log('\nCampos específicos de facturación/trial:');
  console.log('  active:', clientData.active);
  console.log('  stripeCustomerId:', clientData.stripeCustomerId);
  console.log('  stripeSubscriptionId:', clientData.stripeSubscriptionId);
  console.log('  paymentStatus:', clientData.paymentStatus);
  console.log('  trialDays:', clientData.trialDays);
  console.log('  trialEndsAt:', clientData.trialEndsAt);
  console.log('  createdAt:', clientData.createdAt);
  console.log('  panelToken:', clientData.panelToken);

  // 2. Invocar GET /api/client-status
  let statusCode = 0;
  let responseBody = null;

  await handler({
    method: 'GET',
    query: { clientId: clientData.id || clientId, token: clientData.panelToken || process.env.ADMIN_TOKEN },
    headers: {}
  }, {
    setHeader() {},
    status(c) { statusCode = c; return this; },
    json(b) { responseBody = b; return this; }
  });

  console.log(`\n2. Respuesta JSON completa de GET /api/client-status (HTTP ${statusCode}):`);
  console.log(JSON.stringify(responseBody, null, 2));
}
