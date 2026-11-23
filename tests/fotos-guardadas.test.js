import test from 'node:test';
import assert from 'node:assert/strict';
import { parecidoDeFoto, fotosGuardadasPara, buscarEntreGuardadas } from '../src/shared/fotos-guardadas.js';

test('una foto guardada es del producto si es su mismo modelo y color, esté escrita como esté', () => {
  const rosa = { nombre: 'iPhone 16 (SIM + eSIM)', color: 'Pink' };
  // El mismo equipo cargado antes con otro nombre: castellano, con "Apple", con la aclaración de SIM.
  for (const clave of ['iphone-16-pink', 'iphone-16-rosa', 'apple-iphone-16-pink', 'iphone-16-pink-sim-esim']) assert.equal(parecidoDeFoto(rosa, clave), 'igual', clave);
  // El mismo modelo en otro color, o sin decir el color: sirve, pero no se marca sola.
  for (const clave of ['iphone-16-black', 'iphone-16']) assert.equal(parecidoDeFoto(rosa, clave), 'modelo', clave);
  // Otro modelo, aunque se parezca.
  for (const clave of ['iphone-16-pro-pink', 'iphone-16e-pink', 'iphone-15-pink', 'IMG_1234', '']) assert.equal(parecidoDeFoto(rosa, clave), '', clave);

  // Las pulgadas separan modelos; el orden de las palabras no.
  assert.equal(parecidoDeFoto({ nombre: 'iPad Air M4 11"', color: 'Blue' }, 'ipad-air-11-m4-blue'), 'igual');
  assert.equal(parecidoDeFoto({ nombre: 'iPad Air M4 11"', color: 'Blue' }, 'ipad-air-m4-13-blue'), '');
  assert.equal(parecidoDeFoto({ nombre: "MacBook Air 15'' M5 RAM 512gb", color: 'Silver' }, 'macbook-air-m5-15-silver'), 'igual');
  // La RAM anotada como "12+" puede estar o no en el nombre con que se guardó la foto.
  assert.equal(parecidoDeFoto({ nombre: 'Samsung S26 Ultra 12+', color: 'Sky Blue' }, 'samsung-s26-ultra-sky-blue'), 'igual');
  assert.equal(parecidoDeFoto({ nombre: 'Samsung S26 Ultra 12+', color: 'Sky Blue' }, 'samsung-s26-ultra-12-sky-blue'), 'igual');
  assert.equal(parecidoDeFoto({ nombre: 'Samsung S26 Ultra 12+', color: 'Sky Blue' }, 'samsung-s26-12-sky-blue'), '');
  // Un producto sin color: la foto sin color es la suya; la que nombra uno queda para elegir.
  assert.equal(parecidoDeFoto({ nombre: 'JBL Flip 7', color: '' }, 'jbl-flip-7'), 'igual');
  assert.equal(parecidoDeFoto({ nombre: 'JBL Flip 7', color: '' }, 'jbl-flip-7-black'), 'modelo');
  assert.equal(parecidoDeFoto(null, 'iphone-16'), '');
});

test('las guardadas se ordenan para el producto: las suyas, las del modelo y después el resto', () => {
  const mapa = {
    'iphone-16-pink': ['iphone-16-pink.jpg'],                         // ya es del producto: no se ofrece
    'iphone-16-rosa': ['iphone-16-rosa.jpg', 'iphone-16-rosa-2.jpg'],
    'iphone-16-black': ['iphone-16-black.jpg'],
    'jbl-flip-7': ['jbl-flip-7.jpg'],
    'iphone-15-pink': ['iphone-15-pink.jpg'],
  };
  const lista = fotosGuardadasPara({ nombre: 'iPhone 16', color: 'Pink' }, 'iphone-16-pink', mapa, ['IMG_9.jpg', 'iphone-16-pink-3.jpg']);
  assert.deepEqual(lista.map(x => [x.archivo, x.clave, x.parecido]), [
    ['iphone-16-pink-3.jpg', '', 'igual'],                             // sin producto, pero el nombre del archivo lo dice
    ['iphone-16-rosa-2.jpg', 'iphone-16-rosa', 'igual'],
    ['iphone-16-rosa.jpg', 'iphone-16-rosa', 'igual'],
    ['iphone-16-black.jpg', 'iphone-16-black', 'modelo'],
    ['IMG_9.jpg', '', ''],
    ['iphone-15-pink.jpg', 'iphone-15-pink', ''],
    ['jbl-flip-7.jpg', 'jbl-flip-7', ''],
  ]);
  assert.deepEqual(buscarEntreGuardadas(lista, 'JBL flip').map(x => x.archivo), ['jbl-flip-7.jpg']);
  assert.deepEqual(buscarEntreGuardadas(lista, 'pink 15').map(x => x.archivo), ['iphone-15-pink.jpg']);
  assert.equal(buscarEntreGuardadas(lista, '  ').length, lista.length);
  assert.deepEqual(buscarEntreGuardadas(lista, 'no existe'), []);
  assert.deepEqual(fotosGuardadasPara({ nombre: 'x' }, 'x', null), []);
});
