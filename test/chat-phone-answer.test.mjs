// Test obligatorio (auditoría "creador multi plantilla", Requisito 6): crea
// un cliente real vía POST /api/clients (handler real, Redis mockeado) para
// Spa, Restaurante y Barbería, y confirma que el teléfono configurado llega
// intacto y sin ambigüedad al system prompt que arma api/client-chat.js —
// es decir, que el chatbot SÍ puede responder "¿cuál es el teléfono?" con el
// número real, para cualquier plantilla, sin exponer datos privados.
import assert from 'node:assert/strict';

process.env.ADMIN_TOKEN = 'phone-answer-test-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://phone-answer-test.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'phone-answer-test-token';
const redisStore = new Map();
globalThis.fetch = async (url, options = {}) => {
  const command = new URL(url).pathname.split('/').filter(Boolean).pop();
  const args = JSON.parse(options.body || '[]');
  const execute = (entry) => {
    const [op, ...values] = entry;
    if (String(op).toLowerCase() === 'get') return redisStore.get(values[0]) ?? null;
    if (String(op).toLowerCase() === 'set') { redisStore.set(values[0], values[1]); return 'OK'; }
    throw new Error(`Unsupported Redis command: ${op}`);
  };
  const result = command === 'pipeline' ? args.map(entry => ({ result: execute(entry) })) : { result: execute(args) };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { default: clientHandler, __test: clientTest } = await import('../api/clients.js');
const { useClientStripeDouble } = await import('./client-stripe-double.mjs');
useClientStripeDouble(clientTest);
const { __test: chatTest } = await import('../api/client-chat.js');
const { businessInfoBlock, buildSystemPrompt } = chatTest;

async function postClient(body) {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(code) { statusCode = code; return this; }, json(b) { responseBody = b; return this; } };
  await clientHandler({ method: 'POST', query: {}, headers: { 'x-admin-token': process.env.ADMIN_TOKEN }, body }, res);
  return { statusCode, responseBody };
}

const HOURS = { monday: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] } };

console.log('Chat responde el teléfono real para cada plantilla (creación real -> Redis -> prompt)');
for (const [templateId, phoneNumber] of [['spa', '912345001'], ['restaurant', '912345002'], ['barber', '912345003']]) {
  const created = await postClient({
    id: `phone-${templateId}`, businessName: `Negocio ${templateId}`,
    templateId, templateVersion: '1.0',
    address: 'Calle Real 1', ownerEmail: 'owner-secreto@example.com', timezone: 'America/Santiago',
    notificationEmails: ['owner-secreto@example.com'],
    phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber,
    businessHours: HOURS,
    services: [{ nombre: 'Servicio', precio: '100', duracion: templateId === 'restaurant' ? '' : '30' }],
    ...(templateId === 'restaurant' ? { reservationDuration: '60' } : {}),
    capacityPerSlot: 2, bufferMinutes: 10,
  });
  assert.equal(created.statusCode, 201, `${templateId}: se crea correctamente (fue ${created.statusCode}: ${JSON.stringify(created.responseBody)})`);
  const client = created.responseBody;
  assert.equal(client.whatsapp, `+56${phoneNumber}`, `${templateId}: whatsapp queda compuesto correctamente en Redis`);

  for (const lang of ['es', 'en']) {
    const block = businessInfoBlock(client, lang);
    assert.ok(block.includes(`+56${phoneNumber}`), `${templateId} (${lang}): el bloque de datos reales incluye el teléfono exacto configurado`);
    const prompt = await buildSystemPrompt(client.prompt, client, { gallery: 0, menuItems: [] }, lang);
    assert.ok(prompt.includes(`+56${phoneNumber}`), `${templateId} (${lang}): el system prompt final incluye el teléfono real`);
    assert.ok(!prompt.includes('owner-secreto@example.com'), `${templateId} (${lang}): el prompt nunca expone el correo privado del dueño`);
    // El bloque presenta el teléfono como dato operativo del negocio, sin
    // ninguna instrucción para ocultarlo -- el modelo puede compartirlo tal
    // cual si le preguntan "¿puedo llamar al negocio?".
    assert.doesNotMatch(prompt, /no (compartas|reveles|des) (el )?tel[eé]fono/i,
      `${templateId} (${lang}): no existe ninguna instrucción que le impida al modelo compartir el teléfono`);
  }
  console.log(`  ✓ ${templateId}: el teléfono configurado (+56${phoneNumber}) llega intacto y compartible al chatbot, en ambos idiomas`);
}

console.log('Todas las pruebas de teléfono en chat pasan');
