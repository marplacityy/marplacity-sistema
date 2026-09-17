import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarCortesiaEnInventario, deltaCortesias } from '../src/shared/cortesias.js';

const inv = [
  { id: 'v15', nombre: 'Vidrio templado iPhone 15', qty: 4 },
  { id: 'v15pro', nombre: 'Templado iPhone 15 Pro', qty: 9 },
  { id: 'v15pm', nombre: 'Vidrio Templado iPhone 15 Pro Max', qty: 0 },
  { id: 'f15', nombre: 'Funda silicone iPhone 15', qty: 2 },
  { id: 'fa54', nombre: 'Funda Samsung A54', qty: 1 },
  { id: 'cable', nombre: 'Cable USB-C', qty: 10 },
  { id: 'fgen', nombre: 'Funda genérica transparente', qty: 7 },
  { id: 'fs23', nombre: 'Funda silicona Galaxy S23 negra', qty: 3 },
];

test('el vidrio del equipo es el del modelo exacto, no el de una variante', () => {
  assert.equal(buscarCortesiaEnInventario('vidrio', 'iPhone 15', inv)?.id, 'v15');
  assert.equal(buscarCortesiaEnInventario('vidrio', 'iPhone 15 Pro', inv)?.id, 'v15pro');
  assert.equal(buscarCortesiaEnInventario('vidrio', 'iPhone 15 Pro Max 256GB', inv)?.id, 'v15pm');
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 15', inv)?.id, 'f15');
  assert.equal(buscarCortesiaEnInventario('funda', 'Samsung A54', inv)?.id, 'fa54');
  // el equipo trae capacidad y color; el artículo trae descriptores y color: se ignoran
  assert.equal(buscarCortesiaEnInventario('vidrio', 'iPhone 15 128GB Negro', inv)?.id, 'v15');
  assert.equal(buscarCortesiaEnInventario('funda', 'Samsung Galaxy S23 256GB Verde', inv)?.id, 'fs23');
});

test('sin artículo claro no se descuenta nada', () => {
  assert.equal(buscarCortesiaEnInventario('vidrio', 'iPhone 14', inv), null);
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 15 Pro', inv), null);
  assert.equal(buscarCortesiaEnInventario('vidrio', '', inv), null);
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 13', inv), null); // la genérica no vale para nadie
  assert.equal(buscarCortesiaEnInventario('otra', 'iPhone 15', inv), null);
});

test('el delta entre cortesías descuenta las nuevas y devuelve las quitadas', () => {
  const antes = [{ nombre: 'Vidrio templado', refId: 'v15' }, { nombre: 'Funda silicone case' }];
  const despues = [{ nombre: 'Funda silicone case', refId: 'f15' }];
  assert.deepEqual([...deltaCortesias(antes, despues)], [['v15', -1], ['f15', 1]]);
  assert.equal(deltaCortesias([], []).size, 0);
});
