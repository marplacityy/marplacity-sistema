/**
 * Fotos de productos desde Amazon, vía SerpApi.
 * ------------------------------------------------
 * Para un producto sin foto, busca en Amazon "nombre capacidad color", se queda con la
 * imagen principal de los primeros resultados que se parezcan (fondo blanco, de
 * fabricante o vendedor oficial, que es lo que se ve en los listados), la baja y la
 * sube a `fotos/` del repositorio con el nombre que el sistema espera. El sistema
 * después la asigna con "Clasificar fotos nuevas" (la IA confirma modelo y color) o
 * queda asignada por el nombre del archivo.
 *
 * Por qué acá y no en el browser: la clave de SerpApi y el token de GitHub no pueden
 * viajar en un HTML público. Y por qué SerpApi y no pegarle a Amazon: Amazon bloquea
 * scrapers con CAPTCHAs y cambia el HTML seguido; SerpApi ya resuelve eso.
 *
 * Variables:
 *   SERPAPI_KEY    (Secret)  clave de serpapi.com (250 búsquedas gratis por mes)
 *   GITHUB_TOKEN   (Secret)  token con "Contents: read/write" SOLO sobre este repo
 *   GITHUB_REPO    (Text)    marplacityy/marplacity-sistema
 */

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

export async function buscarEnAmazon(env, q) {
  if (!env.SERPAPI_KEY) throw new Error('falta SERPAPI_KEY');
  const u = `${SERP}?engine=amazon&amazon_domain=amazon.com&k=${encodeURIComponent(q)}&api_key=${env.SERPAPI_KEY}`;
  const r = await fetch(u);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`SerpApi: ${d.error || r.status}`);
  return d.organic_results || [];
}

/** Baja una imagen. Devuelve {bytes, ext} o null si no es una imagen. */
export async function bajarImagen(url) {
  if (!urlImagenPermitida(url)) return null;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
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

const b64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Sube (o pisa) un archivo en fotos/ del repo por la API de GitHub. Devuelve el nombre. */
export async function subirAlRepo(env, nombre, bytes) {
  if (!env.GITHUB_TOKEN) throw new Error('falta GITHUB_TOKEN');
  const repo = env.GITHUB_REPO || 'marplacityy/marplacity-sistema';
  const url = `https://api.github.com/repos/${repo}/contents/fotos/${encodeURIComponent(nombre)}`;
  const cab = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'marplacity-tienda', Accept: 'application/vnd.github+json' };
  // Si ya existe hay que mandar su sha para pisarlo.
  const prev = await fetch(url, { headers: cab });
  const sha = prev.ok ? (await prev.json()).sha : undefined;
  const r = await fetch(url, {
    method: 'PUT', headers: { ...cab, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `fotos: ${nombre} (desde Amazon)`, content: b64(bytes), sha }),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return nombre;
}

/**
 * El trabajo completo para un producto: buscar, elegir, bajar y subir. Devuelve los
 * nombres de archivo subidos (vacío si no encontró nada usable).
 */
export async function fotosParaProducto(env, { nombre, gb, color, esAccesorio }) {
  const q = [nombreParaAmazon(nombre), gb, nombreParaAmazon(color)].filter(Boolean).join(' ');
  const resultados = await buscarEnAmazon(env, q);
  const urls = elegirImagenes(resultados, { nombre, color, esAccesorio });
  const base = slugFoto(nombre) + (color ? '-' + slugFoto(color) : '');
  const subidos = [];
  for (let i = 0; i < urls.length; i++) {
    const img = await bajarImagen(urls[i]);
    if (!img) continue;
    const archivo = `${base}${subidos.length ? '-' + (subidos.length + 1) : ''}.${img.ext}`;
    await subirAlRepo(env, archivo, img.bytes);
    subidos.push(archivo);
  }
  return { consulta: q, candidatos: resultados.length, subidos };
}
