/**
 * shared/modelos-tienda: qué productos de la tienda son el mismo modelo, y cuáles sobran.
 *
 * Cada proveedor escribe el mismo equipo a su manera: "iPhone 17" y "iPhone 17 // SIM +
 * eSIM"; "MacBook Air 15'' M5 RAM 512gb" con la RAM cargada en el campo de la capacidad,
 * y "MacBook Air M5 15\" 16GB". En la tienda cada modelo va en una sola tarjeta, con la
 * capacidad y el color para elegir adentro; y cuando dos proveedores ofrecen la misma
 * variante queda una sola: la que está en el local y, si no, la más barata.
 *
 * La regla la puso Juni el 22/11/2026: con precio parecido es el mismo producto ("el 17 o
 * el 16 es el mismo"); si uno es considerablemente más caro —el iPhone 18 Pro Max "con
 * SIM" sale 250 dólares más— es otro producto y va aparte.
 *
 * Es solo para mostrar: los productos siguen publicados uno por uno, con su id. Lo usan
 * la tienda (al leer lo publicado, así no depende de republicar) y el sistema al publicar.
 */
import { palabrasDeItem } from './duplicados.js';

/** Cuánto más caro tiene que ser, para la misma capacidad, para que sea otro producto. */
export const MUCHO_MAS_CARO = 0.10;

const ES_CAPACIDAD = /^\d+(gb|tb)$/;
const palabrasDe = texto => palabrasDeItem({ producto: texto }).fuertes;

/**
 * Lo que identifica al modelo de un producto, sin lo que se elige adentro de su tarjeta.
 *
 *   clave      las palabras del modelo, ordenadas, sin capacidad, color, RAM ni pulgadas
 *   pulgadas   "13in", o '' si el nombre no lo dice
 *   ram        "16GB", o ''
 *   capacidad  la de almacenamiento: la más grande que aparezca, venga en el nombre o en
 *              su campo ("RAM 512gb" + 16GB → 512GB)
 *   color      el color, como lo escribe la mayoría ("Lavander" → "lavender")
 */
export function modeloDe(p) {
  const w = palabrasDeItem({ producto: p?.nombre, gb: p?.gb, color: p?.color, condicion: p?.condicion });
  const delColor = new Set(palabrasDe(p?.color));
  let pulgadas = (w.debiles.pulgadas || []).join('+');
  const base = w.fuertes.filter(x => !ES_CAPACIDAD.test(x) && !delColor.has(x));
  // En un iPad o una MacBook, "11" o "13" sueltos son el tamaño aunque no lleven comillas
  // ("iPad 11 (A16)"); en un iPhone son el modelo.
  if (!pulgadas && base.some(x => x === 'ipad' || x === 'macbook')) {
    const i = base.findIndex(x => /^\d{1,2}(\.\d)?$/.test(x) && Number(x) >= 9 && Number(x) <= 17);
    if (i >= 0) pulgadas = base.splice(i, 1)[0] + 'in';
  }
  return {
    clave: base.join(' '),
    pulgadas,
    ram: ((w.debiles.ram || [])[0] || '').toUpperCase(),
    capacidad: (w.fuertes.find(x => ES_CAPACIDAD.test(x)) || '').toUpperCase(),
    color: [...delColor].sort().join(' '),
  };
}

/**
 * El nombre de un modelo para su tarjeta, cuando hay que armarlo desde el nombre de una
 * lista: sin la RAM ni la capacidad (se eligen adentro) y, con `sinChip`, sin la
 * aclaración de SIM. "MacBook Air 15'' M5 RAM 512gb" → "MacBook Air 15'' M5".
 */
export function nombreDeModelo(nombre, { sinChip = false } = {}) {
  let n = String(nombre ?? '')
    .replace(/''|”|″/g, '"')
    .replace(/\b\d{1,2}\s*\/\s*(?=\d{2,4}\s?(?:gb|tb)\b)/gi, ' ')        // "8/256GB"
    .replace(/(^|\s)\d{1,2}\+(?=\s|$)/g, ' ')                           // "S26 Ultra 12+": la RAM, como la anota un proveedor
    .replace(/\b\d+\s?(?:gb|tb)\b(?:\s+ram\b)?/gi, ' ')
    .replace(/\bram\b/gi, ' ');
  if (sinChip) n = n.replace(/\bsim\s+f[ií]sica\b|\b(?:con|with)\s+e?sim\b|\be?sim\b/gi, ' ').replace(/\(\s*[+/y]?\s*\)/g, ' ');
  return n.replace(/\s+/g, ' ').replace(/\s+([)\]])/g, '$1').trim();
}

const precioDe = p => Number(p?.precioUSD) || 0;
// Entre dos ofertas de la misma variante: primero la que está en el local, después la más barata.
const esMejor = (a, b) => ((a.tipo === 'pedido') - (b.tipo === 'pedido') || precioDe(a) - precioDe(b)) < 0;

