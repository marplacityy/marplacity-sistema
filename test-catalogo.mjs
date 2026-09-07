/**
 * Chequeo sin red de la lógica del catálogo que vive en index.html: el mapa de fotos.
 *
 *   node test-catalogo.mjs
 *
 * Saca la función del HTML con una expresión regular en vez de importarla, porque el
 * módulo de index.html arranca Firebase al cargarse.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const src = html.match(/function armarMapaFotos\(archivos, clasificacion\)\{[\s\S]*?\n\}/)[0];
const armarMapaFotos = new Function(src + '; return armarMapaFotos;')();

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
const srcCat = [
  html.match(/const CATEGORIAS_CATALOGO = \[[\s\S]*?\];/)[0],
  html.match(/const esUsado = .*;\n/)[0],
  html.match(/function categoriaDe\(p\)\{[\s\S]*?return 'Otros';\n\}/)[0],
].join('\n');
const categoriaDe = new Function(srcCat + '; return categoriaDe;')();
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
  [{ nombre: 'Parlante JBL Go' }, 'Otros'],
];
for (const [p, esperado] of casos) assert.equal(categoriaDe(p), esperado, `${p.nombre} → ${esperado}`);

// ── slugFoto: el estado entre paréntesis no es parte del modelo ──
const srcSlug = html.match(/const slugFoto = nombre => [\s\S]*?\.trim\(\)\.replace\(\/\\s\+\/g, '-'\);/)[0];
const slugFoto = new Function(srcSlug + '; return slugFoto;')();
assert.equal(slugFoto('iPhone 13 (Usado Grado A, 100% Ampsentrix)'), 'iphone-13');
assert.equal(slugFoto('iPhone 14 Pro (Usado Grado A, 87-89%)'), 'iphone-14-pro');
assert.equal(slugFoto('iPhone 15 128GB'), 'iphone-15');
assert.equal(slugFoto('Apple Watch Ultra 2 49mm'), 'apple-watch-ultra-2-49mm');

console.log('Todo verde');
