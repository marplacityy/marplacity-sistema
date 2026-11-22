/**
 * La búsqueda de fotos de Ecommodo, adaptada al Worker: no necesita ninguna clave.
 *
 * Es el recorrido de su backend (backend/src/services/imageSearchService.js,
 * amazonService.js y bestbuyService.js): primero un buscador de imágenes, quedándose con
 * las fotos que están en el CDN de las tiendas —las de catálogo: fondo blanco y sin marca
 * de agua—, y si no alcanza, la página del primer resultado de Amazon. Lo que cambia
 * respecto del original:
 *
 *  - no usa wget ni disco: en un Worker solo hay fetch;
 *  - el buscador. Ecommodo usa DuckDuckGo Imágenes, que contesta 403 a las pocas
 *    consultas seguidas (medido el 22/11/2026, también desde una conexión de casa): por
 *    eso "Buscar fotos que faltan" no traía nada. Acá va primero Bing Imágenes, una
 *    consulta por tienda (Amazon, MercadoLibre y BestBuy), y DuckDuckGo queda de segundo
 *    intento;
 *  - MercadoLibre y BestBuy no dejan entrar a su buscador a un programa (ML manda a
 *    verificar la cuenta y su API pide clave, BestBuy no contesta): a sus fotos se llega
 *    por el buscador de imágenes, que ya las tiene indexadas;
 *  - devuelve cada foto con su título y su tienda ({title, thumbnail, tienda}) para que
 *    `fotos.js` descarte lo que no es el modelo pedido. Ecommodo se queda con lo primero
 *    que aparece; acá una foto de otro producto no entra;
 *  - solo sirven las fotos alojadas en esas tres tiendas (`fotoDeTienda`).
 *
 * Los buscadores y Amazon pueden rechazar pedidos que salen de un centro de datos: cada
 * fuente falla en silencio y `fuentes` dice qué pasó con cada una, para que se vea en la
 * pantalla por qué un producto quedó sin fotos.
 */

const CABECERAS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
const ESPERA_MS = 15_000;
const ESPERA_BUSCADOR_MS = 9_000;

/** Las tiendas de donde salen las fotos, en el orden en que se prefieren. */
export const TIENDAS_DE_FOTOS = ['Amazon', 'MercadoLibre', 'BestBuy'];
// Cómo se le nombra cada una al buscador, y en qué país conviene buscarla.
const CONSULTAS = [['amazon', 'en-US'], ['mercadolibre', 'es-AR'], ['bestbuy', 'en-US']];

const HOSTS_AMAZON = ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-eu.ssl-images-amazon.com', 'images-fe.ssl-images-amazon.com'];

/**
 * Si la imagen está en el CDN de una de las tiendas, de cuál y la dirección de su versión
 * más grande; null si es de otro sitio. Exportado para el test.
 *
 * Es también la lista de hosts de los que el Worker acepta bajar una foto por su cuenta:
 * https, sin usuario ni puerto, y solo las rutas donde cada tienda guarda fotos de producto.
 */
