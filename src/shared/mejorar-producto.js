/**
 * shared/mejorar-producto: la ficha de un producto, lista para publicar.
 *
 * Es lo que hacía el importador de Ecommodo con cada lista: de "iPhone 16 Black // SIM +
 * eSIM | 128gb" sale un título prolijo, su categoría, una descripción corta y las
 * etiquetas SEO. Acá el producto ya existe (viene de la lista del proveedor) y la IA solo
 * lo deja presentable: no cambia el precio ni inventa datos.
 *
 * Este módulo no llama a nadie: arma el pedido (`SISTEMA_MEJORAR`, `mensajeParaMejorar`),
 * revisa lo que vuelve (`limpiarMejoras`) y sabe hacer una ficha decente sin IA
 * (`etiquetasBase`, `tituloBase`). Lo usan el sistema, que le pregunta a la IA de
 * siempre, y el Worker de la tienda, que le pregunta a la que tenga cargada.
 */

export const MAX_PRODUCTOS_POR_PEDIDO = 20;

export const SISTEMA_MEJORAR = `Sos quien arma las fichas de la tienda online de MarplaCity, un local de celulares y electrónica de Mar del Plata, Argentina. Te paso productos tal como figuran en las listas de los proveedores y devolvés, para cada uno, su ficha lista para publicar.

Para cada producto:
- "titulo": el nombre comercial completo y prolijo, como lo buscaría un cliente: marca, modelo, capacidad y color (ej: "Apple iPhone 16 128GB Black"). Sin códigos internos del proveedor (MJEL4LS), sin barras ni símbolos sueltos, sin MAYÚSCULAS sostenidas, sin palabras como "Accesorio" adelante. Si la lista aclara algo que distingue al producto (SIM física + eSIM, WiFi + Cellular, tamaño de malla) va al final entre paréntesis. Máximo 70 caracteres. El color queda con su nombre original.
- "categoria": EXACTAMENTE una de las categorías de la lista que te paso, la que mejor le corresponda.
- "descripcion": dos oraciones cortas en castellano rioplatense (voseo), concretas: qué es y qué lo distingue. Nada de "ideal para", "no te lo pierdas" ni adjetivos de venta. Sin precio, sin emojis.
- "etiquetas": entre 5 y 8 palabras clave en minúscula, como las escribiría en Google un cliente argentino: marca, modelo, capacidad, color en castellano, tipo de producto, y "mar del plata".
- "seo": la descripción para Google, hasta 150 caracteres, que nombre el producto y a MarplaCity.

Usá únicamente los datos que te doy: no inventes especificaciones, garantías, accesorios incluidos ni promociones. Si un dato no está, no lo menciones. Conservá el "id" de cada producto tal cual.

Respondé ÚNICAMENTE con un objeto JSON válido, sin texto ni markdown, con esta forma:
{"productos":[{"id":"...","titulo":"...","categoria":"...","descripcion":"...","etiquetas":["..."],"seo":"..."}]}`;

const corto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Los productos como se le mandan a la IA: solo lo que sirve para escribir. */
export function productosParaMejorar(productos) {
  return (Array.isArray(productos) ? productos : []).slice(0, MAX_PRODUCTOS_POR_PEDIDO).map(p => ({
    id: corto(p?.id, 130), nombre: corto(p?.nombre, 160),
    ...(p?.gb ? { capacidad: corto(p.gb, 20) } : {}), ...(p?.color ? { color: corto(p.color, 60) } : {}),
    condicion: p?.condicion === 'usado' ? 'usado' : 'nuevo',
    ...(p?.bateria != null && p.bateria !== '' ? { bateria: Number(p.bateria) } : {}),
    ...(p?.estado ? { estado: corto(p.estado, 80) } : {}),
    entrega: p?.entrega === 'pedido' ? 'se trae a pedido' : 'está en el local',
    ...(p?.categoria ? { categoriaActual: corto(p.categoria, 60) } : {}),
  })).filter(p => p.id && p.nombre);
}

export const categoriasParaMejorar = categorias => (Array.isArray(categorias) ? categorias : []).map(c => corto(c, 60)).filter(Boolean).slice(0, 80);

/** El mensaje del pedido: las categorías entre las que elegir y los productos. */
export const mensajeParaMejorar = (lista, categorias) =>
  `Categorías de la tienda (elegí una de estas para cada producto):\n${JSON.stringify(categorias)}\n\nProductos (JSON):\n${JSON.stringify(lista)}`;

