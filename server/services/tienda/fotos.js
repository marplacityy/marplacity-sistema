/**
 * Fotos de productos desde Amazon.
 * ------------------------------------------------
 * Busca primero con el script de Ecommodo (fotos-ecommodo.js): DuckDuckGo Imágenes y la
 * página de Amazon, sin claves ni cupo de nadie. SerpApi queda de respaldo, solo para
 * cuando el script no trae nada (y si hay clave).
 *
 * Para un producto sin foto, busca en Amazon "nombre capacidad color", se queda con la
 * imagen principal de los primeros resultados que se parezcan (fondo blanco, de
 * fabricante o vendedor oficial, que es lo que se ve en los listados), la baja y la
 * sube a `fotos/` de Firebase Storage con el nombre que el sistema espera. El sistema
 * después la asigna con "Clasificar fotos nuevas" (la IA confirma modelo y color) o
 * queda asignada por el nombre del archivo.
 *
 * Por qué acá y no en el browser: la clave de SerpApi no puede viajar en un HTML
 * público, y muchos sitios no dejan bajar sus imágenes desde otra página (CORS). Y por
 * qué SerpApi y no pegarle a Amazon: Amazon bloquea scrapers con CAPTCHAs y cambia el
 * HTML seguido; SerpApi ya resuelve eso.
 *
 * La subida a Storage va con el token de Firebase del dueño que vino en la solicitud:
 * las reglas de Storage (storage.rules) son las que deciden, igual que si subiera él
 * desde el sistema. El Worker no tiene credenciales propias para escribir fotos.
 *
 * Variables:
 *   SERPAPI_KEY    (Secret)  clave de serpapi.com (250 búsquedas gratis por mes). Opcional:
 *                            es el respaldo del script de Ecommodo, no el buscador principal
 *   FOTOS_BUCKET   (Text)    el bucket de Storage; si falta, el de src/shared/sitio.js
 */

import { FOTOS_BUCKET, FOTOS_CARPETA } from '../../../src/shared/sitio.js';
import { buscarComoEcommodo } from './fotos-ecommodo.js';

const SERP = 'https://serpapi.com/search.json';
const MAX_IMAGEN = 8 * 1024 * 1024;

/** SerpApi es externo: sus resultados no autorizan a consultar la red interna. */
export function urlImagenPermitida(valor) {
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-eu.ssl-images-amazon.com', 'images-fe.ssl-images-amazon.com'].includes(url.hostname);
  } catch { return false; }
}

// Los colores como los escribe una lista de acá, y como los titula Amazon.
const COLORES_EN = { negro: 'Black', blanco: 'White', azul: 'Blue', rojo: 'Red', verde: 'Green', rosa: 'Pink', gris: 'Gray', plata: 'Silver', plateado: 'Silver', dorado: 'Gold', oro: 'Gold', violeta: 'Purple', lila: 'Purple', amarillo: 'Yellow', naranja: 'Orange', celeste: 'Blue', grafito: 'Graphite', titanio: 'Titanium', desierto: 'Desert', medianoche: 'Midnight' };
const COLOR_ES = new RegExp(`\\b(${Object.keys(COLORES_EN).join('|')})\\b`, 'gi');

/** Igual que slugFoto() del sistema: "iPhone 13" + "Red" → iphone-13-red. Exportado para el test. */
export const slugFoto = nombre => String(nombre || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b(usado|usada|nuevo|nueva|sellado|sellada|grado\s*[a-c]|refurb\w*|reacondicionad\w*|ampsentrix|\d{2,3}\s?%)\b/g, ' ')
  .replace(/\b\d+\s?(gb|tb)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim().replace(/\s+/g, '-');

/**
 * El nombre tal como lo entiende Amazon. Las listas de precios vienen con palabras que
 * Amazon no usa en sus títulos y que hacían fallar la búsqueda y el filtro: "Genuine",
 * "Serie" (Amazon dice "Series"), tallas de malla ("M/L"), "GPS", separadores "·", el
 * color de la malla después del punto. Exportado para el test.
 */
export function nombreParaAmazon(nombre) {
  return String(nombre || '')
    .split('·')[0]                                   // "Silver Aluminio · Denim SB" → "Silver Aluminio"
    .replace(/\([^)]*\)/g, ' ')                      // "(Usado Grado A, 100% Ampsentrix)" no es parte del modelo
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')            // caracteres invisibles que traen las listas
    .replace(/\b(genuine|original|nuevo|nueva|sellado|sellada|caja cerrada)\b/gi, ' ')
    .replace(/\bserie\b/gi, 'Series')
    .replace(/\b(gps|cellular|celular|wifi|wi-fi)\b/gi, ' ')
    .replace(/\b[SML]\/[SML]\b/g, ' ')                // tallas de malla M/L, S/M
    .replace(/\b\d+\s?gb\s+ram\b/gi, ' ')             // "8GB RAM" no ayuda a encontrar la foto
    .replace(/\baluminio\b/gi, 'Aluminum')
    .replace(COLOR_ES, c => COLORES_EN[c.toLowerCase()])   // Amazon titula en inglés: "Azul" → "Blue"
    .replace(/\blavander\b/gi, 'Lavender')            // como lo escribe Amazon
    .replace(/\(\s*usb\s*-?\s*c\s*\)/gi, ' USB-C ')    // "( USB - C )" → "USB-C"
    .replace(/\b(\w+)\s+\1\b/gi, '$1')               // "Black Black" → "Black"
    .replace(/\s+/g, ' ').trim();
}

