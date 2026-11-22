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
  for (const ruta of ['/tienda', '/catalogo.html', '/ver.html', '/privacidad.html', '/condiciones.html', '/eliminacion-datos.html', '/manifest.json', '/icon-192.png']) {
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

test('la tienda junta en una tarjeta los colores de un modelo, aunque vengan escritos en el nombre', async ({ page }) => {
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  const valor = dato => Array.isArray(dato) ? { arrayValue: { values: dato.map(valor) } }
    : typeof dato === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(dato).map(([k, v]) => [k, valor(v)])) } }
      : typeof dato === 'number' ? { doubleValue: dato } : { stringValue: dato };
  // Así los publicaba el sistema hasta el 22/11/2026: el color en el nombre y su campo vacío.
  const deLista = (id, nombre, gb, precioUSD, extra = {}) => ({ id, tipo: 'pedido', nombre, gb, color: '', condicion: 'nuevo', precioUSD, fotos: [], ...extra });
  const datos = { local: { nombre: 'Local ficticio', whatsapp: '2235555555' }, productos: [
    deLista('lista_iphone-15-black-sim-esim-128gb', 'iPhone 15 Black // SIM + eSIM', '128GB', 775, { categoria: 'iPhone nuevos', titulo: 'Apple iPhone 15 128GB Black (SIM física + eSIM)' }),
    deLista('lista_iphone-15-blue-sim-esim-128gb', 'iPhone 15 Blue // SIM + eSIM', '128GB', 780, { categoria: 'iPhone nuevos', titulo: 'Apple iPhone 15 128GB Blue (SIM física + eSIM)' }),
    deLista('lista_samsung-s26-ultra-12-black-256gb', 'Samsung S26 Ultra 12+ Black', '256gb', 1090, { categoria: 'Celulares Samsung' }),
    deLista('lista_samsung-s26-ultra-12-sky-blue-512gb', 'Samsung S26 Ultra 12+ Sky Blue', '512GB', 1200, { categoria: 'Celulares Samsung' }),
  ] };
  await page.route('https://firestore.googleapis.com/**', route => route.fulfill({ json: { fields: valor(datos).mapValue.fields } }));
  await page.goto('/catalogo.html');
  await expect(page.locator('.prod')).toHaveCount(2);
  const iphone = page.locator('.prod', { hasText: 'iPhone 15' });
  // El título pulido, sin la capacidad ni el color: eso se elige adentro.
  await expect(iphone.locator('.prod-nombre')).toHaveText('Apple iPhone 15 (SIM física + eSIM)');
  await expect(iphone.locator('.prod-detalle')).toHaveText('128GB · 2 colores');
  await expect(iphone.locator('.precio')).toContainText('775');
  const samsung = page.locator('.prod', { hasText: 'Samsung' });
  await expect(samsung.locator('.prod-nombre')).toHaveText('Samsung S26 Ultra 12+');
  await expect(samsung.locator('.prod-detalle')).toHaveText('256GB · 512GB · 2 colores');

  await iphone.click();
  await expect(page.locator('.producto-nombre')).toHaveText('Apple iPhone 15 128GB Black (SIM física + eSIM)');
  await expect(page.locator('.variantes .opc')).toHaveText(['Black', 'Blue']);
  await page.locator('.variantes .opc', { hasText: 'Blue' }).click();
  await expect(page.locator('.producto-nombre')).toHaveText('Apple iPhone 15 128GB Blue (SIM física + eSIM)');
  // El título de la pestaña no repite la capacidad ni el color que el título ya dice.
  await expect(page).toHaveTitle(/^Apple iPhone 15 128GB Blue \(SIM física \+ eSIM\) — /);
  expect(errores).toEqual([]);
});
