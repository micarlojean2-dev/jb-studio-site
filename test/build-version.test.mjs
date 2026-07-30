import assert from 'node:assert/strict';
import { createBuildHandler } from '../api/client-config.js';

function response() {
  return {
    headers: {}, statusCode: 0, body: undefined,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

{
  const res = response();
  createBuildHandler({ VERCEL_DEPLOYMENT_ID: 'dpl_5916vUzUhMQR' })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { version: 'dpl_5916vUzUhMQR' });
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
}

{
  const res = response();
  createBuildHandler({})({ method: 'GET' }, res);
  assert.deepEqual(res.body, { version: 'local' });
}

console.log('Build version endpoint reports the deployment SHA without caching');
