/**
 * shared/fotos-guardadas: cuáles de las fotos que ya están guardadas le sirven a un producto.
 *
 * Una foto guardada pertenece a una clave ("iphone-16-pink"), que salió del nombre del
 * producto al que se le cargó. Si después el mismo equipo entra por otra lista, escrito de
 * otra manera ("iPhone 16 Rosa", "iPhone 16 Pink // SIM + eSIM"), su clave es otra y queda
 * sin foto aunque la foto esté ahí. Acá se reconoce que es el mismo modelo, y el mismo
 * color, sin importar cómo esté escrito.
 *
 * Y un paso más (Juni, 24/11/2026): hay artículos distintos que SE VEN igual. Un iPhone
 * 18 Pro Max con SIM y otro sin; una MacBook con Ñ y sin Ñ; los AirPods 4 con y sin
 * cancelación de ruido; un iPad WiFi y el Cellular. Son productos y precios distintos,
 * pero la foto es la misma: el sistema usa las de uno para el otro sin que haya que
 * cargarlas dos veces (`fotosCompartidas`, `prestarFotos`).
 *
 * Lo usan "Elegir de las guardadas" en la ficha, el sistema al armar cada producto y la
 * tienda al leer lo publicado.
 */
import { esPalabraDeColor } from './catalogo.js';
import { modeloDe } from './modelos-tienda.js';

// Lo que distingue a dos artículos pero no cómo se ven. (La SIM, la RAM, la capacidad, el
// WiFi y el USB-C ya quedan afuera del modelo: ver palabrasDeItem en duplicados.js.)
const NO_CAMBIA_LA_FOTO = new Set([
  'n', 'teclado', 'espanol', 'ingles', 'spanish', 'english', 'latam', 'internacional',      // la MacBook con Ñ y sin Ñ
  'noise', 'cancelling', 'canceling', 'cancelacion', 'ruido', 'anc', 'activa', 'active',   // los AirPods 4 con y sin cancelación
  'cell', 'gps', '5g', '4g', 'lte', 'dual',                                                 // WiFi o Cellular, una SIM o dos
  'unlocked', 'libre', 'liberado', 'bundle', 'bivolt', 'oem',
]);
// El código de parte de Apple que algunas listas pegan al final ("MJEL4LS", "MF0J4").
const ES_CODIGO_DE_APPLE = /^m(?=[a-z0-9]*\d)[a-z0-9]{4,6}$/;

/** El modelo y el color que nombra un texto: lo que define cómo se ve el artículo. */
function identidad(nombre, color) {
  const m = modeloDe({ nombre, color });
  const delColor = new Set(m.color.split(' ').filter(Boolean));
  const delModelo = [];
  for (const w of m.clave.split(' ').filter(Boolean)) {
    if (NO_CAMBIA_LA_FOTO.has(w) || ES_CODIGO_DE_APPLE.test(w)) continue;
    if (esPalabraDeColor(w)) delColor.add(w); else delModelo.push(w);
  }
  return { modelo: delModelo.join(' '), pulgadas: m.pulgadas, color: [...delColor].sort().join(' ') };
}

/**
 * Qué tan del producto es una foto guardada bajo `claveFoto`:
 *   'igual'   el mismo modelo y el mismo color
 *   'modelo'  el mismo modelo, en otro color (o uno de los dos no dice el color)
 *   ''        otro producto
 */
export function parecidoDeFoto(producto, claveFoto) {
  const b = identidad(String(claveFoto ?? '').replace(/[-_]+/g, ' '), '');
  const [a, sinRam] = aspectosDe(producto);
  if (!a.modelo || (b.modelo !== a.modelo && b.modelo !== sinRam.modelo)) return '';
  if (a.pulgadas && b.pulgadas && a.pulgadas !== b.pulgadas) return '';
  return a.color === b.color ? 'igual' : 'modelo';
}

/**
 * Cómo se ve un producto, de las dos maneras en que puede estar guardada su foto.
 * "Samsung S26 Ultra 12+": hay listas que anotan así la RAM, y la foto puede haberse
 * guardado con ese 12 o sin él.
 */
function aspectosDe(producto) {
  const nombre = String(producto?.nombre ?? '');
  return [identidad(nombre, producto?.color), identidad(nombre.replace(/(^|\s)\d{1,2}\+(?=\s|$)/g, ' '), producto?.color)];
}
const claveDeAspecto = a => `${a.modelo}|${a.color}`;

/**
 * Las fotos guardadas, ordenadas por cómo se ve lo que muestran: `Map(aspecto → [{ clave,
 * pulgadas, archivos }])`. Se arma una vez por cada cambio del mapa de fotos; buscar las
 * de un producto ahí adentro no cuesta nada, y hay que hacerlo para cada producto en cada
 * dibujo de la pantalla.
 */
