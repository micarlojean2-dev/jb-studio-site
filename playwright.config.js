// Playwright — auditoría de preparación para producción de Bella Luna.
// Proyectos: escritorio (Chromium/Firefox/WebKit) + móvil emulado (Android/iOS).
// Reporte HTML en playwright-report/. baseURL = producción.
// Ejecutar: npm run test:e2e   ·   solo críticos: npm run test:critical
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://jbstudio.app',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Los contratos de API no dependen del motor. Ejecutarlos una vez evita que
    // sus POST inválidos consuman varias veces el rate limit de producción.
    {
      name: 'api-contract',
      testMatch: /api-contract\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    // chatbot-pruebas escribe su reporte (REPORTE_PRUEBAS.md) en serie desde
    // Node — correrlo también en los otros 5 proyectos en paralelo pisaría
    // ese mismo archivo entre navegadores. Un solo proyecto, un solo navegador.
    {
      name: 'chatbot-pruebas',
      testMatch: /chatbot-pruebas\.spec\.js/,
      testIgnore: /chatbot-pruebas-real\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    // chatbot-pruebas-real pega contra PRODUCCIÓN REAL con la IA real (sin
    // mocks) — un solo proyecto/navegador por el mismo motivo de arriba, y
    // además para no multiplicar x5 el gasto real de tokens si alguien
    // corriera `npm run test:e2e` sin fijarse.
    {
      name: 'chatbot-pruebas-real',
      testMatch: /chatbot-pruebas-real\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'desktop-chromium', testIgnore: /api-contract\.spec\.js|chatbot-pruebas(-real)?\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox',  testIgnore: /api-contract\.spec\.js|chatbot-pruebas(-real)?\.spec\.js/, use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit',   testIgnore: /api-contract\.spec\.js|chatbot-pruebas(-real)?\.spec\.js/, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-android',   testIgnore: /api-contract\.spec\.js|chatbot-pruebas(-real)?\.spec\.js/, use: { ...devices['Pixel 5'] } },
    { name: 'mobile-ios',       testIgnore: /api-contract\.spec\.js|chatbot-pruebas(-real)?\.spec\.js/, use: { ...devices['iPhone 13'] } },
  ],
});
