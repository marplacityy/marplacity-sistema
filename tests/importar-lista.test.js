import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsDeListaEcommodo, parseProductsDeterministic } from '../src/shared/lista-ecommodo.js';
import { resultadosDeDuckDuckGo, resultadosDeBing, fotoDeTienda, primerAsin, fotosDePaginaAmazon } from '../server/services/tienda/fotos-ecommodo.js';
import { elegirImagenes, nombreParaAmazon, consultaDeFoto, candidatasDeResultados } from '../server/services/tienda/fotos.js';

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

test('una foto sirve si está en Amazon, MercadoLibre o BestBuy, y se pide su versión más grande', () => {
  // Amazon: solo fotos de producto, sin el sufijo de tamaño ni el prefijo de medición.
  assert.deepEqual(fotoDeTienda('https://m.media-amazon.com/images/I/61I+Ttkp5LL._AC_SX679_.jpg'), { tienda: 'Amazon', url: 'https://m.media-amazon.com/images/I/61I+Ttkp5LL.jpg' });
  assert.deepEqual(fotoDeTienda('https://m.media-amazon.com/images/W/BW_MEDIAX_AVIF_MEASUREMENT_1306696-T4/images/I/31zQqJkmfWL.jpg'), { tienda: 'Amazon', url: 'https://m.media-amazon.com/images/I/31zQqJkmfWL.jpg' });
  assert.deepEqual(fotoDeTienda('https://m.media-amazon.com/images/I/61BcZF6lUpL._AC_AIweblab1392912,T2_SF1358,1358_PQ60_.jpg?aicid=x'), { tienda: 'Amazon', url: 'https://m.media-amazon.com/images/I/61BcZF6lUpL.jpg' });
  assert.equal(fotoDeTienda('https://m.media-amazon.com/images/G/32/apple/iPhone/B0FQHPRVG5.MAIN._CB800730539_.jpg'), null, 'un banner no es una foto de producto');
  // MercadoLibre: la de 500 px pasa a la de 1200, con o sin el título de la publicación detrás.
  assert.deepEqual(fotoDeTienda('https://http2.mlstatic.com/D_NQ_NP_661227-MLA95351616131_102025-O.webp'), { tienda: 'MercadoLibre', url: 'https://http2.mlstatic.com/D_NQ_NP_2X_661227-MLA95351616131_102025-F.webp' });
  assert.deepEqual(fotoDeTienda('https://http2.mlstatic.com/D_NQ_NP_752926-MLC118981636925_102026-O-samsung-galaxy-s26-ultra.webp'), { tienda: 'MercadoLibre', url: 'https://http2.mlstatic.com/D_NQ_NP_2X_752926-MLC118981636925_102026-F.webp' });
  assert.equal(fotoDeTienda('https://http2.mlstatic.com/frontend-assets/ml-web-navigation/logo.svg'), null);
  // BestBuy: la misma foto, hasta 2000 px.
  assert.deepEqual(fotoDeTienda('https://pisces.bbystatic.com/image2/BestBuy_US/images/products/b9c111e7-aaef-46de-96bd-718a2cff011c.jpg;maxHeight=1920;maxWidth=900?format=webp'),
    { tienda: 'BestBuy', url: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/b9c111e7-aaef-46de-96bd-718a2cff011c.jpg;maxHeight=2000;maxWidth=2000' });
  // Cualquier otro sitio, y lo que no es https limpio, no.
  for (const mala of ['https://tienda-x.com/images/I/a.jpg', 'http://m.media-amazon.com/images/I/a.jpg', 'https://m.media-amazon.com:8443/images/I/a.jpg', 'https://x@http2.mlstatic.com/D_NQ_NP_661227-MLA95351616131_102025-O.webp', 'https://pisces.bbystatic.com.evil.invalid/image2/BestBuy_US/images/products/a.jpg', '', null]) {
    assert.equal(fotoDeTienda(mala), null, String(mala));
  }
});

test('de Bing y de DuckDuckGo solo sirven las fotos de las tres tiendas, cada una una vez', () => {
  const m = d => ` m="${JSON.stringify(d).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
  const html = `<ul><li><a class="iusc" href="/images/search?view=detailV2"${m({ murl: 'https://m.media-amazon.com/images/I/71aaa._AC_SY300_.jpg', t: 'Apple iPhone 17 (256 GB) - Black : Amazon.sg', purl: 'https://www.amazon.sg/dp/B0X' })} h="ID=images">
    <a class="iusc"${m({ murl: 'https://http2.mlstatic.com/D_NQ_NP_661227-MLA95351616131_102025-O.webp', t: 'Apple iPhone 17 256 GB Negro | MercadoLibre' })}>
    <a class="iusc"${m({ murl: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/abc-123.jpg;maxHeight=640;maxWidth=550', t: 'Apple iPhone 17 256GB "Black" & more - Best Buy' })}>
    <a class="iusc"${m({ murl: 'https://www.blog-x.com/fotos/iphone-17.jpg', t: 'iPhone 17 review' })}>
    <a class="iusc"${m({ murl: 'https://m.media-amazon.com/images/I/71aaa._AC_SL1500_.jpg', t: 'la misma, en otro tamaño' })}>
    <a class="iusc" m="{roto"></li></ul>`;
  assert.deepEqual(resultadosDeBing(html), [
    { title: 'Apple iPhone 17 (256 GB) - Black : Amazon.sg', thumbnail: 'https://m.media-amazon.com/images/I/71aaa.jpg', tienda: 'Amazon' },
    { title: 'Apple iPhone 17 256 GB Negro | MercadoLibre', thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_661227-MLA95351616131_102025-F.webp', tienda: 'MercadoLibre' },
    { title: 'Apple iPhone 17 256GB "Black" & more - Best Buy', thumbnail: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/abc-123.jpg;maxHeight=2000;maxWidth=2000', tienda: 'BestBuy' },
  ]);
  assert.deepEqual(resultadosDeBing('<html>verificá que no sos un robot</html>'), []);
  assert.deepEqual(resultadosDeBing(null), []);

  const r = resultadosDeDuckDuckGo({ results: [
    { image: 'https://m.media-amazon.com/images/I/a.jpg', title: 'Apple iPhone 16 Black', width: 1500, height: 1500 },
    { image: 'https://tienda-x.com/b.jpg', title: 'iPhone 16', width: 1500, height: 1500 },
    { image: 'https://m.media-amazon.com/images/I/c.jpg', title: 'chica', width: 120, height: 120 },
    { image: 'https://m.media-amazon.com/images/I/a.jpg', title: 'repetida', width: 1500, height: 1500 },
  ] });
  assert.deepEqual(r, [{ title: 'Apple iPhone 16 Black', thumbnail: 'https://m.media-amazon.com/images/I/a.jpg', tienda: 'Amazon' }]);
  assert.deepEqual(resultadosDeDuckDuckGo(null), []);
});

test('la búsqueda sale del título que armó la IA, sin la capacidad ni lo que ensucia una lista', () => {
  // Con título: es como lo titula una tienda. La aclaración entre paréntesis y la capacidad no van.
  assert.equal(consultaDeFoto({ nombre: 'iPhone 17 (SIM + eSIM)', titulo: 'Apple iPhone 17 256GB Black (SIM física + eSIM)', gb: '256GB', color: 'Black' }), 'Apple iPhone 17 Black');
  // Sin título: el nombre de la lista, limpio, más el color.
  assert.equal(consultaDeFoto({ nombre: 'Samsung S26 Ultra 12+', gb: '256GB', color: 'Sky Blue' }), 'Samsung S26 Ultra Sky Blue');
  assert.equal(consultaDeFoto({ nombre: 'iPhone 18 Pro Max con SIM', gb: '256GB', color: 'Glacier' }), 'iPhone 18 Pro Max Glacier');
  assert.equal(consultaDeFoto({ nombre: 'Watch S12 46mm Black SB M/L - MJEL4LS' }), 'Apple Watch Series 12 46mm Black Sport Band');
  assert.equal(consultaDeFoto({ nombre: "MacBook Neo 13'' RAM 256gb", gb: '8GB', color: 'Citrus' }), "MacBook Neo 13'' Citrus");
  assert.equal(consultaDeFoto({ nombre: 'MacBook Neo 13" 8/512GB', color: 'Indigo' }), 'MacBook Neo 13" Indigo');
  assert.equal(consultaDeFoto({ nombre: "Accesorio Magic Keyboard Folio 11'' White (For A16)" }), "Magic Keyboard Folio 11'' White");
  assert.equal(consultaDeFoto({ nombre: 'iPhone 16 Black // SIM + eSIM', gb: '128gb' }), 'iPhone 16 Black');
  assert.equal(consultaDeFoto({}), '');
});

test('las candidatas son del modelo pedido aunque el título venga en castellano, con el chip o cortado', () => {
  const A = n => ({ thumbnail: 'https://m.media-amazon.com/images/I/' + n + '.jpg' });
  const ML = n => ({ thumbnail: `https://http2.mlstatic.com/D_NQ_NP_${n}-MLA95351616131_102025-O.webp` });
  const BB = n => ({ thumbnail: `https://pisces.bbystatic.com/image2/BestBuy_US/images/products/${n}.jpg` });
  const elegidas = (resultados, opciones) => candidatasDeResultados(resultados, opciones).map(c => [c.fuente, c.color]);

  // MercadoLibre titula en castellano: "Negro" confirma el Black. Y cada foto dice de qué tienda es.
  assert.deepEqual(elegidas([
    { title: 'Apple iPhone 17 (256 GB) - Negro - Distribuidor Autorizado', ...ML(111111) },
    { title: 'Apple iPhone 17 256GB Black (Unlocked) - Best Buy', ...BB('bb-1') },
    { title: 'Apple iPhone 17 256GB Lavender', ...A('lavanda') },
    { title: 'Apple iPhone 17 Pro 256GB Black', ...A('pro') },
    { title: 'Apple iPhone 17e 256GB Black', ...A('17e') },
    { title: 'Funda de silicona para iPhone 17 Negro', ...ML(222222) },
  ], { nombre: 'iPhone 17 (SIM + eSIM)', titulo: 'Apple iPhone 17 256GB Black (SIM física + eSIM)', color: 'Black' }),
  [['MercadoLibre', true], ['BestBuy', true], ['Amazon', false]]);

  // "A18 Pro" es el chip, no una MacBook Pro; "12+" y "RAM" no se le piden al título.
  assert.equal(candidatasDeResultados([{ title: 'Apple 2026 MacBook Neo 13-inch Laptop with A18 Pro chip', ...A('neo') }, { title: 'Apple MacBook Pro 13-inch', ...A('mbp') }], { nombre: "MacBook Neo 13'' RAM 256gb", color: 'Citrus' }).length, 1);
  assert.equal(candidatasDeResultados([{ title: 'Samsung Galaxy S26 Ultra 512GB, Sky Blue', ...A('s26') }, { title: 'Samsung Galaxy S26 256GB Sky Blue', ...A('s26base') }], { nombre: 'Samsung S26 Ultra 12+', color: 'Sky Blue' }).length, 1);
  // Otro parlante con el mismo número no es el pedido.
  assert.equal(candidatasDeResultados([{ title: 'JBL Charge 7 Portable Speaker', ...A('charge') }, { title: 'JBL Flip 7 Portable Waterproof Speaker', ...A('flip') }], { nombre: 'JBL Flip 7' }).length, 1);

  // Un reloj se titula con la caja y la malla, y el título llega cortado: alcanza con la
  // mitad de las palabras, pero el número tiene que estar ("Ultra 4" no es "Ultra 2").
  const reloj = { nombre: 'Watch Ultra 4 49mm Black - Translucent Black Ocean Band - MJAY4' };
  assert.deepEqual(candidatasDeResultados([
    { title: 'Apple Watch Ultra 4 (GPS + Cellular) 49mm Titanium Case with ...', ...BB('u4') },
    { title: 'Apple Watch Ultra 2 (GPS+Cellular) 49mm Titanium Case with Black Ocean Band', ...BB('u2') },
    { title: 'Pulsera Ocean para Apple Watch Ultra 4 de 49 mm', ...ML(333333) },
  ], reloj).map(c => c.url), ['https://pisces.bbystatic.com/image2/BestBuy_US/images/products/u4.jpg;maxHeight=2000;maxWidth=2000']);
  // Cuando lo que se busca ES el accesorio, "for iPad" no lo descarta.
  assert.equal(candidatasDeResultados([{ title: 'Apple Magic Keyboard Folio for iPad (A16) - White', ...A('folio') }], { nombre: "Accesorio Magic Keyboard Folio 11'' White (For A16)" }).length, 1);
});

test('de la página de Amazon salen el primer producto, su título y sus fotos grandes', () => {
  assert.equal(primerAsin('<div data-asin="B0ABCDE123" data-index="1" data-component-type="s-search-result">'), 'B0ABCDE123');
  assert.equal(primerAsin('<a href="/dp/B0ZZZZZ999/ref=x">'), 'B0ZZZZZ999');
  assert.equal(primerAsin('<html>robot check</html>'), null);
  const html = '<span id="productTitle" class="a"> Apple iPhone 16, 128GB, Black </span>{"hiRes":"https://m.media-amazon.com/images/I/71aaa._AC_SL1500_.jpg"},{"hiRes":"https://m.media-amazon.com/images/I/71aaa._AC_SL1000_.jpg"},{"hiRes":"https://m.media-amazon.com/images/I/61bbb._AC_SL1500_.jpg"}';
  assert.deepEqual(fotosDePaginaAmazon(html), [
    { title: 'Apple iPhone 16, 128GB, Black', thumbnail: 'https://m.media-amazon.com/images/I/71aaa._AC_SL1500_.jpg', tienda: 'Amazon' },
    { title: 'Apple iPhone 16, 128GB, Black', thumbnail: 'https://m.media-amazon.com/images/I/61bbb._AC_SL1500_.jpg', tienda: 'Amazon' },
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
