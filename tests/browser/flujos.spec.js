import { test, expect } from '@playwright/test';
import { preparar, entrar, ir } from './ayudas.js';
import { readFile } from 'node:fs/promises';

test('las 24 pantallas cargan y los controles mantienen sus funciones', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await page.screenshot({ path: '.runtime/home-escritorio.png', fullPage: true });
  for (const nombre of ['cargar', 'listado', 'reportes', 'amort', 'config', 'ingresos', 'facturas', 'stock', 'consig', 'fijos', 'rep', 'inv', 'clientes', 'home', 'caja', 'encargues', 'repuestos', 'conocimiento', 'listas', 'bandeja', 'pedidos', 'catalogo', 'asistente', 'facturador']) {
    await ir(page, nombre);
    await expect(page.locator('#page-' + nombre + ' h1')).toBeVisible();
  }
  expect(errores).toEqual([]);
});

test('los campos importados no pueden crear atributos ni ejecutar JavaScript', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  const ataque = `Modelo " onmouseover="window.__ataque=1" x="`;
  await page.evaluate(async ataque => {
    const cfg = window.__datosPrueba.leer('config/usuario-prueba');
    await window.__datosPrueba.cargar('config/usuario-prueba', { ...cfg, catalogoMeta: { 'eq-equipo-1': { titulo: ataque } } });
    const equipo = window.__datosPrueba.leer('stock/equipo-1');
    await window.__datosPrueba.cargar('stock/equipo-1', { ...equipo, nombre: ataque });
    await window.__datosPrueba.cargar('clientes/cliente-xss', { nombre: ataque });
  }, ataque);
  await ir(page, 'catalogo');
  await page.locator('.cat-prod').first().click();
  expect(await page.locator('[onmouseover*="__ataque"]').count()).toBe(0);
  await ir(page, 'clientes');
  expect(await page.locator('[onmouseover*="__ataque"]').count()).toBe(0);
  expect(await page.evaluate(() => window.__ataque)).toBeUndefined();
  expect(errores).toEqual([]);
});

test('una cuenta nueva no escucha configuraciones privadas ni publica sobre otro local', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  const globales = ['config/bot', 'config/prompt', 'config/mensajes'];
  const activas = () => page.evaluate(() => window.__datosPrueba.suscripciones());
  expect((await activas()).filter(path => globales.includes(path))).toEqual([]);
  await ir(page, 'bandeja');
  await expect(page.locator('#bd-switch')).toContainText('pertenece a otra cuenta');
  await page.evaluate(() => window.publicarCatalogo());
  await expect(page.locator('#toast')).toContainText('otra cuenta');
  expect(await page.evaluate(() => window.__datosPrueba.leer('catalogo/publico'))).toBeUndefined();
  await page.evaluate(() => window.__datosPrueba.cargar('catalogo/publico', { productos: [] }));
  await expect.poll(async () => (await activas()).filter(path => globales.includes(path)).length).toBe(3);
  await page.evaluate(() => window.__datosPrueba.cargar('catalogo/publico', { userId: 'otra-cuenta', productos: [] }));
  await expect.poll(async () => (await activas()).filter(path => globales.includes(path)).length).toBe(0);
  expect(errores).toEqual([]);
});

test('las fotos se suben a Storage y el mapa guarda la base pública de Storage', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await page.evaluate(() => window.__datosPrueba.cargar('catalogo/publico', { productos: [] }));
  await ir(page, 'catalogo');
  const subidos = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    c.getContext('2d').fillRect(0, 0, 40, 40);
    const imagen = await new Promise(r => c.toBlob(r, 'image/png'));
    await window.subirFotosDe('stock_equipo-1', [imagen]);
    return window.__datosPrueba.archivos();
  });
  expect(subidos).toHaveLength(1);
  expect(subidos[0]).toMatch(/^fotos\/iphone-15[a-z0-9-]*\.jpg$/);
  const mapa = await page.evaluate(() => window.__datosPrueba.leer('catalogo/fotos'));
  expect(mapa.base).toBe('https://storage.googleapis.com/mis-gastos-21e7b.firebasestorage.app/fotos/');
  expect(Object.values(mapa.mapa).flat()).toContain(subidos[0].replace('fotos/', ''));
  await page.evaluate(() => window.sincronizarFotos());
  await expect(page.locator('#toast')).toContainText('1 imagen');
  expect(errores).toEqual([]);
});

