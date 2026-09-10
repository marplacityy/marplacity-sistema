import { test, expect } from '@playwright/test';

test('la web compilada abre desde el subdirectorio de Pages sin servidor API', async ({ page, request }) => {
  const errores = [], fallosLocales = [], rutasApi = [];
  page.on('pageerror', error => errores.push(error.message));
  page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) rutasApi.push(req.url()); });
  page.on('response', res => { if (res.url().startsWith('http://127.0.0.1:3103') && res.status() >= 400) fallosLocales.push(res.url()); });
  await page.goto('./');
  await expect(page.locator('#login-screen')).toHaveClass(/show/);
  await expect(page.locator('.logo')).toContainText(/v\d{4}\.\d{2}\.\d{2}-[A-Z]/);
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBe('/marplacity-sistema/manifest.json');
  expect((await request.get(manifest)).status()).toBe(200);
  await page.goto('ver.html?id=incorrecto');
  await expect(page.locator('#err-t')).toHaveText('Link inválido');
  await page.route('https://firestore.googleapis.com/**', route => route.fulfill({ json: { fields: { productos: { arrayValue: { values: [] } } } } }));
  await page.goto('catalogo.html');
  await expect(page.locator('#salida')).toContainText('no hay equipos publicados');
  expect(rutasApi).toEqual([]);
  expect(fallosLocales).toEqual([]);
  expect(errores).toEqual([]);
});
