import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gananciaDeVentaUSD, costoVigente, gananciaRenglon, costoParaGanancia } from '../src/shared/ganancia.js';

const costos = {
  eq: new Map([['e1', { id: 'e1', valorUSD: 550 }]]),
  consig: new Map([['c1', { id: 'c1', precioUSD: 400 }]]),
  inv: new Map([
    ['f1', { id: 'f1', costo: 4, moneda: 'USD' }],
    ['f2', { id: 'f2', costo: 5, moneda: 'USD', costoHist: [{ desde: '0000-01-01', costo: 3, moneda: 'USD' }, { desde: '2026-06-01', costo: 5, moneda: 'USD' }] }],
  ]),
};
const gan = (v, tcActual = null) => gananciaDeVentaUSD(v, { tcActual, costos });

test('la ganancia sale del costo actual del producto', () => {
  assert.equal(gan({ tc: 1400, items: [{ tipo: 'eq', refId: 'e1', precio: 630, moneda: 'USD', costo: 500, qty: 1 }] }), 80);
  assert.equal(gan({ tc: 1400, items: [{ tipo: 'consig', refId: 'c1', precio: 450, moneda: 'USD', costo: 400 }] }), 50);
  // accesorio vendido en pesos: se pasa a dólares con el TC de la venta
  assert.equal(gan({ tc: 1400, items: [{ tipo: 'inv', refId: 'f1', precio: 14000, moneda: 'ARS', costo: 4, qty: 2 }] }), 12);
  // el inventario usa el costo vigente a la fecha de la venta
  assert.equal(gan({ fecha: '2026-03-10', items: [{ tipo: 'inv', refId: 'f2', precio: 10, moneda: 'USD', costo: 3 }] }), 7);
  assert.equal(gan({ fecha: '2026-07-10', items: [{ tipo: 'inv', refId: 'f2', precio: 10, moneda: 'USD', costo: 3 }] }), 5);
});

test('un equipo cargado con el precio de venta como costo da ganancia cero', () => {
  // el caso que se quiere poder corregir: valorUSD = 550 y se vendió a 550
  assert.equal(gan({ tc: 1400, items: [{ tipo: 'eq', refId: 'e1', precio: 550, moneda: 'USD', costo: 550 }] }), 0);
});

test('el costo corregido a mano en la venta manda sobre el del producto', () => {
  const venta = { tc: 1400, items: [{ tipo: 'eq', refId: 'e1', precio: 550, moneda: 'USD', costo: 470, costoMoneda: 'USD', costoManual: true }] };
  assert.equal(gan(venta), 80);
  // y no se mueve aunque después cambie el costo del producto
  const otros = { ...costos, eq: new Map([['e1', { id: 'e1', valorUSD: 999 }]]) };
  assert.equal(gananciaDeVentaUSD(venta, { costos: otros }), 80);
});

test('el costo corregido puede estar en otra moneda que el precio', () => {
  // se vendió en pesos y el costo real fue en dólares
  const it = { tipo: 'manual', refId: null, precio: 840000, moneda: 'ARS', costo: 500, costoMoneda: 'USD', costoManual: true };
  assert.equal(gan({ tc: 1400, items: [it] }), 100);
  // sin TC en la venta se usa el de hoy; sin ninguno no se puede calcular
  assert.equal(gan({ items: [it] }, 1400), 100);
  assert.equal(gan({ items: [it] }), null);
});

test('un importado o un item sin costo pasan a tener ganancia al corregirlos', () => {
  const imp = { tipo: 'imp', refId: null, precio: 300, moneda: 'USD', costo: 0 };
  assert.equal(gan({ items: [imp] }), null);
  assert.equal(gan({ items: [{ ...imp, costo: 240, costoMoneda: 'USD', costoManual: true }] }), 60);
  const sinCosto = { tipo: 'manual', refId: null, precio: 300, moneda: 'USD', costo: null };
  assert.equal(gan({ items: [sinCosto] }), null);
  assert.equal(gan({ items: [{ ...sinCosto, costo: 250, costoMoneda: 'USD', costoManual: true }] }), 50);
});

test('el cobro de una reparación nunca suma ganancia en la venta, ni corregido', () => {
  assert.equal(gan({ items: [{ tipo: 'rep', refId: 'r1', precio: 100, moneda: 'USD', costo: 20, costoManual: true }] }), null);
});

test('las cortesías siguen restando y se mezclan renglones corregidos y automáticos', () => {
  const v = {
    tc: 1400,
    items: [
      { tipo: 'eq', refId: 'e1', precio: 550, moneda: 'USD', costo: 470, costoMoneda: 'USD', costoManual: true },
      { tipo: 'inv', refId: 'f1', precio: 10, moneda: 'USD', costo: 4, qty: 2 },
    ],
    cortesias: [{ costoUSD: 5 }],
  };
  assert.equal(gan(v), 80 + 12 - 5);
});

test('un ingreso manual, sin items, usa la ganancia guardada', () => {
  assert.equal(gan({ gananciaUSD: 35 }), 35);
  assert.equal(gan({ gananciaARS: 140000, tc: 1400 }), 100);
  assert.equal(gan({ totalUSD: 10 }), null);
});

test('costoVigente: lo que se muestra al editar la factura', () => {
  assert.deepEqual(costoVigente({ tipo: 'eq', refId: 'e1', costo: 500 }, '2026-01-01', costos), { costo: 550, moneda: 'USD' });
  assert.deepEqual(costoVigente({ tipo: 'eq', refId: 'e1', costo: 470, costoMoneda: 'USD', costoManual: true }, '', costos), { costo: 470, moneda: 'USD' });
  // producto borrado: queda el costo congelado en la venta
  assert.deepEqual(costoVigente({ tipo: 'eq', refId: 'no-esta', costo: 500, moneda: 'USD' }, '', costos), { costo: 500, moneda: 'USD' });
  assert.equal(costoVigente({ tipo: 'manual', costo: null }, '', costos), null);
  assert.equal(costoVigente({ tipo: 'imp', costo: 0 }, '', costos), null);
  assert.equal(costoVigente({ tipo: 'rep', costo: 0 }, '', costos), null);
});

test('escribir la ganancia despeja el costo, y vuelve a dar esa ganancia', () => {
  const it = { precio: 550, moneda: 'USD', qty: 1 };
  assert.equal(costoParaGanancia(it, 80, 'USD', 1400), 470);
  assert.equal(gananciaRenglon({ ...it, costo: 470, costoMoneda: 'USD' }, 'USD', 1400), 80);
  // con cantidad: la ganancia es del renglón entero y el costo es por unidad
  const dos = { precio: 10, moneda: 'USD', qty: 2 };
  assert.equal(costoParaGanancia(dos, 12, 'USD', null), 4);
  assert.equal(gananciaRenglon({ ...dos, costo: 4, costoMoneda: 'USD' }, 'USD', null), 12);
  // precio en pesos, costo en dólares
  assert.equal(costoParaGanancia({ precio: 840000, moneda: 'ARS', qty: 1 }, 100, 'USD', 1400), 500);
  // una ganancia mayor al precio no deja el costo negativo
  assert.equal(costoParaGanancia(it, 900, 'USD', 1400), 0);
  // sin TC no se puede cruzar de moneda
  assert.equal(costoParaGanancia({ precio: 840000, moneda: 'ARS' }, 100, 'USD', null), null);
  assert.equal(gananciaRenglon({ precio: 840000, moneda: 'ARS', costo: 500, costoMoneda: 'USD' }, 'USD', null), null);
});
