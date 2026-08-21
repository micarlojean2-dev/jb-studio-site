import { readFileSync, writeFileSync } from 'node:fs';
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

process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token-2026';
process.env.UPSTASH_REDIS_REST_URL = 'https://e2e-redis-intenso.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const realFetch = globalThis.fetch;
const redisStore = new Map();

globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);
  if (urlStr.includes('api.openai.com') || urlStr.includes('api.deepseek.com') || urlStr.includes('api.geoapify.com')) {
    return realFetch(url, options);
  }
  
  const pathname = new URL(urlStr).pathname;
  const command = pathname.split('/').filter(Boolean).pop();
  const args = JSON.parse(options.body || '[]');
  const execute = (entry) => {
    const [op, ...values] = entry;
    const opLow = String(op).toLowerCase();
    if (opLow === 'get') return redisStore.get(values[0]) ?? null;
    if (opLow === 'set') {
      const key = values[0];
      const val = values[1];
      redisStore.set(key, val);
      return 'OK';
    }
    if (opLow === 'del') { redisStore.delete(values[0]); return 1; }
    if (opLow === 'mget') return values.map(k => redisStore.get(k) ?? null);
    if (opLow === 'keys') {
      const pattern = values[0] || '*';
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Array.from(redisStore.keys()).filter(k => regex.test(k));
    }
    return null;
  };

  const result = command === 'pipeline' ? args.map(entry => ({ result: execute(entry) })) : { result: execute(args) };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { default: clientHandler } = await import('../api/clients.js');
const { default: reservationsHandler } = await import('../api/reservations.js');

console.log('=== PRUEBA DE RESERVA CON PREVIEW-TOKEN REAL EN CLIENTE EN TRIAL (active: false) ===\n');

const clientId = 'restaurante-e2e-intenso';
const clientPayload = {
  id: clientId,
  templateId: 'restaurant',
  templateVersion: '1.0',
  businessName: 'La Casona de Vitacura (Restaurante E2E Trial)',
  businessType: 'restaurant',
  address: 'Av. Vitacura 9900, Santiago',
  phoneCountry: 'CL',
  phoneCountryCode: '+56',
  phoneNumber: '988776655',
  ownerEmail: 'dueno.casona@example.com',
  timezone: 'America/Santiago',
  language: 'es',
  languages: ['es', 'en'],
  primaryLanguage: 'es',
  bookingEnabled: true,
  notificationEmails: ['dueno.casona@example.com'],
  businessHours: {
    monday:    { enabled: true, ranges: [{ start: '12:00', end: '23:00' }] },
    tuesday:   { enabled: true, ranges: [{ start: '12:00', end: '23:00' }] },
    wednesday: { enabled: true, ranges: [{ start: '12:00', end: '23:00' }] },
    thursday:  { enabled: true, ranges: [{ start: '12:00', end: '23:00' }] },
    friday:    { enabled: true, ranges: [{ start: '12:00', end: '23:00' }] },
    saturday:  { enabled: true, ranges: [{ start: '12:00', end: '23:00' }] },
    sunday:    { enabled: false, ranges: [] },
  },
  services: [
    { id: 'dish_1', nombre: 'Pastel de Choclo', precio: '15000' },
    { id: 'dish_2', nombre: 'Lomo al Trapo', precio: '22000' }
  ],
  capacityPerSlot: 20,
  reservationDuration: '90',
  plan: 'pro',
  active: false // CLIENTE EN TRIAL / INACTIVO
};

let createCode = 0;
await clientHandler({
  method: 'POST',
  query: {},
  headers: { 'x-admin-token': process.env.ADMIN_TOKEN },
  body: clientPayload
}, { setHeader() {}, status(c) { createCode = c; return this; }, json() { return this; } });

console.log(`1. Cliente creado con active: false (HTTP ${createCode}).`);

// 2. Generar un previewToken real vía POST /api/clients?action=preview-token
let previewBody = null;
let previewCode = 0;
await clientHandler({
  method: 'POST',
  query: { action: 'preview-token' },
  headers: { 'x-admin-token': process.env.ADMIN_TOKEN },
  body: { id: clientId }
}, { setHeader() {}, status(c) { previewCode = c; return this; }, json(b) { previewBody = b; return this; } });

const mintedToken = previewBody?.previewToken;
console.log(`2. Minted previewToken real: "${mintedToken}" (HTTP ${previewCode}).`);

// 3. Ejecutar POST /api/reservations enviando previewToken en body (SIN x-test-bypass header!)
let bookingCode = 0;
let bookingBody = null;
await reservationsHandler({
  method: 'POST',
  query: {},
  headers: { 'x-forwarded-for': '127.0.0.1' }, // SIN HEADER x-test-bypass!
  body: {
    clientId,
    previewToken: mintedToken, // PREVIEW TOKEN REAL
    nombre: 'Carlos Mendoza (Prueba Trial)',
    email: 'carlos.mendoza@example.com',
    telefono: '+56999887766',
    fecha: '2026-08-14',
    hora: '20:30',
    personas: 4,
    specialRequests: '2 Pastel de Choclo y 2 Lomo al Trapo'
  }
}, { setHeader() {}, status(c) { bookingCode = c; return this; }, json(b) { bookingBody = b; return this; } });

console.log(`\n3. Resultado de reserva pública con previewToken: HTTP ${bookingCode}`);
console.log('   Respuesta de la reserva:', JSON.stringify(bookingBody, null, 2));

// 4. Confirmar que aparece guardada en Redis (reservations:restaurante-e2e-intenso:<timestamp>)
const reservationId = bookingBody?.reservationId;
const savedReservation = reservationId ? redisStore.get(reservationId) : null;

console.log('\n4. Verificación en Panel del Dueño (Redis Key):');
if (savedReservation) {
  console.log('  ✅ RESERVA HALLADA EN PANEL DEL DUEÑO:', JSON.stringify(savedReservation, null, 2));
} else {
  console.error('  ❌ RESERVA NO ENCONTRADA EN PANEL DEL DUEÑO.');
}
