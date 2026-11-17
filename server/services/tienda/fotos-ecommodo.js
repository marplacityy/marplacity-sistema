/**
 * La búsqueda de fotos de Ecommodo, adaptada al Worker: no necesita ninguna clave.
 *
 * Es el mismo recorrido de su backend (backend/src/services/imageSearchService.js y
 * amazonService.js): primero DuckDuckGo Imágenes, que suele traer las fotos que Amazon
 * tiene en su CDN, y si no alcanza, la página del primer resultado de Amazon. Lo que
 * cambia respecto del original:
 *
 *  - no usa wget ni disco: en un Worker solo hay fetch;
 *  - devuelve los resultados con la forma de SerpApi ({title, thumbnail}) para que pasen
 *    por `elegirImagenes`, que descarta lo que no es el modelo pedido. Ecommodo se queda
 *    con lo primero que aparece; acá una foto de otro producto no entra;
 *  - solo sirven las imágenes alojadas en Amazon, que es lo que `bajarImagen` acepta.
 *
 * Amazon y DuckDuckGo pueden rechazar pedidos que salen de un centro de datos: por eso
 * cada fuente falla en silencio y gana la que conteste.
 */

const CABECERAS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
const ESPERA_MS = 15_000;
const DE_AMAZON = /^https:\/\/(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\//;

/** Las imágenes de Amazon que DuckDuckGo encuentra para la búsqueda, con su título. Exportado para el test. */
export function resultadosDeDuckDuckGo(datos) {
  const vistas = new Set(), out = [];
  for (const r of Array.isArray(datos?.results) ? datos.results : []) {
    const url = String(r?.image || '');
    if (!DE_AMAZON.test(url) || vistas.has(url)) continue;
    if ((r.width || 0) < 300 || (r.height || 0) < 300) continue;
    vistas.add(url);
    out.push({ title: String(r.title || ''), thumbnail: url });
  }
  return out;
}

async function buscarEnDuckDuckGo(q) {
  const consulta = encodeURIComponent(q + ' amazon');
  const pagina = await fetch(`https://duckduckgo.com/?q=${consulta}&iax=images&ia=images`, { headers: CABECERAS, signal: AbortSignal.timeout(ESPERA_MS) });
  const html = await pagina.text();
  const vqd = html.match(/vqd="([^"]+)"/)?.[1] || html.match(/vqd=([\d-]+)&/)?.[1];
  if (!vqd) throw new Error('DuckDuckGo no entregó el permiso de búsqueda');
  const r = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${consulta}&vqd=${vqd}&f=,,,&p=1`, {
    headers: { ...CABECERAS, Referer: 'https://duckduckgo.com/', Accept: 'application/json' },
    signal: AbortSignal.timeout(ESPERA_MS),
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
      out.push({ title: titulo, thumbnail: m[1] });
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

/**
 * Los resultados de las dos fuentes, DuckDuckGo primero. Nunca lanza: si ninguna
 * contesta devuelve una lista vacía y `fuentes` dice qué pasó con cada una.
 */
export async function buscarComoEcommodo(q) {
  const fuentes = {}, resultados = [];
  for (const [nombre, buscar] of [['duckduckgo', buscarEnDuckDuckGo], ['amazon', buscarEnPaginaAmazon]]) {
    try {
      const r = await buscar(q);
      fuentes[nombre] = r.length;
      resultados.push(...r);
    } catch (e) {
      fuentes[nombre] = e.name === 'TimeoutError' ? 'sin respuesta' : e.message;
    }
    if (resultados.length >= 6) break;
  }
  return { resultados, fuentes };
}
