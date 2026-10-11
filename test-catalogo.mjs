/**
 * Chequeo sin red de la lógica compartida del catálogo: fotos y categorías.
 *
 *   node test-catalogo.mjs
 *
 * Importa funciones puras, sin arrancar Firebase ni depender del formato del HTML.
 */
import { armarMapaFotos, categoriaDe, slugFoto, rubroDe, CATEGORIAS_CATALOGO, RUBROS_CATALOGO } from './src/shared/catalogo.js';
import assert from 'node:assert/strict';


// Sin decisiones: la clave sale del nombre, y el sufijo -2 solo si existe el base.
assert.deepEqual(
  armarMapaFotos(['iphone-15-black.jpg', 'iphone-15-black-2.jpg', 'galaxy-s23-2.jpg'], {}),
  { 'iphone-15-black': ['iphone-15-black.jpg', 'iphone-15-black-2.jpg'], 'galaxy-s23-2': ['galaxy-s23-2.jpg'] },
);

// Lo que decidió la IA manda sobre el nombre. Orden: frente y dorso juntos, frente, sin dato, el resto.
const clas = {
  'IMG_1.jpg': { clave: 'iphone-13-red', vista: 'dorso' },
  'IMG_2.jpg': { clave: 'iphone-13-red', vista: 'frente' },
  'IMG_3.jpg': { clave: null, vista: 'otro' },          // mirada y sin producto: no entra
  'IMG_4.jpg': { clave: 'iphone-13-red', vista: 'ambos' },
};
assert.deepEqual(
  armarMapaFotos(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'IMG_4.jpg', 'iphone-13-red-2.jpg'], clas),
  { 'iphone-13-red': ['IMG_4.jpg', 'IMG_2.jpg', 'iphone-13-red-2.jpg', 'IMG_1.jpg'] },
);

// Una foto con nombre "bueno" que la IA reasignó, va donde dijo la IA.
assert.deepEqual(
  armarMapaFotos(['iphone-13-blue.jpg'], { 'iphone-13-blue.jpg': { clave: 'iphone-13-red', vista: 'frente' } }),
  { 'iphone-13-red': ['iphone-13-blue.jpg'] },
);

// ── categoriaDe ──
const casos = [
  [{ nombre: 'iPhone 15 128GB Black', estado: '9/10', bateria: 87 }, 'iPhone usados'],
  [{ nombre: 'iPhone 16 Pro Max 256GB White', estado: 'Nuevo' }, 'iPhone nuevos'],
  [{ nombre: 'iPhone 13 512 Red', estado: '', bateria: 100 }, 'iPhone usados'],
  [{ nombre: 'iPhone 17 Pro', estado: '' }, 'iPhone nuevos'],
  [{ nombre: 'Genuine Apple Clear Case with MagSafe for iPhone 16' }, 'Accesorios iPhone'],
  [{ nombre: 'Genuine Apple USB-C to Lightning Cables' }, 'Accesorios de carga'],
  [{ nombre: 'Apple Pencil Pro' }, 'Accesorios iPad'],
  [{ nombre: 'iPad Air M2 128GB' }, 'iPad nuevos'],
  [{ nombre: 'MacBook Air M3 13' }, 'MacBook nuevas'],
  [{ nombre: 'Apple Watch Series 10 45mm' }, 'Apple Watch nuevos'],
  [{ nombre: 'AirPods Max (USB-C) Black' }, 'AirPods'],
  [{ nombre: 'Samsung Galaxy S24 Ultra' }, 'Celulares Samsung'],
  [{ nombre: 'Xiaomi Redmi Note 13' }, 'Celulares Xiaomi'],
  [{ nombre: 'Lenovo IdeaPad 3' }, 'Notebooks'],
  [{ nombre: 'AirTag pack x4' }, 'Accesorios Apple'],
  // Los rubros nuevos: audio, más marcas de celulares, electrodomésticos.
  [{ nombre: 'Parlante JBL Go' }, 'Parlantes'],
  [{ nombre: 'Auriculares Sony WH-1000XM5' }, 'Auriculares'],
  [{ nombre: 'Samsung Galaxy Buds 3' }, 'Auriculares'],
  [{ nombre: 'Galaxy Watch 7 44mm' }, 'Otros smartwatch'],
  [{ nombre: 'Motorola Moto G85 256GB' }, 'Celulares Motorola'],
  [{ nombre: 'Celular Tecno Spark 20' }, 'Otros celulares'],
  [{ nombre: 'Samsung Galaxy Tab S9' }, 'Tablets'],
  [{ nombre: 'Smart TV Samsung 50" 4K' }, 'Smart TV'],
  [{ nombre: 'Heladera Gafa No Frost 364L' }, 'Heladeras y freezers'],
  [{ nombre: 'Lavarropas Drean Next 8.14' }, 'Lavarropas'],
  [{ nombre: 'Aire Acondicionado Split Midea 3000W frío calor' }, 'Climatización'],
  [{ nombre: 'Microondas BGH 28L' }, 'Cocina'],
  [{ nombre: 'Freidora de aire Philips 4L' }, 'Pequeños electrodomésticos'],
  [{ nombre: 'Funda Galaxy S24 silicona' }, 'Fundas y protectores'],
  [{ nombre: 'Cargador Samsung 25W' }, 'Accesorios de carga'],
  [{ nombre: 'Soporte de auto magnético' }, 'Otros'],
];
for (const [p, esperado] of casos) assert.equal(categoriaDe(p), esperado, `${p.nombre} → ${esperado}`);

// ── rubroDe: toda categoría fija tiene rubro, y las creadas a mano caen en el que sugiere el nombre ──
for (const c of CATEGORIAS_CATALOGO) assert.ok(RUBROS_CATALOGO[rubroDe(c)].includes(c), `${c} está en su rubro`);
assert.equal(new Set(CATEGORIAS_CATALOGO).size, CATEGORIAS_CATALOGO.length, 'sin categorías repetidas entre rubros');
for (const [c, esperado] of [
  ['Fundas Samsung', 'Accesorios'], ['Parlantes Bluetooth', 'Audio'], ['Galaxy Watch', 'Smartwatch'],
  ['Aires acondicionados', 'Electrodomésticos'], ['Tablets Samsung', 'Notebooks y tablets'],
  ['Celulares Motorola', 'Celulares'], ['Gaming', 'Otros'],
]) assert.equal(rubroDe(c), esperado, `${c} → ${esperado}`);

// ── slugFoto: el estado entre paréntesis no es parte del modelo ──
assert.equal(slugFoto('iPhone 13 (Usado Grado A, 100% Ampsentrix)'), 'iphone-13');
assert.equal(slugFoto('iPhone 14 Pro (Usado Grado A, 87-89%)'), 'iphone-14-pro');
assert.equal(slugFoto('iPhone 15 128GB'), 'iphone-15');
assert.equal(slugFoto('Apple Watch Ultra 2 49mm'), 'apple-watch-ultra-2-49mm');

console.log('Todo verde');
