import test from 'node:test';
import assert from 'node:assert/strict';
import {
  idDeItemLista, idViejoDeItemLista, migrarIdsDeLista, palabrasDeItem, gruposDuplicados,
  precioUnificado, ofertaMasBarata, ofertaMejorEscrita, unificarGrupos,
} from '../src/shared/duplicados.js';
import { fondoBlanco, huellaDeFoto, distanciaDeHuellas, elegirFotos } from '../src/shared/calidad-foto.js';

const oferta = (origen, producto, gb, color, precioUSD, condicion = '') => {
  const it = { producto, gb, color, condicion };
  return { id: idDeItemLista(it), origen, proveedor: origen, ...it, precioUSD };
};

test('el id de un producto de lista distingue capacidad, usado y lo que va entre paréntesis', () => {
  const a = idDeItemLista({ producto: 'iPhone 18 Pro Max', gb: '256GB', color: 'Black' });
  const b = idDeItemLista({ producto: 'iPhone 18 Pro Max', gb: '512GB', color: 'Black' });
  assert.equal(a, 'lista_iphone-18-pro-max-256gb-black');
  assert.notEqual(a, b);
  // Antes los dos eran el mismo producto: se veía uno solo, al precio del primero.
  assert.equal(idViejoDeItemLista({ producto: 'iPhone 18 Pro Max', gb: '256GB', color: 'Black' }), idViejoDeItemLista({ producto: 'iPhone 18 Pro Max', gb: '512GB', color: 'Black' }));
  assert.notEqual(idDeItemLista({ producto: 'Cargador 20W (Original)' }), idDeItemLista({ producto: 'Cargador 20W (AAA)' }));
  assert.equal(idDeItemLista({ producto: 'iPhone 13', gb: '128GB', condicion: 'usado' }), 'lista_iphone-13-128gb-usado');
  assert.equal(idDeItemLista({ producto: 'iPhone 13', gb: '128GB', condicion: 'nuevo' }), idDeItemLista({ producto: 'iPhone 13', gb: '128GB', condicion: '' }));
  // Lo que no tenía capacidad conserva su id: no hay nada que pasar.
  assert.equal(idDeItemLista({ producto: 'AirPods Pro 3' }), idViejoDeItemLista({ producto: 'AirPods Pro 3' }));
});

test('un nombre largo no deja el id fuera del límite de la tienda, ni lo hace chocar', () => {
  const largo = 'Lenovo 83JT0047US 2 en 1 Intel Core Ultra 7 256V 16GB RAM 14" 2K Touch Windows 11 Home Edición Especial';
  const a = idDeItemLista({ producto: largo, gb: '512GB', color: 'Gray' });
  const b = idDeItemLista({ producto: largo, gb: '512GB', color: 'Blue' });
  assert.ok(a.length <= 120 && b.length <= 120);
  assert.notEqual(a, b);
  assert.equal(a, idDeItemLista({ producto: largo, gb: '512GB', color: 'Gray' }));
});

test('lo guardado por el id viejo pasa al nuevo sin borrar nada', () => {
  const items = [
    { producto: 'iPhone 18 Pro Max Black', gb: '256gb', color: '', condicion: '' },
    { producto: 'iPhone 18 Pro Max Black', gb: '512gb', color: '', condicion: '' },
    { producto: 'AirPods 5', gb: '', color: '', condicion: '' },
  ];
  const viejo = 'lista_iphone-18-pro-max-black';
  const cfg = {
    catalogoIncluidos: [viejo, 'lista_airpods-5', 'stock_1'],
    catalogoAjustes: { [viejo]: { categoria: 'iPhone nuevos', precioUSD: 1499 } },
    catalogoNotas: { [viejo]: 'De 256GB, sellado.' },
    catalogoMeta: {},
  };
  const r = migrarIdsDeLista(cfg, items);
  const [de256, de512] = items.map(idDeItemLista);
  // Las dos capacidades quedan en la tienda y en su categoría; lo viejo sigue ahí.
  assert.deepEqual(new Set(r.catalogoIncluidos), new Set([viejo, 'lista_airpods-5', 'stock_1', de256, de512]));
  assert.deepEqual(r.catalogoAjustes[de256], { categoria: 'iPhone nuevos', precioUSD: 1499 });
  assert.deepEqual(r.catalogoAjustes[de512], { categoria: 'iPhone nuevos' });   // el precio propio era del de 256
  assert.equal(r.catalogoNotas[de256], 'De 256GB, sellado.');
  assert.equal(r.catalogoNotas[de512], undefined);
  assert.deepEqual(r.catalogoAjustes[viejo], cfg.catalogoAjustes[viejo]);
  assert.equal(r.separados, 1);
  // Sin nada guardado por ids viejos no hay nada que hacer.
  assert.equal(migrarIdsDeLista({ catalogoIncluidos: ['lista_airpods-5'] }, items), null);
  assert.equal(migrarIdsDeLista({}, []), null);
});