/** Un JSON que vino como texto: tolera los \`\`\`json que algunos modelos agregan igual. */
export function jsonDeTexto(texto) {
  const limpio = String(texto || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(limpio); } catch { /* sigue */ }
  const desde = limpio.search(/[[{]/), hasta = Math.max(limpio.lastIndexOf('}'), limpio.lastIndexOf(']'));
  if (desde >= 0 && hasta > desde) { try { return JSON.parse(limpio.slice(desde, hasta + 1)); } catch { /* sigue */ } }
  return null;
}

/**
 * Lo que devolvió la IA, ya revisado: solo los productos pedidos, la categoría solo si es
 * una de las que existen, y cada texto dentro de su largo. Lo que no pasa queda afuera y
 * el sistema usa lo que ya tenía.
 */
export function limpiarMejoras(crudo, productos, categorias) {
  const pedidos = new Set((Array.isArray(productos) ? productos : []).map(p => String(p.id)));
  const cats = new Map((Array.isArray(categorias) ? categorias : []).map(c => [String(c).toLowerCase(), String(c)]));
  const lista = Array.isArray(crudo) ? crudo : Array.isArray(crudo?.productos) ? crudo.productos : [];
  const out = [];
  for (const m of lista) {
    const id = String(m?.id ?? '');
    if (!pedidos.has(id) || out.some(x => x.id === id)) continue;
    const titulo = corto(m.titulo, 90);
    const etiquetas = [...new Set((Array.isArray(m.etiquetas) ? m.etiquetas : String(m.etiquetas || '').split(',')).map(e => corto(e, 40).toLowerCase()).filter(Boolean))].slice(0, 10);
    out.push({
      id,
      ...(titulo.length >= 3 ? { titulo } : {}),
      ...(cats.has(String(m.categoria || '').toLowerCase()) ? { categoria: cats.get(String(m.categoria).toLowerCase()) } : {}),
      ...(corto(m.descripcion, 400).length > 20 ? { descripcion: corto(m.descripcion, 400) } : {}),
      ...(etiquetas.length ? { etiquetas } : {}),
      ...(corto(m.seo, 160).length > 20 ? { seo: corto(m.seo, 160) } : {}),
    });
  }
  return out;
}

// ── Sin IA ───────────────────────────────────────────────────
//
// Lo que se puede decir de un producto sin preguntarle a nadie. No es tan bueno como lo
// que escribe la IA, pero es correcto y deja la ficha completa si la IA no contesta.

const MARCAS = [
  [/\b(iphone|ipad|macbook|imac|mac\s?mini|airpods|airtag|homepod|apple|magic\s?keyboard|pencil)\b|\bwatch (s\d|se|ultra|series)/i, 'apple'],
  [/\b(samsung|galaxy)\b/i, 'samsung'], [/\b(xiaomi|redmi|poco)\b/i, 'xiaomi'], [/\b(motorola|moto)\b/i, 'motorola'],
  [/\bjbl\b/i, 'jbl'], [/\b(playstation|ps[345])\b/i, 'playstation'], [/\bxbox\b/i, 'xbox'], [/\bnintendo\b/i, 'nintendo'],
  [/\blenovo\b/i, 'lenovo'], [/\bhp\b/i, 'hp'], [/\bdell\b/i, 'dell'], [/\basus\b/i, 'asus'], [/\bacer\b/i, 'acer'],
  [/\b(google|pixel)\b/i, 'google'], [/\bhuawei\b/i, 'huawei'], [/\bsony\b/i, 'sony'],
];
const COLOR_EN_CASTELLANO = { black: 'negro', white: 'blanco', blue: 'azul', pink: 'rosa', silver: 'plateado', gold: 'dorado', gray: 'gris', grey: 'gris', green: 'verde', red: 'rojo', purple: 'violeta', yellow: 'amarillo', orange: 'naranja' };

/** El título sin lo que ensucia una lista: "Accesorio" adelante, las barras y los códigos del proveedor. */
export function tituloBase(p) {
  let aclaracion = '';
  const nombre = String(p?.nombre || '')
    .replace(/\s*\/\/\s*(.+)$/, (_, resto) => { aclaracion = resto.trim(); return ''; })
    .replace(/^accesorios?\s+/i, '')
    .replace(/\s+-\s+[A-Z0-9]{5,}$/, '')          // " - MJEL4LS"
    .replace(/\s+/g, ' ').trim();
  const gb = String(p?.gb || '').trim().replace(/(\d)\s*(gb|tb)$/i, (_, n, u) => n + u.toUpperCase());
  return [nombre, gb, String(p?.color || '').trim(), aclaracion ? `(${aclaracion})` : ''].filter(Boolean).join(' ');
}

/** Las etiquetas que se deducen del producto: marca, modelo, capacidad, color y categoría. */
export function etiquetasBase(p, categoria = '') {
  const nombre = String(p?.nombre || '');
  const texto = `${nombre} ${p?.color || ''}`.toLowerCase();
  const marca = MARCAS.find(([re]) => re.test(nombre))?.[1] || '';
  const modelo = nombre.toLowerCase().replace(/\s*\/\/.*$/, '').replace(/\([^)]*\)/g, ' ').replace(/^accesorios?\s+/, '').replace(/\s+-\s+[a-z0-9]{5,}$/, '').replace(/["']+/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
  const colores = Object.entries(COLOR_EN_CASTELLANO).filter(([en]) => new RegExp(`\\b${en}\\b`).test(texto)).map(([, es]) => es);
  return [...new Set([marca, modelo, String(p?.gb || '').toLowerCase().trim(), ...colores, String(categoria || '').toLowerCase(), p?.condicion === 'usado' ? 'usado' : '', 'mar del plata'].filter(Boolean))].slice(0, 8);
}