export function fotoDeTienda(valor) {
  let u;
  try { u = new URL(String(valor || '')); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const ruta = u.pathname;
  if (HOSTS_AMAZON.includes(u.hostname)) {
    // Solo las fotos de producto (/images/I/): lo demás son banners de publicidad. Pueden
    // venir con un prefijo de medición (/images/W/…/images/I/…) y con un sufijo de tamaño
    // (._AC_SX679_.); sin el sufijo Amazon entrega la original.
    const m = /\/images\/I\/([A-Za-z0-9+_%-]+)\.(?:[^/.]*\.)*(jpe?g|png|webp)$/i.exec(ruta);
    return m ? { tienda: 'Amazon', url: `https://${u.hostname}/images/I/${m[1]}.${m[2].toLowerCase()}` } : null;
  }
  if (u.hostname === 'http2.mlstatic.com') {
    // D_NQ_NP_661227-MLA95351616131_102025-O.webp es la de 500 px; la misma con 2X y -F
    // llega a 1200. Detrás de la letra puede venir el título de la publicación.
    const m = /^\/D_[A-Z0-9_]*?(\d{4,8}-M[A-Z]{2}\d+_\d{6})-[A-Z](?:-[^/]*)?\.(?:webp|jpe?g|png)$/.exec(ruta);
    return m ? { tienda: 'MercadoLibre', url: `https://http2.mlstatic.com/D_NQ_NP_2X_${m[1]}-F.webp` } : null;
  }
  if (u.hostname === 'pisces.bbystatic.com') {
    // …/images/products/<id>.jpg;maxHeight=640;maxWidth=550?format=webp: se pide hasta 2000 px.
    const m = /^(\/image2\/BestBuy_US\/images\/products\/[A-Za-z0-9/_-]+\.(?:jpe?g|png))/i.exec(ruta);
    return m ? { tienda: 'BestBuy', url: `https://pisces.bbystatic.com${m[1]};maxHeight=2000;maxWidth=2000` } : null;
  }
  return null;
}

/** Una lista de resultados sin fotos repetidas ni de otros sitios, cada una con su tienda y su versión grande. */
function soloDeTiendas(crudos) {
  const vistas = new Set(), out = [];
  for (const r of crudos) {
    const foto = fotoDeTienda(r.imagen);
    if (!foto || vistas.has(foto.url)) continue;
    vistas.add(foto.url);
    out.push({ title: String(r.titulo || '').replace(/\s+/g, ' ').trim(), thumbnail: foto.url, tienda: foto.tienda });
  }
  return out;
}

const desescapar = s => String(s)
  .replace(/&#(\d+);/g, (todo, n) => { try { return String.fromCodePoint(Number(n)); } catch { return todo; } })
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Las fotos de una página de resultados de Bing Imágenes que están en una de las tiendas.
 * Cada resultado trae sus datos en el atributo `m` del link ({murl, t, purl…}). Exportado
 * para el test.
 */
export function resultadosDeBing(html) {
  const crudos = [];
  for (const m of String(html || '').matchAll(/\sm="(\{[^"]+\})"/g)) {
    try {
      const d = JSON.parse(desescapar(m[1]));
      // Bing marca las palabras buscadas con caracteres de uso privado: no son parte del título.
      crudos.push({ imagen: d?.murl, titulo: String(d?.t || '').replace(/[-]/g, '') });
    } catch { /* un resultado roto no frena a los demás */ }
  }
  return soloDeTiendas(crudos);
}

async function buscarEnBing(q, pais) {
  const r = await fetch(`https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=0&count=35&adlt=moderate&mkt=${pais}`, {
    headers: { ...CABECERAS, 'Accept-Language': pais === 'es-AR' ? 'es-AR,es;q=0.9' : CABECERAS['Accept-Language'] },
    signal: AbortSignal.timeout(ESPERA_BUSCADOR_MS),
  });
  if (!r.ok) throw new Error(`Bing respondió ${r.status}`);
  return resultadosDeBing(await r.text());
}

/** Las fotos de las tiendas que DuckDuckGo encuentra para la búsqueda, con su título. Exportado para el test. */
export function resultadosDeDuckDuckGo(datos) {
  return soloDeTiendas((Array.isArray(datos?.results) ? datos.results : [])
    .filter(r => (r?.width || 0) >= 300 && (r?.height || 0) >= 300)
    .map(r => ({ imagen: r.image, titulo: r.title })));
}

