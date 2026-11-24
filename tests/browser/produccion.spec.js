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
  // "12+" es la RAM, como la anota ese proveedor: no es parte del nombre del modelo.
  await expect(samsung.locator('.prod-nombre')).toHaveText('Samsung S26 Ultra');
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

test('cada modelo va en una tarjeta aunque dos proveedores lo escriban distinto, y MacBooks y Notebooks son secciones aparte', async ({ page }) => {
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  const valor = dato => Array.isArray(dato) ? { arrayValue: { values: dato.map(valor) } }
    : typeof dato === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(dato).map(([k, v]) => [k, valor(v)])) } }
      : typeof dato === 'number' ? { doubleValue: dato } : { stringValue: dato };
  const P = (id, nombre, gb, color, precioUSD, extra = {}) => ({ id: 'lista_' + id, tipo: 'pedido', nombre, gb, color, condicion: 'nuevo', categoria: 'iPhone nuevos', precioUSD, fotos: [], ...extra });
  const datos = { local: { nombre: 'Local ficticio', whatsapp: '2235555555' }, productos: [
    // El mismo iPhone 17 en dos listas: una lo tiene en el local, la otra a pedido y más barato.
    P('a1', 'iPhone 17', '256GB', 'Black', 1035, { tipo: 'equipo' }), P('a2', 'iPhone 17', '256GB', 'Blue', 1035, { tipo: 'equipo' }),
    P('b1', 'iPhone 17 Black // SIM + eSIM', '256GB', '', 1020), P('b2', 'iPhone 17 Sage // SIM + eSIM', '256GB', '', 1020),
    // El "con SIM" es mucho más caro: otro producto.
    P('c1', 'iPhone 18 Pro Max', '256GB', 'Glacier', 1505), P('c2', 'iPhone 18 Pro Max', '512GB', 'Glacier', 1720), P('c3', 'iPhone 18 Pro Max', '1TB', 'Glacier', 1950),
    P('d1', 'iPhone 18 Pro Max con SIM', '256GB', 'Glacier', 1765), P('d2', 'iPhone 18 Pro Max con SIM', '256GB', 'Burgundy', 1765),
    // Una lista carga la RAM donde va la capacidad y el disco en el nombre.
    P('m1', "MacBook Air 15'' M5 RAM 512gb Silver", '16GB', '', 1610, { categoria: 'MacBook nuevas' }), P('m2', 'MacBook Air M5 15" 16GB', '512GB', 'Midnight', 1640, { categoria: 'MacBook nuevas' }),
    P('n1', 'Lenovo 83RR Intel Core 7 16GB RAM 15.3"', '512GB', 'Blue', 900, { categoria: 'Notebooks' }),
    P('n2', 'Acer A15 Intel Core i9 16GB RAM 15.6"', '512GB', 'Gray', 800, { categoria: 'Notebooks' }),
    P('n3', 'Acer SFG16 AMD Ryzen AI 7 16GB RAM 16"', '1TB', 'Black', 1000, { categoria: 'Notebooks' }),
  ] };
  await page.route('https://firestore.googleapis.com/**', route => route.fulfill({ json: { fields: valor(datos).mapValue.fields } }));
  const tarjetas = () => page.locator('.grilla .prod').evaluateAll(lista => lista.map(p => [p.querySelector('.prod-nombre').textContent.trim(), p.querySelector('.prod-detalle')?.textContent.trim() || '', p.querySelector('.precio').textContent.replace('desde', '').trim()].join(' | ').replace(/\s+/g, ' ')));

  await page.goto('/catalogo.html#r=iphone-nuevos');
  await expect(page.locator('.grilla .prod')).toHaveCount(3);
  expect(await tarjetas()).toEqual([
    'iPhone 18 Pro Max | 256GB · 512GB · 1TB | u$s 1.505',
    'iPhone 18 Pro Max con SIM | 256GB · 2 colores | u$s 1.765',
    'iPhone 17 | 256GB · 3 colores | u$s 1.020',
  ]);
  await expect(page.locator('#nav-rubros')).toContainText('MacBooks');
  await expect(page.locator('#nav-rubros')).toContainText('Notebooks');

  // El Black de la lista a pedido quedó repetido: su link abre el que se muestra, el del local.
  await page.goto('/catalogo.html#p=lista_b1');
  await expect(page.locator('.producto-nombre')).toHaveText('iPhone 17');
  await expect(page.locator('.variantes .opc')).toHaveText(['Black', 'Blue', 'Sage']);
  await expect(page.locator('.producto-precio, .ficha-precio, .precio').first()).toContainText('1.035');

  await page.goto('/catalogo.html#r=macbooks');
  expect(await tarjetas()).toEqual(['MacBook Air 15" M5 | 512GB · 2 colores | u$s 1.610']);
  // Las notebooks, por marca y de mayor a menor precio.
  await page.goto('/catalogo.html#r=notebooks');
  expect((await tarjetas()).map(t => t.split(' | ')[0].split(' ').slice(0, 2).join(' '))).toEqual(['Acer SFG16', 'Acer A15', 'Lenovo 83RR']);
  expect(errores).toEqual([]);
});