/**
 * Elige, entre los resultados de Amazon, los que parecen ser el producto pedido.
 * Exportado para el test.
 *
 * Amazon devuelve mucha basura alrededor (fundas, cables, "compatible con"): se filtra
 * por título. Tiene que contener el modelo (todas las palabras del nombre, salvo
 * "apple") y, si se pidió color, el color; y no tener palabras de accesorio cuando lo
 * que se busca es un equipo. Se devuelven hasta `max` imágenes distintas.
 */
export function elegirImagenes(resultados, { nombre, color, esAccesorio = false, max = 3 } = {}) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palabras = norm(nombreParaAmazon(nombre)).split(/[^a-z0-9]+/).filter(w => w && w !== 'apple' && !/^\d+(gb|tb|mm)$/.test(w));
  // El color también puede venir con "· malla": se compara solo la primera palabra útil.
  const colorN = norm(nombreParaAmazon(color)).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').pop() || '';
  // Un equipo tiene que tener TODAS las palabras del modelo; para lo demás (relojes con
  // medidas, cables con nombres largos) alcanza con la mayoría.
  const minimo = esAccesorio || /watch|cable|charger|cargador/i.test(nombre) ? Math.ceil(palabras.length * 0.6) : palabras.length;
  const ACCESORIO = /\b(case|cover|funda|cable|charger|cargador|screen protector|glass|protector|holder|mount|stand|adapter|sleeve|skin|strap|band)\b/;
  const vistas = new Set(), out = [];
  for (const r of Array.isArray(resultados) ? resultados : []) {
    const t = norm(r.title);
    if (palabras.filter(w => t.includes(w)).length < minimo) continue;
    if (colorN && !t.includes(colorN)) continue;
    // Un reloj se vende con "case" y "band" en el título: ahí ese filtro no aplica.
    if (!esAccesorio && !/watch/i.test(nombre) && ACCESORIO.test(t)) continue;
    const img = String(r.thumbnail || r.image || '');
    if (!urlImagenPermitida(img) || vistas.has(img)) continue;
    vistas.add(img);
    // Amazon sirve miniaturas con sufijo de tamaño (._AC_UY218_.); sin el sufijo viene la grande.
    out.push(img.replace(/\._[^.]*_\./, '.'));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Una URL de imagen que eligió el dueño a mano (de Google Imágenes). No se limita a
 * Amazon, pero sí a hosts públicos con nombre: nada de IPs, localhost, puertos ni
 * credenciales. Exportado para el test.
 */
export function urlPublicaSegura(valor) {
  try {
    const url = new URL(valor);
    const h = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (!h.includes('.') || /^[\d.]+$/.test(h) || /^\[/.test(h) || /\.(local|localhost|internal|lan|home|arpa)$/i.test(h) || /^localhost$/i.test(h)) return false;
    return true;
  } catch { return false; }
}

/**
 * Google Imágenes, vía SerpApi: devuelve la imagen original de cada resultado con su
 * tamaño, así se puede ofrecer la grande sin bajarla. `tbs=isz:l` pide solo grandes.
 */
export async function buscarEnGoogleImagenes(env, q) {
  if (!env.SERPAPI_KEY) throw new Error('falta SERPAPI_KEY');
  const u = `${SERP}?engine=google_images&q=${encodeURIComponent(q)}&tbs=isz:l&hl=es&gl=ar&api_key=${env.SERPAPI_KEY}`;
  const r = await fetch(u);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`SerpApi: ${d.error || r.status}`);
  return d.images_results || [];
}

/**
 * Los candidatos de Google Imágenes para un producto: grandes (lado mayor ≥ 800), de un
 * host público, sin accesorios cuando se busca un equipo, con el modelo en el título.
 * Exportado para el test.
 */
export function candidatosDeGoogle(resultados, { nombre, color, esAccesorio = false, max = 12 } = {}) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palabras = norm(nombreParaAmazon(nombre)).split(/[^a-z0-9]+/).filter(w => w && w !== 'apple' && !/^\d+(gb|tb|mm)$/.test(w));
  const colorN = norm(nombreParaAmazon(color)).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').pop() || '';
  const minimo = Math.max(1, Math.ceil(palabras.length * 0.6));
  const ACCESORIO = /\b(case|cover|funda|cable|charger|cargador|screen protector|glass|protector|holder|mount|stand|adapter|sleeve|skin|strap|band)\b/;
  const vistas = new Set(), out = [];
  for (const r of Array.isArray(resultados) ? resultados : []) {
    const t = norm(`${r.title || ''} ${r.source || ''}`);
    const ancho = Number(r.original_width) || 0, alto = Number(r.original_height) || 0;
    if (Math.max(ancho, alto) < 800) continue;
    if (palabras.filter(w => t.includes(w)).length < minimo) continue;
    if (!esAccesorio && !/watch/i.test(nombre) && ACCESORIO.test(t)) continue;
    const url = String(r.original || '');
    if (!urlPublicaSegura(url) || vistas.has(url)) continue;
    vistas.add(url);
    out.push({ url, thumb: String(r.thumbnail || ''), ancho, alto, fuente: String(r.source || ''), titulo: String(r.title || '').slice(0, 120), color: !!(colorN && t.includes(colorN)) });
    if (out.length >= max) break;
  }
  // Primero las del color pedido, después las más grandes.
  return out.sort((a, b) => (b.color - a.color) || (b.ancho * b.alto - a.ancho * a.alto));
}

