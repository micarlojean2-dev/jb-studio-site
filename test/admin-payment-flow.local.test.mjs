// Browser regression for the payment-link UI. The admin APIs and checkout are
// local mocks: this test must never contact Stripe or create a real charge.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let checkoutCalls = 0;
let checkoutFails = false;
const client = {
  id: 'qa-payment-ui', businessName: 'QA Payment UI', plan: 'basic', active: false,
  paymentStatus: 'pending', menu: [], services: [], features: {},
};

const server = createServer(async (request, response) => {
  if (request.url.startsWith('/api/clients')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify([client]));
  }
  if (request.url.startsWith('/api/create-checkout')) {
    checkoutCalls++;
    response.writeHead(checkoutFails ? 500 : 200, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify(checkoutFails
      ? { error: 'Checkout mock failure' }
      : { url: 'https://checkout.stripe.test/c/pay_qa_mock', sessionId: 'cs_test_qa_mock' }));
  }
  const path = request.url === '/admin.html' ? 'admin.html' : request.url.slice(1);
  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : 'text/html' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/admin.html`);
  await page.locator('#token-input').fill('mock-admin-token');
  await page.locator('#login-btn').click();
  await page.getByRole('button', { name: /pagos/i }).click();
  await page.locator('.ct-pago-manage').first().click();

  const paymentButton = page.locator('.ct-pay-action').first();
  await paymentButton.dblclick();
  await page.locator('.pay-link-inline').waitFor();
  assert.equal(checkoutCalls, 1, 'un doble clic solo genera un checkout');
  await assert.doesNotReject(page.getByText('checkout.stripe.test/c/pay_qa_mock').waitFor());

  await paymentButton.click(); // Hide the generated link before exercising the failure path.
  checkoutFails = true;
  const dialog = page.waitForEvent('dialog');
  await paymentButton.click();
  const alert = await dialog;
  assert.match(alert.message(), /Checkout mock failure/);
  await alert.accept();
  assert.equal(checkoutCalls, 2, 'el error se muestra sin generar un enlace');
  assert.equal(await page.locator('.pay-link-inline').count(), 0, 'un checkout fallido no deja enlace visible');
  console.log('Payment link browser flow passed with checkout mocks only');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