test('las palabras de un renglón no dependen del orden ni del campo en que vinieron', () => {
  const a = palabrasDeItem({ producto: 'iPhone 18 Pro Burgundy', gb: '256gb', color: '' });
  const b = palabrasDeItem({ producto: 'iPhone 18 Pro', gb: '256GB', color: 'Burgundy' });
  assert.deepEqual(a, b);
  // Las pulgadas y la RAM son de las que un proveedor aclara y otro no.
  const mac = palabrasDeItem({ producto: "MacBook Air 13'' M5 RAM 512gb Midnight", gb: '16GB' });
  assert.deepEqual(mac.debiles, { pulgadas: ['13in'], ram: ['16gb'] });
  assert.ok(mac.fuertes.includes('512gb') && !mac.fuertes.includes('ram'));
  assert.deepEqual(palabrasDeItem({ producto: 'MacBook Neo 13" 8/256GB', gb: '256GB', color: 'Indigo' }).debiles, { pulgadas: ['13in'], ram: ['8gb'] });
  assert.deepEqual(palabrasDeItem({ producto: 'iPhone 15', gb: '128', color: 'Negro' }).fuertes, ['128gb', '15', 'black', 'iphone']);
  assert.equal(palabrasDeItem({ producto: 'iPhone 13 usado', gb: '128GB' }).usado, true);
});

test('junta el mismo producto escrito distinto por cada proveedor', () => {
  const grupos = gruposDuplicados([
    oferta('ema', 'iPhone 18 Pro Max Black', '256gb', '', 1490),
    oferta('agus', 'iPhone 18 Pro Max', '256GB', 'Black', 1515),
    oferta('ema', 'iPhone 18 Pro Max Black', '512gb', '', 1760),      // otra capacidad: otro producto
    oferta('ema', 'Airpods 5', '', '', 180),
    oferta('agus', 'AirPods 5', '', '', 200),
    oferta('nico', 'AirPods 5', '', '', 180, 'nuevo'),
    oferta('ema', 'Accesorio Pencil Pro', '', '', 150),
    oferta('agus', 'Apple Pencil Pro', '', '', 165),
    oferta('ema', 'iPad A16 Blue', '128gb', '', 540),
    oferta('nico', 'iPad A16 11"', '128GB', 'Blue', 540, 'nuevo'),
    oferta('ema', 'Airpods 4 Noise Cancelling', '', '', 175),        // no es el AirPods 4 común
    oferta('agus', 'AirPods 4', '', '', 165),
    oferta('agus', 'iPad Air M4 13"', '128GB', 'Starlight', 1115),   // 13" y 11" no son el mismo
    oferta('nico', 'iPad Air M4 11"', '128GB', 'Starlight', 830),
  ]);
  const de = texto => grupos.find(g => g.ofertas.some(o => o.producto === texto));
  assert.equal(grupos.length, 4);
  assert.deepEqual(de('iPhone 18 Pro Max').ofertas.map(o => o.precioUSD).sort(), [1490, 1515]);
  assert.equal(de('AirPods 5').ofertas.length, 3);
  assert.equal(de('Apple Pencil Pro').tipo, 'seguro');
  assert.deepEqual(de('iPad A16 Blue').difieren, ['11"']);
  assert.equal(de('iPad A16 Blue').tipo, 'seguro');
  assert.equal(de('AirPods 4'), undefined);
  assert.equal(de('iPad Air M4 13"'), undefined);
});

