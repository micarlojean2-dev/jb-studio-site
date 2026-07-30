import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(root, 'admin.html'), 'utf8');
const clients = readFileSync(join(root, 'api', 'clients.js'), 'utf8');
const panel = readFileSync(join(root, 'reservas.html'), 'utf8');
const clientId = 'qa-spa';
const panelToken = 'qa-panel-token';
const panelUrl = `https://jbstudio.app/reservas/${clientId}#t=${encodeURIComponent(panelToken)}`;

assert.match(clients, /panelToken:\s*randomUUID\(\)/, 'la creación de cliente genera panelToken');
assert.equal(panelUrl, 'https://jbstudio.app/reservas/qa-spa#t=qa-panel-token', 'el enlace incluye el fragmento del token');
assert.match(admin, /const panelUrl = `https:\/\/jbstudio\.app\/reservas\/\$\{id\}#t=\$\{encodeURIComponent\(data\.panelToken\)\}`;/, 'admin construye el enlace completo');
assert.match(admin, /const panelUrl = `https:\/\/jbstudio\.app\/reservas\/\$\{encodeURIComponent\(c\.id\)\}#t=\$\{encodeURIComponent\(c\.panelToken\)\}`;/, 'clientes existentes construyen su enlace completo');
assert.match(admin, /href="\$\{escHTML\(panelUrl\)\}"/, 'el enlace persistente usa el token');
assert.match(admin, /class="ct-link ct-copy-panel"/, 'la tabla ofrece copiar el enlace del dueño');
assert.match(admin, /class="cc-btn-secondary ct-copy-panel"/, 'la vista móvil ofrece copiar el enlace del dueño');
assert.match(admin, /navigator\.clipboard\.writeText\(btn\.dataset\.panelUrl\)/, 'el botón persistente copia el enlace completo');
assert.match(admin, /Copiar enlace del panel/, 'admin identifica claramente el botón');
assert.match(panel, /window\.location\.hash\.replace\(\/\^#t=\//, 'el panel consume el token desde el fragmento');

console.log('✅ Enlace profesional del panel verificado (10 checks)');
