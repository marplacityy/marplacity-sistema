import test from 'node:test';
import assert from 'node:assert/strict';
import { agruparModelos, modeloDe, nombreDeModelo } from '../src/shared/modelos-tienda.js';

let n = 0;
const P = (nombre, gb, color, precioUSD, extra = {}) => ({ id: `lista_${++n}`, tipo: 'pedido', condicion: 'nuevo', categoria: 'iPhone nuevos', nombre, gb, color, precioUSD, ...extra });
/** Las tarjetas que quedan: el nombre del modelo y sus variantes visibles, "capacidad color precio". */
function tarjetas(productos) {
  const r = agruparModelos(productos);
  const out = {};
  for (const p of productos) {
    if (r.repetidos.has(p.id)) continue;
    const k = r.grupoDe.get(p.id);
    const nombre = k ? r.nombres.get(k) + (k.endsWith('|0') ? '' : ' #' + k.split('|').pop()) : '(suelto) ' + p.nombre;
    (out[nombre] ||= []).push([r.capacidad.get(p.id) || p.gb, p.color, p.precioUSD].filter(Boolean).join(' '));
  }
  return out;
}

test('el modelo de un producto no depende de cómo lo escriba el proveedor', () => {
  assert.deepEqual(modeloDe({ nombre: 'iPhone 17 (SIM + eSIM)', gb: '256GB', color: 'Mist Blue' }), { clave: '17 iphone', pulgadas: '', ram: '', capacidad: '256GB', color: 'blue mist' });
  assert.equal(modeloDe({ nombre: 'iPhone 17', gb: '256gb', color: 'Lavander' }).color, 'lavender');
  // La RAM cargada en el campo de la capacidad y el disco en el nombre: la capacidad es la más grande.
  assert.deepEqual(modeloDe({ nombre: "MacBook Air 15'' M5 RAM 512gb", gb: '16GB', color: 'Silver' }), { clave: 'air m5 macbook', pulgadas: '15in', ram: '16GB', capacidad: '512GB', color: 'silver' });
  assert.deepEqual(modeloDe({ nombre: 'MacBook Air M5 15" 16GB', gb: '512GB', color: 'Midnight' }), { clave: 'air m5 macbook', pulgadas: '15in', ram: '16GB', capacidad: '512GB', color: 'midnight' });
  assert.equal(modeloDe({ nombre: 'MacBook Neo 13" 8/256GB', gb: '', color: 'Indigo' }).capacidad, '256GB');
  // "11" suelto es el tamaño en un iPad y el modelo en un iPhone.
  assert.deepEqual([modeloDe({ nombre: 'iPad 11 (A16)' }).clave, modeloDe({ nombre: 'iPad 11 (A16)' }).pulgadas], ['a16 ipad', '11in']);
  assert.deepEqual([modeloDe({ nombre: 'iPhone 11' }).clave, modeloDe({ nombre: 'iPhone 11' }).pulgadas], ['11 iphone', '']);

  assert.equal(nombreDeModelo("MacBook Air 15'' M5 RAM 512gb"), 'MacBook Air 15" M5');
  assert.equal(nombreDeModelo('MacBook Neo 13" 8/256GB'), 'MacBook Neo 13"');
  assert.equal(nombreDeModelo('Samsung S26 Ultra 12+'), 'Samsung S26 Ultra');
  assert.equal(nombreDeModelo('iPhone 17 (SIM + eSIM)'), 'iPhone 17 (SIM + eSIM)', 'la aclaración queda si es lo que lo distingue');
  assert.equal(nombreDeModelo('iPhone 17 (SIM + eSIM)', { sinChip: true }), 'iPhone 17');
  assert.equal(nombreDeModelo('iPhone 18 Pro Max con SIM', { sinChip: true }), 'iPhone 18 Pro Max');
});

test('con precio parecido es el mismo producto; si uno es mucho más caro, va aparte', () => {
  const productos = [
    // Dos proveedores, el mismo iPhone 17: una sola tarjeta, y cada color una vez (el más barato).
    P('iPhone 17', '256GB', 'Black', 1035), P('iPhone 17', '256GB', 'Blue', 1035), P('iPhone 17', '256GB', 'Lavander', 1040),
    P('iPhone 17 (SIM + eSIM)', '256GB', 'Black', 1020), P('iPhone 17 (SIM + eSIM)', '256GB', 'Lavender', 1020), P('iPhone 17 (SIM + eSIM)', '256GB', 'Sage', 1020),
    // El "con SIM" sale 250 dólares más: es otro producto.
    P('iPhone 18 Pro Max', '256GB', 'Glacier', 1505), P('iPhone 18 Pro Max', '512GB', 'Glacier', 1720),
    P('iPhone 18 Pro Max con SIM', '256GB', 'Glacier', 1765), P('iPhone 18 Pro Max con SIM', '256GB', 'Burgundy', 1765),
    // Un usado es una unidad única: nunca se agrupa ni sobra.
    P('iPhone 17', '256GB', 'Black', 900, { condicion: 'usado', id: 'stock_usado' }),
  ];
  assert.deepEqual(tarjetas(productos), {
    'iPhone 17': ['256GB Blue 1035', '256GB Black 1020', '256GB Lavender 1020', '256GB Sage 1020'],
    'iPhone 18 Pro Max': ['256GB Glacier 1505', '512GB Glacier 1720'],
    'iPhone 18 Pro Max con SIM #1': ['256GB Glacier 1765', '256GB Burgundy 1765'],
    '(suelto) iPhone 17': ['256GB Black 900'],
  });
  const r = agruparModelos(productos);
  assert.equal(r.grupoDe.has('stock_usado'), false);
  assert.equal(r.repetidos.size, 2);
  // El que sobra apunta al que queda: un link viejo abre ese.
  assert.equal(productos.find(p => p.id === r.repetidos.get(productos[0].id)).precioUSD, 1020);
});

