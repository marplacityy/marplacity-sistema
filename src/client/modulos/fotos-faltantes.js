/**
 * modulos/fotos-faltantes: "Buscar fotos que faltan" de la pantalla Catálogo web.
 *
 * Es el importador de Ecommodo aplicado a lo que ya está cargado: deja cada producto
 * listo para la tienda, con sus fotos y su ficha. Para los productos de la tienda que no
 * tienen foto (o para los seleccionados):
 *
 *   1. la IA mejora el título, elige la categoría y escribe la descripción y las
 *      etiquetas SEO de toda la tanda (`shared/mejorar-producto.js`). Se le pregunta a
 *      la IA del sistema; si no contesta, a la que tenga cargada el Worker tienda; y si
 *      tampoco, queda la ficha base, sin IA;
 *   2. busca las candidatas de cada uno en Amazon, MercadoLibre y BestBuy (Worker tienda,
 *      `/fotos/buscar`: el script de Ecommodo; SerpApi solo de respaldo). Como en
 *      Ecommodo, la búsqueda sale del título que armó la IA ("Apple iPhone 16 128GB
 *      Black"), que es como lo titula una tienda; por eso la IA va primero. Todavía no
 *      baja nada;
 *   3. mide cada candidata en el navegador y marca las mejores: fondo blanco, la mayor
 *      resolución y sin repetir (`shared/calidad-foto.js`), hasta 5 por producto;
 *   4. muestra todo junto para revisar: fotos, título, descripción, categoría, precio y
 *      etiquetas de cada producto se pueden corregir antes de confirmar;
 *   5. recién al confirmar baja las fotos elegidas a Firebase Storage (`/fotos/traer`),
 *      guarda los textos y, si se pidió, publica la tienda.
 *
 * Las fotos son del modelo y el color: las capacidades de un mismo equipo comparten
 * fotos, así que se busca una vez por modelo y color, de a tandas.
 */
import { on } from '../../shared/seguridad.js';
import { elegirFotos, fondoBlanco, huellaDeFoto, LADO_MEDICION, FOTOS_POR_PRODUCTO } from '../../shared/calidad-foto.js';
import { SISTEMA_MEJORAR, MAX_PRODUCTOS_POR_PEDIDO, productosParaMejorar, categoriasParaMejorar, mensajeParaMejorar, limpiarMejoras, jsonDeTexto, etiquetasBase } from '../../shared/mejorar-producto.js';
import { configuracion } from '../core/config-publica.js';
import { contextoApp } from '../core/estado.js';
import { esc, showToast, requiereDuenoDelLocal } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { updateDoc } from 'firebase/firestore';
import { workerHeaders, textoDeIA } from './reportes.js';
import { catalogoCandidatos, renderCatalogo, guardarFotos } from './catalogo.js';

const TANDA = 20;        // modelos por vez: son muchas búsquedas seguidas y conviene revisar de a poco
const MAX_FOTOS = 6;     // lo que acepta /fotos/traer por producto
const MAX_CANDIDATAS = 16;   // las que se miden y se muestran por producto, de las tres tiendas
const ESPERA_FOTO = 12_000;

const el = id => document.getElementById(id);
const plural = (n, uno, muchos) => `${n} ${n === 1 ? uno : muchos}`;
const urlTienda = () => configuracion.api.tiendaRemota || contextoApp.TIENDA_URL;

// El trabajo en curso: { productos, fotos: { clave: { candidatas, error } }, restantes, cancelado }
let T = null;
let OCUPADO = false;

function paso(n) {
  for (const k of [1, 2, 3, 4]) el('ff-paso-' + k).style.display = k === n ? '' : 'none';
}

function espera(titulo, detalle, hecho, total) {
  el('ff-espera-titulo').textContent = titulo;
  el('ff-espera-detalle').textContent = detalle;
  el('ff-espera-barra').style.width = total ? Math.round(hecho / total * 100) + '%' : '0%';
}