// Lo que cambia el producto si aparece en el título y no en lo que se busca: "iPhone 16"
// no es "iPhone 16 Pro Max" ni "iPhone 16e".
const VARIANTES = ['pro', 'max', 'plus', 'ultra', 'mini', 'air', 'lite', 'fe', 'se', 'neo', 'slim'];

/**
 * Las candidatas para revisar a mano, a partir de los resultados de una búsqueda
 * ({title, thumbnail}). Exportado para el test.
 *
 * Es más permisivo que `elegirImagenes` porque nada se guarda sin que el dueño lo vea: el
 * color no se exige (los títulos de DuckDuckGo vienen cortados), solo se anota si
 * aparece. Pero compara palabras enteras, así "16" no coincide con "16e", y descarta lo
 * que es de otra variante, los accesorios y los banners de publicidad de Amazon (solo
 * valen las fotos de producto, las de `/images/I/`).
 */
export function candidatasDeResultados(resultados, { nombre, color, esAccesorio = false, max = 12 } = {}) {
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // "3rd", "3nd" (así lo escribe Amazon a veces) son el 3.
  const palabrasDe = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean).map(w => w.replace(/^(\d+)(st|nd|rd|th)$/, '$1'));
  const pedidas = palabrasDe(nombreParaAmazon(nombre)).filter(w => w !== 'apple' && !/^\d+(gb|tb|mm)$/.test(w));
  const colores = palabrasDe(nombreParaAmazon(color));
  const suelto = esAccesorio || /watch|cable|charger|cargador|parlante|speaker/i.test(nombre);
  const minimo = Math.max(1, suelto ? Math.ceil(pedidas.length * 0.6) : pedidas.length);
  // Un accesorio PARA el producto ("Case for iPad", "compatible with"), no un producto que
  // trae su estuche: los AirPods se titulan "with MagSafe Charging Case".
  const ACCESORIO = /\b(case|cover|funda|shell|skin|sleeve|protector|holder|mount|stand|strap|band|cable|charger|cargador|adapter|keyboard)s?\s+(for|para|compatible)\b|\bcompatible (with|con)\b|\bscreen protector\b|\btempered glass\b/;
  const vistas = new Set(), out = [];
  for (const r of Array.isArray(resultados) ? resultados : []) {
    const titulo = norm(r.title);
    const enTitulo = new Set(palabrasDe(r.title));
    if (pedidas.filter(w => enTitulo.has(w)).length < minimo) continue;
    if (!suelto && VARIANTES.some(v => enTitulo.has(v) && !pedidas.includes(v))) continue;
    // "16e", "s25fe": el número pedido seguido de letras es otro modelo.
    if (!suelto && pedidas.some(w => /^[a-z]?\d+$/.test(w) && [...enTitulo].some(t => t !== w && new RegExp(`^${w}[a-z]{1,2}$`).test(t)))) continue;
    if (!esAccesorio && ACCESORIO.test(titulo)) continue;
    const img = String(r.thumbnail || r.image || '');
    if (!urlImagenPermitida(img) || !/\/images\/I\//.test(img)) continue;
    // Sin el sufijo de tamaño (._AC_SX679_.) Amazon entrega la original.
    const url = img.replace(/\._[^./]*_\./, '.');
    if (vistas.has(url)) continue;
    vistas.add(url);
    out.push({ url, thumb: url.replace(/\.(jpg|jpeg|png|webp)$/i, '._AC_UL320_.$1'), ancho: 0, alto: 0, fuente: 'Amazon', titulo: String(r.title || '').slice(0, 120), color: colores.length > 0 && colores.every(c => enTitulo.has(c)) });
  }
  // Primero las que nombran el color pedido; dentro de cada grupo, el orden de la búsqueda.
  return out.sort((a, b) => b.color - a.color).slice(0, max);
}