test('la etiqueta dibuja barras y QR e invoca impresión con la política de seguridad', async ({ page, context }) => {
  await preparar(page);
  await context.addInitScript(() => { window.print = () => { window.__impresionSolicitada = true; }; });
  await entrar(page);
  const emergente = page.waitForEvent('popup');
  await page.evaluate(() => window.labelEquipo('equipo-1'));
  const etiqueta = await emergente;
  await etiqueta.waitForURL(url => url.protocol === 'blob:', { waitUntil: 'load' });
  await expect.poll(() => etiqueta.evaluate(() => !!window.__impresionSolicitada)).toBe(true);
  expect(await etiqueta.locator('svg[data-bc] rect').count()).toBeGreaterThan(0);
  expect(await etiqueta.locator('canvas[data-qr]').count()).toBeGreaterThan(0);
});

test('guardar un gasto lo lleva al listado y al cierre de caja', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'cargar');
  await page.locator('#concepto').fill('Compra de limpieza');
  await page.locator('#monto').fill('28000');
  await page.locator('#medio').selectOption('Efectivo');
  await page.locator('#page-cargar button[data-click="guardar"]').click();
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.listar('gastos').length)).toBe(2);
  const gasto = await page.evaluate(() => window.__datosPrueba.listar('gastos').find(g => g.concepto === 'Compra de limpieza'));
  expect(gasto.usd).toBe(20);
  expect(gasto.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(gasto.userId).toBe('usuario-prueba');
  await ir(page, 'listado');
  await expect(page.locator('#page-listado')).toContainText('Compra de limpieza');
  await ir(page, 'caja');
  await page.locator('#btn-cerrar-caja').click();
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.listar('cierres').length)).toBe(1);
  expect(errores).toEqual([]);
});

test('el proveedor de consignación se elige de una lista que se edita aparte', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'consig');
  // Sin lista guardada, salen los proveedores que ya tienen equipos
  await expect(page.locator('#cp-proveedor option')).toHaveText(['Elegí el proveedor...', 'Proveedor prueba', '✏️ Editar proveedores...']);
  await page.locator('#cp-proveedor').selectOption('__editar__');
  await expect(page.locator('#consig-tab-proveedores')).toBeVisible();
  await expect(page.locator('#nuevo-proveedor')).toBeFocused();
  await page.locator('#nuevo-proveedor').fill('  Juan   Pérez ');
  await page.locator('#prov-lista-card button[data-click="agregarProveedor"]').click();
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.leer('config/usuario-prueba').consigProveedores)).toEqual(['Juan Pérez', 'Proveedor prueba']);
  await page.locator('#proveedores-tags .tag', { hasText: 'Proveedor prueba' }).locator('button').click();
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.leer('config/usuario-prueba').consigProveedores)).toEqual(['Juan Pérez']);
  await expect(page.locator('#pago-proveedor option')).toHaveText(['Elegí el proveedor...', 'Juan Pérez', '✏️ Editar proveedores...']);
  await page.locator('#page-consig .tab-btn[data-args*="productos"]').click();
  await page.locator('#cp-proveedor').selectOption('Juan Pérez');
  await page.locator('#cp-producto').fill('iPhone 13');
  await page.locator('#btn-cp-guardar').click();
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.listar('consig').some(g => g.proveedor === 'Juan Pérez' && g.producto === 'iPhone 13'))).toBe(true);
  expect(errores).toEqual([]);
});