test('lo que puede ser otra versión queda como parecido, y un proveedor nunca se junta consigo mismo', () => {
  const grupos = gruposDuplicados([
    oferta('ema', 'iPhone 16 Black // SIM + eSIM', '128gb', '', 855),
    oferta('agus', 'iPhone 16', '128GB', 'Black', 875),
    // agus lista el común y el "con SIM" aparte, a otro precio: son dos productos.
    oferta('agus', 'iPhone 18 Pro Max', '256GB', 'Glacier', 1515),
    oferta('agus', 'iPhone 18 Pro Max con SIM', '256GB', 'Glacier', 1765),
    oferta('ema', 'iPhone 18 Pro Max Glacier', '256gb', '', 1490),
    // Mismo texto, precios demasiado lejos para ser lo mismo.
    oferta('ema', 'Parlante X', '', '', 100),
    oferta('agus', 'Parlante X', '', '', 140),
  ]);
  const de = texto => grupos.find(g => g.ofertas.some(o => o.producto === texto));
  assert.equal(de('iPhone 16').tipo, 'parecido');
  assert.deepEqual(de('iPhone 16').difieren.sort(), ['SIM', 'eSIM']);
  assert.deepEqual(de('iPhone 18 Pro Max').ofertas.map(o => o.origen).sort(), ['agus', 'ema']);
  assert.equal(de('iPhone 18 Pro Max').tipo, 'seguro');
  assert.equal(de('iPhone 18 Pro Max con SIM'), undefined);
  assert.equal(de('Parlante X').tipo, 'parecido');
  // Un mismo texto en dos listas también es un duplicado, aunque el id sea uno solo.
  assert.equal(de('Parlante X').ids.length, 1);
  assert.deepEqual(gruposDuplicados([oferta('ema', 'iPhone 17', '256GB', 'Black', 1000)]), []);
  assert.deepEqual(gruposDuplicados(null), []);
});

test('el precio unificado es el punto medio entre el más alto y el más bajo', () => {
  assert.equal(precioUnificado([180, 200, 180]), 190);      // no el promedio de los tres (186,67)
  assert.equal(precioUnificado([1490, 1515]), 1505);        // termina en 0 o 5 si los extremos también
  assert.equal(precioUnificado([37, 42]), 40);
  assert.equal(precioUnificado([37, 40]), 39);
  assert.equal(precioUnificado([1490, 1515], 'minimo'), 1490);
  assert.equal(precioUnificado([1490, 1515], 'maximo'), 1515);
  assert.equal(precioUnificado([0, null, 300]), 300);       // los sin precio no cuentan
  assert.equal(precioUnificado([]), 0);
  assert.equal(ofertaMasBarata([{ proveedor: 'a', precioUSD: 200 }, { proveedor: 'b', precioUSD: 180 }, { proveedor: 'c', precioUSD: 180 }]).proveedor, 'b');
  assert.equal(ofertaMasBarata([{ proveedor: 'a', precioUSD: 0 }, { proveedor: 'b', precioUSD: 50 }]).proveedor, 'b');
  assert.equal(ofertaMasBarata([]), null);
  // Queda el nombre del renglón que trae color y capacidad en su campo.
  assert.equal(ofertaMejorEscrita([oferta('ema', 'iPhone 18 Pro Black', '256gb', '', 1), oferta('agus', 'iPhone 18 Pro', '256GB', 'Black', 2)]).origen, 'agus');
});