/** El precio más bajo de cada capacidad de una lista de productos. */
function minimos(productos, fichas) {
  const m = new Map();
  for (const p of productos) {
    const c = fichas.get(p).capacidad, precio = precioDe(p);
    if (precio > 0 && (!m.has(c) || precio < m.get(c))) m.set(c, precio);
  }
  return m;
}

/** Dos maneras de escribir un modelo son el mismo producto si, capacidad por capacidad, ninguna es mucho más cara. */
function preciosParecidos(a, b) {
  for (const [capacidad, x] of a) {
    const y = b.get(capacidad);
    if (y && Math.abs(x - y) / Math.min(x, y) > MUCHO_MAS_CARO) return false;
  }
  return true;
}

/**
 * Agrupa los productos de la tienda por modelo.
 *
 * Devuelve:
 *   grupoDe    Map(id → clave del grupo) de los productos que se agrupan (los nuevos que
 *              no son accesorios; un usado es una unidad única y va solo)
 *   nombres    Map(clave → nombre del modelo, armado desde los nombres de las listas)
 *   capacidad  Map(id → capacidad de almacenamiento), cuando se pudo saber
 *   repetidos  Map(id que sobra → id que queda): la misma variante (capacidad y color)
 *              ofrecida por dos listas de proveedores. Queda la que está en el local y,
 *              entre iguales, la más barata. Lo que viene del stock nunca sobra ni hace
 *              sobrar a nadie: es una unidad que está ahí.
 */
export function agruparModelos(productos, { categoriaDe = p => p.categoria || 'Otros', deLista = p => String(p?.id ?? '').startsWith('lista_') } = {}) {
  const fichas = new Map(), familias = new Map();
  for (const p of Array.isArray(productos) ? productos : []) {
    if (!p || p.condicion !== 'nuevo' || (p.tipo || 'equipo') === 'accesorio') continue;
    const f = modeloDe(p);
    if (!f.clave) continue;
    fichas.set(p, f);
    const k = `${categoriaDe(p)}|${f.clave}`;
    (familias.get(k) || familias.set(k, []).get(k)).push(p);
  }

  const grupoDe = new Map(), nombres = new Map(), capacidad = new Map(), repetidos = new Map();
  for (const [familia, lista] of familias) {
    // Las pulgadas y la RAM separan modelos (iPad Air de 11 y de 13), pero no todos los
    // proveedores las aclaran: el que no las dice va con el único que sí, si es uno solo.
    const unica = campo => { const v = new Set(lista.map(p => fichas.get(p)[campo]).filter(Boolean)); return v.size === 1 ? [...v][0] : ''; };
    const unicas = { pulgadas: unica('pulgadas'), ram: unica('ram') };
    const formas = new Map();
    for (const p of lista) {
      const f = fichas.get(p);
      const k = `${f.pulgadas || unicas.pulgadas}|${f.ram || unicas.ram}`;
      (formas.get(k) || formas.set(k, []).get(k)).push(p);
    }
    for (const [forma, deLaForma] of formas) {
      // Cada manera de escribirlo (cada proveedor), y cuáles son el mismo producto por precio.
      const escrituras = new Map();
      for (const p of deLaForma) {
        const k = String(p.nombre ?? '').trim().toLowerCase();
        (escrituras.get(k) || escrituras.set(k, []).get(k)).push(p);
      }
      const grupos = [];
      for (const variantes of [...escrituras.values()].sort((a, b) => b.length - a.length)) {
        const mins = minimos(variantes, fichas);
        const g = grupos.find(x => preciosParecidos(x.mins, mins));
        if (!g) { grupos.push({ variantes: [...variantes], mins, nombres: [variantes[0].nombre] }); continue; }
        g.variantes.push(...variantes);
        g.nombres.push(variantes[0].nombre);
        for (const [c, precio] of mins) if (!g.mins.has(c) || precio < g.mins.get(c)) g.mins.set(c, precio);
      }
      grupos.forEach((g, i) => {
        const clave = `${familia}|${forma}|${i}`;
        // Con una sola manera de escribirlo queda su aclaración ("con SIM": es lo que lo
        // distingue del otro); si se juntaron varias, el nombre más corto y sin ella.
        const candidatos = g.nombres.map(n => nombreDeModelo(n, { sinChip: g.nombres.length > 1 })).filter(Boolean);
        nombres.set(clave, candidatos.sort((a, b) => a.length - b.length)[0] || g.nombres[0]);
        const laQueQueda = new Map();
        const variante = p => `${fichas.get(p).capacidad}|${fichas.get(p).color}`;
        for (const p of g.variantes) {
          grupoDe.set(p.id, clave);
          if (fichas.get(p).capacidad) capacidad.set(p.id, fichas.get(p).capacidad);
          if (!deLista(p)) continue;
          const otra = laQueQueda.get(variante(p));
          if (!otra || esMejor(p, otra)) laQueQueda.set(variante(p), p);
        }
        for (const p of g.variantes) {
          const queda = deLista(p) && laQueQueda.get(variante(p));
          if (queda && queda !== p) repetidos.set(p.id, queda.id);
        }
      });
    }
  }
  return { grupoDe, nombres, capacidad, repetidos };
}
