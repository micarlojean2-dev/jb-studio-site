const { test, expect } = require('@playwright/test');

const BASE = process.env.LOCAL_AUDIT_URL || 'http://localhost:4173';
const client = {
  id: 'v2-qa', businessName: 'Spa QA V2', templateId: 'spa', language: 'es', languages: ['es'], active: true,
  menu: [{ nombre: 'Masaje relajante', precio: '700', duracion: '60' }],
  features: { reservations: true, cancellation: true },
};

test('V2 booking starts from structured intent and uses isolated persistence', async ({ page }) => {
  await page.route('**/api/client-config**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(client) }));
  await page.route('**/api/client-chat', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: 'Elige un servicio.', interpretation: { intent: 'booking', entities: { service: null, date: null, time: null, name: null, email: null, phone: null, people: null, notes: null } } }) }));
  await page.goto(`${BASE}/asistente.html?id=v2-qa`);
  await page.locator('#a-inp').fill('Quiero reservar');
  await page.locator('#a-inp').press('Enter');
  await expect(page.locator('#a-msgs')).toContainText(/Masaje relajante|Elige un servicio/);
  const keys = await page.evaluate(() => Object.keys(sessionStorage));
  expect(keys.some(key => key === 'jba_v2-qa_booking_v2')).toBeTruthy();
  expect(keys.some(key => key.endsWith('_booking'))).toBeFalsy();
});
