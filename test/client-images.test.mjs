import assert from 'node:assert/strict';
import { createClientImagesHandler } from '../api/client-config.js';

const data = new Map([['client:alpha', { id: 'alpha' }], ['client:beta', { id: 'beta' }]]);
const redis = {
  async get(key) { return data.get(key) || null; },
  async set(key, value) { data.set(key, structuredClone(value)); },
  async del(key) { data.delete(key); },
  async keys(pattern) { const prefix = pattern.slice(0, -1); return [...data.keys()].filter(key => key.startsWith(prefix)); },
  async mget(...keys) { return keys.map(key => data.get(key) || null); },
};
const cloudResources = new Map();
let destroyCalls = [];
const fetchImpl = async (url, options = {}) => {
  if (url.includes('/resources/image/upload/')) {
    const publicId = decodeURIComponent(url.split('/resources/image/upload/')[1]);
    const resource = cloudResources.get(publicId);
    return { ok: Boolean(resource), json: async () => resource };
  }
  if (url.includes('/image/destroy')) {
    destroyCalls.push(String(options.body));
    return { ok: true, json: async () => ({ result: 'ok' }) };
  }
  throw new Error(`Unexpected URL: ${url}`);
};
const env = { ADMIN_TOKEN: 'admin', CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'secret' };
const handler = createClientImagesHandler({ redis, fetchImpl, env });

async function request({ method, action, clientId = 'alpha', body = {}, token = 'admin', query = {} }) {
  let statusCode; let response;
  await handler({ method, query: { clientId, ...(action ? { action } : {}), ...query }, body: { clientId, ...body }, headers: { 'x-admin-token': token } }, {
    setHeader() {}, status(code) { statusCode = code; return this; }, json(value) { response = value; return this; }, end() {},
  });
  return { statusCode, response };
}

const files = [{ type: 'image/jpeg', size: 100, data: 'data:image/jpeg;base64,not-persisted' }, { type: 'image/webp', size: 200 }];
const signed = await request({ method: 'POST', action: 'upload', body: { files } });
assert.equal(signed.statusCode, 200);
assert.equal(signed.response.uploads.length, 2, 'multi-upload returns one signed instruction per file');
assert.ok(signed.response.uploads.every(item => item.publicId.startsWith('clients/alpha/')));
assert.ok(signed.response.uploads.every(item => !JSON.stringify(item).includes('secret')));
assert.equal(await redis.get(`client-images:alpha:${signed.response.uploads[0].publicId}`), null, 'signing does not persist files or placeholders');

for (const [index, upload] of signed.response.uploads.entries()) cloudResources.set(upload.publicId, { public_id: upload.publicId, format: index ? 'webp' : 'jpg', bytes: files[index].size });
const confirmed = await request({ method: 'POST', action: 'confirm', body: { publicIds: signed.response.uploads.map(item => item.publicId) } });
assert.equal(confirmed.statusCode, 201);
assert.ok(confirmed.response.every(item => item.confirmed && !JSON.stringify(item).includes('data:')), 'confirmation stores references only');
assert.ok(!JSON.stringify([...data.values()]).includes('base64,'), 'Redis never stores supplied base64 content');

const association = await request({ method: 'PUT', body: { images: [{ publicId: confirmed.response[0].publicId, linkedType: 'service', linkedItemId: 'cut-1' }] } });
assert.equal(association.statusCode, 200);
assert.equal(association.response[0].linkedItemId, 'cut-1');

const isolated = await request({ method: 'GET', clientId: 'beta' });
assert.deepEqual(isolated.response, [], 'client image records are isolated');
const crossClient = await request({ method: 'POST', action: 'confirm', clientId: 'beta', body: { publicIds: [confirmed.response[0].publicId] } });
assert.equal(crossClient.statusCode, 400, 'another client cannot confirm a foreign publicId');

const deleted = await request({ method: 'DELETE', body: { publicId: confirmed.response[0].publicId } });
assert.equal(deleted.statusCode, 200);
assert.equal(await redis.get(`client-images:alpha:${confirmed.response[0].publicId}`), null);
assert.equal(destroyCalls.length, 1, 'deletion is sent to Cloudinary before removing the reference');
assert.equal((await request({ method: 'POST', action: 'upload', body: { files: [{ type: 'image/gif', size: 1 }] } })).statusCode, 400, 'unsupported formats are rejected');
assert.equal((await request({ method: 'POST', action: 'upload', body: { files: [{ type: 'image/png', size: 10 * 1024 * 1024 + 1 }] } })).statusCode, 400, 'oversized files are rejected');
assert.equal((await request({ method: 'POST', action: 'upload', body: { files: Array.from({ length: 9 }, () => ({ type: 'image/png', size: 1 })) } })).statusCode, 400, 'too many files are rejected');
assert.equal((await request({ method: 'GET', token: 'wrong' })).statusCode, 401, 'admin authentication is required');
console.log('Client image API verified with mocked Redis and Cloudinary');
