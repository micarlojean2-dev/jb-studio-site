import assert from 'node:assert/strict';
import { createClientConfigHandler } from '../api/client-config.js';

const records = new Map([
  ['client:alpha', { businessName: 'Alpha', menu: [{ id: 'cut-1', nombre: 'Corte' }] }],
  ['client-images:alpha:clients/alpha/gallery-ok', {
    publicId: 'clients/alpha/gallery-ok', confirmed: true, linkedType: 'gallery', linkedItemId: null,
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/gallery-ok.jpg', thumbnailUrl: 'https://res.cloudinary.com/demo/image/upload/thumb.jpg',
  }],
  ['client-images:alpha:clients/alpha/menu-ok', {
    publicId: 'clients/alpha/menu-ok', confirmed: true, linkedType: 'menu', linkedItemId: 'cut-1',
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/menu-ok.jpg',
  }],
  ['client-images:alpha:clients/beta/foreign', {
    publicId: 'clients/beta/foreign', confirmed: true, linkedType: 'gallery', imageUrl: 'https://res.cloudinary.com/demo/image/upload/foreign.jpg',
  }],
  ['client-images:alpha:clients/alpha/unconfirmed', {
    publicId: 'clients/alpha/unconfirmed', confirmed: false, linkedType: 'gallery', imageUrl: 'https://res.cloudinary.com/demo/image/upload/unconfirmed.jpg',
  }],
  ['client-images:alpha:clients/alpha/http', {
    publicId: 'clients/alpha/http', confirmed: true, linkedType: 'gallery', imageUrl: 'http://example.test/not-safe.jpg',
  }],
]);
const redis = {
  async get(key) { return records.get(key) || null; },
  async keys(pattern) { const prefix = pattern.slice(0, -1); return [...records.keys()].filter(key => key.startsWith(prefix)); },
  async mget(...keys) { return keys.map(key => records.get(key) || null); },
};
const handler = createClientConfigHandler({ redis });
let statusCode; let response;
await handler({ method: 'GET', query: { id: 'alpha' } }, {
  setHeader() {}, status(code) { statusCode = code; return this; }, json(value) { response = value; return this; }, end() {},
});

assert.equal(statusCode, 200);
assert.deepEqual(response.media, {
  gallery: ['https://res.cloudinary.com/demo/image/upload/gallery-ok.jpg'],
  menu: [{ itemId: 'cut-1', imageUrl: 'https://res.cloudinary.com/demo/image/upload/menu-ok.jpg' }],
});
assert.equal(response.menu[0].imagen, 'https://res.cloudinary.com/demo/image/upload/menu-ok.jpg');
assert.ok(!JSON.stringify(response).includes('publicId'));
assert.ok(!JSON.stringify(response).includes('thumbnailUrl'));
assert.ok(!JSON.stringify(response).includes('foreign'));
assert.ok(!JSON.stringify(response).includes('unconfirmed'));
console.log('Client config exposes only confirmed, client-owned public media');
