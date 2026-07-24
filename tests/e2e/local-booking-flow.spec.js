const { test, expect } = require('@playwright/test');

const BASE = process.env.LOCAL_AUDIT_URL || 'http://localhost:4173';

async function mockApi(page, language) {
  let reservationPayload = null;
  await page.route('**/api/client-config**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      businessName: language === 'en' ? 'QA English' : 'QA Español', templateId: 'restaurant',
      color: '#1a4a2e', language, active: true,
      menu: language === 'en' ? [{ nombre: 'Classic Burger' }, { nombre: 'Pizza' }] : [{ nombre: 'Hamburguesa Clásica' }, { nombre: 'Pizza' }],
      businessHours: { wednesday: { enabled: true, unknown: false, ranges: [{ start: '10:00', end: '22:00' }] } },
      features: { reservations: true, cancellation: true },
    }),
  }));
  await page.route('**/api/client-chat', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: language === 'en' ? 'Please share the next detail.' : '¿Me compartes el siguiente dato?' }) }));
  await page.route('**/api/reservations', async route => {
    expect(route.request().method()).toBe('POST');
    reservationPayload = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, reservationCreated: true, status: 'confirmada' }) });
  });
  return () => reservationPayload;
}

async function send(page, text) {
  const input = page.getByRole('textbox');
  await input.fill(text);
  await input.press('Enter');
}

test('English booking confirms with normalized preference payload', async ({ page }) => {
  const payload = await mockApi(page, 'en');
  await page.goto(`${BASE}/asistente.html?id=local-en`);
  await send(page, 'I want to reserve a Classic Burger without cheese and sauce on the side for 2 people on August 5 2026 at 1 PM. My name is QA English, my phone is 5551234567 and my email is qa@example.com.');
  await expect(page.getByText('Special requests: No cheese · Sauce on the side')).toBeVisible();
  await page.getByRole('button', { name: /change something/i }).click();
  await send(page, 'change time to 2 PM');
  await expect(page.getByText('Time: 2:00 PM')).toBeVisible();
  await page.getByRole('button', { name: /yes, confirm/i }).click();
  await expect(page.getByText('Your request has been registered successfully.')).toBeVisible();
  expect(payload()).toMatchObject({ clientId: 'local-en', nombre: 'QA English', telefono: '5551234567', email: 'qa@example.com', servicio: 'Classic Burger', personas: '2', hora: '2:00 PM', specialRequests: 'No cheese · Sauce on the side' });
  expect(payload().foodPreferences).toMatchObject({ remove: ['cheese'], notes: ['sauce_on_side'] });
});

test('Spanish booking confirms with normalized preference payload', async ({ page }) => {
  const payload = await mockApi(page, 'es');
  await page.goto(`${BASE}/asistente.html?id=local-es`);
  await send(page, 'Quiero reservar una Hamburguesa Clásica sin queso y salsa aparte para 2 personas el 5 de agosto de 2026 a las 1 PM. Me llamo QA Español, mi teléfono es 5551234567 y mi correo qa@example.com.');
  await expect(page.getByText('Peticiones especiales: Sin queso · Salsa aparte')).toBeVisible();
  await page.getByRole('button', { name: /confirmar cita/i }).click();
  await expect(page.getByText('Tu solicitud quedó registrada correctamente.')).toBeVisible();
  expect(payload()).toMatchObject({ clientId: 'local-es', nombre: 'QA Español', servicio: 'Hamburguesa Clásica', personas: '2', specialRequests: 'Sin queso · Salsa aparte' });
});
