/**
 * Fotos de productos: de Amazon, MercadoLibre y BestBuy.
 * ------------------------------------------------
 * Busca con el script de Ecommodo (fotos-ecommodo.js): un buscador de imágenes y la
 * página de Amazon, sin claves ni cupo de nadie. SerpApi queda de respaldo, solo para
 * cuando el script no trae nada (y si hay clave).
 *
 * Para un producto sin foto busca "nombre capacidad color" y se queda con las fotos de
 * esas tiendas que son del modelo pedido (`candidatasDeResultados`). Qué fotos van —fondo
 * blanco, la mejor resolución, sin repetir— lo decide el sistema, que las mide en el
 * navegador y se las muestra al dueño antes de guardar nada ("Buscar fotos que faltan").
 * `fotosParaProducto` es el camino sin revisión, para el importador de listas: más
 * estricto, exige el color en el título.
 *
 * Por qué acá y no en el browser: una página no puede leer los resultados de un buscador
 * ni de Amazon (CORS), y la clave de SerpApi no puede viajar en un HTML público.
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
import { esPalabraDeColor } from '../../../src/shared/catalogo.js';
import { buscarComoEcommodo, fotoDeTienda } from './fotos-ecommodo.js';

const SERP = 'https://serpapi.com/search.json';
const MAX_IMAGEN = 8 * 1024 * 1024;

/**
 * Lo que viene de un buscador es externo: no autoriza a consultar la red interna. El
 * Worker baja por su cuenta solo fotos de producto de las tres tiendas (`fotoDeTienda`).
 */
export const urlImagenPermitida = valor => !!fotoDeTienda(valor);

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
    .replace(/\s*\/\/.*$/, ' ')                       // "iPhone 16 Black // SIM + eSIM": lo de atrás es una aclaración
    .replace(/\([^)]*\)/g, ' ')                      // "(Usado Grado A, 100% Ampsentrix)" no es parte del modelo
    .replace(/^\s*accesorios?\s+/i, '')              // "Accesorio Magic Keyboard…"
    .replace(/\s+-\s+(?=[A-Z0-9]*\d)[A-Z0-9]{5,}\s*$/, ' ')   // " - MJEL4LS": el código del proveedor
    .replace(/\b\d{1,2}\s?\+\s?(?=\d{2,4}\s?(?:gb|tb)\b)/gi, ' ')   // "12+256GB": los 12 son de RAM
    .replace(/(^|\s)\d{1,2}\+(?=\s|$)/g, ' ')         // "S26 Ultra 12+": lo mismo, suelto
    .replace(/\b\d{1,2}\/(?=\d{2,4}\s?(?:gb|tb)\b)/gi, ' ')         // "8/512GB": RAM y disco
    .replace(/\b(con|with)\s+e?sim\b|\be?sim\b/gi, ' ') // "con SIM", "SIM + eSIM": la foto es la misma
    .replace(/(?<!galaxy\s)\bwatch\s+s(\d{1,2})\b/gi, 'Apple Watch Series $1')   // "Watch S12", como lo escriben las listas
    .replace(/\bSB\b/g, 'Sport Band')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')            // caracteres invisibles que traen las listas
    .replace(/\b(genuine|original|nuevo|nueva|sellado|sellada|caja cerrada)\b/gi, ' ')
    .replace(/\bserie\b/gi, 'Series')
    .replace(/\b(gps|cellular|celular|wifi|wi-fi)\b/gi, ' ')
    .replace(/\b[SML]\/[SML]\b/g, ' ')                // tallas de malla M/L, S/M
    .replace(/\b\d+\s?gb\s+ram\b/gi, ' ')             // "8GB RAM" no ayuda a encontrar la foto
    .replace(/\bram\b/gi, ' ')                        // ni "RAM 512gb", como lo escriben otras listas
    .replace(/\baluminio\b/gi, 'Aluminum')
    .replace(COLOR_ES, c => COLORES_EN[c.toLowerCase()])   // Amazon titula en inglés: "Azul" → "Blue"
    .replace(/\blavander\b/gi, 'Lavender')            // como lo escribe Amazon
    .replace(/\(\s*usb\s*-?\s*c\s*\)/gi, ' USB-C ')    // "( USB - C )" → "USB-C"
    .replace(/\s[+-](?=\s|$)/g, ' ')                  // un "+" o un guion que quedó suelto
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
    // La versión grande: Amazon sirve miniaturas con sufijo de tamaño (._AC_UY218_.).
    const foto = fotoDeTienda(r.thumbnail || r.image);
    if (!foto || vistas.has(foto.url)) continue;
    vistas.add(foto.url);
    out.push(foto.url);
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

