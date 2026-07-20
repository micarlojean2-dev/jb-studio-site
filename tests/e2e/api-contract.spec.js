// QA — Categorías J (errores técnicos) + N (panel protegido) + K (seguridad):
// contrato de las APIs con entradas inválidas/no autorizadas. SEGURO: no crea
// reservas ni datos; solo comprueba códigos de estado y que no se filtren datos.
const { test, expect, request } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'https://jbstudio.app';

test.describe('Contrato de API @critical', () => {
  test('POST /api/reservations sin campos obligatorios → 400', async ({ request }) => {
    const r = await request.post(`${BASE}/api/reservations`, { data: { clientId: 'bella-luna-spa' } });
    expect(r.status()).toBe(400);
  });

  test('POST /api/reservations con clientId inválido → 400', async ({ request }) => {
    const r = await request.post(`${BASE}/api/reservations`, {
      data: { clientId: 'MAYUS Inválido!', nombre: 'x', telefono: '123', fecha: 'hoy', hora: '10:00' },
    });
    expect(r.status()).toBe(400);
  });

  test('GET /api/reservations (método no permitido para alta) → 405', async ({ request }) => {
    const r = await request.get(`${BASE}/api/reservations`);
    expect(r.status()).toBe(405);
  });

  test('panel: GET /api/reservations-list SIN token → 401', async ({ request }) => {
    const r = await request.get(`${BASE}/api/reservations-list?clientId=bella-luna-spa`);
    expect(r.status()).toBe(401);
  });

  test('panel: GET /api/reservations-list con token inválido → 401 y sin datos', async ({ request }) => {
    const r = await request.get(`${BASE}/api/reservations-list?clientId=bella-luna-spa&token=token-falso-123`);
    expect(r.status()).toBe(401);
    const body = await r.text();
    // No debe filtrar reservas ni correos con un token incorrecto.
    expect(body).not.toMatch(/@/);
    expect(body).not.toMatch(/reservations:bella-luna/);
  });

  test('cron protegido: /api/reservations?cron=digest sin auth → 401', async ({ request }) => {
    const r = await request.get(`${BASE}/api/reservations?cron=digest`);
    expect(r.status()).toBe(401);
  });

  test('endpoints temporales de limpieza NO existen en producción → 405', async ({ request }) => {
    for (const action of ['cleanup-playwright-tests', 'cleanup-playwright-rejected', 'cleanup-notatest']) {
      const r = await request.get(`${BASE}/api/reservations?cron=${action}`);
      expect(r.status(), `acción ${action} no debe ejecutar nada`).toBe(405);
    }
  });
});

test.describe('Panel protegido (UI) @critical', () => {
  test('la pantalla de acceso pide clave y no muestra reservas', async ({ page }) => {
    await page.goto('/reservas/bella-luna-spa');
    await expect(page.getByText(/clave de acceso|introduce tu clave/i)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Creada|Teléfono/i);
  });
});
