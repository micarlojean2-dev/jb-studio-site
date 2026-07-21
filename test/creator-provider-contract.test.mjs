import assert from 'node:assert/strict';

process.env.ADMIN_TOKEN = 'creator-contract-token';

const draft = {
  business: {
    businessName: 'Casa Prueba', businessType: 'restaurante', ownerName: 'Ana', ownerEmail: 'ana@example.com',
    address: 'Calle 1', phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber: '912345678',
    languages: ['es'], primaryLanguage: 'es',
  },
  design: { primaryColor: '#123456', secondaryColor: '#abcdef', style: 'Moderno' },
  businessHours: {
    monday: { enabled: true, unknown: false, ranges: [{ start: '09:00', end: '18:00' }] },
    tuesday: { enabled: false, unknown: true, ranges: [] },
    wednesday: { enabled: false, unknown: true, ranges: [] },
    thursday: { enabled: false, unknown: true, ranges: [] },
    friday: { enabled: false, unknown: true, ranges: [] },
    saturday: { enabled: false, unknown: true, ranges: [] },
    sunday: { enabled: false, unknown: true, ranges: [] },
  },
  services: [{ name: 'Servicio', price: '$20', duration: '45 min', description: '', category: '' }],
  templateData: {
    menuMetadata: [{ itemName: 'Sopa', category: 'Entradas', dietaryTags: ['vegana'], allergens: [] }],
    barberStaff: [{ name: 'Luis', specialties: ['Fade'] }],
    barberPolicies: ['Llegar puntual'],
  },
  bookingRequested: false,
  missingFields: ['ownerEmail'],
};

let requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) });
  if (url.includes('api.openai.com')) return { ok: true, json: async () => ({ output_text: JSON.stringify(draft) }) };
  if (url.includes('api.anthropic.com')) return { ok: true, json: async () => ({ content: [{ text: JSON.stringify(draft) }] }) };
  throw new Error(`Unexpected provider URL: ${url}`);
};

const { default: handler } = await import('../api/generate-client-config.js');

async function create(provider, templateId) {
  process.env.CREATOR_PROVIDER = provider;
  process.env.OPENAI_API_KEY = 'mock-openai-key';
  process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
  let statusCode;
  let responseBody;
  await handler({
    method: 'POST',
    headers: { 'x-admin-token': process.env.ADMIN_TOKEN, 'x-forwarded-for': `${provider}-${templateId}` },
    body: { businessInfo: 'Casa Prueba, Calle 1', templateId },
  }, {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
  });
  assert.equal(statusCode, 200);
  return responseBody;
}

for (const templateId of ['restaurant', 'barber', 'spa']) {
  const openai = await create('openai', templateId);
  const anthropic = await create('anthropic', templateId);
  assert.deepEqual(anthropic, openai, `Anthropic ${templateId} draft normalizes like OpenAI`);
  assert.equal(anthropic.template.id, templateId);
  assert.equal(anthropic.features.reservations, true, 'template capabilities remain server-owned');
  assert.equal(anthropic.planRecommendation.plan, 'pro', 'template plan remains server-owned');
  if (templateId === 'restaurant') {
    assert.deepEqual(anthropic.templateData, { menuMetadata: draft.templateData.menuMetadata });
  } else if (templateId === 'barber') {
    assert.deepEqual(anthropic.templateData, {
      barberStaff: draft.templateData.barberStaff,
      barberPolicies: draft.templateData.barberPolicies,
    });
  } else {
    assert.deepEqual(anthropic.templateData, {});
  }
}

assert.equal(requests.filter(request => request.url.includes('api.openai.com')).length, 3);
assert.equal(requests.filter(request => request.url.includes('api.anthropic.com')).length, 3);
const anthropicRequest = requests.find(request => request.url.includes('api.anthropic.com'));
assert.match(anthropicRequest.body.system, /"templateData"/);
assert.match(anthropicRequest.body.system, /"bookingRequested"/);
assert.match(anthropicRequest.body.system, /No decidas planes, features, permisos, acciones ni escribas un system prompt/);
console.log('Provider factual draft contracts verified with mocked OpenAI and Anthropic calls');