// Un color como lo titula una tienda de afuera, y como lo titula MercadoLibre.
const COLOR_EN_CASTELLANO = {
  black: ['negro', 'negra'], white: ['blanco', 'blanca'], blue: ['azul'], red: ['rojo', 'roja'], green: ['verde'], pink: ['rosa', 'rosado'],
  gray: ['gris', 'grey'], grey: ['gris', 'gray'], silver: ['plata', 'plateado'], gold: ['dorado', 'oro'], purple: ['violeta', 'lila', 'morado', 'purpura'],
  yellow: ['amarillo'], orange: ['naranja'], midnight: ['medianoche'], starlight: ['estelar'], titanium: ['titanio'], desert: ['desierto'],
  graphite: ['grafito'], lavender: ['lavanda'], sage: ['salvia'], teal: ['azulado', 'turquesa'], ultramarine: ['ultramar', 'ultramarino'],
  deep: ['profundo', 'oscuro'], dark: ['oscuro'], light: ['claro'], sky: ['cielo', 'celeste'], space: ['espacial'],
};

const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "3rd", "3nd" (así lo escribe Amazon a veces) son el 3.
const palabrasDe = s => sinAcentos(s).split(/[^a-z0-9]+/).filter(Boolean).map(w => w.replace(/^(\d+)(st|nd|rd|th)$/, '$1'));
const esCapacidad = w => /^\d+(gb|tb)$/.test(w);

/**
 * Lo que se le escribe al buscador para un producto. Exportado para el test.
 *
 * Como en Ecommodo, la búsqueda sale del nombre que armó la IA ("Apple iPhone 16 128GB
 * Black"): es como lo titula una tienda. Si el producto todavía no tiene título, del
 * nombre de la lista con su color. La capacidad no va: la foto de un equipo es la misma
 * en 128 que en 256, y con ella el buscador devuelve menos. Hasta diez palabras.
 */
export function consultaDeFoto({ nombre, titulo, color } = {}) {
  const base = nombreParaAmazon(titulo || nombre).split(' ').filter(w => w && !esCapacidad(w.toLowerCase())).join(' ');
  const elColor = nombreParaAmazon(color);
  const yaLoDice = elColor && palabrasDe(elColor).every(w => palabrasDe(base).includes(w));
  return [base, yaLoDice ? '' : elColor].join(' ').split(' ').filter(Boolean).slice(0, 10).join(' ');
}

const miniaturaDe = ({ tienda, url }) => tienda === 'Amazon' ? url.replace(/\.(jpg|jpeg|png|webp)$/i, '._AC_UL320_.$1')
  : tienda === 'MercadoLibre' ? url.replace('/D_NQ_NP_2X_', '/D_NQ_NP_').replace(/-F\.webp$/, '-O.webp')
  : url.replace(/;maxHeight=\d+;maxWidth=\d+$/, ';maxHeight=320;maxWidth=320');