async function buscarEnDuckDuckGo(q) {
  const consulta = encodeURIComponent(q);
  const pagina = await fetch(`https://duckduckgo.com/?q=${consulta}&iax=images&ia=images`, { headers: CABECERAS, signal: AbortSignal.timeout(ESPERA_BUSCADOR_MS) });
  const html = await pagina.text();
  const vqd = html.match(/vqd="([^"]+)"/)?.[1] || html.match(/vqd=([\d-]+)&/)?.[1];
  if (!vqd) throw new Error('DuckDuckGo no entregó el permiso de búsqueda');
  const r = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${consulta}&vqd=${vqd}&f=,,,&p=1`, {
    headers: { ...CABECERAS, Referer: 'https://duckduckgo.com/', Accept: 'application/json' },
    signal: AbortSignal.timeout(ESPERA_BUSCADOR_MS),
  });
  if (!r.ok) throw new Error(`DuckDuckGo respondió ${r.status}`);
  return resultadosDeDuckDuckGo(await r.json());
}

/** El primer producto de una página de resultados de Amazon. Exportado para el test. */
export function primerAsin(html) {
  const resultado = /data-asin="([A-Z0-9]{10})"[^>]*data-component-type="s-search-result"/.exec(html);
  return resultado?.[1] || /\/dp\/([A-Z0-9]{10})[/"]/.exec(html)?.[1] || null;
}

/** El título y las fotos grandes de la página de un producto de Amazon. Exportado para el test. */
export function fotosDePaginaAmazon(html) {
  const titulo = (/id="productTitle"[^>]*>\s*([^<]+)/.exec(html)?.[1] || '').trim();
  const vistas = new Set(), out = [];
  for (const patron of [/"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/g, /data-old-hires="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/g]) {
    for (const m of html.matchAll(patron)) {
      const id = /\/I\/([A-Za-z0-9+_-]+)\./.exec(m[1])?.[1];
      if (!id || vistas.has(id)) continue;
      vistas.add(id);
      out.push({ title: titulo, thumbnail: m[1], tienda: 'Amazon' });
    }
    if (out.length >= 3) break;
  }
  return out.slice(0, 8);
}

async function buscarEnPaginaAmazon(q) {
  const pedir = async url => (await fetch(url, { headers: { ...CABECERAS, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(ESPERA_MS) })).text();
  const asin = primerAsin(await pedir(`https://www.amazon.com/s?k=${encodeURIComponent(q)}`));
  if (!asin) throw new Error('Amazon no mostró resultados');
  return fotosDePaginaAmazon(await pedir(`https://www.amazon.com/dp/${asin}`));
}

const motivo = e => e?.name === 'TimeoutError' ? 'sin respuesta' : String(e?.message || e);

/**
 * Las fotos de una tienda de cada vez, para que al recortar la lista queden de todas:
 * Amazon, MercadoLibre, BestBuy, Amazon… Dentro de cada tienda, el orden del buscador.
 */
function intercalarPorTienda(resultados) {
  const filas = TIENDAS_DE_FOTOS.map(t => resultados.filter(r => r.tienda === t));
  const out = [];
  for (let i = 0; filas.some(f => i < f.length); i++) for (const f of filas) if (i < f.length) out.push(f[i]);
  return out;
}

/**
 * Los resultados de la búsqueda de un producto. Nunca lanza: si ninguna fuente contesta
 * devuelve una lista vacía y `fuentes` dice qué pasó con cada una que se probó.
 *
 * Primero Bing, las tres tiendas a la vez. DuckDuckGo y la página de Amazon solo se
 * consultan si con lo anterior no `alcanza` (lo decide quien llama, que es quien sabe
 * cuántas fotos son del modelo pedido).
 */
export async function buscarComoEcommodo(q, { alcanza = lista => lista.length >= 6 } = {}) {
  const fuentes = {}, vistas = new Set();
  let resultados = [];
  const sumar = lista => {
    for (const r of lista) { if (!vistas.has(r.thumbnail)) { vistas.add(r.thumbnail); resultados.push(r); } }
    resultados = intercalarPorTienda(resultados);
  };

  const porTienda = await Promise.allSettled(CONSULTAS.map(([palabra, pais]) => buscarEnBing(`${q} ${palabra}`, pais)));
  const contestaron = porTienda.filter(r => r.status === 'fulfilled');
  for (const r of contestaron) sumar(r.value);
  fuentes.bing = contestaron.length ? resultados.length : motivo(porTienda[0].reason);

  for (const [nombre, buscar] of [['duckduckgo', buscarEnDuckDuckGo], ['amazon', buscarEnPaginaAmazon]]) {
    if (alcanza(resultados)) break;
    try {
      const r = await buscar(q);
      fuentes[nombre] = r.length;
      sumar(r);
    } catch (e) {
      fuentes[nombre] = motivo(e);
    }
  }
  return { resultados, fuentes };
}
