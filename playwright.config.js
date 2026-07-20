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
    { name: 'desktop-chromium', testIgnore: /api-contract\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox',  testIgnore: /api-contract\.spec\.js/, use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit',   testIgnore: /api-contract\.spec\.js/, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-android',   testIgnore: /api-contract\.spec\.js/, use: { ...devices['Pixel 5'] } },
    { name: 'mobile-ios',       testIgnore: /api-contract\.spec\.js/, use: { ...devices['iPhone 13'] } },
  ],
});
