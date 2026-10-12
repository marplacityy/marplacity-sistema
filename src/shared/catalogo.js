export const slugFoto = nombre => String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin acentos
.toLowerCase().replace(/\([^)]*\)/g, ' ') // sin lo que va entre paréntesis: "(Usado Grado A, 100%)"
.replace(/\b(usado|usada|nuevo|nueva|sellado|sellada|grado\s*[a-c]|refurb\w*|reacondicionad\w*|ampsentrix|\d{2,3}\s?%)\b/g, ' ') // el estado no es parte del modelo
.replace(/\b\d+\s?(gb|tb)\b/g, ' ') // sin capacidad
.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');
/**
 * Los rubros de la tienda y las categorías de cada uno. El menú, las burbujas y las
 * secciones de la portada salen de acá; lo que se elige por producto sigue siendo la
 * categoría. El orden es el del menú. Una categoría creada a mano desde el sistema cae en
 * el rubro que sugiere su nombre (`rubroDe`) y, si no se reconoce, en Otros.
 */
export const RUBROS_CATALOGO = {
  'Celulares': ['iPhone nuevos', 'iPhone usados', 'Celulares Samsung', 'Celulares Xiaomi', 'Celulares Motorola', 'Otros celulares'],
  'Notebooks y tablets': ['Notebooks', 'MacBook nuevas', 'iPad nuevos', 'Tablets', 'Monitores'],
  'Audio': ['AirPods', 'Auriculares', 'Parlantes'],
  'Smartwatch': ['Apple Watch nuevos', 'Otros smartwatch'],
  'Accesorios': ['Accesorios iPhone', 'Accesorios iPad', 'Accesorios Apple', 'Accesorios de carga', 'Fundas y protectores', 'Otros accesorios'],
  'Electrodomésticos': ['Smart TV', 'Heladeras y freezers', 'Lavarropas', 'Climatización', 'Cocina', 'Pequeños electrodomésticos'],
  'Otros': ['Otros'],
};
export const CATEGORIAS_CATALOGO = Object.values(RUBROS_CATALOGO).flat();

// Para una categoría que no está en la tabla: los accesorios van primero porque "Fundas
// Samsung" tiene "Samsung" adentro, y los celulares al final por lo mismo.
const RUBRO_POR_NOMBRE = [
  [/accesorio|funda|cable|cargador|vidrio|protector|\bcase\b|soporte|adaptador/i, 'Accesorios'],
  [/\btv\b|televisor|heladera|freezer|lavarropa|secarropa|lavavajilla|\baires?\b|climatiz|cocina|horno|microondas|electrodom|aspiradora|freidora|cafetera|licuadora|ventilador|calefac|estufa|termotanque|anafe/i, 'Electrodomésticos'],
  [/parlante|auricular|airpods|audio|sonido|speaker|soundbar/i, 'Audio'],
  [/watch|reloj|smartwatch|\bband\b/i, 'Smartwatch'],
  [/notebook|laptop|macbook|ipad|tablet|monitor|computaci|\bpc\b|chromebook/i, 'Notebooks y tablets'],
  [/iphone|celular|smartphone|galaxy|xiaomi|motorola|samsung|tel[eé]fono/i, 'Celulares'],
];
/** El rubro de una categoría: el de la tabla, o el que sugiere el nombre si la creó Juni. */
export function rubroDe(categoria) {
  const c = String(categoria || '');
  for (const r in RUBROS_CATALOGO) if (RUBROS_CATALOGO[r].includes(c)) return r;
  const m = RUBRO_POR_NOMBRE.find(([re]) => re.test(c));
  return m ? m[1] : 'Otros';
}
export const esUsado = p => /usad|refurb|reacond|impecab|\d+\s*\/\s*10/i.test(p.estado || '') || p.bateria != null && !/nuev|sellad/i.test(p.estado || '');

/**
 * El borrador de la descripción de un producto para la tienda, a partir de sus datos:
 * una oración por dato, en el orden en que el cliente pregunta. Es lo que la IA pule; sin
 * IA queda así, que ya dice la verdad. Nunca lleva el precio: cambia.
 */
