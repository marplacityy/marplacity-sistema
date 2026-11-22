/**
 * shared/duplicados: el mismo producto en las listas de varios proveedores.
 *
 * Cada proveedor escribe a su manera: uno pone "iPhone 18 Pro Burgundy" con la capacidad
 * aparte, otro "iPhone 18 Pro" con el color aparte; uno aclara 11" o "16GB RAM" y otro
 * no. Acá está todo lo que hace falta para reconocerlos, sin red ni pantalla:
 *
 *   - el identificador de un producto de lista (`idDeItemLista`) y el paso desde el
 *     identificador viejo, que ignoraba la capacidad (`migrarIdsDeLista`);
 *   - qué renglones de qué listas son el mismo producto (`gruposDuplicados`);
 *   - a qué precio queda el producto unificado (`precioUnificado`) y a quién conviene
 *     pedírselo (`ofertaMasBarata`).
 *
 * Nada de esto decide solo: los grupos se le muestran al dueño y él confirma.
 */
import { slugFoto } from './catalogo.js';

const sinAcentos = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Un texto como parte de un identificador: minúsculas, números y guiones. */
export const slugId = t => sinAcentos(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Un resumen corto y estable de un texto, para acortar identificadores largos sin que choquen. */
function resumen(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = (h * 33 ^ texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// El Worker de la tienda corta los ids de un pedido a 120 letras: el id entero tiene que entrar.
const MAX_SLUG = 96;

/**
 * El identificador de un renglón de una lista de precios.
 *
 * Sale del texto y no de un documento, porque cada guardado de la lista es un documento
 * nuevo y el link que un cliente compartió ayer tiene que seguir cayendo en el mismo
 * producto. Entra TODO lo que distingue a un producto de otro: modelo, capacidad, color
 * y si es usado. Hasta noviembre de 2026 se armaba con `slugFoto`, que descarta la
 * capacidad y lo que va entre paréntesis (sirve para las fotos, que son del modelo): un
 * iPhone de 256, 512 y 1TB quedaba como un solo producto, al precio del primero.
 */
export function idDeItemLista(it) {
  let slug = slugId([it?.producto, it?.gb, it?.color].filter(Boolean).join(' '));
  if (slug.length > MAX_SLUG) slug = slug.slice(0, MAX_SLUG - 8).replace(/-+$/, '') + '-' + resumen(slug);
  return 'lista_' + slug + (it?.condicion === 'usado' ? '-usado' : '');
}

/** El identificador como se armaba antes. Solo para pasar lo guardado al nuevo. */
export const idViejoDeItemLista = it => 'lista_' + slugFoto([it?.producto, it?.gb, it?.color, it?.condicion].filter(Boolean).join(' '));

/**
 * Pasa al identificador nuevo lo que estaba guardado por el viejo: qué va a la tienda,
 * categoría y entrega, precio propio, descripción y título.
 *
 * `items` son los renglones de las listas vigentes, en el orden en que se leen. Varios
 * podían compartir un id viejo (las capacidades de un mismo modelo) y solo el primero se
 * veía. Al separarlos:
 *   - todos heredan estar en la tienda, la categoría y la entrega: son del modelo;
 *   - el precio propio, la descripción y el título quedan en el primero, que es el que
 *     se veía cuando se escribieron (hablan de esa capacidad).
 *
 * Solo agrega: lo guardado por el id viejo no se borra, así una pestaña que todavía corre
 * la versión anterior sigue viendo lo mismo. Devuelve los cuatro campos de la
 * configuración ya completados y cuántos productos se separaron, o null si no había
 * nada que pasar.
 */
export function migrarIdsDeLista(cfg, items) {
  const porViejo = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const viejo = idViejoDeItemLista(it), nuevo = idDeItemLista(it);
    const l = porViejo.get(viejo) || porViejo.set(viejo, []).get(viejo);
    if (!l.includes(nuevo)) l.push(nuevo);
  }
  const incluidos = new Set(Array.isArray(cfg?.catalogoIncluidos) ? cfg.catalogoIncluidos : []);
  const ajustes = { ...(cfg?.catalogoAjustes || {}) };
  const notas = { ...(cfg?.catalogoNotas || {}) };
  const meta = { ...(cfg?.catalogoMeta || {}) };
  let pasados = 0, separados = 0;
  for (const [viejo, nuevos] of porViejo) {
    const otros = nuevos.filter(n => n !== viejo);
    if (!otros.length) continue;                      // el id no cambió
    const primero = nuevos[0];
    let toco = false;
    if (incluidos.has(viejo)) {
      otros.forEach(n => incluidos.add(n));
      toco = true;
    }
    if (ajustes[viejo]) {
      const { precioUSD, ...delModelo } = ajustes[viejo];
      for (const n of otros) {
        const aj = { ...delModelo, ...(n === primero && precioUSD ? { precioUSD } : {}), ...(ajustes[n] || {}) };
        if (Object.keys(aj).length) ajustes[n] = aj;
      }
      toco = true;
    }
    for (const mapa of [notas, meta]) {
      // Si un renglón conserva el id viejo, lo escrito ya es suyo.
      if (mapa[viejo] == null || primero === viejo || mapa[primero] != null) continue;
      mapa[primero] = mapa[viejo];
      toco = true;
    }
    if (toco) { pasados++; separados += nuevos.length - 1; }
  }
  if (!pasados) return null;
  return { catalogoIncluidos: [...incluidos], catalogoAjustes: ajustes, catalogoNotas: notas, catalogoMeta: meta, pasados, separados };
}

// ── ¿Es el mismo producto? ───────────────────────────────────
//
// De cada renglón se sacan sus palabras, ya normalizadas, en dos grupos:
//
//   fuertes   las que definen el producto: modelo, capacidad, color, "pro", "max", "cell"…
//             Dos renglones con palabras fuertes distintas NO son el mismo producto.
//   débiles   lo que un proveedor aclara y otro no, por clase: las pulgadas, la RAM, el
//             año, USB-C, WiFi, y el chip (SIM / eSIM). Si los dos lo aclaran y dicen
//             cosas distintas (11" y 13") no son el mismo; si uno solo lo aclara, sí.
//
// El orden de las palabras no importa, ni en qué campo vinieron: así "iPhone 18 Pro
// Burgundy" + 256gb es igual a "iPhone 18 Pro" + 256GB + Burgundy.

// Como lo escribe una lista de acá → como lo escribe la mayoría.
const SINONIMOS = {
  negro: 'black', negra: 'black', blanco: 'white', blanca: 'white', azul: 'blue', rojo: 'red', roja: 'red', verde: 'green',
  rosa: 'pink', rosado: 'pink', gris: 'gray', grey: 'gray', plata: 'silver', plateado: 'silver', dorado: 'gold', oro: 'gold',
  violeta: 'purple', lila: 'purple', morado: 'purple', amarillo: 'yellow', naranja: 'orange', grafito: 'graphite',
  titanio: 'titanium', medianoche: 'midnight', lavander: 'lavender', lavanda: 'lavender', serie: 'series', aluminio: 'aluminum',
  celular: 'cell', cellular: 'cell', lte: 'cell',
};
// No dicen nada del producto.
const RUIDO = new Set(['apple', 'accesorio', 'accesorios', 'ram', 'de', 'del', 'la', 'el', 'con', 'para', 'for', 'the', 'and', 'y',
  'en', 'gen', 'generation', 'generacion', 'new', 'nuevo', 'nueva', 'nuevos', 'sellado', 'sellada', 'sellados', 'color', 'memoria']);
const DE_USADO = /^(usad[oa]s?|refurb\w*|reacondicionad\w*|seminuev\w*)$/;
const CAPACIDAD = /^(\d+)(gb|tb)$/;
// Las clases "descriptivas" no cambian el producto si faltan de un lado; el chip sí puede.
const CLASES_VARIANTE = new Set(['chip']);

function claseDebil(palabra) {
  if (/^\d+(\.\d+)?in$/.test(palabra)) return 'pulgadas';
  if (/^20[12]\d$/.test(palabra)) return 'año';
  if (palabra === 'usbc') return 'conector';
  if (palabra === 'wifi') return 'red';
  if (palabra === 'sim' || palabra === 'esim') return 'chip';
  return '';
}

const enGb = palabra => { const m = CAPACIDAD.exec(palabra); return m ? Number(m[1]) * (m[2] === 'tb' ? 1024 : 1) : 0; };

/** Las palabras de un renglón: `{ fuertes: [...], debiles: { clase: [...] }, usado }`. */
export function palabrasDeItem(it) {
  // Una capacidad cargada sin unidad ("256") es de almacenamiento.
  const gb = /^\d+$/.test(String(it?.gb ?? '').trim()) ? String(it.gb).trim() + (Number(it.gb) <= 4 ? 'tb' : 'gb') : it?.gb;
  const texto = sinAcentos([it?.producto, gb, it?.color].filter(Boolean).join(' ')).toLowerCase()
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:''|"|”|″|pulgadas?\b|pulg\b|inch(?:es)?\b)/g, (_, n) => ` ${n.replace(',', '.')}in `)
    .replace(/(\d+)\s*\/\s*(\d+)\s*(gb|tb)\b/g, ' $1gb $2$3 ')        // "8/256GB": RAM y almacenamiento
    .replace(/(\d+)\s*(gb|tb)\b/g, ' $1$2 ')
    .replace(/(\d+)\s*mm\b/g, ' $1mm ')
    .replace(/\b(?:usb|tipo|type)\s*-?\s*c\b/g, ' usbc ')
    .replace(/\bwi\s*-?\s*fi\b/g, ' wifi ')
    .replace(/\be\s*-?\s*sim\b/g, ' esim ')
    .replace(/(\d+)\s*[°º]/g, '$1 ')
    .replace(/\b(\d+)(?:st|nd|rd|th|ra|da|ta|va)\b/g, '$1');            // "3rd Gen" → 3
  const palabras = [...new Set(texto.split(/[^a-z0-9.]+/).map(w => w.replace(/^\.+|\.+$/g, '')).filter(Boolean).map(w => SINONIMOS[w] || w))];
  const usado = it?.condicion === 'usado' || palabras.some(w => DE_USADO.test(w));
  const utiles = palabras.filter(w => !RUIDO.has(w) && !DE_USADO.test(w));
  // Con dos capacidades, la más chica es la RAM: se aclara o no según el proveedor.
  const capacidades = utiles.filter(w => CAPACIDAD.test(w)).sort((a, b) => enGb(b) - enGb(a));
  const ram = new Set(capacidades.slice(1));
  const fuertes = [], debiles = {};
  for (const w of utiles) {
    const clase = ram.has(w) ? 'ram' : claseDebil(w);
    if (clase) (debiles[clase] ||= []).push(w); else fuertes.push(w);
  }
  for (const c in debiles) debiles[c].sort();
  return { fuertes: fuertes.sort(), debiles, usado };
}

const claveFuerte = p => p.fuertes.join(' ') + (p.usado ? ' |usado' : '');
const claveDebil = p => Object.keys(p.debiles).sort().map(c => c + ':' + p.debiles[c].join('+')).join(' ');

/** Qué clases débiles separan a dos renglones: null si se contradicen, o la lista de las que uno aclara y el otro no. */
function diferencias(a, b) {
  const difieren = [];
  for (const clase of new Set([...Object.keys(a.debiles), ...Object.keys(b.debiles)])) {
    const x = a.debiles[clase], y = b.debiles[clase];
    if (x && y) { if (x.join('+') !== y.join('+')) return null; } else difieren.push(clase);
  }
  return difieren;
}

const ETIQUETA_DEBIL = w => /in$/.test(w) && /^\d/.test(w) ? w.replace('in', '"') : w === 'usbc' ? 'USB-C' : w === 'wifi' ? 'WiFi' : w === 'sim' ? 'SIM' : w === 'esim' ? 'eSIM' : CAPACIDAD.test(w) ? w.toUpperCase() + ' RAM' : w;

/** Si los precios de un grupo están tan lejos, conviene mirarlo antes de unificar. */
export const DISPERSION_SOSPECHOSA = 0.15;

/**
 * Agrupa las ofertas que son el mismo producto.
 *
 * `ofertas`: [{ id, origen, proveedor, producto, gb, color, condicion, precioUSD }], una
 * por renglón de cada lista vigente. Devuelve solo los grupos que son un duplicado de
 * verdad (más de un id, o un mismo id en más de una lista):
 *
 *   { clave, tipo, ofertas, ids, difieren, min, max, dispersion }
 *
 * `tipo` es "seguro" cuando coinciden en todo lo que define al producto, y "parecido"
 * cuando lo que los separa puede ser otra versión (uno dice "SIM + eSIM" y el otro no) o
 * cuando los precios están demasiado lejos para ser lo mismo. Dos renglones distintos de
 * un mismo proveedor nunca se juntan: si él los lista aparte, son dos productos.
 */
export function gruposDuplicados(ofertas) {
  const porFuerte = new Map();
  for (const o of Array.isArray(ofertas) ? ofertas : []) {
    const palabras = palabrasDeItem(o);
    if (!palabras.fuertes.length) continue;
    const k = claveFuerte(palabras);
    (porFuerte.get(k) || porFuerte.set(k, []).get(k)).push({ o, palabras });
  }
  const grupos = [];
  for (const [clave, filas] of porFuerte) {
    if (filas.length < 2) continue;
    // Los que coinciden también en lo débil son uno desde el arranque.
    const exactos = new Map();
    for (const f of filas) { const k = claveDebil(f.palabras); (exactos.get(k) || exactos.set(k, []).get(k)).push(f); }
    let racimos = [...exactos.values()].map(fs => ({ filas: fs, variante: false }));
    // Después se juntan de a pares, empezando por los que menos se diferencian.
    const pares = [];
    for (let i = 0; i < racimos.length; i++) for (let j = i + 1; j < racimos.length; j++) {
      const d = diferencias(racimos[i].filas[0].palabras, racimos[j].filas[0].palabras);
      if (d) pares.push({ a: racimos[i], b: racimos[j], variantes: d.filter(c => CLASES_VARIANTE.has(c)).length, total: d.length });
    }
    pares.sort((x, y) => x.variantes - y.variantes || x.total - y.total);
    const dueno = new Map(racimos.map(r => [r, r]));
    const raiz = r => { while (dueno.get(r) !== r) r = dueno.get(r); return r; };
    for (const par of pares) {
      const a = raiz(par.a), b = raiz(par.b);
      if (a === b) continue;
      const compatibles = a.filas.every(x => b.filas.every(y => {
        const d = diferencias(x.palabras, y.palabras);
        return d && (x.o.origen !== y.o.origen || claveDebil(x.palabras) === claveDebil(y.palabras));
      }));
      if (!compatibles) continue;
      a.filas.push(...b.filas);
      a.variante = a.variante || b.variante || par.variantes > 0;
      dueno.set(b, a);
    }
    racimos = racimos.filter(r => raiz(r) === r);
    for (const r of racimos) {
      const lista = r.filas.map(f => f.o);
      const ids = [...new Set(lista.map(o => o.id))];
      if (ids.length < 2 && new Set(lista.map(o => o.origen)).size < 2) continue;
      const precios = lista.map(o => Number(o.precioUSD)).filter(n => n > 0);
      const min = precios.length ? Math.min(...precios) : 0, max = precios.length ? Math.max(...precios) : 0;
      const dispersion = min ? (max - min) / min : 0;
      // Lo que algunos aclaran y otros no, para mostrarlo.
      const todas = new Set(), comunes = new Map();
      for (const f of r.filas) for (const w of Object.values(f.palabras.debiles).flat()) { todas.add(w); comunes.set(w, (comunes.get(w) || 0) + 1); }
      const difieren = [...todas].filter(w => comunes.get(w) < r.filas.length).map(ETIQUETA_DEBIL);
      grupos.push({
        clave: clave + (racimos.length > 1 ? ' #' + claveDebil(r.filas[0].palabras) : ''),
        tipo: r.variante || dispersion > DISPERSION_SOSPECHOSA ? 'parecido' : 'seguro',
        ofertas: lista, ids, difieren, min, max, dispersion,
      });
    }
  }
  return grupos;
}

export const REGLAS_PRECIO = {
  promedio: 'Promedio entre el más alto y el más bajo',
  minimo: 'El más barato',
  maximo: 'El más caro',
};

/**
 * El precio de un producto que está en varias listas. "promedio" es el punto medio entre
 * el más bajo y el más alto (no el promedio de todos: tres listas a 180, 180 y 200 dan
 * 190). Si los dos extremos terminan en 0 o 5, el resultado también.
 */
export function precioUnificado(precios, regla = 'promedio') {
  const v = (Array.isArray(precios) ? precios : []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!v.length) return 0;
  const min = Math.min(...v), max = Math.max(...v);
  if (regla === 'minimo') return min;
  if (regla === 'maximo') return max;
  const medio = (min + max) / 2;
  return min % 5 === 0 && max % 5 === 0 ? Math.round(medio / 5) * 5 : Math.round(medio);
}

/** A quién pedírselo: la oferta con precio más bajo; a igual precio, la primera. */
export function ofertaMasBarata(ofertas) {
  let mejor = null;
  for (const o of Array.isArray(ofertas) ? ofertas : []) {
    if (!(Number(o?.precioUSD) > 0)) continue;
    if (!mejor || Number(o.precioUSD) < Number(mejor.precioUSD)) mejor = o;
  }
  return mejor || (Array.isArray(ofertas) && ofertas[0]) || null;
}

/**
 * Con qué nombre queda el producto unificado: el del renglón mejor armado, que es el que
 * trae el color y la capacidad en su campo (la tienda agrupa las variantes de un modelo
 * por esos campos). A igualdad, el nombre más corto.
 */
export function ofertaMejorEscrita(ofertas) {
  const puntos = o => (o.color ? 2 : 0) + (o.gb ? 1 : 0);
  return [...(Array.isArray(ofertas) ? ofertas : [])].sort((a, b) => puntos(b) - puntos(a) || String(a.producto).length - String(b.producto).length)[0] || null;
}

/**
 * Lo que queda guardado al unificar los grupos marcados (cada uno con `queda`: la oferta
 * cuyo nombre lleva el producto). Devuelve los campos de la configuración a escribir. El precio propio del producto se va (ahora lo pone la
 * regla); descripción, título, categoría y entrega se conservan del que los tenga.
 */
export function unificarGrupos(cfg, grupos, regla = 'promedio') {
  const unificados = { ...(cfg.catalogoUnificados || {}) };
  const incluidos = new Set(cfg.catalogoIncluidos || []);
  const ajustes = { ...(cfg.catalogoAjustes || {}) };
  const notas = { ...(cfg.catalogoNotas || {}) };
  const meta = { ...(cfg.catalogoMeta || {}) };
  for (const g of grupos) {
    const principalDe = new Map();
    for (const [principal, u] of Object.entries(unificados)) for (const id of u?.ids || []) principalDe.set(id, principal);
    const elegido = g.ofertas[g.queda] || g.ofertas[0];
    // Si alguno ya estaba unificado, el producto sigue siendo ese: conserva su link y sus textos.
    const previos = [...new Set(g.ids.map(id => principalDe.get(id)).filter(Boolean))];
    const principal = previos[0] || elegido.id;
    const ids = new Set([principal, ...g.ids]);
    for (const previo of previos) for (const id of unificados[previo].ids || []) ids.add(id);
    for (const previo of previos.slice(1)) delete unificados[previo];
    const condicion = g.ofertas.some(o => o.condicion === 'usado') ? 'usado' : g.ofertas.some(o => o.condicion === 'nuevo') ? 'nuevo' : '';
    unificados[principal] = { ids: [...ids], regla, nombre: elegido.producto, gb: elegido.gb || '', color: elegido.color || '', condicion };
    const otros = [...ids].filter(id => id !== principal);
    if ([...ids].some(id => incluidos.has(id))) incluidos.add(principal);
    otros.forEach(id => incluidos.delete(id));
    const aj = {};
    for (const id of [principal, ...otros]) for (const campo of ['categoria', 'entrega']) if (aj[campo] == null && ajustes[id]?.[campo]) aj[campo] = ajustes[id][campo];
    if (Object.keys(aj).length) ajustes[principal] = aj; else delete ajustes[principal];
    for (const mapa of [notas, meta]) {
      if (mapa[principal] != null) continue;
      const de = otros.find(id => mapa[id] != null);
      if (de) mapa[principal] = mapa[de];
    }
  }
  return { catalogoUnificados: unificados, catalogoIncluidos: [...incluidos], catalogoAjustes: ajustes, catalogoNotas: notas, catalogoMeta: meta, catalogoReglaPrecio: regla };
}
