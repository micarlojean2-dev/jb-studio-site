import assert from 'node:assert/strict';
import { createReservationsListApiHandler } from '../api/client-config.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

console.log('Testing Owner Password Flow (createReservationsListHandler)...');

// Mock dataStore
const mockStore = {
  data: {
    'client:qa-password-test': {
      id: 'qa-password-test',
      panelToken: 'qa-token-12345',
      active: true,
      plan: 'pro'
    }
  },
  async get(key) { return this.data[key] || null; },
  async set(key, val) { this.data[key] = val; return 'OK'; },
  async keys(pattern) { return []; },
  async lrange(key, start, end) { return []; }
};

const handler = createReservationsListApiHandler({ redis: mockStore });

async function runTests() {
  // 1. Initial GET with panelToken: should return hasPassword === false
  let req = { method: 'GET', query: { clientId: 'qa-password-test', token: 'qa-token-12345' } };
  let res = {
    _status: 200,
    _data: null,
    setHeader() {},
    status(s) { this._status = s; return this; },
    json(d) { this._data = d; return this; }
  };

  await handler(req, res);
  assert.equal(res._status, 200, 'GET con panelToken devuelve 200');
  assert.equal(res._data.hasPassword, false, 'hasPassword es false inicialmente');

  // 2. Unauthorized access with wrong password
  req = { method: 'GET', query: { clientId: 'qa-password-test', token: 'WrongPassword' } };
  res = { _status: 200, _data: null, setHeader() {}, status(s) { this._status = s; return this; }, json(d) { this._data = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 401, 'contraseña incorrecta da 401');

  // 3. Admin token access works
  process.env.ADMIN_TOKEN = 'admin-secret-999';
  req = { method: 'GET', query: { clientId: 'qa-password-test', token: 'admin-secret-999' } };
  res = { _status: 200, _data: null, setHeader() {}, status(s) { this._status = s; return this; }, json(d) { this._data = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 200, 'ADMIN_TOKEN otorga acceso');

  // 4. Set password using panelToken
  req = {
    method: 'POST',
    query: { clientId: 'qa-password-test', token: 'qa-token-12345', scope: 'set_password' },
    body: { action: 'set_password', newPassword: 'OwnerPassword2026!' }
  };
  res = { _status: 200, _data: null, setHeader() {}, status(s) { this._status = s; return this; }, json(d) { this._data = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 200, 'set_password con panelToken devuelve 200');
  assert.equal(res._data.ok, true);
  assert.equal(res._data.hasPassword, true);

  // Verify stored in mockStore
  const clientData = mockStore.data['client:qa-password-test'];
  assert.ok(clientData.passwordHash, 'client tiene passwordHash guardado');
  assert.notEqual(clientData.passwordHash, 'OwnerPassword2026!', 'NUNCA se guarda en texto plano');
  assert.ok(verifyPassword('OwnerPassword2026!', clientData.passwordHash), 'verifyPassword valida la contraseña elegida');

  // 5. Login with new custom password
  req = { method: 'GET', query: { clientId: 'qa-password-test', token: 'OwnerPassword2026!' } };
  res = { _status: 200, _data: null, setHeader() {}, status(s) { this._status = s; return this; }, json(d) { this._data = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 200, 'login con la nueva contraseña devuelve 200');
  assert.equal(res._data.hasPassword, true, 'hasPassword es true tras configurar la contraseña');

  // 6. Backup fallback: panelToken still works even after password is set
  req = { method: 'GET', query: { clientId: 'qa-password-test', token: 'qa-token-12345' } };
  res = { _status: 200, _data: null, setHeader() {}, status(s) { this._status = s; return this; }, json(d) { this._data = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 200, 'panelToken sigue funcionando como respaldo');

  // 7. Backup fallback: ADMIN_TOKEN still works
  req = { method: 'GET', query: { clientId: 'qa-password-test', token: 'admin-secret-999' } };
  res = { _status: 200, _data: null, setHeader() {}, status(s) { this._status = s; return this; }, json(d) { this._data = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 200, 'ADMIN_TOKEN sigue funcionando');

  console.log('✅ All owner password integration tests passed!');
}

runTests();