test('el asistente lee una factura y la carga al inventario recién al confirmar', async ({ page }) => {
  const errores = await preparar(page);
  const pedidos = [];
  const respuestas = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'proponer_inventario', input: { proveedor: 'Mayorista X', numero_factura: '0001-00012345', moneda: 'USD', items: [
      { nombre: 'Funda iPhone 15', cantidad: 10, costo: 4, categoria: 'Accesorios', refId: 'funda-1' },
      { nombre: 'Cargador 20W', cantidad: 6, costo: 7.5, categoria: 'Accesorios', sku: 'CG20' },
      { nombre: 'Templado genérico', cantidad: 2, costo: 1, categoria: 'Accesorios', refId: 'no-existe' }
    ] } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Te dejé la factura lista para confirmar.' }] }
  ];
  await page.route('**/api/ia**', async route => {
    pedidos.push(route.request().postDataJSON());
    await route.fulfill({ json: respuestas.shift() });
  });
  await entrar(page);
  await ir(page, 'asistente');
  await page.locator('#ag-archivo').setInputFiles({ name: 'factura.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 factura de prueba') });
  await expect(page.locator('#ag-adjunto')).toContainText('factura.pdf');
  await page.locator('#btn-ag-enviar').click();
  await expect(page.locator('#ag-chat')).toContainText('Factura para cargar al inventario');
  const primero = pedidos[0].messages[0].content;
  expect(primero[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
  expect(primero[1].text).toContain('factura.pdf');
  // Nada se guarda hasta confirmar
  expect(await page.evaluate(() => window.__datosPrueba.listar('inventario').length)).toBe(2);
  // El templado venía con un refId que no existe: queda como producto nuevo, y se destilda
  await expect(page.locator('#ag-f0-r2-destino')).toHaveValue('');
  await page.locator('#ag-f0-r2-ok').uncheck();
  await page.locator('#ag-chat button', { hasText: 'Cargar al inventario' }).click();
  await expect(page.locator('#ag-chat')).toContainText('Cargado al inventario');
  const inv = await page.evaluate(() => window.__datosPrueba.listar('inventario'));
  expect(inv).toHaveLength(3);
  const funda = inv.find(x => x.nombre === 'Funda iPhone 15');
  expect(funda.qty).toBe(15);
  expect(funda.costo).toBe(4);
  expect(funda.costoHist.map(h => h.costo)).toEqual([3, 4]);
  const cargador = inv.find(x => x.nombre === 'Cargador 20W');
  expect(cargador).toMatchObject({ qty: 6, costo: 7.5, moneda: 'USD', sku: 'CG20', proveedor: 'Mayorista X', notas: 'Factura 0001-00012345', userId: 'usuario-prueba' });
  expect(errores).toEqual([]);
});

test('venta con equipo y accesorio actualiza inventario, cliente y comprobante', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'ingresos');
  await page.evaluate(() => { window.addToCart('eq', 'equipo-1'); window.addToCart('inv', 'funda-1'); window.cartPrecio(0, 550); window.cartPrecio(1, 10); window.toggleCortesia('funda'); window.toggleCortesia('vidrio'); });
  await page.locator('#pos-cliente').fill('Cliente de prueba');
  await page.locator('#pos-cliente-tel').fill('2235555555');
  await page.locator('#pos-medio-moneda').selectOption('USD');
  await page.evaluate(() => { window.completarPago(); window.addPosMedio(); });
  await page.evaluate(() => window.cobrarPos(false));
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.listar('ingresos').length)).toBe(1);
  expect(await page.evaluate(() => window.__datosPrueba.leer('stock/equipo-1').status)).toBe('vendido');
  expect(await page.evaluate(() => window.__datosPrueba.listar('clientes').length)).toBe(1);
  const venta = await page.evaluate(() => window.__datosPrueba.listar('ingresos')[0]);
  expect(venta.items).toHaveLength(2);
  expect(venta.cortesias.map(co => co.refId || null)).toEqual([null, 'funda-1']);
  // la funda vendida y la funda de cortesía salen las dos del inventario; el vidrio no existe y no descuenta nada
  expect(await page.evaluate(() => window.__datosPrueba.leer('inventario/funda-1').qty)).toBe(3);
  expect(venta.totalUSD).toBe(560);
  await ir(page, 'facturas');
  await expect(page.locator('#page-facturas')).toContainText('iPhone 15');
  expect(errores).toEqual([]);
});

test('reparar descuenta una pieza una sola vez y permite agregar notas', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'rep');
  await page.evaluate(() => window.abrirRep('rep-1'));
  await page.locator('#rm-nota').fill('Equipo revisado');
  await page.evaluate(() => window.agregarNotaRep());
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.leer('reparaciones/rep-1').historial.some(h => h.texto === 'Equipo revisado'))).toBe(true);
  await page.locator('#rm-estado').selectOption('reparado');
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.leer('inventario/pantalla-1').qty)).toBe(2);
  await page.locator('#rm-estado').selectOption('avisado');
  await page.locator('#rm-estado').selectOption('reparado');
  expect(await page.evaluate(() => window.__datosPrueba.leer('inventario/pantalla-1').qty)).toBe(2);
  expect(errores).toEqual([]);
});