test('los relojes van por modelo con su tamaño y color, y el que no tiene foto usa la del que se ve igual', async ({ page }) => {
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  const valor = dato => Array.isArray(dato) ? { arrayValue: { values: dato.map(valor) } }
    : typeof dato === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(dato).map(([k, v]) => [k, valor(v)])) } }
      : typeof dato === 'number' ? { doubleValue: dato } : { stringValue: dato };
  const P = (id, nombre, color, precioUSD, extra = {}) => ({ id: 'lista_' + id, tipo: 'pedido', nombre, gb: '', color, condicion: 'nuevo', categoria: 'Apple Watch nuevos', precioUSD, fotos: [], ...extra });
  const datos = { local: { nombre: 'Local ficticio', whatsapp: '2235555555' }, productos: [
    // Como los trae una lista: todo junto en el nombre, con el código del proveedor.
    P('w1', 'Watch S12 46mm Black SB M/L - MJEL4LS', '', 545), P('w2', 'Watch S12 46mm Dark Bronze - Olive SB M/L', '', 545),
    P('w3', 'Watch S12 42mm Black SB S/M', '', 485),
    P('w4', 'Apple Watch SE 3 Gen 40mm', 'Starlight', 365), P('w5', 'Apple Watch SE 3 Gen 40mm + Cell', 'Starlight', 385),
    // El 18 Pro Max con SIM no tiene foto; el común, del mismo color, sí: es la misma.
    // (La foto es un archivo que existe en el paquete: una que no carga se cambia por el recuadro.)
    P('i1', 'iPhone 18 Pro Max', 'Glacier', 1505, { gb: '256GB', categoria: 'iPhone nuevos', fotos: ['/icon-192.png'] }),
    P('i2', 'iPhone 18 Pro Max con SIM', 'Glacier', 1765, { gb: '256GB', categoria: 'iPhone nuevos' }),
    P('i3', 'iPhone 18 Pro Max con SIM', 'Burgundy', 1765, { gb: '256GB', categoria: 'iPhone nuevos' }),
  ] };
  await page.route('https://firestore.googleapis.com/**', route => route.fulfill({ json: { fields: valor(datos).mapValue.fields } }));
  const tarjetas = () => page.locator('.grilla .prod').evaluateAll(lista => lista.map(p => [p.querySelector('.prod-nombre').textContent.trim(), p.querySelector('.prod-detalle')?.textContent.trim() || ''].join(' | ').replace(/\s+/g, ' ')));

  await page.goto('/catalogo.html#r=smartwatch');
  await expect(page.locator('.grilla .prod')).toHaveCount(3);
  expect(await tarjetas()).toEqual([
    'Apple Watch Series 12 | 42mm · 46mm · 2 colores',
    'Apple Watch SE 3 + Cellular | 40mm · Starlight',
    'Apple Watch SE 3 | 40mm · Starlight',
  ]);
  await page.locator('.prod', { hasText: 'Series 12' }).click();
  await expect(page.locator('.variantes .t')).toHaveText(['Tamaño', 'Color']);
  await expect(page.locator('.variantes .opc')).toContainText(['42mm', '46mm', 'Black Sport Band']);

  // Con SIM y sin SIM, mismo color: la misma foto. El Burgundy no tiene de dónde tomarla.
  await page.goto('/catalogo.html#p=lista_i2');
  await expect(page.locator('.producto-nombre')).toHaveText('iPhone 18 Pro Max con SIM');
  await expect(page.locator('#ficha img[src$="/icon-192.png"]').first()).toBeAttached();
  await page.goto('/catalogo.html#p=lista_i3');
  await expect(page.locator('#ficha img[src$="/icon-192.png"]')).toHaveCount(0);
  expect(errores).toEqual([]);
});
