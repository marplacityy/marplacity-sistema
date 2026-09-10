export const slugFoto = nombre => String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin acentos
.toLowerCase().replace(/\([^)]*\)/g, ' ') // sin lo que va entre paréntesis: "(Usado Grado A, 100%)"
.replace(/\b(usado|usada|nuevo|nueva|sellado|sellada|grado\s*[a-c]|refurb\w*|reacondicionad\w*|ampsentrix|\d{2,3}\s?%)\b/g, ' ') // el estado no es parte del modelo
.replace(/\b\d+\s?(gb|tb)\b/g, ' ') // sin capacidad
.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');
export const CATEGORIAS_CATALOGO = ['iPhone nuevos', 'iPhone usados', 'iPad nuevos', 'MacBook nuevas', 'Apple Watch nuevos', 'AirPods', 'Accesorios de carga', 'Accesorios iPad', 'Accesorios iPhone', 'Accesorios Apple', 'Celulares Samsung', 'Celulares Xiaomi', 'Notebooks', 'Otros'];
export const esUsado = p => /usad|refurb|reacond|impecab|\d+\s*\/\s*10/i.test(p.estado || '') || p.bateria != null && !/nuev|sellad/i.test(p.estado || '');
export function categoriaDe(p) {
  const n = String(p.nombre || '');
  const t = s => s.test(n);
  if (t(/pencil|teclado|keyboard|smart folio|smart cover|magic keyboard/i) && t(/ipad|pencil/i)) return 'Accesorios iPad';
  if (t(/funda|case|cover|vidrio|templado|glass|protector|magsafe|wallet/i) && t(/iphone|magsafe/i)) return 'Accesorios iPhone';
  if (t(/funda|case|cover|teclado|keyboard/i) && t(/ipad/i)) return 'Accesorios iPad';
  if (t(/airpods|auricular|earpods|beats/i)) return 'AirPods';
  if (t(/apple watch|\bwatch\b|malla|band/i) && !t(/samsung|xiaomi|galaxy/i)) return 'Apple Watch nuevos';
  if (t(/macbook|imac|mac mini|mac studio|\bmac\b/i)) return 'MacBook nuevas';
  if (t(/ipad/i)) return 'iPad nuevos';
  if (t(/iphone/i)) return esUsado(p) ? 'iPhone usados' : 'iPhone nuevos';
  // Carga va después de los equipos: "AirPods Max (USB-C)" no es un cable.
  if (t(/cargador|charger|cable|usb|lightning|adaptador|adapter|power ?bank|bater[ií]a externa|fuente|\bw\b|watt/i)) return 'Accesorios de carga';
  if (t(/samsung|galaxy/i)) return 'Celulares Samsung';
  if (t(/xiaomi|redmi|poco/i)) return 'Celulares Xiaomi';
  if (t(/notebook|laptop|lenovo|\bhp\b|dell|asus|acer|thinkpad|chromebook/i)) return 'Notebooks';
  if (t(/apple|airtag|homepod|apple tv|magic/i)) return 'Accesorios Apple';
  return 'Otros';
}

/**
 * Todo lo que califica: equipos en stock, artículos del inventario con cantidad, y los
 * ítems de la última lista de cada origen. Un mismo producto en dos listas entra una sola
 * vez, con el precio de la primera (Mar del Plata, CABA, proveedor, en ese orden).
 */
export
/**
 * Arma el mapa producto → archivos a partir de la lista de archivos.
 *
 * Manda lo que se decidió por archivo (la IA o Juni a mano); si no hay decisión, la clave
 * sale del nombre como siempre: `iphone-15-black-2.jpg` es la segunda foto de
 * `iphone-15-black`. El sufijo se saca SOLO si existe el archivo base sin él, para no
 * romper un modelo que de verdad termine en número.
 *
 * Dentro de cada producto va primero el frente: es la foto de la tarjeta.
 */
function armarMapaFotos(archivos, clasificacion) {
  // Los "bases" válidos para un sufijo -2: un archivo sin sufijo, o una clave ya asignada.
  const stems = new Set([...archivos.map(n => n.replace(/\.[^.]+$/, '')), ...Object.values(clasificacion).map(c => c && c.clave).filter(Boolean)]);
  const mapa = {};
  for (const nombre of [...archivos].sort()) {
    const c = clasificacion[nombre];
    let clave;
    if (c && 'clave' in c) {
      if (!c.clave) continue; // mirada y sin producto: no entra al mapa
      clave = c.clave;
    } else {
      const stem = nombre.replace(/\.[^.]+$/, '');
      const m = /^(.+)-[2-9]$/.exec(stem);
      clave = m && stems.has(m[1]) ? m[1] : stem;
    }
    (mapa[clave] ||= []).push(nombre);
  }
  const orden = ['ambos', 'frente'];
  const peso = a => {
    const v = clasificacion[a]?.vista;
    const i = orden.indexOf(v);
    return i >= 0 ? i : v ? 3 : 2; // ambos, frente, sin dato, el resto
  };
  for (const k in mapa) mapa[k].sort((a, b) => peso(a) - peso(b) || a.length - b.length || a.localeCompare(b));
  return mapa;
}

/** Los archivos de imagen que hay de verdad en `fotos/`, según GitHub. */