test('después de vender se corrige la ganancia de un producto y cambia en el listado y en el reporte', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'ingresos');
  // el equipo está cargado con valor u$s 400 y se vende a u$s 400: ganancia cero, que no es real
  await page.evaluate(() => { window.addToCart('eq', 'equipo-1'); window.addToCart('inv', 'funda-1'); window.cartPrecio(0, 400); window.cartPrecio(1, 10); });
  await page.locator('#pos-medio-moneda').selectOption('USD');
  await page.evaluate(() => { window.completarPago(); window.addPosMedio(); });
  await page.evaluate(() => window.cobrarPos(false));
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.listar('ingresos').length)).toBe(1);
  const id = await page.evaluate(() => window.__datosPrueba.listar('ingresos')[0].id);
  const leer = () => page.evaluate(id => window.__datosPrueba.leer('ingresos/' + id), id);

  await ir(page, 'facturas');
  await expect(page.locator('#inc-list-body')).toContainText('+u$s 7'); // solo la funda: 10 − 3
  await page.evaluate(id => window.abrirFE(id), id);
  await expect(page.locator('#fe-modal')).toHaveClass(/open/);
  await expect(page.locator('#fe-costo-0')).toHaveValue('400');
  await expect(page.locator('#fe-gan-0')).toHaveValue('0');
  await expect(page.locator('#fe-gan-1')).toHaveValue('7');
  await expect(page.locator('#fe-ganancia')).toHaveText(/^u\$s 7 /);

  // escribir la ganancia despeja el costo…
  await page.locator('#fe-gan-0').fill('80');
  await expect(page.locator('#fe-costo-0')).toHaveValue('320');
  await expect(page.locator('#fe-ganancia')).toHaveText(/^u\$s 87 /);
  // …y escribir el costo recalcula la ganancia
  await page.locator('#fe-costo-0').fill('350');
  await expect(page.locator('#fe-gan-0')).toHaveValue('50');
  await expect(page.locator('#fe-ganancia')).toHaveText(/^u\$s 57 /);
  await page.evaluate(() => window.saveFE());
  await expect.poll(async () => (await leer()).gananciaUSD).toBe(57);
  let venta = await leer();
  expect(venta.items[0]).toMatchObject({ costo: 350, costoMoneda: 'USD', costoManual: true, costoAuto: 400 });
  expect(venta.items[1].costoManual).toBeUndefined(); // la funda no se tocó: sigue en automático
  expect(venta.totalUSD).toBe(410); // corregir el costo no cambia lo cobrado
  // el equipo y el inventario no se tocan
  expect(await page.evaluate(() => window.__datosPrueba.leer('stock/equipo-1'))).toMatchObject({ valorUSD: 400, status: 'vendido' });
  expect(await page.evaluate(() => window.__datosPrueba.leer('inventario/funda-1').qty)).toBe(4);
  await expect(page.locator('#inc-list-body')).toContainText('+u$s 57');

  // el reporte suma la ganancia corregida y deja corregirla desde ahí
  await ir(page, 'reportes');
  const fila = page.locator('#reporte-content tbody tr').first();
  await expect(fila).toContainText('u$s 57');
  await fila.locator('button.ei-btn').click();
  await expect(page.locator('#fe-modal')).toHaveClass(/open/);
  await expect(page.locator('#fe-costo-0')).toHaveValue('350');

  // vaciar el costo vuelve al cálculo automático
  await page.locator('#fe-costo-0').fill('');
  await expect(page.locator('#fe-gan-0')).toHaveValue('0');
  await page.evaluate(() => window.saveFE());
  await expect.poll(async () => (await leer()).gananciaUSD).toBe(7);
  venta = await leer();
  expect(venta.items[0].costo).toBe(400);
  expect(venta.items[0].costoManual).toBeUndefined();
  expect(venta.items[0].costoAuto).toBeUndefined();
  await expect(page.locator('#reporte-content tbody tr').first()).toContainText('u$s 7');
  expect(errores).toEqual([]);
});

test('un reporte de más de 300 ventas se puede abrir sin errores', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await page.evaluate(async () => {
    for (let n = 0; n < 305; n++) await window.__datosPrueba.cargar('ingresos/venta-' + n, { fecha: window.__datosPrueba.fecha, nombre: 'Venta ' + n, totalUSD: 10, tc: 1400, gananciaUSD: 2 });
  });
  await ir(page, 'reportes');
  await expect(page.locator('#reporte-content')).toContainText('Mostrando las últimas 300');
  expect(errores).toEqual([]);
});

test('la permuta entra al stock con el valor acordado', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'ingresos');
  await page.evaluate(() => { window.addToCart('eq', 'equipo-1'); window.cartPrecio(0, 550); });
  await page.locator('#pos-permuta').check();
  await page.locator('#pos-permuta-desc').fill('iPhone 12 recibido');
  await page.locator('#pos-permuta-val').fill('300');
  await page.locator('#pos-permuta-moneda').selectOption('USD');
  await page.locator('#pos-permuta-imei').fill('987654321012345');
  await page.locator('#pos-medio-moneda').selectOption('USD');
  await page.locator('#pos-medio-val').fill('250');
  await page.evaluate(() => { window.addPosMedio(); return window.cobrarPos(false); });
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.listar('stock').length)).toBe(2);
  const recibido = await page.evaluate(() => window.__datosPrueba.listar('stock').find(x => x.imei === '987654321012345'));
  expect(recibido.valorUSD).toBe(300);
  expect(recibido.status).toBe('en_stock');
  expect(errores).toEqual([]);
});

