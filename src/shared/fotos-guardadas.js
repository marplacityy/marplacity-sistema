/**
 * shared/fotos-guardadas: cuáles de las fotos que ya están guardadas le sirven a un producto.
 *
 * Una foto guardada pertenece a una clave ("iphone-16-pink"), que salió del nombre del
 * producto al que se le cargó. Si después el mismo equipo entra por otra lista, escrito de
 * otra manera ("iPhone 16 Rosa", "iPhone 16 Pink // SIM + eSIM"), su clave es otra y queda
 * sin foto aunque la foto esté ahí. Acá se reconoce que es el mismo modelo, y el mismo
 * color, sin importar cómo esté escrito: es lo que usa "Elegir de las guardadas" en la
 * ficha de un producto para proponerlas solo.
 */
import { esPalabraDeColor } from './catalogo.js';
import { modeloDe } from './modelos-tienda.js';

/** El modelo y el color que nombra un texto, con las palabras de color fuera del modelo. */
function identidad(nombre, color) {
  const m = modeloDe({ nombre, color });
  const delColor = new Set(m.color.split(' ').filter(Boolean));
  const delModelo = [];
  for (const w of m.clave.split(' ').filter(Boolean)) {
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
  const nombre = String(producto?.nombre ?? '');
  const a = identidad(nombre, producto?.color);
  // "Samsung S26 Ultra 12+": hay listas que anotan así la RAM. La foto puede estar guardada con ese 12 o sin él.
  const sinRam = identidad(nombre.replace(/(^|\s)\d{1,2}\+(?=\s|$)/g, ' '), producto?.color);
  const b = identidad(String(claveFoto ?? '').replace(/[-_]+/g, ' '), '');
  if (!a.modelo || (b.modelo !== a.modelo && b.modelo !== sinRam.modelo)) return '';
  if (a.pulgadas && b.pulgadas && a.pulgadas !== b.pulgadas) return '';
  return a.color === b.color ? 'igual' : 'modelo';
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