test('unificar deja uno solo en la tienda y conserva lo escrito', () => {
  const ema = oferta('ema', 'iPhone 18 Pro Max Black', '256gb', '', 1490);
  const agus = oferta('agus', 'iPhone 18 Pro Max', '256GB', 'Black', 1515);
  const [g] = gruposDuplicados([ema, agus]);
  const cfg = {
    catalogoIncluidos: [ema.id, agus.id, 'stock_1'],
    catalogoAjustes: { [ema.id]: { categoria: 'iPhone nuevos', precioUSD: 1600 }, [agus.id]: { entrega: 'inmediato', precioUSD: 1700 } },
    catalogoNotas: { [ema.id]: 'Sellado.' },
    catalogoMeta: {},
  };
  const r = unificarGrupos(cfg, [{ ...g, queda: g.ofertas.indexOf(agus) }], 'promedio');
  assert.deepEqual(r.catalogoUnificados[agus.id], { ids: [agus.id, ema.id], regla: 'promedio', nombre: 'iPhone 18 Pro Max', gb: '256GB', color: 'Black', condicion: '' });
  assert.deepEqual(new Set(r.catalogoIncluidos), new Set([agus.id, 'stock_1']));
  // Categoría y entrega se heredan; el precio propio se va: ahora lo pone la regla.
  assert.deepEqual(r.catalogoAjustes[agus.id], { entrega: 'inmediato', categoria: 'iPhone nuevos' });
  assert.equal(r.catalogoNotas[agus.id], 'Sellado.');
  assert.deepEqual(cfg.catalogoIncluidos, [ema.id, agus.id, 'stock_1']);   // no toca lo que recibió

  // Después llega una tercera lista con el mismo producto: se suma al que ya existe.
  const nico = oferta('nico', 'iPhone 18 Pro Max', '256 GB', 'Black', 1480);
  const [g2] = gruposDuplicados([ema, agus, nico]);
  const r2 = unificarGrupos({ ...cfg, ...r, catalogoIncluidos: [...r.catalogoIncluidos, nico.id] }, [{ ...g2, queda: g2.ofertas.indexOf(nico) }], 'minimo');
  assert.deepEqual(Object.keys(r2.catalogoUnificados), [agus.id]);          // sigue siendo el mismo producto (mismo link)
  assert.deepEqual(new Set(r2.catalogoUnificados[agus.id].ids), new Set([agus.id, ema.id, nico.id]));
  assert.equal(r2.catalogoUnificados[agus.id].regla, 'minimo');
  assert.ok(!r2.catalogoIncluidos.includes(nico.id) && r2.catalogoIncluidos.includes(agus.id));
});

// ── Las fotos ──
const imagen = (lado, pintar) => {
  const d = new Uint8ClampedArray(lado * lado * 4);
  for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
    const [r, g, b] = pintar(x, y);
    d.set([r, g, b, 255], (y * lado + x) * 4);
  }
  return d;
};
const BLANCO = [255, 255, 255], NEGRO = [20, 20, 20];
const centro = (lado, color) => imagen(lado, (x, y) => (x > lado * 0.25 && x < lado * 0.75 && y > lado * 0.15 && y < lado * 0.85 ? color : BLANCO));

test('el fondo blanco se mide en el borde de la imagen', () => {
  assert.equal(fondoBlanco(centro(32, NEGRO), 32, 32), 1);
  assert.equal(fondoBlanco(imagen(32, () => [90, 140, 200]), 32, 32), 0);
  // Una foto de uso: arriba cielo, abajo mesa. Menos de la mitad del borde es blanco.
  assert.ok(fondoBlanco(imagen(32, (x, y) => (y < 8 ? BLANCO : [120, 100, 80])), 32, 32) < 0.5);
  // El blanco de un JPG no es 255 parejo.
  assert.equal(fondoBlanco(imagen(32, () => [244, 246, 243]), 32, 32), 1);
});

test('dos fotos iguales dan la misma huella y dos distintas, no', () => {
  const a = huellaDeFoto(centro(32, NEGRO), 32, 32);
  const casiIgual = huellaDeFoto(centro(32, [28, 26, 30]), 32, 32);
  const otra = huellaDeFoto(imagen(32, (x, y) => ((x + y) % 16 < 8 ? NEGRO : BLANCO)), 32, 32);
  assert.equal(a.length, 64);
  assert.ok(distanciaDeHuellas(a, casiIgual) <= 4);
  assert.ok(distanciaDeHuellas(a, otra) > 12);
  assert.equal(distanciaDeHuellas(a, ''), Infinity);
});