test('entregar un encargue cobra el saldo y conserva la seña previa', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'encargues');
  await page.evaluate(() => window.abrirEnt('enc-1'));
  await page.locator('#ent-med-mon').selectOption('USD');
  await page.evaluate(() => { window.entCompletar(); window.entAddMedio(); return window.entregarEncargue(false); });
  const encargue = await page.evaluate(() => window.__datosPrueba.leer('encargues/enc-1'));
  expect(encargue.estado).toBe('entregado');
  const venta = await page.evaluate(() => window.__datosPrueba.listar('ingresos')[0]);
  expect(venta.totalUSD).toBe(100);
  expect(venta.medios.map(m => m.valor)).toEqual([30, 70]);
  expect(errores).toEqual([]);
});

test('la orden de reparación genera un PDF con las bibliotecas instaladas', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'rep');
  await page.evaluate(() => window.abrirRep('rep-1'));
  const descarga = page.waitForEvent('download');
  await page.evaluate(() => window.ordenPDFActual());
  const archivo = await descarga;
  const bytes = await readFile(await archivo.path());
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(3000);
  expect(errores).toEqual([]);
});

test('importar una lista pegada arma los productos, aunque la IA no responda', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await page.evaluate(() => window.__datosPrueba.cargar('catalogo/publico', { productos: [] }));
  await ir(page, 'catalogo');
  await page.locator('.cat-importar').click();
  await expect(page.locator('#importar-lista-modal')).toHaveClass(/open/);
  await page.locator('#imp-nombre').fill('Lista Valen');
  await page.locator('#imp-texto').fill('🍎 SELLADOS 🍎\niPhone 16 128gb negro - u$s 850\n*USADOS*\n- iPhone 13 128gb 87% azul $ 380\nAirPods Pro 2 usd 210');
  await page.locator('#btn-imp-interpretar').click();
  // La IA de las pruebas no devuelve una lista: la lee el lector de Ecommodo.
  await expect(page.locator('#imp-filas tr')).toHaveCount(3);
  await expect(page.locator('#imp-aviso')).toContainText('lector automático');
  await expect(page.locator('#imp-filas tr').nth(1).locator('select').nth(1)).toHaveValue('iPhone usados');
  // Se corrige un precio y se saca un producto antes de importar.
  await page.locator('#imp-filas tr').first().locator('input.precio').fill('900');
  await page.locator('#imp-filas tr').first().locator('input.precio').dispatchEvent('change');
  await page.locator('#imp-filas tr').nth(2).locator('.imp-quitar').click();
  await expect(page.locator('#btn-imp-confirmar')).toHaveText('Importar 2 productos');
  await page.locator('#btn-imp-confirmar').click();
  await expect(page.locator('#btn-imp-listo')).toBeVisible();
  await expect(page.locator('#imp-avance')).toContainText('Lista "Valen" guardada: 2 nuevos');
  await page.locator('#btn-imp-listo').click();
  await expect(page.locator('.cat-metric.on .m-label')).toHaveText('Lista Valen');
  await expect(page.locator('.cat-prod')).toHaveCount(2);
  const cfg = await page.evaluate(() => window.__datosPrueba.leer('config/usuario-prueba'));
  expect(cfg.catalogoIncluidos).toHaveLength(2);
  expect(Object.keys(cfg.catalogoNotas)).toHaveLength(2);
  const conoc = await page.evaluate(() => window.__datosPrueba.leer('conocimiento/usuario-prueba'));
  expect(conoc.proveedores.map(p => p.nombre)).toContain('Valen');
  expect(errores).toEqual([]);
});

