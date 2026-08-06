import assert from 'node:assert/strict';

process.env.ADMIN_TOKEN = 'detect-timezone-admin-token';
process.env.GEOAPIFY_API_KEY = 'geoapify-test-secret';

const { default: handler } = await import('../api/clients.js');

async function call({ headers = {}, body = {}, method = 'POST' } = {}) {
  let statusCode = 200;
  let responseBody = null;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(bodyValue) { responseBody = bodyValue; return this; },
    end() {},
  };
  await handler({ method, headers, body, query: { action: 'detect-timezone' } }, res);
  return { statusCode, responseBody };
}

console.log('Detección de zona horaria por dirección\n');

{
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not call Geoapify'); };
  const result = await call({ body: { address: 'Av. Apoquindo 3000', country: 'CL' } });
  assert.equal(result.statusCode, 401);
  assert.equal(called, false);
  console.log('✓ rechaza peticiones sin token administrativo');
}

{
  let requestedUrl = null;
  globalThis.fetch = async url => {
    requestedUrl = new URL(url);
    return new Response(JSON.stringify({ results: [{
      country_code: 'cl', formatted: 'Avenida Apoquindo 3000, Las Condes, Chile',
      timezone: { name: 'America/Santiago' }, rank: { confidence: 0.99 },
    }] }), { status: 200 });
  };
  const result = await call({
    headers: { 'x-admin-token': process.env.ADMIN_TOKEN },
    body: { address: 'Av. Apoquindo 3000', country: 'CL' },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.responseBody, {
    timezone: 'America/Santiago', address: 'Avenida Apoquindo 3000, Las Condes, Chile',
  });
  assert.equal(requestedUrl.hostname, 'api.geoapify.com');
  assert.equal(requestedUrl.searchParams.get('filter'), 'countrycode:cl');
  assert.equal(requestedUrl.searchParams.get('apiKey'), process.env.GEOAPIFY_API_KEY);
  assert.equal(JSON.stringify(result.responseBody).includes(process.env.GEOAPIFY_API_KEY), false);
  console.log('✓ devuelve una zona IANA confirmada sin exponer la key');
}

for (const [label, results] of [
  ['sin coincidencias', []],
  ['confianza baja', [{ country_code: 'cl', timezone: { name: 'America/Santiago' }, rank: { confidence: 0.89 } }]],
  ['país distinto', [{ country_code: 'ar', timezone: { name: 'America/Argentina/Buenos_Aires' }, rank: { confidence: 0.99 } }]],
  ['resultado ambiguo', [
    { country_code: 'us', timezone: { name: 'America/New_York' }, rank: { confidence: 0.99 } },
    { country_code: 'us', timezone: { name: 'America/Chicago' }, rank: { confidence: 0.98 } },
  ]],
]) {
  globalThis.fetch = async () => new Response(JSON.stringify({ results }), { status: 200 });
  const result = await call({
    headers: { 'x-admin-token': process.env.ADMIN_TOKEN },
    body: { address: 'Dirección de prueba', country: label === 'resultado ambiguo' ? 'US' : 'CL' },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.responseBody, { timezone: null, address: null });
  console.log(`✓ ${label}: no adivina una zona horaria`);
}

{
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  const result = await call({
    headers: { 'x-admin-token': process.env.ADMIN_TOKEN },
    body: { address: 'Dirección de prueba', country: 'CL' },
  });
  assert.equal(result.statusCode, 502);
  assert.deepEqual(result.responseBody, { error: 'Timezone lookup failed' });
  console.log('✓ un error de Geoapify no devuelve sugerencias inventadas');
}

console.log('\nTodas las pruebas del endpoint de timezone pasan');