test('se eligen las de fondo blanco y más resolución, sin repetir', () => {
  const h = n => n.toString(2).padStart(64, '0');
  const r = elegirFotos([
    { url: 'uso', ancho: 2000, alto: 2000, blanco: 0.3, huella: h(1) },
    { url: 'chica', ancho: 300, alto: 300, blanco: 1, huella: h(2) },
    { url: 'media', ancho: 900, alto: 900, blanco: 1, huella: h(0xffff) },
    { url: 'grande', ancho: 1500, alto: 1500, blanco: 0.97, huella: h(0xff00ff00) },
    { url: 'repetida', ancho: 1400, alto: 1400, blanco: 1, huella: h(0xff00ff01) },
    { url: 'sin-medir', ancho: 1600, alto: 1600, blanco: null, huella: '' },
  ]);
  assert.deepEqual(r.filter(c => c.elegida).map(c => c.url), ['grande', 'media']);
  assert.deepEqual(Object.fromEntries(r.filter(c => c.nota).map(c => [c.url, c.nota])), { uso: 'otro fondo', chica: 'chica', repetida: 'repetida', 'sin-medir': 'no se pudo medir' });
  assert.equal(r[0].url, 'grande');   // primero las elegidas
  // No más de las pedidas.
  const muchas = Array.from({ length: 9 }, (_, i) => ({ url: 'f' + i, ancho: 1500, alto: 1500, blanco: 1, huella: '0'.repeat(i * 7) + '1'.repeat(7) + '0'.repeat(57 - i * 7) }));
  assert.equal(elegirFotos(muchas, { max: 5 }).filter(c => c.elegida).length, 5);
  assert.deepEqual(elegirFotos(null), []);
});

// ── La ficha de un producto y la IA que la escribe ──
import { limpiarMejoras, jsonDeTexto, productosParaMejorar, tituloBase, etiquetasBase } from '../src/shared/mejorar-producto.js';
import { proveedoresCargados, pedidoDeIA, textoDeIA, textoConIA, mejorarProductos } from '../server/services/tienda/ia.js';
import { candidatasDeResultados } from '../server/services/tienda/fotos.js';

test('de lo que devuelve la IA solo entra lo pedido y lo que tiene sentido', () => {
  const pedidos = productosParaMejorar([{ id: 'a', nombre: 'iPhone 16 Black // SIM + eSIM', gb: '128gb' }, { id: 'b', nombre: 'AirPods 5' }, { id: '', nombre: 'sin id' }]);
  assert.deepEqual(pedidos.map(p => p.id), ['a', 'b']);
  assert.deepEqual(pedidos[0], { id: 'a', nombre: 'iPhone 16 Black // SIM + eSIM', capacidad: '128gb', condicion: 'nuevo', entrega: 'está en el local' });
  const crudo = jsonDeTexto('```json\n{"productos":[{"id":"a","titulo":"Apple iPhone 16 128GB Black (SIM + eSIM)","categoria":"iphone nuevos","descripcion":"Es el iPhone 16 de 128GB en negro, sellado.","etiquetas":["Apple","iPhone 16","apple"],"seo":"corta"},{"id":"zz","titulo":"Colado"},{"id":"b","titulo":"x","categoria":"Inventada"}]}\n```');
  assert.deepEqual(limpiarMejoras(crudo, pedidos, ['iPhone nuevos', 'AirPods']), [
    { id: 'a', titulo: 'Apple iPhone 16 128GB Black (SIM + eSIM)', categoria: 'iPhone nuevos', descripcion: 'Es el iPhone 16 de 128GB en negro, sellado.', etiquetas: ['apple', 'iphone 16'] },
    { id: 'b' },   // título de una letra y categoría que no existe: no se toca nada
  ]);
  assert.deepEqual(jsonDeTexto('Acá va: {"productos":[]} listo'), { productos: [] });
  assert.equal(jsonDeTexto('no es json'), null);
  assert.deepEqual(limpiarMejoras(null, pedidos, []), []);
});

