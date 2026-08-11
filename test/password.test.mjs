import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../lib/password.js';

console.log('Testing lib/password.js...');

// 1. Correct password matches
const pass = 'MiPasswordSuperSeguro123';
const hash = hashPassword(pass);
assert.ok(hash.includes(':'), 'el hash contiene salt:derived');
assert.ok(verifyPassword(pass, hash), 'la contraseña correcta valida true');

// 2. Incorrect password fails
assert.equal(verifyPassword('PasswordIncorrecto', hash), false, 'contraseña incorrecta devuelve false');

// 3. Edge cases
assert.equal(verifyPassword('', hash), false, 'contraseña vacía devuelve false');
assert.equal(verifyPassword(pass, ''), false, 'hash vacío devuelve false');
assert.equal(verifyPassword(pass, 'malformado'), false, 'hash malformado devuelve false');

console.log('✅ All password unit tests passed successfully!');
