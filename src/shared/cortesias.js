/** Cortesías (vidrio templado, funda) que salen del inventario del local.
 * Funciones puras: buscan qué artículo del inventario corresponde al equipo vendido
 * y calculan cuánto descontar. La escritura a Firestore vive en modulos/inventario.js. */

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Palabras que distinguen variantes de un mismo modelo: "iPhone 15" no es "iPhone 15 Pro".
const VARIANTES = new Set(['pro', 'max', 'plus', 'mini', 'ultra', 'fe', 'lite', 'edge', 'note', 'se']);
const MARCAS = new Set(['iphone', 'apple', 'samsung', 'galaxy', 'motorola', 'moto', 'xiaomi', 'redmi', 'poco', 'huawei', 'lg', 'tcl', 'nokia', 'oppo', 'realme', 'oneplus', 'pixel']);
const PALABRAS = { vidrio: /\b(vidrio|templado|glass|protector)\b/, funda: /\b(funda|case|cover)\b/ };

// Lo que identifica al modelo en un nombre: marca, variantes y todo lo que tenga
// números ("15", "a54", "s23"). Colores, capacidades y descripciones se ignoran.
const tokensModelo = nombre => new Set(norm(nombre).split(' ').filter(t => t && !/^\d+(gb|tb)$/.test(t) && (MARCAS.has(t) || VARIANTES.has(t) || /\d/.test(t))));

/** El artículo del inventario para esa cortesía y ese equipo, o null si no hay uno claro.
 * El nombre del inventario tiene que nombrar el tipo (vidrio/templado o funda/case) y su
 * modelo tiene que ser exactamente el del equipo: "Funda iPhone 15" sirve para
 * "iPhone 15 128GB Negro", no para "iPhone 15 Pro". Si hay varios, gana el de más stock. */
export function buscarCortesiaEnInventario(tipo, equipoNombre, invItems) {
  const patron = PALABRAS[tipo];
  const equipo = tokensModelo(equipoNombre);
  if (!patron || ![...equipo].some(t => /\d/.test(t))) return null;
  const candidatos = (invItems || []).filter(p => {
    const n = norm(p.nombre);
    if (!patron.test(n)) return false;
    const inv = tokensModelo(n);
    if (![...inv].some(t => /\d/.test(t))) return false;              // "Funda genérica" no es de ningún modelo
    if (![...inv].every(t => equipo.has(t))) return false;              // todo lo del artículo está en el equipo
    for (const t of equipo) if (VARIANTES.has(t) && !inv.has(t)) return false; // y ninguna variante del equipo falta
    return true;
  });
  return candidatos.sort((a, b) => (b.qty || 0) - (a.qty || 0))[0] || null;
}

/** Cuánto descontar (positivo) o devolver (negativo) por artículo, comparando las
 * cortesías que tenía una venta con las que tiene ahora. Solo cuentan las que
 * salieron del inventario (tienen refId). */
export function deltaCortesias(antes, despues) {
  const cuenta = lista => {
    const m = new Map();
    for (const co of lista || []) if (co?.refId) m.set(co.refId, (m.get(co.refId) || 0) + (co.qty || 1));
    return m;
  };
  const a = cuenta(antes), d = cuenta(despues), delta = new Map();
  for (const ref of new Set([...a.keys(), ...d.keys()])) {
    const n = (d.get(ref) || 0) - (a.get(ref) || 0);
    if (n) delta.set(ref, n);
  }
  return delta;
}