test('sin IA la ficha base ya queda prolija', () => {
  assert.equal(tituloBase({ nombre: 'iPhone 16 Black // SIM + eSIM', gb: '128gb' }), 'iPhone 16 Black 128GB (SIM + eSIM)');
  assert.equal(tituloBase({ nombre: 'Accesorio Pencil Pro' }), 'Pencil Pro');
  assert.equal(tituloBase({ nombre: 'Watch S12 46mm Black SB M/L - MJEL4LS' }), 'Watch S12 46mm Black SB M/L');
  assert.deepEqual(etiquetasBase({ nombre: 'iPhone 18 Pro Max', gb: '256GB', color: 'Black' }, 'iPhone nuevos'), ['apple', 'iphone 18 pro max', '256gb', 'negro', 'iphone nuevos', 'mar del plata']);
  assert.deepEqual(etiquetasBase({ nombre: 'JBL Flip 7', color: 'Black' }, 'Parlantes').slice(0, 2), ['jbl', 'jbl flip 7']);
});

test('la IA del Worker usa la clave que haya, en el orden pedido', () => {
  assert.deepEqual(proveedoresCargados({}), []);
  assert.deepEqual(proveedoresCargados({ OPENAI_KEY: 'k', ANTHROPIC_KEY: 'k', DEEPSEEK_KEY: ' ' }), ['openai', 'anthropic']);
  assert.deepEqual(proveedoresCargados({ OPENAI_KEY: 'k', ANTHROPIC_KEY: 'k', IA_PROVEEDOR: 'Anthropic' }), ['anthropic', 'openai']);
  assert.deepEqual(proveedoresCargados({ OPENAI_KEY: 'k', IA_PROVEEDOR: 'gemini' }), ['openai']);   // el preferido sin clave no cuenta

  const opciones = { sistema: 'S', mensaje: 'M', json: true, maxTokens: 3000 };
  const cuerpo = (p, env) => { const { url, init } = pedidoDeIA(p, env, opciones); return { url, headers: init.headers, body: JSON.parse(init.body) }; };
  const ds = cuerpo('deepseek', { DEEPSEEK_KEY: 'd' });
  assert.equal(ds.headers.Authorization, 'Bearer d');
  assert.deepEqual(ds.body, { model: 'deepseek-chat', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'M' }], max_tokens: 3000, response_format: { type: 'json_object' } });
  const oa = cuerpo('openai', { OPENAI_KEY: 'o', OPENAI_MODELO: 'otro-modelo' });
  assert.equal(oa.body.model, 'otro-modelo');
  assert.equal(oa.body.max_completion_tokens, 3000);
  assert.ok(!('temperature' in oa.body));
  const ge = cuerpo('gemini', { GEMINI_KEY: 'g' });
  assert.match(ge.url, /models\/gemini-[\w.-]+:generateContent$/);
  assert.equal(ge.headers['x-goog-api-key'], 'g');
  assert.equal(ge.body.generationConfig.responseMimeType, 'application/json');
  // Claude: sin temperature, con lugar para pensar, esfuerzo bajo y respaldo si se niega.
  const cl = cuerpo('anthropic', { ANTHROPIC_KEY: 'a' });
  assert.equal(cl.headers['x-api-key'], 'a');
  assert.equal(cl.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.deepEqual(cl.body, { model: 'claude-opus-5-5', max_tokens: 16000, output_config: { effort: 'low' }, fallbacks: 'default', system: 'S', messages: [{ role: 'user', content: 'M' }] });
  const haiku = cuerpo('anthropic', { ANTHROPIC_KEY: 'a', ANTHROPIC_MODELO: 'claude-haiku-5-5' });
  assert.ok(!('fallbacks' in haiku.body) && !('anthropic-beta' in haiku.headers));

  assert.equal(textoDeIA('deepseek', { choices: [{ message: { content: ' hola ' } }] }), 'hola');
  assert.equal(textoDeIA('gemini', { candidates: [{ content: { parts: [{ text: 'pienso', thought: true }, { text: 'hola' }] } }] }), 'hola');
  assert.equal(textoDeIA('anthropic', { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'hola' }] }), 'hola');
  assert.equal(textoDeIA('anthropic', { stop_reason: 'refusal', content: [{ type: 'text', text: 'no' }] }), '');
  assert.equal(textoDeIA('openai', null), '');
});