/**
 * A qué productos se les trabaja: los de la tienda que no tienen foto o, si hay una
 * selección, los seleccionados (tengan foto o no: a los que ya tienen se les arma la
 * ficha y no se les busca nada).
 */
function objetivo() {
  const elegidos = contextoApp.catSeleccion;
  return catalogoCandidatos().filter(p => contextoApp.claveFotoDe(p) && (elegidos.size ? elegidos.has(p.id) : p._sale && !p.fotos.length));
}

function cargarImagen(url, conCors) {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    if (conCors) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const corte = setTimeout(() => { img.src = ''; rechazar(new Error('tardó demasiado')); }, ESPERA_FOTO);
    img.addEventListener('load', () => { clearTimeout(corte); resolver(img); }, { once: true });
    img.addEventListener('error', () => { clearTimeout(corte); rechazar(new Error('no cargó')); }, { once: true });
    img.src = url;
  });
}

/** Cuánto del borde de una imagen ya cargada es blanco, y su huella. */
function medirPixeles(imagen, ancho, alto) {
  const lienzo = document.createElement('canvas');
  lienzo.width = lienzo.height = LADO_MEDICION;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, LADO_MEDICION, LADO_MEDICION);
  ctx.drawImage(imagen, 0, 0, LADO_MEDICION, LADO_MEDICION);
  const { data } = ctx.getImageData(0, 0, LADO_MEDICION, LADO_MEDICION);
  return { ancho, alto, blanco: fondoBlanco(data, LADO_MEDICION, LADO_MEDICION), huella: huellaDeFoto(data, LADO_MEDICION, LADO_MEDICION) };
}

/**
 * El tamaño real de una imagen, cuánto de su borde es blanco y su huella. Amazon y
 * MercadoLibre dejan leer los píxeles desde otra página; BestBuy no, así que esa foto se
 * pide por el Worker tienda (`/fotos/leer?url=`). Si tampoco se puede, queda el tamaño y
 * `blanco` en null (no se pudo medir: no se elige sola).
 */
async function medirFoto(url) {
  try {
    const img = await cargarImagen(url, true);
    return medirPixeles(img, img.naturalWidth, img.naturalHeight);
  } catch { /* esa tienda no deja leerla desde acá: se prueba por el Worker */ }
  try {
    const r = await fetch(`${urlTienda()}/fotos/leer?url=${encodeURIComponent(url)}`, { headers: await workerHeaders() });
    if (r.ok) {
      const mapa = await createImageBitmap(await r.blob());
      return medirPixeles(mapa, mapa.width, mapa.height);
    }
  } catch { /* sin el Worker queda sin medir */ }
  try {
    const img = await cargarImagen(url, false);
    return { ancho: img.naturalWidth, alto: img.naturalHeight, blanco: null, huella: '' };
  } catch {
    return null;   // ni siquiera carga: no sirve
  }
}

const NOMBRE_DE_FUENTE = { bing: 'Bing', duckduckgo: 'DuckDuckGo', amazon: 'Amazon', serpapi: 'SerpApi' };
/** Qué contestó cada buscador ("Bing: 3 fotos · Amazon: no mostró resultados"), para cuando un producto queda sin fotos. */
const detalleDeFuentes = fuentes => Object.entries(fuentes && typeof fuentes === 'object' ? fuentes : {})
  .map(([k, v]) => `${NOMBRE_DE_FUENTE[k] || k}: ${typeof v === 'number' ? plural(v, 'foto', 'fotos') : String(v).slice(0, 60)}`).join(' · ');

/**
 * Las candidatas de un producto, ya medidas y con las mejores marcadas. `titulo` es el
 * nombre que armó la IA (o el que ya tenía): de ahí sale la búsqueda.
 */
