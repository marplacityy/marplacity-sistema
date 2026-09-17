/** Cortesías (vidrio templado, funda) que salen del inventario del local.
 * Funciones puras: buscan qué artículo del inventario corresponde al equipo vendido
 * y calculan cuánto descontar. La escritura a Firestore vive en modulos/inventario.js. */

// Cómo se reconoce el tipo, por categoría del producto o por su nombre.
const TIPOS = {
  vidrio: /\b(vidrios?|templados?|glass|films?|protector(es)?|hidrogel)\b/,
  funda: /\b(fundas?|cases?|covers?|silicone)\b/
};
// Palabras que distinguen variantes de un mismo modelo: "iPhone 15" no es "iPhone 15 Pro".
const VARIANTES = new Set(['pro', 'max', 'plus', 'mini', 'ultra', 'fe', 'lite', 'edge', 'note', 'se']);
const MARCAS = new Set(['iphone', 'samsung', 'motorola', 'xiaomi', 'redmi', 'poco', 'huawei', 'lg', 'tcl', 'nokia', 'oppo', 'realme', 'oneplus', 'pixel']);
// Abreviaturas y sinónimos con que se cargan los nombres: "IPH 15 PRO", "Sam A54", "Galaxy S23".
const ALIAS = { iph: 'iphone', ip: 'iphone', sam: 'samsung', galaxy: 'samsung', moto: 'motorola' };
// Números que no nombran un modelo: capacidad (128gb), dureza o curva del vidrio (9h, 5d, 2.5d), red (5g), potencia (20w).
const RUIDO = /^\d+(gb|tb|d|h|g|w|mah|mm|k)$/;

const norm = s => String(s || '').toLowerCase()
  .replace(/\d+[.,]\d+\s?[dh]\b/g, ' ')            // "2.5D" antes de que el punto se vuelva espacio
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/(\d)(pro|max|plus|mini|ultra)/g, '$1 $2') // "13PRO" → "13 pro", "13PROMAX" → "13 pro max"
  .replace(/promax/g, 'pro max');

const separar = s => s.replace(/[^a-z0-9/]+/g, ' ').trim();

// Lo que identifica al modelo en un texto: marca, variantes y todo lo que tenga
// números ("15", "a54", "s23", "16e"). Colores, capacidades y descripciones se ignoran.
const tokensModelo = texto => new Set(separar(texto).replace(/\//g, ' ').split(' ')
  .map(t => ALIAS[t] || t)
  .filter(t => t && !RUIDO.test(t) && (MARCAS.has(t) || VARIANTES.has(t) || /\d/.test(t))));

// Un artículo puede servir a varios modelos: "IPH 13/14/13PRO/16E" son cuatro alternativas.
// La primera lleva la marca y las palabras del tipo; las demás, solo el modelo.
const alternativas = nombre => separar(norm(nombre)).split('/').map(tokensModelo).filter(t => [...t].some(x => /\d/.test(x)));

const esDelTipo = (tipo, p) => {
  const cat = norm(p.categoria);
  if (cat) for (const [t, patron] of Object.entries(TIPOS)) if (patron.test(cat)) return t === tipo; // la categoría manda
  return TIPOS[tipo].test(norm(p.nombre));
};

const coincide = (inv, equipo) => {
  if (![...inv].every(t => equipo.has(t))) return false;                 // todo lo del artículo está en el equipo
  for (const t of equipo) if (VARIANTES.has(t) && !inv.has(t)) return false; // y ninguna variante del equipo falta
  return true;
};

/** El artículo del inventario para esa cortesía y ese equipo, o null si no hay uno claro.
 * El artículo tiene que ser del tipo (por categoría "Vidrios"/"Fundas" o por su nombre) y
 * nombrar exactamente el modelo del equipo: "Funda iPhone 15" sirve para "iPhone 15 128GB
 * Negro", no para "iPhone 15 Pro"; "FILM DISPLAY 5D IPH 13/14/13PRO" sirve para el 13, el
 * 14 y el 13 Pro. Si hay varios, gana el que tiene stock, después el que dice "cortesía",
 * después el más barato: una funda original no es la que se regala. */
export function buscarCortesiaEnInventario(tipo, equipoNombre, invItems) {
  if (!TIPOS[tipo]) return null;
  const equipo = tokensModelo(norm(equipoNombre));
  if (![...equipo].some(t => /\d/.test(t))) return null;
  const candidatos = (invItems || []).filter(p => esDelTipo(tipo, p) && alternativas(p.nombre).some(alt => coincide(alt, equipo)));
  const puntaje = p => [(p.qty || 0) > 0 ? 0 : 1, /cortesia/.test(norm(p.nombre)) ? 0 : 1, p.costo || 0, -(p.qty || 0)];
  return candidatos.sort((a, b) => {
    const pa = puntaje(a), pb = puntaje(b);
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  })[0] || null;
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
