const { test, expect } = require('@playwright/test');

const BASE = process.env.PROD_URL || 'https://jbstudio.app';
const CLIENT_ID = process.env.PROD_CLIENT_ID || 'spa';

test('production V2 booking entry exposes guided controls without confirming', async ({ page }) => {
  await page.goto(`${BASE}/asistente.html?id=${CLIENT_ID}`);
  await page.locator('#a-inp').fill('Quiero reservar una cita');
  await page.locator('#a-inp').press('Enter');
  await expect(page.locator('#a-msgs')).toContainText(/servicio|cita|reserv/i, { timeout: 45_000 });
  await expect(page.locator('button')).not.toContainText(/confirmar cita|confirm it/i);
});