/**
 * Las candidatas para elegir a mano, sin bajar nada: la elección es del dueño. Primero el
 * script de Ecommodo; SerpApi solo si no trajo ninguna que sirva. `motor` dice quién
 * contestó.
 */
export async function candidatosDeFotos(env, { nombre, gb, color, esAccesorio }) {
  const q = [nombreParaAmazon(nombre), gb, nombreParaAmazon(color)].filter(Boolean).join(' ');
  const opciones = { nombre, color, esAccesorio };
  const propio = await buscarComoEcommodo(q);
  let candidatos = candidatasDeResultados(propio.resultados, opciones), motor = 'ecommodo';
  if (!candidatos.length && env.SERPAPI_KEY) {
    const pagos = await buscarEnSerpApi(env, q).catch(e => { console.log('serpapi', e.message); return []; });
    candidatos = candidatasDeResultados(pagos, opciones);
    motor = 'serpapi';
  }
  if (!candidatos.length) console.log('fotos sin candidatas', q, JSON.stringify(propio.fuentes));
  // Google Imágenes trae mucha basura para esto (lo vio Juni el 12/10/2026): queda apagado
  // salvo que FOTOS_GOOGLE sea "si". Lo manual de verdad es pegar el link de la foto.
  const google = env.FOTOS_GOOGLE === 'si' ? await buscarEnGoogleImagenes(env, q).catch(e => { console.log('google imágenes', e.message); return []; }) : [];
  return { consulta: q, motor: candidatos.length ? motor : '', candidatos: [...candidatos, ...candidatosDeGoogle(google, opciones)] };
}

/**
 * Baja y sube las fotos que el dueño eligió. Los nombres salen de `base` y `desde`
 * (base-3, base-4…), con la extensión real de cada imagen.
 */
export async function traerFotos(env, { base, desde, urls }, token) {
  const subidos = [], fallidas = [];
  let n = Math.max(1, Number(desde) || 1);
  for (const url of urls) {
    const img = await bajarImagen(url, { externa: true });
    if (!img) { fallidas.push(url); continue; }
    const archivo = `${base}${n > 1 ? '-' + n : ''}.${img.ext}`;
    await subirAStorage(env, archivo, img, token);
    subidos.push(archivo);
    n++;
  }
  return { subidos, fallidas };
}

/** Los resultados de Amazon vía SerpApi. Gasta una consulta del cupo. */
async function buscarEnSerpApi(env, q) {
  const u = `${SERP}?engine=amazon&amazon_domain=amazon.com&k=${encodeURIComponent(q)}&api_key=${env.SERPAPI_KEY}`;
  const r = await fetch(u);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`SerpApi: ${d.error || r.status}`);
  return d.organic_results || [];
}

/**
 * Los resultados de una búsqueda: primero el script de Ecommodo, que no usa ninguna
 * clave; si no trae nada, SerpApi (cuando hay clave).
 */
export async function buscarEnAmazon(env, q) {
  const { resultados, fuentes } = await buscarComoEcommodo(q);
  if (resultados.length) return resultados;
  console.log('el script de fotos no trajo nada', q, JSON.stringify(fuentes));
  if (!env.SERPAPI_KEY) return [];
  return buscarEnSerpApi(env, q);
}

