import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

assert.match(admin, />📅 Panel de reservas</, 'shows the reservation panel label');
assert.match(admin, /href="\/reservas\/\$\{encodeURIComponent\(c\.id\)\}"/, 'each assistant card links to its reservation panel');
assert.match(admin, /window\.location\.origin\}\/reservas\/\$\{encodeURIComponent\(manageClient\.id\)\}/,
  'management modal opens the current Preview or production deployment');

console.log('Admin reservation panel links verified');
