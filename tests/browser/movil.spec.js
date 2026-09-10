import { test, expect } from '@playwright/test';
import { preparar, entrar, ir } from './ayudas.js';

test('inicio y ventas se pueden usar desde una pantalla de celular', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await expect(page.locator('#home-saludo')).toBeVisible();
  await page.screenshot({ path: '.runtime/home-celular.png', fullPage: true });
  await ir(page, 'ingresos');
  await expect(page.locator('#page-ingresos h1')).toBeVisible();
  const medidas = await page.evaluate(() => ({ ancho: window.innerWidth, contenido: document.documentElement.scrollWidth }));
  expect(medidas.contenido).toBeLessThanOrEqual(medidas.ancho + 2);
  expect(errores).toEqual([]);
});
