// Browser regression using a static local server, mocked admin APIs, and the deployed CSP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' https://connect.facebook.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; frame-src 'self' https://*.framer.website; connect-src 'self' https://www.facebook.com https://connect.facebook.net; form-action 'self' https://wa.me; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; upgrade-insecure-requests;";
const client = { id: 'demo-client', businessName: 'Demo Studio', plan: 'pro', active: true, menu: [] };

const server = createServer(async (request, response) => {
  if (request.url.startsWith('/api/clients')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify([client]));
  }
  if (request.url.startsWith('/api/client-images')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    return response.end('[]');
  }
  const path = request.url === '/admin.html' ? 'admin.html' : request.url.slice(1);
  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, {
      'Content-Security-Policy': csp,
      'Content-Type': path.endsWith('.js') ? 'text/javascript' : 'text/html',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__printInvoked = false;
    window.open = () => ({
      document: { write() {}, close() {} }, focus() {}, print() { window.__printInvoked = true; },
    });
  });
  await page.goto(`http://127.0.0.1:${port}/admin.html`);
  await page.locator('#token-input').fill('local-test-token');
  await page.locator('#login-btn').click();
  await page.locator('.ct-manage').first().click();
  await page.locator('#mg-media').click();

  const assistantUrl = `http://127.0.0.1:${port}/asistente/demo-client`;
  await assert.doesNotReject(page.locator('#client-qr canvas').waitFor());
  assert.equal(await page.locator('#client-qr').getAttribute('title'), assistantUrl, 'QR payload is the assistant URL');

  await page.locator('#copy-qr-url-btn').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), assistantUrl, 'copy action uses the assistant URL');

  const download = page.waitForEvent('download');
  await page.locator('#download-qr-btn').click();
  assert.equal((await download).suggestedFilename(), 'demo-client-assistant-qr.png', 'PNG download name');
  await page.locator('#print-qr-btn').click();
  assert.equal(await page.evaluate(() => window.__printInvoked), true, 'print is invoked');
  assert.equal(await page.evaluate(() => Boolean(window.QRCode)), true, 'local QR library loads under CSP');
  console.log('QR local browser flow passed under production CSP');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
