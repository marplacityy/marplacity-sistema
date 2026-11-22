export const slugFoto = nombre => String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin acentos
.toLowerCase().replace(/\([^)]*\)/g, ' ') // sin lo que va entre paréntesis: "(Usado Grado A, 100%)"
.replace(/\b(usado|usada|nuevo|nueva|sellado|sellada|grado\s*[a-c]|refurb\w*|reacondicionad\w*|ampsentrix|\d{2,3}\s?%)\b/g, ' ') // el estado no es parte del modelo
.replace(/\b\d+\s?(gb|tb)\b/g, ' ') // sin capacidad
.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');
/**
 * Las secciones de la tienda y las categorías de cada una. La tira de arriba, las
 * secciones de la portada y los filtros salen de acá; lo que se elige por producto sigue
 * siendo la categoría. El orden es el de la tienda: lo pidió Juni el 22/11/2026, con
 * secciones específicas (iPhone nuevos, iPhone usados, iPad con sus Pencil y teclados…)
 * en lugar de rubros amplios ("Celulares", "Audio"). Una categoría creada a mano desde el
 * sistema cae en la sección que sugiere su nombre (`rubroDe`) y, si no se reconoce, en
 * Otros.
 */
export const RUBROS_CATALOGO = {
  'iPhone nuevos': ['iPhone nuevos'],
  'iPhone usados': ['iPhone usados'],
  'iPad': ['iPad nuevos', 'Accesorios iPad'],
  'Accesorios Apple': ['Accesorios Apple', 'Accesorios iPhone', 'Accesorios de carga'],
  'Consolas': ['Consolas'],
  'Notebooks': ['MacBook nuevas', 'Notebooks'],
  'Celulares Samsung': ['Celulares Samsung'],
  'Celulares Xiaomi': ['Celulares Xiaomi'],
  'Celulares Motorola': ['Celulares Motorola'],
  'Parlantes y auriculares': ['AirPods', 'Auriculares', 'Parlantes'],
  'Smartwatch': ['Apple Watch nuevos', 'Otros smartwatch'],
  'Tablets': ['Tablets'],
  'Otros celulares': ['Otros celulares'],
  'Electrodomésticos': ['Smart TV', 'Heladeras y freezers', 'Lavarropas', 'Climatización', 'Cocina', 'Pequeños electrodomésticos'],
  'Otros': ['Monitores', 'Fundas y protectores', 'Otros accesorios', 'Otros'],
};
export const CATEGORIAS_CATALOGO = Object.values(RUBROS_CATALOGO).flat();

// Para una categoría que no está en la tabla. El orden importa: "Fundas iPhone" tiene
// "iPhone" adentro y "Smart TV Samsung" tiene "Samsung", así que lo específico va primero.
const RUBRO_POR_NOMBRE = [
  [/pencil|(teclado|keyboard|funda|accesorio)s?.*ipad/i, 'iPad'],
  [/(accesorio|funda|cable|cargador|vidrio|protector|\bcase\b|soporte|adaptador)s?.*(apple|iphone|magsafe)|magsafe/i, 'Accesorios Apple'],
  [/accesorio|funda|cable|cargador|vidrio|protector|\bcase\b|soporte|adaptador/i, 'Otros'],
  [/\btv\b|televisor|heladera|freezer|lavarropa|secarropa|lavavajilla|\baires?\b|climatiz|cocina|horno|microondas|electrodom|aspiradora|freidora|cafetera|licuadora|ventilador|calefac|estufa|termotanque|anafe/i, 'Electrodomésticos'],
  [/consola|playstation|\bps[345]\b|xbox|nintendo|gaming|videojuego|joystick/i, 'Consolas'],
  [/parlante|auricular|airpods|audio|sonido|speaker|soundbar/i, 'Parlantes y auriculares'],
  [/watch|reloj|smartwatch|\bband\b/i, 'Smartwatch'],
  [/ipad/i, 'iPad'],
  [/tablet|\btab\b/i, 'Tablets'],
  [/notebook|laptop|macbook|computaci|\bpc\b|chromebook/i, 'Notebooks'],
  [/iphone.*usad/i, 'iPhone usados'],
  [/iphone/i, 'iPhone nuevos'],
  [/samsung|galaxy/i, 'Celulares Samsung'],
  [/xiaomi|redmi|poco/i, 'Celulares Xiaomi'],
  [/motorola|\bmoto\b/i, 'Celulares Motorola'],
  [/celular|smartphone|tel[eé]fono/i, 'Otros celulares'],
];
/** La sección de una categoría: la de la tabla, o la que sugiere el nombre si la creó Juni. */
export function rubroDe(categoria) {
  const c = String(categoria || '');
  for (const r in RUBROS_CATALOGO) if (RUBROS_CATALOGO[r].includes(c)) return r;
  const m = RUBRO_POR_NOMBRE.find(([re]) => re.test(c));
  return m ? m[1] : 'Otros';
}
/**
 * La capacidad escrita siempre igual: "256gb", "256 GB" y "256GB" son la misma. Cada
 * proveedor la escribe a su manera, y sin esto la tienda las ofrecía como dos opciones.
 */
export const capacidadPareja = gb => {
  const t = String(gb ?? '').trim();
  return /^\d+(?:[.,]\d+)?\s*(gb|tb)$/i.test(t) ? t.replace(/\s+/g, '').toUpperCase() : t;
};
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
  if (t(/pencil|keyboard folio|smart folio|smart cover/i) || t(/teclado|keyboard/i) && t(/ipad/i)) return 'Accesorios iPad';
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
  if (t(/playstation|\bps[345]\b|xbox|nintendo|\bswitch\b|joystick|dualsense|consola/i)) return 'Consolas';
  // Computación.
  if (t(/macbook|imac|mac mini|mac studio|\bmac\b/i)) return 'MacBook nuevas';
  if (t(/ipad/i)) return 'iPad nuevos';
  if (t(/tablet|galaxy tab|\btab\b|\bpad\b/i)) return 'Tablets';   // "Redmi Pad", "Poco Pad": el iPad ya salió arriba
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

/** Cuántas unidades de un producto entran en un pedido de la tienda: un usado es una unidad única. */
export const MAX_CANTIDAD_PEDIDO = 5;
export const cantidadMaxima = producto => (producto?.condicion === 'usado' ? 1 : MAX_CANTIDAD_PEDIDO);