// Lo que se vende para acompañar a otro producto, y cómo se reconoce en un título que es
// de un accesorio PARA el producto buscado ("Case for iPad", "Pulsera Ocean para Apple
// Watch", "Bands 49mm Compatible") y no del producto mismo, que puede traer su estuche:
// los AirPods se titulan "with MagSafe Charging Case".
const DE_ACCESORIO = 'case|cover|funda|carcasa|estuche|shell|skin|sleeve|protector|holder|mount|soporte|stand|strap|band|correa|pulsera|malla|cable|charger|cargador|adapter|adaptador|keyboard|teclado|pencil|folio';
const PIDE_ACCESORIO = new RegExp(`\\b(${DE_ACCESORIO})s?\\b`);
// Un reloj se nombra con su caja y su malla ("Titanium Case", "Ocean Band"): no por eso es un accesorio.
const PIDE_ACCESORIO_DE_RELOJ = new RegExp(`\\b(${DE_ACCESORIO.split('|').filter(w => !['case', 'strap', 'band', 'correa', 'pulsera', 'malla'].includes(w)).join('|')})s?\\b`);
const ES_RELOJ = /\bwatch\b.*(\b(series|ultra|se)\b|\d{2}\s?mm\b)/;
const ES_PARA_OTRO = new RegExp(`\\b(${DE_ACCESORIO})s?\\s+(?:\\S+\\s+){0,2}(for|para|compatible)\\b|\\bcompatible (with|con)\\b|\\bscreen protector\\b|\\btempered glass\\b|\\bvidrio templado\\b`);

/**
 * Las candidatas para revisar a mano, a partir de los resultados de una búsqueda
 * ({title, thumbnail}). Exportado para el test.
 *
 * Solo fotos de producto de las tres tiendas, y solo del modelo pedido. Para un equipo el
 * título tiene que traer todo lo que lleva número ("17", "s26", "m4": ahí está el modelo),
 * las variantes pedidas ("pro", "max") y casi todas las demás palabras; no puede ser de
 * otra variante ("16" no es "16e" ni "16 Pro"), ni un accesorio para ese equipo. Para lo
 * demás (relojes, accesorios, cables, parlantes), que se titulan con la malla, el color y
 * las medidas, alcanza con la mitad de las palabras; en un reloj o un parlante, además,
 * los números sueltos ("Ultra 4" no es "Ultra 2").
 *
 * El color no se exige —los títulos vienen cortados— pero se anota si aparece, en inglés
 * o en castellano (MercadoLibre): con color cargado, el sistema solo elige solas las que
 * lo nombran. Es más permisivo que `elegirImagenes` porque nada se guarda sin que el
 * dueño lo vea.
 */
export function candidatasDeResultados(resultados, { nombre, titulo, color, esAccesorio = false, max = 16 } = {}) {
  const base = nombreParaAmazon(titulo || nombre);
  const colores = palabrasDe(nombreParaAmazon(color));
  const enMinuscula = sinAcentos(base);
  const buscaAccesorio = esAccesorio || (ES_RELOJ.test(enMinuscula) ? PIDE_ACCESORIO_DE_RELOJ : PIDE_ACCESORIO).test(enMinuscula);
  const suelto = buscaAccesorio || /watch|parlante|speaker/i.test(base);
  const pedidas = [...new Set(palabrasDe(base))].filter(w => w !== 'apple' && !/^\d+(gb|tb|mm)$/.test(w) && !/^[45]g$/.test(w) && !colores.includes(w) && !(suelto && esPalabraDeColor(w)));
  if (!pedidas.length) return [];
  const conNumero = pedidas.filter(w => /\d/.test(w));
  const deVariante = pedidas.filter(w => VARIANTES.includes(w));
  const resto = pedidas.filter(w => !/\d/.test(w) && !VARIANTES.includes(w));
  // De las palabras sin número puede faltar alguna (la marca, "galaxy"), según cuántas son.
  const puedenFaltar = resto.length <= 2 ? 0 : resto.length <= 4 ? 1 : 2;
  const esElModelo = enTitulo => suelto
    ? (buscaAccesorio || pedidas.filter(w => /^\d+$/.test(w)).every(w => enTitulo.has(w))) && pedidas.filter(w => enTitulo.has(w)).length >= Math.max(1, Math.ceil(pedidas.length / 2))
    : conNumero.every(w => enTitulo.has(w)) && deVariante.every(w => enTitulo.has(w)) && resto.filter(w => !enTitulo.has(w)).length <= puedenFaltar;
  const vistas = new Set(), out = [];
  for (const r of Array.isArray(resultados) ? resultados : []) {
    const palabras = palabrasDe(r.title);
    const enTitulo = new Set(palabras);
    if (!esElModelo(enTitulo)) continue;
    // "Pro" o "Max" detrás del chip ("A18 Pro", "M4 Max") es el nombre del chip, no otra variante.
    const variantesDelTitulo = palabras.filter((w, i) => VARIANTES.includes(w) && !/^[am]\d{1,2}$/.test(palabras[i - 1] || ''));
    if (!suelto && variantesDelTitulo.some(v => !pedidas.includes(v))) continue;
    // "16e", "s25fe": el número pedido seguido de letras es otro modelo.
    if (!suelto && pedidas.some(w => /^[a-z]?\d+$/.test(w) && palabras.some(t => t !== w && new RegExp(`^${w}[a-z]{1,2}$`).test(t)))) continue;
    if (!buscaAccesorio && ES_PARA_OTRO.test(sinAcentos(r.title))) continue;
    const foto = fotoDeTienda(r.thumbnail || r.image);
    if (!foto || vistas.has(foto.url)) continue;
    vistas.add(foto.url);
    const nombraElColor = colores.length > 0 && colores.every(c => enTitulo.has(c) || (COLOR_EN_CASTELLANO[c] || []).some(e => enTitulo.has(e)));
    out.push({ url: foto.url, thumb: miniaturaDe(foto), ancho: 0, alto: 0, fuente: foto.tienda, titulo: String(r.title || '').slice(0, 120), color: nombraElColor });
  }
  // Primero las que nombran el color pedido; dentro de cada grupo, el orden de la búsqueda.
  return out.sort((a, b) => b.color - a.color).slice(0, max);
}