/** Baja una imagen. Devuelve {bytes, ext} o null si no es una imagen. `externa`: una URL que eligió el dueño, de cualquier host público. */
export async function bajarImagen(url, { externa = false } = {}) {
  if (!(externa ? urlPublicaSegura(url) : urlImagenPermitida(url))) return null;
  // Sin seguir redirecciones: una imagen de Amazon no debería redirigir a otro host, y
  // Cloudflare no acepta redirect "error" (solo "follow" o "manual"), así que se corta a mano.
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;   // un 3xx también es "no ok"
  const tipo = r.headers.get('content-type') || '';
  const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : tipo.includes('jpeg') || tipo.includes('jpg') ? 'jpg' : null;
  if (!ext) return null;
  if (Number(r.headers.get('content-length')) > MAX_IMAGEN) { await r.body?.cancel(); return null; }
  if (!r.body) return null;
  const lector = r.body.getReader();
  const partes = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      if (total > MAX_IMAGEN) { await lector.cancel(); return null; }
      partes.push(value);
    }
  } finally { lector.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) { bytes.set(parte, offset); offset += parte.length; }
  if (bytes.length < 5000) return null;   // un placeholder, no una foto
  return { bytes, ext };
}

const TIPOS = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** El nombre de un archivo de `fotos/`, como los arma el sistema (el mismo patrón que storage.rules). */
export const esArchivoDeFoto = nombre => /^[a-z0-9][a-z0-9-]{0,118}[.](jpe?g|png|webp)$/.test(String(nombre || ''));

/**
 * Una foto de `fotos/`, tal cual está en Storage. El bucket no deja que una página lea los
 * píxeles de sus imágenes (no manda cabeceras CORS); el sistema las pide por acá para
 * medir el recuadro del producto. Devuelve `{ bytes, tipo }` o null si no existe.
 */
export async function leerFoto(env, archivo) {
  if (!esArchivoDeFoto(archivo)) return null;
  const r = await fetch(`https://storage.googleapis.com/${env.FOTOS_BUCKET || FOTOS_BUCKET}/${FOTOS_CARPETA}/${archivo}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const tipo = r.headers.get('content-type') || '';
  if (!tipo.startsWith('image/') || Number(r.headers.get('content-length')) > MAX_IMAGEN) { await r.body?.cancel(); return null; }
  return { bytes: await r.arrayBuffer(), tipo };
}

/** La URL de subida de la API REST de Storage para un archivo de `fotos/`. Exportado para el test. */
export function urlSubidaStorage(bucket, archivo) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(`${FOTOS_CARPETA}/${archivo}`)}`;
}

/**
 * Sube (o pisa) un archivo en `fotos/` de Firebase Storage con el token del dueño. Si el
 * token no es del dueño o no es una imagen, las reglas de Storage lo rechazan (403).
 */
export async function subirAStorage(env, nombre, { bytes, ext }, token) {
  if (!token) throw new Error('falta el token del dueño');
  const r = await fetch(urlSubidaStorage(env.FOTOS_BUCKET || FOTOS_BUCKET, nombre), {
    method: 'POST',
    headers: { Authorization: `Firebase ${token}`, 'Content-Type': TIPOS[ext] || 'image/jpeg' },
    body: bytes,
  });
  if (!r.ok) throw new Error(`Storage respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return nombre;
}

/**
 * El trabajo completo para un producto: buscar, elegir, bajar y subir. Devuelve los
 * nombres de archivo subidos (vacío si no encontró nada usable).
 */
export async function fotosParaProducto(env, { nombre, gb, color, esAccesorio }, token) {
  const q = [nombreParaAmazon(nombre), gb, nombreParaAmazon(color)].filter(Boolean).join(' ');
  const resultados = await buscarEnAmazon(env, q);
  const urls = elegirImagenes(resultados, { nombre, color, esAccesorio });
  const base = slugFoto(nombre) + (color ? '-' + slugFoto(color) : '');
  const subidos = [];
  for (let i = 0; i < urls.length; i++) {
    const img = await bajarImagen(urls[i]);
    if (!img) continue;
    const archivo = `${base}${subidos.length ? '-' + (subidos.length + 1) : ''}.${img.ext}`;
    await subirAStorage(env, archivo, img, token);
    subidos.push(archivo);
  }
  return { consulta: q, candidatos: resultados.length, subidos };
}