async function candidatasDe(p, titulo) {
  const r = await fetch(urlTienda() + '/fotos/buscar', {
    method: 'POST',
    headers: await workerHeaders(),
    body: JSON.stringify({ nombre: p.nombre, titulo: titulo || '', gb: p.gb, color: p.color, tipo: p.tipo }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 404 ? 'el servicio tienda todavía no tiene la búsqueda (falta el deploy)' : d.error || `el Worker respondió ${r.status}`);
  const crudas = (Array.isArray(d.candidatos) ? d.candidatos : []).filter(x => x && /^(https:|data:image\/)/.test(String(x.url || ''))).slice(0, MAX_CANDIDATAS);
  const medidas = (await Promise.all(crudas.map(async x => {
    const m = await medirFoto(x.url);
    return m && { url: x.url, fuente: String(x.fuente || ''), deOtroColor: !!p.color && x.color === false, ...m };
  }))).filter(Boolean);
  // Con color cargado solo se eligen solas las fotos cuyo título nombra ese color: mostrar
  // un teléfono azul con el cartel "Red" es peor que no mostrar nada. Las demás quedan a
  // la vista, sin marcar.
  return {
    candidatas: [
      ...elegirFotos(medidas.filter(c => !c.deOtroColor)),
      ...elegirFotos(medidas.filter(c => c.deOtroColor)).map(c => ({ ...c, elegida: false, nota: c.nota || 'color sin confirmar' })),
    ],
    detalle: detalleDeFuentes(d.fuentes),
  };
}

/**
 * La ficha de una tanda de productos, escrita por la IA: título, categoría, descripción,
 * etiquetas y descripción para Google. Devuelve `{ mejoras, nombre }` o lanza con el motivo.
 *
 * Primero la IA del sistema (el proxy de siempre, con la clave del dueño). Si no contesta,
 * el Worker tienda, que usa la IA que tenga cargada (DeepSeek, OpenAI, Gemini o Claude).
 */
async function fichasConIA(productos, categorias) {
  const lista = productosParaMejorar(productos);
  const cats = categoriasParaMejorar(categorias);
  let motivo = '';
  try {
    const r = await fetch(contextoApp.WORKER_URL, {
      method: 'POST',
      headers: await workerHeaders(),
      body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 16000, output_config: { effort: 'low' }, system: SISTEMA_MEJORAR, messages: [{ role: 'user', content: mensajeParaMejorar(lista, cats) }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error?.message || d?.error || `respondió ${r.status}`);
    const mejoras = limpiarMejoras(jsonDeTexto(textoDeIA(d)), lista, cats);
    if (mejoras.length) return { mejoras, nombre: 'Claude' };
    throw new Error('no devolvió las fichas');
  } catch (e) {
    motivo = String(e.message || e);
  }
  // El respaldo. Si tampoco contesta, el motivo que importa es el de la IA del sistema.
  try {
    const r = await fetch(urlTienda() + '/ia/mejorar', { method: 'POST', headers: await workerHeaders(), body: JSON.stringify({ productos: lista, categorias: cats }) });
    const d = await r.json().catch(() => ({}));
    const mejoras = r.ok ? limpiarMejoras(d.productos, lista, cats) : [];
    if (mejoras.length) return { mejoras, nombre: d.nombre || 'la IA' };
  } catch { /* sin respaldo */ }
  throw new Error(motivo);
}

function fotosHTML(x, i) {
  const f = T.fotos[x.clave];
  if (x.comparteCon != null) {
    const n = f.candidatas.filter(c => c.elegida).length;
    return `<div class="ff-nota">Usa las mismas ${n ? plural(n, 'foto', 'fotos') : 'fotos'} que <b>${esc(T.productos[x.comparteCon].nombreCompleto)}</b>: son del mismo modelo y color.</div>`;
  }
  if (f.yaTiene) return `<div class="ff-nota">Ya tiene ${plural(f.yaTiene, 'foto', 'fotos')}: no se le buscan más.</div>`;
  if (f.error) return `<div class="ff-nota mal">No pude buscar: ${esc(f.error)}</div>`;
  if (!f.candidatas.length) return `<div class="ff-nota mal">No encontré fotos de este modelo en Amazon, MercadoLibre ni BestBuy. Después se pueden subir o pegar el link desde la ficha del producto.${f.detalle ? `<span class="ff-fuentes">${esc(f.detalle)}</span>` : ''}</div>`;
  return `<div class="cat-cands ff-cands">${f.candidatas.map((c, j) => `
    <label class="cat-cand${c.elegida ? ' on' : ''}">
      <input type="checkbox" ${c.elegida ? 'checked' : ''} ${on('change', 'ffFoto', i, j, '$checked')}>
      <img src="${esc(c.url)}" loading="lazy" alt="" referrerpolicy="no-referrer">
      <div class="d">${c.ancho ? `${c.ancho}×${c.alto}` : ''}${c.nota ? ` · <span class="aviso">${esc(c.nota)}</span>` : c.blanco != null ? ' · fondo blanco' : ''}${c.fuente ? `<span class="tienda">${esc(c.fuente)}</span>` : ''}</div>
    </label>`).join('')}</div>`;
}

function productoHTML(x, i) {
  const cats = contextoApp.todasLasCategorias();
  return `<div class="ff-prod" id="ff-prod-${i}">
    <div class="ff-cab">
      <div><b>${esc(x.nombreCompleto)}</b><span>${esc([x.origen, x.entrega === 'pedido' ? 'a pedido' : 'en el local'].filter(Boolean).join(' · '))}</span></div>
      <button type="button" class="imp-quitar" title="Dejarlo para después: no se le carga nada" ${on('click', 'ffQuitar', i)}>✕</button>
    </div>
    ${fotosHTML(x, i)}
    <div class="ff-campos">
      <div class="field"><label>Título en la tienda</label>
        <input type="text" value="${esc(x.titulo)}" placeholder="${esc(x.nombreCompleto)}" ${on('change', 'ffCampo', i, 'titulo', '$value')}></div>
      <div class="field"><label>Categoría</label>
        <select ${on('change', 'ffCampo', i, 'categoria', '$value')}>${cats.map(c => `<option${c === x.categoria ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Precio u$s</label>
        <input type="number" class="precio" min="0" step="1" value="${x.precio || ''}" ${on('change', 'ffCampo', i, 'precio', '$value')}></div>
      <div class="field ff-desc"><label>Descripción</label>
        <textarea rows="2" placeholder="Lo que quieras contar: estado, qué incluye, garantía…" ${on('change', 'ffCampo', i, 'descripcion', '$value')}>${esc(x.descripcion)}</textarea></div>
      <div class="field ff-desc"><label>Etiquetas SEO <span>separadas por coma</span></label>
        <input type="text" class="etiquetas" value="${esc(x.etiquetas)}" placeholder="iphone 16, 128gb, negro, mar del plata" ${on('change', 'ffCampo', i, 'etiquetas', '$value')}></div>
      <div class="field ff-desc"><label>Descripción para Google <span>hasta 160 letras</span></label>
        <input type="text" class="seo" maxlength="160" value="${esc(x.seo)}" ${on('change', 'ffCampo', i, 'seo', '$value')}></div>
    </div>
  </div>`;
}

function pintarRevision() {
  const vivos = T.productos.filter(x => !x.fuera);
  const conFotos = vivos.filter(x => T.fotos[x.clave].candidatas.some(c => c.elegida)).length;
  const fotos = Object.entries(T.fotos).filter(([clave]) => vivos.some(x => x.clave === clave)).reduce((a, [, f]) => a + f.candidatas.filter(c => c.elegida).length, 0);
  el('ff-resumen').textContent = `${plural(vivos.length, 'producto listo', 'productos listos')} para cargar: ${conFotos} con fotos nuevas (${plural(fotos, 'foto elegida', 'fotos elegidas')}, las de fondo blanco y más resolución)${vivos.length - conFotos ? ` y ${vivos.length - conFotos} sin fotos nuevas` : ''}. Revisá y corregí lo que quieras: nada se guarda hasta que toques el botón.`;
  el('ff-ia').textContent = T.ia.nombre ? `✨ Títulos, categorías, descripciones y etiquetas escritos por ${T.ia.nombre}.`
    : T.ia.error ? `La IA no contestó (${T.ia.error}): quedó la ficha base de cada producto, sin mejorar.` : '';
  el('ff-ia').className = 'ff-ia' + (T.ia.error && !T.ia.nombre ? ' mal' : '');
  el('ff-productos').innerHTML = T.productos.map((x, i) => x.fuera ? '' : productoHTML(x, i)).join('') || '<div class="ff-nota">No quedó ningún producto en esta tanda.</div>';
  const btn = el('btn-ff-cargar');
  btn.disabled = !vivos.length;
  btn.textContent = `Cargar ${plural(vivos.length, 'producto', 'productos')}`;
}

/** Buscar: las candidatas de cada modelo y la ficha de cada producto. */
async function buscar() {
  const todos = objetivo();
  // Una búsqueda por modelo y color; entran los productos de los primeros modelos de la tanda.
  const claves = [...new Set(todos.map(contextoApp.claveFotoDe))];
  const tanda = new Set(claves.slice(0, TANDA));
  const cats = contextoApp.todasLasCategorias();
  const cfg = contextoApp.cfg;
  const productos = [];
  for (const p of todos) {
    const clave = contextoApp.claveFotoDe(p);
    if (!tanda.has(clave)) continue;
    const meta = (cfg.catalogoMeta || {})[p.id] || {};
    const primero = productos.findIndex(x => x.clave === clave);
    productos.push({
      id: p.id, clave, p,
      nombreCompleto: [p.nombre, p.gb, p.color].filter(Boolean).join(' '),
      origen: p._origen, entrega: p._entrega,
      comparteCon: primero >= 0 ? primero : null,
      // Lo que el dueño ya escribió no se pisa: la IA completa solo lo que falta.
      titulo: meta.titulo || '', descripcion: p.descripcion || '', etiquetas: meta.keywords || '', seo: meta.seoDescripcion || '',
      categoria: cats.includes(p.categoria) ? p.categoria : p._catAuto, categoriaAuto: p._catAuto,
      categoriaElegida: !!(cfg.catalogoAjustes || {})[p.id]?.categoria,
      precio: p.precioUSD || 0, precioOrigen: p._precioOrigen || 0,
      fuera: false,
    });
  }
  T = { productos, fotos: {}, restantes: claves.length - tanda.size, cancelado: false, ia: { nombre: '', error: '' } };
  // Primero las fichas: la búsqueda de fotos sale del título que arme la IA.
  if (el('ff-op-ia').checked) {
    for (let i = 0; i < productos.length && !T.ia.error; i += MAX_PRODUCTOS_POR_PEDIDO) {
      if (T.cancelado) return false;
      const lote = productos.slice(i, i + MAX_PRODUCTOS_POR_PEDIDO);
      espera('Armando las fichas con IA…', `Títulos, categorías, descripciones y etiquetas · ${Math.min(i + lote.length, productos.length)} de ${productos.length}`, i, productos.length);
      try {
        const r = await fichasConIA(lote.map(x => ({ id: x.id, nombre: x.p.nombre, gb: x.p.gb, color: x.p.color, condicion: x.p.condicion, bateria: x.p.bateria, estado: x.p.estado, entrega: x.entrega, categoria: x.categoria })), cats);
        T.ia.nombre = r.nombre;
        for (const m of r.mejoras) {
          const x = lote.find(y => y.id === m.id);
          if (!x) continue;
          if (!x.titulo && m.titulo) x.titulo = m.titulo;
          if (!x.categoriaElegida && m.categoria) x.categoria = m.categoria;
          if (!x.descripcion && m.descripcion) x.descripcion = m.descripcion;
          if (!x.etiquetas && m.etiquetas) x.etiquetas = m.etiquetas.join(', ');
          if (!x.seo && m.seo) x.seo = m.seo;
        }
      } catch (e) {
        T.ia.error = String(e.message || e).slice(0, 140);
      }
    }
  }
  const unicos = productos.filter(x => x.comparteCon == null);
  let cortar = '';
  for (let i = 0; i < unicos.length; i++) {
    if (T.cancelado) return false;
    const x = unicos[i];
    if (x.p.fotos.length) { T.fotos[x.clave] = { candidatas: [], error: '', yaTiene: x.p.fotos.length }; continue; }
    espera('Buscando fotos…', `${i + 1} de ${unicos.length} · ${x.nombreCompleto}`, i, unicos.length);
    if (cortar) { T.fotos[x.clave] = { candidatas: [], error: cortar }; continue; }
    try {
      T.fotos[x.clave] = { ...await candidatasDe(x.p, x.titulo), error: '' };
    } catch (e) {
      T.fotos[x.clave] = { candidatas: [], error: e.message };
      // Sin permiso o sin servicio no tiene sentido seguir probando uno por uno.
      if (/no autorizado|401|403|Failed to fetch|NetworkError|Load failed/i.test(e.message)) cortar = e.message;
    }
  }
  // Lo que la IA no escribió (o si no se la usó): la ficha base, que ya dice la verdad.
  for (const x of productos) {
    if (!x.descripcion) x.descripcion = contextoApp.borradorDe(x.p);
    if (!x.etiquetas) x.etiquetas = etiquetasBase(x.p, x.categoria).join(', ');
  }
  return !T.cancelado;
}

/** Cargar: baja las fotos elegidas, guarda los textos y publica. */
async function cargar() {
  const vivos = T.productos.filter(x => !x.fuera);
  const conocidos = new Set([...Object.values(contextoApp.FOTOS).flat(), ...Object.keys(contextoApp.FOTOS_CLAS)]);
  const claves = [...new Set(vivos.map(x => x.clave))].filter(clave => T.fotos[clave].candidatas.some(c => c.elegida));
  const resultado = { conFotos: 0, fotos: 0, fallidas: 0, errores: [] };
  let clasificacion = { ...contextoApp.FOTOS_CLAS };
  for (let i = 0; i < claves.length; i++) {
    const clave = claves[i];
    const de = vivos.find(x => x.clave === clave);
    espera('Cargando productos…', `Fotos ${i + 1} de ${claves.length} · ${de.nombreCompleto}`, i, claves.length + 1);
    const urls = T.fotos[clave].candidatas.filter(c => c.elegida).map(c => c.url).slice(0, MAX_FOTOS);
    // Desde qué número nombrar: después de las que ya tenga y de cualquier archivo con ese nombre.
    let desde = (contextoApp.FOTOS[clave] || []).length + 1;
    while ([...conocidos].some(a => a.startsWith(`${clave}${desde > 1 ? '-' + desde : ''}.`))) desde++;
    try {
      const r = await fetch(urlTienda() + '/fotos/traer', { method: 'POST', headers: await workerHeaders(), body: JSON.stringify({ base: clave, desde, urls }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `el Worker respondió ${r.status}`);
      for (const a of d.subidos || []) { conocidos.add(a); clasificacion = { ...clasificacion, [a]: { clave, vista: '', manual: true } }; }
      if (d.subidos?.length) resultado.conFotos += vivos.filter(x => x.clave === clave).length;
      resultado.fotos += d.subidos?.length || 0;
      resultado.fallidas += d.fallidas?.length || 0;
    } catch (e) {
      resultado.errores.push(`${de.nombreCompleto}: ${e.message}`);
      if (/no autorizado|401|403|Failed to fetch|NetworkError|Load failed/i.test(e.message)) break;
    }
  }
  espera('Cargando productos…', 'Guardando fotos, títulos y descripciones', claves.length, claves.length + 1);
  if (resultado.fotos) {
    contextoApp.FOTOS_CLAS = clasificacion;
    await guardarFotos([...conocidos]);
  }
  // Los textos: lo que se escribió queda; lo que se vació vuelve al valor por defecto.
  const cfg = contextoApp.cfg;
  const notas = { ...(cfg.catalogoNotas || {}) }, meta = { ...(cfg.catalogoMeta || {}) }, ajustes = { ...(cfg.catalogoAjustes || {}) };
  for (const x of vivos) {
    const descripcion = String(x.descripcion || '').trim();
    if (descripcion) notas[x.id] = descripcion; else delete notas[x.id];
    const m = { ...(meta[x.id] || {}) };
    for (const [campo, valor] of [['titulo', x.titulo], ['keywords', x.etiquetas], ['seoDescripcion', x.seo]]) {
      const texto = String(valor || '').replace(/\s+/g, ' ').trim();
      if (texto) m[campo] = texto; else delete m[campo];
    }
    if (Object.keys(m).length) meta[x.id] = m; else delete meta[x.id];
    const aj = { ...(ajustes[x.id] || {}) };
    if (x.categoria && x.categoria !== x.categoriaAuto) aj.categoria = x.categoria; else delete aj.categoria;
    const precio = Math.round(Number(x.precio) || 0);
    if (precio > 0 && precio !== x.precioOrigen) aj.precioUSD = precio; else delete aj.precioUSD;
    if (Object.keys(aj).length) ajustes[x.id] = aj; else delete ajustes[x.id];
  }
  const cambios = { catalogoNotas: notas, catalogoMeta: meta, catalogoAjustes: ajustes };
  // updateDoc reemplaza cada mapa entero: con setDoc y merge, lo que se vació volvería.
  await updateDoc(contextoApp.cfgDoc, cambios);
  Object.assign(cfg, cambios);
  resultado.productos = vivos.length;
  return resultado;
}

function linea(texto, estado) {
  const fila = document.createElement('div');
  fila.className = 'imp-av ' + estado;
  fila.textContent = (estado === 'ok' ? '✓ ' : estado === 'mal' ? '✕ ' : '· ') + texto;
  el('ff-final').appendChild(fila);
}

export function inicializarFotosFaltantes() {
  window.abrirFotosFaltantes = function () {
    if (!requiereDuenoDelLocal() || OCUPADO) return;
    const todos = objetivo();
    const haySeleccion = contextoApp.catSeleccion.size > 0;
    if (!todos.length) {
      showToast(haySeleccion ? 'No hay nada para trabajar en la selección' : 'Todos los productos de la tienda ya tienen foto ✓ — para rehacer la ficha de algunos, seleccionalos primero');
      return;
    }
    const sinFotos = todos.filter(p => !p.fotos.length);
    const modelos = new Set(todos.map(contextoApp.claveFotoDe)).size;
    const ahora = Math.min(modelos, TANDA);
    T = null;
    el('ff-intro').textContent = (haySeleccion
      ? `${plural(todos.length, 'producto seleccionado', 'productos seleccionados')}, ${sinFotos.length} sin foto`
      : plural(todos.length, 'producto de la tienda no tiene foto', 'productos de la tienda no tienen foto'))
      + ` (${plural(modelos, 'modelo distinto', 'modelos distintos')}: las capacidades de un mismo equipo comparten fotos). `
      + `Las fotos se buscan en Amazon y de cada producto se eligen hasta ${FOTOS_POR_PRODUCTO}: fondo blanco, la mayor resolución y sin repetir. Antes de cargar nada vas a ver todo junto para revisarlo y corregirlo.`
      + (modelos > TANDA ? ` Van de a ${TANDA} modelos por vez: al terminar seguís con los que falten.` : '');
    el('btn-ff-buscar').textContent = sinFotos.length ? `Buscar fotos de ${plural(ahora, 'modelo', 'modelos')}` : `Armar ${plural(Math.min(todos.length, TANDA), 'ficha', 'fichas')}`;
    paso(1);
    el('fotos-faltantes-modal').classList.add('open');
  };

  window.cerrarFotosFaltantes = function () {
    if (OCUPADO && !confirm('Hay un trabajo en curso. Si cerrás se corta: lo que ya se cargó queda, el resto no. ¿Cerrar igual?')) return;
    if (T) T.cancelado = true;
    el('fotos-faltantes-modal').classList.remove('open');
  };

  window.ffBuscar = async function () {
    if (!requiereDuenoDelLocal() || OCUPADO) return;
    OCUPADO = true;
    paso(2);
    espera('Buscando fotos…', '', 0, 1);
    try {
      if (await buscar()) { pintarRevision(); paso(3); }
    } catch (e) {
      console.error(e);
      showToast('No pude buscar las fotos: ' + e.message, true);
      paso(1);
    }
    OCUPADO = false;
  };

  window.ffFoto = function (i, j, marcada) {
    const x = T?.productos[i];
    const c = x && T.fotos[x.clave].candidatas[j];
    if (!c) return;
    if (marcada && T.fotos[x.clave].candidatas.filter(k => k.elegida).length >= MAX_FOTOS) {
      showToast(`Hasta ${MAX_FOTOS} fotos por producto`, true);
      pintarRevision();
      return;
    }
    c.elegida = !!marcada;
    pintarRevision();
  };
  window.ffCampo = function (i, campo, valor) {
    const x = T?.productos[i];
    if (!x) return;
    x[campo] = campo === 'precio' ? Number(String(valor).replace(',', '.')) || 0 : String(valor);
  };
  window.ffQuitar = function (i) {
    const x = T?.productos[i];
    if (!x) return;
    x.fuera = true;
    // Si otros compartían sus fotos, el primero que quede pasa a mostrarlas.
    const hereda = T.productos.findIndex(y => !y.fuera && y.clave === x.clave);
    if (hereda >= 0) T.productos.forEach((y, k) => { if (!y.fuera && y.clave === x.clave) y.comparteCon = k === hereda ? null : hereda; });
    pintarRevision();
  };

  window.ffCargar = async function () {
    if (!requiereDuenoDelLocal() || OCUPADO || !T) return;
    OCUPADO = true;
    const publicar = el('ff-op-publicar').checked;
    paso(2);
    espera('Cargando productos…', '', 0, 1);
    setSyncDot('syncing');
    el('ff-final').innerHTML = '';
    try {
      const r = await cargar();
      if (publicar) { espera('Cargando productos…', 'Publicando la tienda', 1, 1); await window.publicarCatalogo(); }
      const sinFotos = r.productos - r.conFotos;
      linea(`${plural(r.productos, 'producto cargado', 'productos cargados')} con título, categoría, descripción, etiquetas SEO y precio`, 'ok');
      linea(r.fotos ? `${plural(r.fotos, 'foto guardada', 'fotos guardadas')} en ${plural(r.conFotos, 'producto', 'productos')}${r.fallidas ? ` · ${plural(r.fallidas, 'foto no se pudo bajar', 'fotos no se pudieron bajar')}` : ''}` : 'No se guardó ninguna foto', r.fotos ? 'ok' : 'mal');
      if (sinFotos) linea(`${plural(sinFotos, 'producto', 'productos')} sin fotos nuevas: se pueden subir o pegar el link desde la ficha`, 'espera');
      for (const e of r.errores.slice(0, 4)) linea(e, 'mal');
      linea(publicar ? 'La tienda quedó publicada' : 'Falta publicar: tocá "Publicar" para que se vea en la tienda', publicar ? 'ok' : 'espera');
      if (T.restantes) linea(`Quedan ${plural(T.restantes, 'modelo', 'modelos')} sin foto para otra tanda`, 'espera');
      el('btn-ff-seguir').style.display = T.restantes ? '' : 'none';
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      linea('Se cortó: ' + e.message, 'mal');
      el('btn-ff-seguir').style.display = 'none';
      setSyncDot('error');
    }
    OCUPADO = false;
    T = null;
    contextoApp.catSeleccion.clear();
    renderCatalogo();
    paso(4);
  };

  window.ffSeguir = function () {
    el('fotos-faltantes-modal').classList.remove('open');
    window.abrirFotosFaltantes();
  };
}