export function borradorDescripcion(d) {
  const usado = d.condicion === 'usado';
  const frases = [];
  frases.push(`${d.producto}${d.capacidad ? ' de ' + d.capacidad : ''}${d.color ? ' color ' + d.color : ''}, ${usado ? 'usado' : 'nuevo'}${d.estado && usado ? ' (' + d.estado + ')' : d.estado && /sellad/i.test(d.estado) ? ', sellado' : ''}.`);
  if (d.bateria != null) frases.push(`Batería al ${d.bateria}%${d.ciclos != null ? ` con ${d.ciclos} ciclos de carga` : ''}.`);
  if (d.cosmetica) frases.push(`Estética: ${d.cosmetica}.`);
  if (d.entrega) frases.push(d.entrega.charAt(0).toUpperCase() + d.entrega.slice(1) + '.');
  return frases.join(' ');
}
/**
 * La categoría automática de un producto, por el nombre y el estado. Las reglas se
 * prueban de arriba a abajo y gana la primera: los accesorios van antes que los equipos
 * porque "funda iPhone 15" tiene "iPhone" adentro, y los electrodomésticos antes que las
 * marcas porque "Smart TV Samsung" no es un celular.
 */
export function categoriaDe(p) {
  const n = String(p.nombre || '');
  const t = s => s.test(n);
  if (t(/pencil|teclado|keyboard|smart folio|smart cover|magic keyboard/i) && t(/ipad|pencil/i)) return 'Accesorios iPad';
  if (t(/funda|case|cover|vidrio|templado|glass|protector|magsafe|wallet/i) && t(/iphone|magsafe/i)) return 'Accesorios iPhone';
  if (t(/funda|case|cover|teclado|keyboard/i) && t(/ipad/i)) return 'Accesorios iPad';
  if (t(/funda|\bcase\b|cover|vidrio|templado|glass|protector|hidrogel/i)) return 'Fundas y protectores';
  // Audio.
  if (t(/airpods|earpods|beats/i)) return 'AirPods';
  if (t(/auricular|headphone|earbuds|\bbuds\b|headset|vincha/i)) return 'Auriculares';
  if (t(/parlante|speaker|soundbar|barra de sonido|subwoofer|bafle/i)) return 'Parlantes';
  // Relojes.
  if (t(/galaxy watch|smartwatch|smart watch|amazfit|mi band|smart band|garmin|huawei watch|redmi watch|reloj inteligente/i)) return 'Otros smartwatch';
  if (t(/apple watch|\bwatch\b|malla|band/i) && !t(/samsung|xiaomi|galaxy/i)) return 'Apple Watch nuevos';
  // Electrodomésticos.
  if (t(/smart tv|televisor|\btv\b/i) && !t(/apple tv/i)) return 'Smart TV';
  if (t(/heladera|freezer|exhibidora/i)) return 'Heladeras y freezers';
  if (t(/lavarropas|secarropas|lavasecarropas|lavavajillas/i)) return 'Lavarropas';
  if (t(/aire acondicionado|\bsplit\b|ventilador|calefactor|caloventor|estufa|climatiz|purificador|deshumidificador/i)) return 'Climatización';
  if (t(/cocina|horno|anafe|microondas|campana|termotanque|calef[oó]n/i)) return 'Cocina';
  if (t(/freidora|cafetera|licuadora|batidora|tostadora|\bpava\b|plancha|aspiradora|minipimer|sandwichera|procesadora|jugera|exprimidor|hervidor|secador de pelo|afeitadora|planchita|buclera/i)) return 'Pequeños electrodomésticos';
  // Computación.
  if (t(/macbook|imac|mac mini|mac studio|\bmac\b/i)) return 'MacBook nuevas';
  if (t(/ipad/i)) return 'iPad nuevos';
  if (t(/tablet|galaxy tab|\btab\b/i)) return 'Tablets';
  if (t(/monitor/i)) return 'Monitores';
  if (t(/iphone/i)) return esUsado(p) ? 'iPhone usados' : 'iPhone nuevos';
  // Carga va después de los equipos: "AirPods Max (USB-C)" no es un cable.
  if (t(/cargador|charger|cable|usb|lightning|adaptador|adapter|power ?bank|bater[ií]a externa|fuente|\bw\b|watt/i)) return 'Accesorios de carga';
  if (t(/samsung|galaxy/i)) return 'Celulares Samsung';
  if (t(/xiaomi|redmi|poco/i)) return 'Celulares Xiaomi';
  if (t(/motorola|\bmoto\b/i)) return 'Celulares Motorola';
  if (t(/celular|smartphone|tecno|infinix|realme|\boppo\b|huawei|nokia|\bzte\b|\bhonor\b|oneplus|pixel/i)) return 'Otros celulares';
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
