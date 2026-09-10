import { test, expect } from '@playwright/test';

test('el paquete real inicia con Firebase y dependencias locales', async ({ page }) => {
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.route('https://fonts.**/*', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#login-screen')).toHaveClass(/show/);
  expect(await page.evaluate(() => typeof window.__datosPrueba)).toBe('undefined');
  expect(await page.evaluate(() => typeof window.jspdf.jsPDF)).toBe('function');
  expect(await page.evaluate(() => typeof window.QRious)).toBe('function');
  expect(errores).toEqual([]);
});

test('las páginas públicas, el manifest y los documentos están disponibles', async ({ page, request }) => {
  for (const ruta of ['/catalogo.html', '/ver.html', '/privacidad.html', '/condiciones.html', '/eliminacion-datos.html', '/manifest.json', '/icon-192.png']) {
    expect((await request.get(ruta)).status(), ruta).toBe(200);
  }
  await page.goto('/ver.html?id=incorrecto');
  await expect(page.locator('#err-t')).toHaveText('Link inválido');
});
