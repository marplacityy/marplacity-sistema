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
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__scriptInyectado = true';
    document.body.append(script);
  });
  expect(await page.evaluate(() => window.__scriptInyectado)).toBeUndefined();
  expect(errores).toEqual([]);
});

test('las páginas públicas, el manifest y los documentos están disponibles', async ({ page, request }) => {
  for (const ruta of ['/catalogo.html', '/ver.html', '/privacidad.html', '/condiciones.html', '/eliminacion-datos.html', '/manifest.json', '/icon-192.png']) {
    expect((await request.get(ruta)).status(), ruta).toBe(200);
  }
  await page.goto('/ver.html?id=incorrecto');
  await expect(page.locator('#err-t')).toHaveText('Link inválido');
});

test('el catálogo no ejecuta código guardado en nombres, ids, categorías o fotos', async ({ page }) => {
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  const ataque = `x');window.__ataque=1;//" onmouseover="window.__ataque=2`;
  const valor = dato => Array.isArray(dato) ? { arrayValue: { values: dato.map(valor) } }
    : typeof dato === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(dato).map(([k, v]) => [k, valor(v)])) } }
      : typeof dato === 'number' ? { doubleValue: dato } : { stringValue: dato };
  const datos = { local: { nombre: 'Local ficticio', whatsapp: '2235555555' }, productos: [{
    id: ataque, nombre: ataque, categoria: 'Equipos', tipo: 'equipo', precioUSD: 100,
    bateria: '<img src=x onerror="window.__ataque=3">',
    fotos: ['/imagen-inexistente.jpg', `/otra-imagen${ataque}.jpg`],
  }] };
  await page.route('https://firestore.googleapis.com/**', route => route.fulfill({ json: { fields: valor(datos).mapValue.fields } }));
  await page.goto('/catalogo.html');
  await expect(page.locator('.prod').first()).toBeVisible();
  await page.locator('.prod').first().click();
  await expect(page.locator('#ficha')).toBeVisible();
  expect(await page.evaluate(() => window.__ataque)).toBeUndefined();
  expect(errores).toEqual([]);
});
