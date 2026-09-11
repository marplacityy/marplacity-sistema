import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  // El navegador de prueba corre en la zona horaria del local. Sin esto, en el runner de
  // GitHub (UTC) las pruebas fallan entre las 21:00 y las 00:00 de Argentina: los datos
  // de prueba se fechan en Argentina y la app toma "hoy" del reloj del navegador.
  use: { channel: process.platform === 'win32' ? 'chrome' : undefined, timezoneId: 'America/Argentina/Buenos_Aires', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm run build:pages && node scripts/servidor-pages-pruebas.mjs', url: 'http://127.0.0.1:3103/marplacity-sistema/', timeout: 60_000, reuseExistingServer: false },
    { command: 'node server/index.js', url: 'http://127.0.0.1:3101/api/salud', env: { PORT: '3101', LOG_LEVEL: 'silent' }, reuseExistingServer: false },
    { command: 'npx vite build --mode prueba --outDir .runtime/pruebas && node scripts/servidor-pruebas.mjs', url: 'http://127.0.0.1:3102/api/salud', timeout: 60_000, reuseExistingServer: false },
  ],
  projects: [
    { name: 'pages', testMatch: 'pages.spec.js', use: { baseURL: 'http://127.0.0.1:3103/marplacity-sistema/' } },
    { name: 'produccion', testMatch: 'produccion.spec.js', use: { baseURL: 'http://127.0.0.1:3101' } },
    { name: 'escritorio', testMatch: 'flujos.spec.js', use: { baseURL: 'http://127.0.0.1:3102', viewport: { width: 1440, height: 1000 } } },
    { name: 'celular', testMatch: 'movil.spec.js', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: 'http://127.0.0.1:3102' } },
  ],
});