test('entre dos ofertas de la misma variante queda la que está en el local, y si no la más barata', () => {
  const productos = [
    P('iPhone 16', '128GB', 'Black', 875, { tipo: 'equipo' }),         // de lista, pero ya está en el local
    P('iPhone 16 (SIM + eSIM)', '128GB', 'Black', 855),
    P('iPhone 16', '128GB', 'Pink', 885), P('iPhone 16 (SIM + eSIM)', '128GB', 'Pink', 855),
    // Lo que viene del stock no sobra ni hace sobrar: es una unidad que está ahí.
    P('iPhone 16', '128GB', 'Pink', 870, { id: 'stock_1', tipo: 'equipo' }),
  ];
  assert.deepEqual(tarjetas(productos), { 'iPhone 16': ['128GB Black 875', '128GB Pink 855', '128GB Pink 870'] });
});

test('las pulgadas y la RAM separan modelos, salvo que haya una sola posible', () => {
  const ipad = (nombre, gb, color, precio) => P(nombre, gb, color, precio, { categoria: 'iPad nuevos' });
  assert.deepEqual(tarjetas([
    ipad('iPad Air M4 11"', '128GB', 'Blue', 830), ipad("iPad Air 11'' M4", '256GB', 'Blue', 980),
    ipad('iPad Air M4 13"', '128GB', 'Blue', 1040),
    // El A16 viene en un solo tamaño: el que no lo aclara es el mismo.
    ipad('iPad A16 11"', '128GB', 'Silver', 550), ipad('iPad 11 (A16)', '128GB', 'Blue', 550), ipad('iPad A16', '256GB', 'Pink', 675),
  ]), {
    'iPad Air M4 11"': ['128GB Blue 830', '256GB Blue 980'],
    'iPad Air M4 13"': ['128GB Blue 1040'],
    'iPad A16': ['128GB Silver 550', '128GB Blue 550', '256GB Pink 675'],
  });
  const mac = (nombre, gb, color, precio) => P(nombre, gb, color, precio, { categoria: 'MacBook nuevas' });
  assert.deepEqual(tarjetas([
    mac("MacBook Air 15'' M5 RAM 512gb", '16GB', 'Silver', 1610), mac('MacBook Air M5 15" 16GB', '512GB', 'Midnight', 1640),
    mac("MacBook Neo 13'' RAM 256gb", '8GB', 'Citrus', 905), mac('MacBook Neo 13" 8/256GB', '256GB', 'Indigo', 910), mac("MacBook Neo 13'' RAM 512gb", '8GB', 'Citrus', 1005),
  ]), {
    'MacBook Air 15" M5': ['512GB Silver 1610', '512GB Midnight 1640'],
    'MacBook Neo 13"': ['256GB Citrus 905', '256GB Indigo 910', '512GB Citrus 1005'],
  });
  // La misma categoría importa: el mismo nombre en otra sección es otra tarjeta. Y los accesorios no se agrupan.
  const r = agruparModelos([P('Apple Pencil Pro', '', '', 160, { tipo: 'accesorio' }), P('iPhone 17', '256GB', 'Black', 1035), P('iPhone 17', '256GB', 'Black', 1035, { categoria: 'Otros' })]);
  assert.equal(r.grupoDe.size, 2);
  assert.notEqual([...r.grupoDe.values()][0], [...r.grupoDe.values()][1]);
  assert.deepEqual(agruparModelos(null), { grupoDe: new Map(), nombres: new Map(), capacidad: new Map(), repetidos: new Map() });
});

test('los relojes de un modelo van en una tarjeta: el tamaño de la caja se elige como la capacidad', () => {
  assert.deepEqual(modeloDe({ nombre: 'Apple Watch Series 12', gb: '46mm', color: 'Dark Bronze - Olive Sport Band' }),
    { clave: '12 series watch', pulgadas: '', ram: '', capacidad: '46mm', color: 'band bronze dark olive sport' });
  const reloj = (nombre, gb, color, precio) => P(nombre, gb, color, precio, { categoria: 'Apple Watch nuevos' });
  assert.deepEqual(tarjetas([
    reloj('Apple Watch Series 12', '42mm', 'Black Sport Band', 485), reloj('Apple Watch Series 12', '46mm', 'Black Sport Band', 545),
    reloj('Apple Watch Series 12', '46mm', 'Dark Bronze - Olive Sport Band', 545),
    reloj('Apple Watch Ultra 4', '49mm', 'Black - Translucent Black Ocean Band', 905),
    // El Cellular es otro producto: tiene su tarjeta.
    reloj('Apple Watch SE 3', '40mm', 'Starlight', 365), reloj('Apple Watch SE 3 + Cellular', '40mm', 'Starlight', 385),
  ]), {
    'Apple Watch Series 12': ['42mm Black Sport Band 485', '46mm Black Sport Band 545', '46mm Dark Bronze - Olive Sport Band 545'],
    'Apple Watch Ultra 4': ['49mm Black - Translucent Black Ocean Band 905'],
    'Apple Watch SE 3': ['40mm Starlight 365'],
    'Apple Watch SE 3 + Cellular': ['40mm Starlight 385'],
  });
});