// Con cuántas fotos del modelo no hace falta seguir preguntando en otras fuentes.
const FOTOS_QUE_ALCANZAN = 4;

/**
 * Las candidatas para elegir a mano, sin bajar nada: la elección es del dueño. Primero el
 * script de Ecommodo; SerpApi solo si no trajo ninguna que sirva. `motor` dice quién
 * contestó y `fuentes` qué pasó con cada fuente consultada (cuántas fotos trajo, o por
 * qué no contestó), para mostrarlo cuando un producto queda sin fotos.
 */
export async function candidatosDeFotos(env, { nombre, titulo, color, esAccesorio }) {
  const q = consultaDeFoto({ nombre, titulo, color });
  const opciones = { nombre, titulo, color, esAccesorio };
  const propio = await buscarComoEcommodo(q, { alcanza: lista => candidatasDeResultados(lista, opciones).length >= FOTOS_QUE_ALCANZAN });
  const fuentes = { ...propio.fuentes };
  let candidatos = candidatasDeResultados(propio.resultados, opciones), motor = 'ecommodo';
  if (!candidatos.length && env.SERPAPI_KEY) {
    const pagos = await buscarEnSerpApi(env, q).then(r => { fuentes.serpapi = r.length; return r; }, e => { fuentes.serpapi = e.message; return []; });
    candidatos = candidatasDeResultados(pagos, opciones);
    motor = 'serpapi';
  }
  if (!candidatos.length) console.log('fotos sin candidatas', q, JSON.stringify(fuentes));
  // Google Imágenes trae mucha basura para esto (lo vio Juni el 12/10/2026): queda apagado
  // salvo que FOTOS_GOOGLE sea "si". Lo manual de verdad es pegar el link de la foto.
  const google = env.FOTOS_GOOGLE === 'si' ? await buscarEnGoogleImagenes(env, q).catch(e => { console.log('google imágenes', e.message); return []; }) : [];
  return { consulta: q, motor: candidatos.length ? motor : '', fuentes, candidatos: [...candidatos, ...candidatosDeGoogle(google, opciones)] };
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

/**
 * Una foto de una de las tiendas, para medirla: BestBuy no deja que una página lea los
 * píxeles de sus imágenes, así que el sistema la pide por acá. Solo las tres tiendas
 * (`urlImagenPermitida`). Devuelve `{ bytes, tipo }` o null.
 */
export async function leerFotoDeTienda(url) {
  const img = await bajarImagen(url);
  return img && { bytes: img.bytes, tipo: TIPOS[img.ext] };
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
