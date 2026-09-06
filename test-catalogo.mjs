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

// Lo que decidió la IA manda sobre el nombre, y el frente va primero.
const clas = {
  'IMG_1.jpg': { clave: 'iphone-13-red', vista: 'dorso' },
  'IMG_2.jpg': { clave: 'iphone-13-red', vista: 'frente' },
  'IMG_3.jpg': { clave: null, vista: 'otro' },          // mirada y sin producto: no entra
};
assert.deepEqual(
  armarMapaFotos(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'iphone-13-red-2.jpg'], clas),
  { 'iphone-13-red': ['IMG_2.jpg', 'iphone-13-red-2.jpg', 'IMG_1.jpg'] },   // frente, sin dato, dorso
);

// Una foto con nombre "bueno" que la IA reasignó, va donde dijo la IA.
assert.deepEqual(
  armarMapaFotos(['iphone-13-blue.jpg'], { 'iphone-13-blue.jpg': { clave: 'iphone-13-red', vista: 'frente' } }),
  { 'iphone-13-red': ['iphone-13-blue.jpg'] },
);

console.log('Todo verde');