test('los repetidos entre listas se unifican: uno solo, precio promedio y la lista más barata como fuente', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  const ids = await page.evaluate(async () => {
    const d = window.__datosPrueba;
    const item = (producto, gb, color, precioPublico) => ({ producto, gb, color, condicion: '', precioPublico });
    await d.cargar('conocimiento/usuario-prueba', { proveedores: [{ id: 'ema', nombre: 'ema', tipo: 'costo', vence: false }, { id: 'agus', nombre: 'agus south', tipo: 'costo', vence: false }] });
    await d.cargar('listas_precios/l-ema', { origen: 'ema', fecha: d.fecha, moneda: 'USD', items: [
      item('iPhone 18 Pro Max Black', '256gb', '', 1490), item('iPhone 18 Pro Max Black', '512gb', '', 1760), item('iPhone 16 Black // SIM + eSIM', '128gb', '', 855),
    ] });
    await d.cargar('listas_precios/l-agus', { origen: 'agus', fecha: d.fecha, moneda: 'USD', items: [item('iPhone 18 Pro Max', '256GB', 'Black', 1515), item('iPhone 16', '128GB', 'Black', 875)] });
    // Lo mandado a la tienda con el id de antes, que no distinguía capacidades.
    await d.cargar('config/usuario-prueba', { ...d.leer('config/usuario-prueba'), catalogoIncluidos: ['lista_iphone-18-pro-max-black'], catalogoNotas: { 'lista_iphone-18-pro-max-black': 'Sellado, con garantía.' } });
    await d.cargar('catalogo/publico', { productos: [] });
    return { ema256: 'lista_iphone-18-pro-max-black-256gb', ema512: 'lista_iphone-18-pro-max-black-512gb', agus256: 'lista_iphone-18-pro-max-256gb-black' };
  });
  await ir(page, 'catalogo');
  // Cada capacidad pasa a ser su producto, y las tres heredan estar en la tienda.
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.leer('config/usuario-prueba').catalogoIdsV2)).toBe(true);
  let cfg = await page.evaluate(() => window.__datosPrueba.leer('config/usuario-prueba'));
  expect(cfg.catalogoIncluidos).toEqual(expect.arrayContaining([ids.ema256, ids.ema512, ids.agus256]));
  expect(cfg.catalogoNotas[ids.ema256]).toBe('Sellado, con garantía.');

  await expect(page.locator('#btn-cat-duplicados')).toHaveText('🔎 Buscar duplicados (1)');
  await page.locator('#btn-cat-duplicados').click();
  await expect(page.locator('#duplicados-modal')).toHaveClass(/open/);
  // El 256 es seguro y viene marcado; el iPhone 16 queda para revisar (uno aclara SIM + eSIM).
  await expect(page.locator('.dup-grupo')).toHaveCount(2);
  await expect(page.locator('.dup-grupo.on')).toHaveCount(1);
  await expect(page.locator('.dup-grupo.on .dup-queda')).toContainText('1.505');
  await expect(page.locator('.dup-grupo.on .dup-of.mejor')).toContainText('ema');
  await expect(page.locator('.dup-grupo').nth(1).locator('.dup-nota')).toContainText('SIM');
  await page.locator('#dup-regla').selectOption('minimo');
  await expect(page.locator('.dup-grupo.on .dup-queda')).toContainText('1.490');
  await page.locator('#dup-regla').selectOption('promedio');
  await expect(page.locator('#btn-dup-unificar')).toContainText('Unificar 1 producto');
  await page.locator('#btn-dup-unificar').click();
  await expect(page.locator('#dup-listo')).toBeVisible();
  await page.locator('#dup-listo .btn-secondary').click();

  cfg = await page.evaluate(() => window.__datosPrueba.leer('config/usuario-prueba'));
  expect(cfg.catalogoUnificados[ids.agus256]).toMatchObject({ regla: 'promedio', nombre: 'iPhone 18 Pro Max', gb: '256GB', color: 'Black' });
  expect(cfg.catalogoIncluidos).toContain(ids.agus256);
  expect(cfg.catalogoIncluidos).not.toContain(ids.ema256);
  expect(cfg.catalogoNotas[ids.agus256]).toBe('Sellado, con garantía.');
  await expect(page.locator('#btn-cat-duplicados')).toHaveText('🔎 Buscar duplicados');

  // En modo lista se ve la columna Fuente: la más barata, y que también lo tiene la otra.
  await page.evaluate(() => { if (document.getElementById('cat-modo-btn').textContent.includes('Lista')) window.modoCatalogo(); });
  await expect(page.locator('.cat-fila-cab')).toContainText('Fuente');
  const fila = page.locator('.cat-fila', { hasText: '256GB · Black' });
  await expect(fila).toHaveCount(1);
  await expect(fila.locator('.col.fuente')).toContainText('Lista ema');
  await expect(fila.locator('.col.fuente')).toContainText('también agus south');
  await expect(fila.locator('.col.precio')).toHaveText('u$s 1.505');
  await page.screenshot({ path: '.runtime/catalogo-fuente.png', fullPage: true });
  // La fuente de cada lista sigue mostrando el producto unificado.
  await page.locator('.cat-metric', { hasText: 'Lista agus south' }).click();
  await expect(page.locator('.cat-fila', { hasText: '256GB · Black' })).toHaveCount(1);

  // Lo que se publica no lleva nada de los proveedores.
  await page.evaluate(() => window.publicarCatalogo());
  const publicado = await page.evaluate(() => window.__datosPrueba.leer('catalogo/publico'));
  const unificado = publicado.productos.find(p => p.id === ids.agus256);
  expect(unificado).toMatchObject({ nombre: 'iPhone 18 Pro Max', gb: '256GB', color: 'Black', precioUSD: 1505, descripcion: 'Sellado, con garantía.' });
  expect(JSON.stringify(publicado)).not.toMatch(/ema|agus|_ofertas|_fuentes/);
  expect(publicado.productos.map(p => p.id)).toContain(ids.ema512);

  // Cuando alguien lo compra, Pedidos dice a quién pedírselo.
  await page.evaluate(id => window.__datosPrueba.cargar('pedidos/pedido-1', {
    estado: 'pagado', creado: new Date().toISOString(), pago: 'efectivo', montoUSD: 1505, entrega: 'retiro',
    cliente: { nombre: 'Ana', whatsapp: '2235550000' }, items: [{ id, nombre: 'iPhone 18 Pro Max', gb: '256GB', color: 'Black', tipo: 'pedido', cantidad: 1 }],
  }), ids.agus256);
  await ir(page, 'pedidos');
  await expect(page.locator('.ped-prov')).toContainText('Pedíselo a ema');
  await expect(page.locator('.ped-prov')).toContainText('1.490');
  await expect(page.locator('.ped-prov')).toContainText('agus south u$s 1.515');

  // Separar deshace la unificación.
  await ir(page, 'catalogo');
  await page.evaluate(id => window.separarUnificado(id), ids.agus256);
  await expect.poll(() => page.evaluate(() => Object.keys(window.__datosPrueba.leer('config/usuario-prueba').catalogoUnificados).length)).toBe(0);
  await expect(page.locator('#btn-cat-duplicados')).toHaveText('🔎 Buscar duplicados (1)');
  expect(errores).toEqual([]);
});

