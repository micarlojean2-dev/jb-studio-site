const { test, expect } = require('@playwright/test');

const BASE = process.env.LOCAL_AUDIT_URL || 'http://localhost:4173';

test('restaurant V2 state persists preferences under the v2 namespace', async ({ page }) => {
  await page.goto(`${BASE}/asistente.html?id=restaurant-v2-audit`);
  const state = await page.evaluate(() => ({
    version: 2, step: 'CUSTOMER_DATA', service: 'Hamburguesa Clásica', date: '2026-08-05', time: '13:00', people: 2,
    customer: { name: null, phone: null, email: null }, specialRequests: null,
    foodPreferences: { remove: ['cheese'] }, tablePreference: 'Ventana', barberPreference: null,
  }));
  await page.evaluate((saved) => sessionStorage.setItem('jba_restaurant-v2-audit_booking_v2', JSON.stringify(saved)), state);
  await page.reload();
  const restored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jba_restaurant-v2-audit_booking_v2')));
  expect(restored).toMatchObject({ version: 2, people: 2, foodPreferences: { remove: ['cheese'] }, tablePreference: 'Ventana' });
});
