// QA — Categoría M: interfaz y dispositivos (SEGURO: solo carga y mide la UI,
// no envía mensajes ni crea reservas, así no gasta modelo ni toca datos).
// Corre en los 5 proyectos (escritorio x3 + móvil x2) definidos en el config.
const { test, expect } = require('@playwright/test');

const ASISTENTE = '/asistente/bella-luna-spa';

test.describe('Interfaz del asistente @critical', () => {
  test('carga, el campo de texto es visible y el botón de enviar existe', async ({ page }) => {
    const errores = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(ASISTENTE);
    // El campo de mensaje debe estar visible y editable.
    const input = page.locator('textarea, input[type="text"]').first();
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
    // Botón enviar presente.
    await expect(page.getByRole('button', { name: /enviar|send/i })).toBeVisible();
    // Sin errores de consola relevantes (favicon 404 se ignora).
    const relevantes = errores.filter((e) => !/favicon/i.test(e));
    expect(relevantes, 'errores de consola: ' + relevantes.join(' | ')).toHaveLength(0);
  });

  test('no hay scroll horizontal (el diseño no se desborda)', async ({ page }) => {
    await page.goto(ASISTENTE);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return { scroll: d.scrollWidth, client: d.clientWidth };
    });
    // Tolerancia de 2px por redondeo.
    expect(overflow.scroll, `scrollWidth ${overflow.scroll} vs clientWidth ${overflow.client}`)
      .toBeLessThanOrEqual(overflow.client + 2);
  });

  test('el saludo inicial del asistente se muestra', async ({ page }) => {
    await page.goto(ASISTENTE);
    await expect(page.locator('body')).toContainText(/Bella Luna|hola|ayudar/i, { timeout: 15000 });
  });
});
