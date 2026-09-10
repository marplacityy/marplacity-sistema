import { test, expect } from '@playwright/test';
import { preparar, entrar, ir } from './ayudas.js';
import { readFile } from 'node:fs/promises';

test('las 23 pantallas cargan y los controles mantienen sus funciones', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await page.screenshot({ path: '.runtime/home-escritorio.png', fullPage: true });
  for (const nombre of ['cargar', 'listado', 'reportes', 'amort', 'config', 'ingresos', 'facturas', 'stock', 'consig', 'fijos', 'rep', 'inv', 'clientes', 'home', 'caja', 'encargues', 'repuestos', 'conocimiento', 'bandeja', 'pedidos', 'catalogo', 'asistente', 'facturador']) {
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
  await page.locator('#page-cargar button[onclick="guardar()"]').click();
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

test('venta con equipo y accesorio actualiza inventario, cliente y comprobante', async ({ page }) => {
  const errores = await preparar(page);
  await entrar(page);
  await ir(page, 'ingresos');
  await page.evaluate(() => { window.addToCart('eq', 'equipo-1'); window.addToCart('inv', 'funda-1'); window.cartPrecio(0, 550); window.cartPrecio(1, 10); });
  await page.locator('#pos-cliente').fill('Cliente de prueba');
  await page.locator('#pos-cliente-tel').fill('2235555555');
  await page.locator('#pos-medio-moneda').selectOption('USD');
  await page.evaluate(() => { window.completarPago(); window.addPosMedio(); });
  await page.evaluate(() => window.cobrarPos(false));
  await expect.poll(() => page.evaluate(() => window.__datosPrueba.listar('ingresos').length)).toBe(1);
  expect(await page.evaluate(() => window.__datosPrueba.leer('stock/equipo-1').status)).toBe('vendido');
  expect(await page.evaluate(() => window.__datosPrueba.leer('inventario/funda-1').qty)).toBe(4);
  expect(await page.evaluate(() => window.__datosPrueba.listar('clientes').length)).toBe(1);
  const venta = await page.evaluate(() => window.__datosPrueba.listar('ingresos')[0]);
  expect(venta.items).toHaveLength(2);
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
