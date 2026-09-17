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

// Cómo están cargados de verdad los productos del local: categoría "Vidrios", "IPH" por
// iPhone, "5D" por el tipo de vidrio y varios modelos separados por barras.
const local = [
  { id: 'cargador', nombre: '20W Power Adapter', categoria: 'Cargadores', qty: 35, costo: 20 },
  { id: 'belkin', nombre: 'Belkin Charging Cable USB-C To USB-C', categoria: 'Fundas', qty: 9, costo: 4.2 },
  { id: 'v11pm', nombre: 'FILM DISPLAY 5D IPH 11 PRO MAX NEGRO', categoria: 'Vidrios', qty: 8, costo: 0.4 },
  { id: 'vmulti', nombre: 'FILM DISPLAY 5D IPH 13/14/13PRO/16E NEGRO', categoria: 'Vidrios', qty: 15, costo: 0.4 },
  { id: 'v14pro', nombre: 'FILM DISPLAY 5D IPH 14 PRO NEGRO', categoria: 'Vidrios', qty: 3, costo: 0.4 },
  { id: 'v15pm', nombre: 'FILM DISPLAY 5D IPH 15 PRO MAX NEGRO', categoria: 'Vidrios', qty: 4, costo: 0.4 },
  { id: 'v15pro', nombre: 'FILM DISPLAY 5D IPH 15 PRO NEGRO', categoria: 'Vidrios', qty: 22, costo: 0.4 },
  { id: 'v16', nombre: 'FILM DISPLAY 5D IPH 16 NEGRO', categoria: 'Vidrios', qty: 43, costo: 0.4 },
  { id: 'v16pro', nombre: 'FILM DISPLAY 5D IPH 16 PRO NEGRO', categoria: 'Vidrios', qty: 10, costo: 0.4 },
  { id: 'v17pm', nombre: 'FILM DISPLAY 5D IPH 17 PRO MAX NEGRO', categoria: 'Vidrios', qty: 2, costo: 0.4 },
  { id: 'apple16', nombre: 'Genuine Apple Clear Case with MagSafe for iPhone 16 - Open-Box', categoria: 'Fundas', qty: 6, costo: 12 },
  { id: 'cablec', nombre: 'Genuine Apple USB-C to C Cable', categoria: 'Cables', qty: 9, costo: 10 },
  { id: 'cablel', nombre: 'Genuine Apple USB-C to Lightning Cables', categoria: 'Cables', qty: 25, costo: 5.6 },
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
  assert.equal(buscarCortesiaEnInventario('funda', 'Galaxy S23', inv)?.id, 'fs23');
});

test('sin artículo claro no se descuenta nada', () => {
  assert.equal(buscarCortesiaEnInventario('vidrio', 'iPhone 14', inv), null);
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 15 Pro', inv), null);
  assert.equal(buscarCortesiaEnInventario('vidrio', '', inv), null);
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 13', inv), null); // la genérica no vale para nadie
  assert.equal(buscarCortesiaEnInventario('otra', 'iPhone 15', inv), null);
  assert.equal(buscarCortesiaEnInventario('vidrio', 'Macbook Air M4', local), null);
});

test('reconoce los nombres reales del local: categoría, IPH, 5D y varios modelos con barras', () => {
  const v = eq => buscarCortesiaEnInventario('vidrio', eq, local)?.id ?? null;
  assert.equal(v('iPhone 14 Pro 128GB Negro'), 'v14pro');
  assert.equal(v('iPhone 15 Pro Max'), 'v15pm');
  assert.equal(v('iPhone 15 Pro Sierra Blue'), 'v15pro');
  assert.equal(v('iPhone 16 128GB Pink'), 'v16');
  assert.equal(v('iPhone 16 Pro'), 'v16pro');
  assert.equal(v('iPhone 17 Pro Max'), 'v17pm');
  assert.equal(v('iPhone 11 Pro Max 64GB'), 'v11pm');
  // el film compartido sirve para el 13, el 14, el 13 Pro y el 16e, y para nadie más
  assert.equal(v('iPhone 13'), 'vmulti');
  assert.equal(v('iPhone 14'), 'vmulti');
  assert.equal(v('iPhone 13 Pro'), 'vmulti');
  assert.equal(v('iPhone 16e'), 'vmulti');
  assert.equal(v('iPhone 13 Pro Max'), null);
  assert.equal(v('iPhone 15'), null);
  assert.equal(v('iPhone 11'), null);
  assert.equal(v('iPhone 17'), null);
  // los cables y cargadores nunca son cortesía, aunque el "Belkin" esté en la categoría Fundas
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 15 Pro', local), null);
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 16', local)?.id, 'apple16');
});

test('entre varios candidatos gana el que tiene stock, después el que dice cortesía, después el más barato', () => {
  const fundas16 = [
    ...local,
    { id: 'barata', nombre: 'Funda silicona iPhone 16', categoria: 'Fundas', qty: 30, costo: 1.5 },
    { id: 'sinstock', nombre: 'Funda cortesía iPhone 16', categoria: 'Fundas', qty: 0, costo: 1 },
  ];
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 16', fundas16)?.id, 'barata');
  fundas16.push({ id: 'cort', nombre: 'Funda cortesía iPhone 16 transparente', categoria: 'Fundas', qty: 5, costo: 1 });
  assert.equal(buscarCortesiaEnInventario('funda', 'iPhone 16', fundas16)?.id, 'cort');
  // el vidrio de dureza 9H o curva 2.5D no cambia el modelo
  assert.equal(buscarCortesiaEnInventario('vidrio', 'Samsung A54 5G', [{ id: 'x', nombre: 'Vidrio 9H 2.5D Sam A54' }])?.id, 'x');
});

test('el delta entre cortesías descuenta las nuevas y devuelve las quitadas', () => {
  const antes = [{ nombre: 'Vidrio templado', refId: 'v15' }, { nombre: 'Funda silicone case' }];
  const despues = [{ nombre: 'Funda silicone case', refId: 'f15' }];
  assert.deepEqual([...deltaCortesias(antes, despues)], [['v15', -1], ['f15', 1]]);
  assert.equal(deltaCortesias([], []).size, 0);
});