test('si una IA falla se prueba la siguiente, y el error dice qué pasó con cada una', async () => {
  const env = { DEEPSEEK_KEY: 'd', OPENAI_KEY: 'o' };
  const llamadas = [];
  const respuestas = {
    'api.deepseek.com': () => Response.json({ error: { message: 'Insufficient Balance' } }, { status: 402 }),
    'api.openai.com': () => Response.json({ choices: [{ message: { content: JSON.stringify({ productos: [{ id: 'a', titulo: 'Apple iPhone 16 128GB Black', categoria: 'iPhone nuevos', etiquetas: ['iphone 16'] }] }) } }] }),
  };
  const fetchFalso = async url => { const host = new URL(url).host; llamadas.push(host); return respuestas[host](); };
  const r = await mejorarProductos(env, { productos: [{ id: 'a', nombre: 'iPhone 16', gb: '128GB', color: 'Black' }], categorias: ['iPhone nuevos'] }, fetchFalso);
  assert.deepEqual(llamadas, ['api.deepseek.com', 'api.openai.com']);
  assert.equal(r.proveedor, 'openai');
  assert.deepEqual(r.productos, [{ id: 'a', titulo: 'Apple iPhone 16 128GB Black', categoria: 'iPhone nuevos', etiquetas: ['iphone 16'] }]);
  assert.deepEqual(r.intentos, [{ proveedor: 'deepseek', error: '402: Insufficient Balance' }]);

  await assert.rejects(textoConIA({}, { mensaje: 'hola' }, fetchFalso), e => e.sinIA === true && /no hay ninguna IA cargada/.test(e.message));
  await assert.rejects(textoConIA({ DEEPSEEK_KEY: 'd' }, { mensaje: 'hola' }, fetchFalso), e => !e.sinIA && /DeepSeek \(402/.test(e.message));
});

test('las candidatas de foto son del modelo pedido, no de otra variante ni de un accesorio', () => {
  const I = n => 'https://m.media-amazon.com/images/I/' + n;
  const r = candidatasDeResultados([
    { title: 'Apple iPhone 16 128GB Ultramarine', thumbnail: I('otro-color._AC_SX679_.jpg') },
    { title: 'Apple iPhone 16 (128 GB) - Black', thumbnail: I('bien._AC_SL1500_.jpg') },
    { title: 'Apple iPhone 16e 128GB Black', thumbnail: I('16e.jpg') },
    { title: 'Apple iPhone 16 Pro Max 256GB Black Titanium', thumbnail: I('promax.jpg') },
    { title: 'Silicone Case for iPhone 16 Black', thumbnail: I('funda.jpg') },
    { title: 'Apple iPhone 16 Black', thumbnail: 'https://m.media-amazon.com/images/G/01/apple/banner.jpg' },
    { title: 'Apple iPhone 16 Black', thumbnail: 'https://otro-sitio.com/images/I/x.jpg' },
  ], { nombre: 'iPhone 16', color: 'Negro' });
  // Primero la que nombra el color; la otra queda para revisar, sin el color confirmado.
  assert.deepEqual(r.map(c => [c.url, c.color]), [[I('bien.jpg'), true], [I('otro-color.jpg'), false]]);
  // Un producto que trae su estuche no es un accesorio, y "3nd Generation" es el 3.
  assert.equal(candidatasDeResultados([{ title: 'Apple AirPods Pro (3nd Generation) with MagSafe Charging Case', thumbnail: I('a.jpg') }], { nombre: 'AirPods Pro 3', color: '' }).length, 1);
  assert.deepEqual(candidatasDeResultados(null, { nombre: 'x' }), []);
});
