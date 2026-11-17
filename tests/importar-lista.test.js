import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsDeListaEcommodo, parseProductsDeterministic } from '../src/shared/lista-ecommodo.js';
import { resultadosDeDuckDuckGo, primerAsin, fotosDePaginaAmazon } from '../server/services/tienda/fotos-ecommodo.js';
import { elegirImagenes, nombreParaAmazon } from '../server/services/tienda/fotos.js';

test('el lector de Ecommodo lee una lista de WhatsApp sin IA', () => {
  const items = itemsDeListaEcommodo(`🍎 IPHONE SELLADOS 🍎
iPhone 16 128gb negro - u$s 850
*USADOS*
- iPhone 13 128gb 87% azul $ 380
AirPods Pro 2 usd 210
Samsung S24 Ultra 256 gb 1.050 USD
Consultar por otros modelos`);
  assert.deepEqual(items, [
    { producto: 'iPhone 16', gb: '128GB', color: 'Negro', precioPublico: 850, condicion: null },
    { producto: 'iPhone 13', gb: '128GB', color: 'Azul', precioPublico: 380, condicion: 'usado' },
    { producto: 'AirPods Pro 2', gb: null, color: null, precioPublico: 210, condicion: null },
    { producto: 'Samsung S24 Ultra', gb: '256GB', color: null, precioPublico: 1050, condicion: null },
  ]);
});

test('en una tabla, lo que sigue a la capacidad es el color', () => {
  assert.deepEqual(itemsDeListaEcommodo('IPHONE 17 PRO MAX\t256GB \tCOSMIC ORANGE\t100%\t1,400USD'),
    [{ producto: 'iPhone 17 Pro Max', gb: '256GB', color: 'Cosmic Orange', precioPublico: 1400, condicion: null }]);
});

test('lo que no es un producto con precio no entra, y nada rompe con basura', () => {
  assert.deepEqual(itemsDeListaEcommodo('Hola! Envíos a todo el país\niPhone 15 128GB'), []);
  assert.deepEqual(itemsDeListaEcommodo(''), []);
  assert.deepEqual(parseProductsDeterministic(undefined), []);
});

test('de DuckDuckGo solo sirven las fotos grandes alojadas en Amazon', () => {
  const r = resultadosDeDuckDuckGo({ results: [
    { image: 'https://m.media-amazon.com/images/I/a.jpg', title: 'Apple iPhone 16 Black', width: 1500, height: 1500 },
    { image: 'https://tienda-x.com/b.jpg', title: 'iPhone 16', width: 1500, height: 1500 },
    { image: 'https://m.media-amazon.com/images/I/c.jpg', title: 'chica', width: 120, height: 120 },
    { image: 'https://m.media-amazon.com/images/I/a.jpg', title: 'repetida', width: 1500, height: 1500 },
  ] });
  assert.deepEqual(r, [{ title: 'Apple iPhone 16 Black', thumbnail: 'https://m.media-amazon.com/images/I/a.jpg' }]);
  assert.deepEqual(resultadosDeDuckDuckGo(null), []);
});

test('de la página de Amazon salen el primer producto, su título y sus fotos grandes', () => {
  assert.equal(primerAsin('<div data-asin="B0ABCDE123" data-index="1" data-component-type="s-search-result">'), 'B0ABCDE123');
  assert.equal(primerAsin('<a href="/dp/B0ZZZZZ999/ref=x">'), 'B0ZZZZZ999');
  assert.equal(primerAsin('<html>robot check</html>'), null);
  const html = '<span id="productTitle" class="a"> Apple iPhone 16, 128GB, Black </span>{"hiRes":"https://m.media-amazon.com/images/I/71aaa._AC_SL1500_.jpg"},{"hiRes":"https://m.media-amazon.com/images/I/71aaa._AC_SL1000_.jpg"},{"hiRes":"https://m.media-amazon.com/images/I/61bbb._AC_SL1500_.jpg"}';
  assert.deepEqual(fotosDePaginaAmazon(html), [
    { title: 'Apple iPhone 16, 128GB, Black', thumbnail: 'https://m.media-amazon.com/images/I/71aaa._AC_SL1500_.jpg' },
    { title: 'Apple iPhone 16, 128GB, Black', thumbnail: 'https://m.media-amazon.com/images/I/61bbb._AC_SL1500_.jpg' },
  ]);
});

test('los resultados de Ecommodo pasan por el mismo filtro de modelo y color', () => {
  const resultados = [
    { title: 'Apple iPhone 16, 128GB, Black', thumbnail: 'https://m.media-amazon.com/images/I/71aaa._AC_SL1500_.jpg' },
    { title: 'Case for iPhone 16 Black silicone', thumbnail: 'https://m.media-amazon.com/images/I/funda.jpg' },
    { title: 'Apple iPhone 15, 128GB, Black', thumbnail: 'https://m.media-amazon.com/images/I/otro.jpg' },
  ];
  assert.deepEqual(elegirImagenes(resultados, { nombre: 'iPhone 16', color: 'Negro' }), ['https://m.media-amazon.com/images/I/71aaa.jpg']);
  assert.equal(nombreParaAmazon('Titanio Desierto'), 'Titanium Desert');
});
