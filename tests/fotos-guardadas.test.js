import test from 'node:test';
import assert from 'node:assert/strict';
import { parecidoDeFoto, fotosGuardadasPara, buscarEntreGuardadas, indiceDeFotos, fotosCompartidas, prestarFotos } from '../src/shared/fotos-guardadas.js';

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

test('dos artículos que se ven igual comparten la foto: con SIM o sin, con Ñ o sin, con cancelación o sin', () => {
  // Lo que pidió Juni: son productos distintos (y precios distintos), pero la foto es la misma.
  for (const [producto, clave] of [
    [{ nombre: 'iPhone 18 Pro Max con SIM', color: 'Glacier' }, 'iphone-18-pro-max-glacier'],
    [{ nombre: 'iPhone 18 Pro Max', color: 'Glacier' }, 'iphone-18-pro-max-con-sim-glacier'],
    [{ nombre: 'MacBook Air M5 13" con Ñ', color: 'Midnight' }, 'macbook-air-m5-13-midnight'],
    [{ nombre: 'MacBook Air M5 13" Teclado Español', color: 'Midnight' }, 'macbook-air-m5-13-midnight'],
    [{ nombre: 'MacBook Air M5 13"', color: 'Midnight' }, 'macbook-air-m5-13-teclado-ingles-midnight'],
    [{ nombre: 'Apple AirPods 4 (Noise Cancelling)', color: '' }, 'airpods-4'],
    [{ nombre: 'AirPods 4', color: '' }, 'airpods-4-con-cancelacion-de-ruido'],
    [{ nombre: 'iPad A16 11" + CELL', color: 'Silver' }, 'ipad-a16-11-silver'],
    [{ nombre: 'Apple Watch SE 3 40mm GPS + Cellular', color: 'Starlight' }, 'apple-watch-se-3-40mm-starlight'],
    [{ nombre: 'Watch Ultra 4 49mm - MJAY4', color: 'Black' }, 'apple-watch-ultra-4-49mm-black'],
  ]) assert.equal(parecidoDeFoto(producto, clave), 'igual', `${producto.nombre} ↔ ${clave}`);
  // Lo que sí cambia cómo se ve sigue separando: otro modelo, otro tamaño, otro color.
  assert.equal(parecidoDeFoto({ nombre: 'iPhone 18 Pro con SIM', color: 'Glacier' }, 'iphone-18-pro-max-glacier'), '');
  assert.equal(parecidoDeFoto({ nombre: 'AirPods Pro 3', color: '' }, 'airpods-4'), '');
  assert.equal(parecidoDeFoto({ nombre: 'MacBook Air M5 15" con Ñ', color: 'Midnight' }, 'macbook-air-m5-13-midnight'), '');
  assert.equal(parecidoDeFoto({ nombre: 'iPhone 18 Pro Max con SIM', color: 'Burgundy' }, 'iphone-18-pro-max-glacier'), 'modelo');
});

test('un producto sin fotos propias usa las del que se ve igual, nunca las de otro color', () => {
  const mapa = {
    'iphone-18-pro-max-glacier': ['a.jpg', 'a-2.jpg'], 'iphone-18-pro-max-black': ['b.jpg'],
    'apple-iphone-18-pro-max-glacier': ['c.jpg'], 'airpods-4': ['d.jpg'], 'vacia': [],
  };
  const indice = indiceDeFotos(mapa);
  // Entre dos claves que se ven igual, la que más fotos tiene.
  assert.deepEqual(fotosCompartidas({ nombre: 'iPhone 18 Pro Max con SIM', color: 'Glacier' }, 'iphone-18-pro-max-con-sim-glacier', indice), { clave: 'iphone-18-pro-max-glacier', archivos: ['a.jpg', 'a-2.jpg'] });
  assert.deepEqual(fotosCompartidas({ nombre: 'Apple AirPods 4 (Noise Cancelling)', color: '' }, 'apple-airpods-4', indice), { clave: 'airpods-4', archivos: ['d.jpg'] });
  // Otro color, o sin color cuando el producto tiene uno: nada.
  assert.equal(fotosCompartidas({ nombre: 'iPhone 18 Pro Max con SIM', color: 'Burgundy' }, 'x', indice), null);
  assert.equal(fotosCompartidas({ nombre: 'AirPods 4', color: 'Black' }, 'airpods-4-black', indice), null);
  // Su propia clave no cuenta como "otro".
  assert.equal(fotosCompartidas({ nombre: 'AirPods 4', color: '' }, 'airpods-4', indice), null);
  assert.equal(fotosCompartidas({ nombre: 'x' }, 'x', new Map()), null);
  assert.equal(indiceDeFotos(null).size, 0);
});

test('en lo publicado, el que no tiene foto toma las del que se ve igual', () => {
  const productos = [
    { id: 'a', nombre: 'iPhone 18 Pro Max', color: 'Glacier', fotos: [] },
    { id: 'b', nombre: 'iPhone 18 Pro Max con SIM', color: 'Glacier', fotos: ['glacier.jpg', 'glacier-2.jpg'], fotoCaja: [1, 2, 3, 4, 1] },
    { id: 'c', nombre: 'iPhone 18 Pro Max con SIM', color: 'Burgundy', fotos: [] },
    { id: 'd', nombre: 'iPhone 18 Pro Max', color: 'Burgundy', fotos: ['burgundy.jpg'] },
    { id: 'e', nombre: 'iPhone 18 Pro', color: 'Glacier' },
  ];
  assert.equal(prestarFotos(productos), 2);
  assert.deepEqual(productos.map(p => (p.fotos || []).join(',')), ['glacier.jpg,glacier-2.jpg', 'glacier.jpg,glacier-2.jpg', 'burgundy.jpg', 'burgundy.jpg', '']);
  assert.deepEqual(productos[0].fotoCaja, [1, 2, 3, 4, 1], 'con el recuadro de su miniatura');
  assert.equal(prestarFotos(null), 0);
});