test('las fotos que faltan se buscan, la IA arma la ficha, se revisa y recién ahí se carga', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await page.evaluate(async () => {
    const d = window.__datosPrueba;
    await d.cargar('config/usuario-prueba', { ...d.leer('config/usuario-prueba'), catalogoIncluidos: ['consig_consig-1'], catalogoIdsV2: true });
    await d.cargar('catalogo/publico', { productos: [] });
  });
  // Cuatro candidatas: dos de fondo blanco distintas, la primera repetida y una foto de uso.
  // La búsqueda va al Worker de la tienda (en Node, su dirección real): acá se la responde la prueba.
  const fotos = await page.evaluate(() => {
    const dibujar = pintar => { const c = document.createElement('canvas'); c.width = c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 600); pintar(x); return c.toDataURL('image/png'); };
    const frente = dibujar(x => { x.fillStyle = '#111'; x.fillRect(200, 80, 200, 440); });
    return [frente, dibujar(x => { x.fillStyle = '#6a7'; x.fillRect(0, 0, 600, 600); }), frente, dibujar(x => { x.fillStyle = '#334'; x.fillRect(60, 240, 480, 120); })];
  });
  const pedidos = [];
  await page.route('**/fotos/buscar', route => { pedidos.push(route.request().postDataJSON()); return route.fulfill({ json: { consulta: 'iPhone 14', candidatos: fotos.map(url => ({ url, fuente: 'Amazon' })) } }); });
  await page.route('**/fotos/traer', route => {
    const { base, desde, urls } = route.request().postDataJSON();
    pedidos.push({ base, desde, urls: urls.length });
    return route.fulfill({ json: { subidos: urls.map((_, i) => `${base}${desde + i > 1 ? '-' + (desde + i) : ''}.png`), fallidas: [] } });
  });
  // La IA del sistema contesta como Claude: primero un bloque de razonamiento, después el texto.
  const ficha = { id: 'consig_consig-1', titulo: 'Apple iPhone 14', categoria: 'iPhone nuevos', descripcion: 'El iPhone 14 está en el local y lo podés ver antes de llevarlo.', etiquetas: ['Apple', 'iphone 14', 'celular', 'mar del plata'], seo: 'Apple iPhone 14 en MarplaCity, Mar del Plata.' };
  await page.route('**/api/ia', route => {
    const pedido = route.request().postDataJSON();
    pedidos.push({ ia: pedido.model, sistema: pedido.system.includes('etiquetas'), pide: pedido.messages[0].content.includes('consig_consig-1') });
    return route.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '```json\n' + JSON.stringify({ productos: [ficha, { id: 'otro-que-nadie-pidio', titulo: 'No va' }] }) + '\n```' }] } });
  });
  await ir(page, 'catalogo');
  await expect(page.locator('#btn-cat-fotos-faltan')).toHaveText('📷 Buscar fotos que faltan (1)');
  await page.locator('#btn-cat-fotos-faltan').click();
  await expect(page.locator('#fotos-faltantes-modal')).toHaveClass(/open/);
  await expect(page.locator('#ff-intro')).toContainText('1 producto de la tienda no tiene foto');
  await page.locator('#btn-ff-buscar').click();

  // La revisión: todo a la vista y nada guardado todavía.
  await expect(page.locator('#ff-paso-3')).toBeVisible();
  await expect(page.locator('.ff-prod')).toHaveCount(1);
  await expect(page.locator('.ff-prod .cat-cand')).toHaveCount(4);
  await expect(page.locator('.ff-prod .cat-cand.on')).toHaveCount(2);
  await expect(page.locator('.ff-prod .cat-cand').nth(0)).toContainText('600×600 · fondo blanco');
  await expect(page.locator('.ff-prod .cat-cands')).toContainText('otro fondo');
  await expect(page.locator('.ff-prod .cat-cands')).toContainText('repetida');
  // La ficha la escribió la IA: título, descripción y etiquetas, todo editable.
  await expect(page.locator('#ff-ia')).toContainText('escritos por Claude');
  await expect(page.locator('.ff-prod input[type=text]').first()).toHaveValue('Apple iPhone 14');
  await expect(page.locator('.ff-prod textarea')).toHaveValue(/lo podés ver/);
  await expect(page.locator('.ff-prod input.etiquetas')).toHaveValue('apple, iphone 14, celular, mar del plata');
  await expect(page.locator('.ff-prod input.seo')).toHaveValue('Apple iPhone 14 en MarplaCity, Mar del Plata.');
  expect(await page.evaluate(() => window.__datosPrueba.leer('catalogo/fotos'))).toBeUndefined();
  expect(pedidos).toEqual([{ nombre: 'iPhone 14', gb: '', color: '', tipo: 'equipo' }, { ia: 'claude-opus-5-5', sistema: true, pide: true }]);
  await page.screenshot({ path: '.runtime/fotos-revision.png' });

  // La última edición a mano, y a cargar.
  await page.locator('.ff-prod input[type=text]').first().fill('iPhone 14 impecable');
  await page.locator('.ff-prod input[type=text]').first().dispatchEvent('change');
  await page.locator('.ff-prod input.precio').fill('480');
  await page.locator('.ff-prod input.precio').dispatchEvent('change');
  await page.locator('#btn-ff-cargar').click();
  await expect(page.locator('#ff-paso-4')).toBeVisible();
  await expect(page.locator('#ff-final')).toContainText('2 fotos guardadas en 1 producto');
  await expect(page.locator('#ff-final')).toContainText('La tienda quedó publicada');
  expect(pedidos[2]).toEqual({ base: 'iphone-14', desde: 1, urls: 2 });

  const cfg = await page.evaluate(() => window.__datosPrueba.leer('config/usuario-prueba'));
  expect(cfg.catalogoMeta['consig_consig-1']).toEqual({ titulo: 'iPhone 14 impecable', keywords: 'apple, iphone 14, celular, mar del plata', seoDescripcion: 'Apple iPhone 14 en MarplaCity, Mar del Plata.' });
  expect(cfg.catalogoAjustes['consig_consig-1'].precioUSD).toBe(480);
  expect(cfg.catalogoNotas['consig_consig-1']).toMatch(/lo podés ver/);
  const mapa = await page.evaluate(() => window.__datosPrueba.leer('catalogo/fotos'));
  expect(mapa.mapa['iphone-14']).toEqual(['iphone-14.png', 'iphone-14-2.png']);
  const publicado = await page.evaluate(() => window.__datosPrueba.leer('catalogo/publico'));
  expect(publicado.productos).toHaveLength(1);
  expect(publicado.productos[0]).toMatchObject({ id: 'consig_consig-1', titulo: 'iPhone 14 impecable', precioUSD: 480, keywords: 'apple, iphone 14, celular, mar del plata' });
  expect(publicado.productos[0].fotos).toHaveLength(2);
  await page.locator('#ff-paso-4 .btn-save').click();
  await expect(page.locator('#btn-cat-fotos-faltan')).toHaveText('📷 Buscar fotos que faltan');
  expect(errores).toEqual([]);
});