export function indiceDeFotos(mapa) {
  const indice = new Map();
  for (const [clave, archivos] of Object.entries(mapa || {})) {
    if (!Array.isArray(archivos) || !archivos.length) continue;
    const a = identidad(clave.replace(/[-_]+/g, ' '), '');
    if (!a.modelo) continue;
    const k = claveDeAspecto(a);
    (indice.get(k) || indice.set(k, []).get(k)).push({ clave, pulgadas: a.pulgadas, archivos });
  }
  return indice;
}

/**
 * Las fotos de otro artículo que se ve igual que este —mismo modelo, mismo color—, para
 * cuando el producto no tiene propias: `{ clave, archivos }` o null. Entre varias, la
 * clave que más fotos tiene.
 */
export function fotosCompartidas(producto, claveDelProducto, indice) {
  if (!indice || !indice.size) return null;
  const [a, sinRam] = aspectosDe(producto);
  if (!a.modelo) return null;
  const candidatas = [...new Set([claveDeAspecto(a), claveDeAspecto(sinRam)])].flatMap(k => indice.get(k) || [])
    .filter(x => x.clave !== claveDelProducto && !(a.pulgadas && x.pulgadas && a.pulgadas !== x.pulgadas));
  if (!candidatas.length) return null;
  const mejor = candidatas.sort((x, y) => y.archivos.length - x.archivos.length || x.clave.localeCompare(y.clave))[0];
  return { clave: mejor.clave, archivos: mejor.archivos };
}

/**
 * Entre los productos ya publicados: el que no tiene foto toma las de otro que se ve
 * igual (y su recuadro de miniatura). Devuelve cuántos se completaron. Es lo que hace la
 * tienda al leer el catálogo, para que valga también con lo publicado de antes.
 */
export function prestarFotos(productos) {
  const lista = Array.isArray(productos) ? productos : [];
  const tiene = p => Array.isArray(p?.fotos) && p.fotos.length > 0;
  const donantes = new Map();
  for (const p of lista) {
    if (!tiene(p)) continue;
    const a = identidad(p.nombre, p.color);
    if (!a.modelo) continue;
    const k = claveDeAspecto(a);
    (donantes.get(k) || donantes.set(k, []).get(k)).push({ p, pulgadas: a.pulgadas });
  }
  let n = 0;
  for (const p of lista) {
    if (!p || tiene(p)) continue;
    const [a, sinRam] = aspectosDe(p);
    if (!a.modelo) continue;
    const donante = [...new Set([claveDeAspecto(a), claveDeAspecto(sinRam)])].flatMap(k => donantes.get(k) || [])
      .filter(x => !(a.pulgadas && x.pulgadas && a.pulgadas !== x.pulgadas))
      .sort((x, y) => y.p.fotos.length - x.p.fotos.length)[0];
    if (!donante) continue;
    p.fotos = donante.p.fotos;
    if (donante.p.fotoCaja) p.fotoCaja = donante.p.fotoCaja;
    n++;
  }
  return n;
}

/**
 * Las fotos guardadas, ordenadas para un producto: primero las de su mismo modelo y color,
 * después las del mismo modelo en otro color, y al final todas las demás.
 *
 * `mapa` es `{ clave: [archivos] }` y `sueltas`, los archivos que no son de ningún
 * producto. Las que ya son del producto (`claveDelProducto`) no entran. Devuelve
 * `[{ archivo, clave, parecido }]`.
 */
export function fotosGuardadasPara(producto, claveDelProducto, mapa, sueltas = []) {
  const out = [];
  for (const [clave, archivos] of Object.entries(mapa || {})) {
    if (clave === claveDelProducto) continue;
    const parecido = parecidoDeFoto(producto, clave);
    for (const archivo of Array.isArray(archivos) ? archivos : []) out.push({ archivo, clave, parecido });
  }
  // Una foto sin producto solo tiene su nombre de archivo: "iphone-16-rosa-2.jpg".
  for (const archivo of sueltas) out.push({ archivo, clave: '', parecido: parecidoDeFoto(producto, String(archivo).replace(/\.[^.]+$/, '').replace(/-[2-9]$/, '')) });
  const peso = { igual: 0, modelo: 1, '': 2 };
  return out.sort((x, y) => peso[x.parecido] - peso[y.parecido] || x.clave.localeCompare(y.clave) || x.archivo.localeCompare(y.archivo));
}

const sinAcentos = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Las fotos cuyo producto o archivo tiene todas las palabras buscadas ("iphone 16 pink"). */
export function buscarEntreGuardadas(lista, texto) {
  const palabras = sinAcentos(texto).split(/[^a-z0-9]+/).filter(Boolean);
  if (!palabras.length) return lista;
  return lista.filter(x => { const donde = sinAcentos(`${x.clave} ${x.archivo}`); return palabras.every(w => donde.includes(w)); });
}
