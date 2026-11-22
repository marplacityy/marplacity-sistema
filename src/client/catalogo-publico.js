import { esc, on } from '../shared/seguridad.js';
import { ajusteDeMiniatura } from '../shared/calidad-foto.js';
import { rangoDeModelo, compararPesos } from '../shared/orden-tienda.js';
import { RUBROS_CATALOGO, rubroDe, cantidadMaxima, capacidadPareja, separarColor } from '../shared/catalogo.js';
import { activarEventos } from './core/eventos.js';
activarEventos();
import { cargarConfiguracion } from './core/config-publica.js';
const configuracion = await cargarConfiguracion();
// La página es pública y no tiene login: lee un solo documento que el sistema publica
// con los campos que se pueden mostrar. La clave de Firebase es pública por diseño —va
// dentro de cualquier app web— y lo que protege los datos son las reglas, que sobre este
// documento solo permiten LEER.
const PROYECTO = 'mis-gastos-21e7b';
const CLAVE = 'AIzaSyCxT-g9yMRhrRcjwI5uz3ITTWUB8ddeZCg';
const URL = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents/catalogo/publico?key=${CLAVE}`;

let PRODUCTOS = [], LOCAL = {}, COBRO = {}, CATEGORIAS = [];

// El Worker que cobra. La página no tiene credenciales de nada: le manda el pedido y él
// arma el link de pago con el precio publicado, no con el que diga la página.
const TIENDA_URL = configuracion.api.tienda;

// Dónde está parado el que mira: un rubro (Celulares), una categoría adentro de un rubro
// (iPhone usados), o la portada. Buscando, se ignora todo eso y se muestra lo que coincida.
let RUBRO = null;      // el rubro abierto, o null en la portada
let FILTRO = 'todo';   // la categoría abierta, o 'todo'
let COND = '', ENTREGA = '', ORDEN = 'relevancia';   // los filtros de la página de rubro

// La imagen de cada rubro cuando ningún producto suyo tiene foto.
const ICONO_WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 0 1 0 16.4 8.1 8.1 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8zm-3.3 4.4c-.2 0-.5 0-.7.3-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.2.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5 0 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4l-.5-.3-1.9-.9c-.3-.1-.4-.1-.6.1l-.9 1.1c-.2.2-.3.2-.6.1a7 7 0 0 1-3.4-3c-.3-.4.3-.4.8-1.5.1-.2 0-.4 0-.5l-.9-2c-.2-.6-.5-.5-.6-.5h-.6z"/></svg>';

const usd = n => 'u$s ' + Math.round(n).toLocaleString('es-AR');

// Los valores de Firestore vienen envueltos por tipo ({stringValue:"x"}).
const valor = v => v == null ? null
  : 'stringValue'  in v ? v.stringValue
  : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue'  in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue
  : 'nullValue'    in v ? null
  : 'mapValue'     in v ? campos(v.mapValue.fields)
  : 'arrayValue'   in v ? (v.arrayValue.values || []).map(valor)
  : null;
const campos = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, valor(v)]));

/** La inicial del modelo, para cuando no hay foto. */
const inicial = nombre => {
  const m = String(nombre).match(/\d+/);
  return m ? m[0].slice(0, 2) : String(nombre).trim().slice(0, 1).toUpperCase() || '·';
};

const fotosDe = p => Array.isArray(p.fotos) ? p.fotos : (p.foto ? [p.foto] : []);

/** La foto de la tarjeta: la primera, o la inicial del modelo si no hay. */
function fotoTarjeta(p){
  const foto = fotosDe(p)[0];
  // Cada foto trae su propio margen blanco. El sistema publica dónde está el producto
  // dentro de la foto y acá se agranda la miniatura lo justo para que todos se vean del
  // mismo tamaño. Solo en la tarjeta: en la página del producto la foto va entera.
  const a = ajusteDeMiniatura(p.fotoCaja);
  const ajuste = a ? ` style="--k:${a.k};--dx:${a.dx};--dy:${a.dy}"` : '';
  // Si el archivo no carga, se cambia por la inicial: nunca una imagen rota.
  return foto
    ? `<img src="${esc(foto)}" alt="${esc(p.nombre)}" loading="lazy"${ajuste} ${on('error', 'fotoFallo', '$this', inicial(p.nombre))}>`
    : `<span class="sin-foto">${esc(inicial(p.nombre))}</span>`;
}

const sello = p => p.tipo === 'pedido' ? '<span class="sello">A pedido</span>' : '';
const linkProducto = p => '#p=' + encodeURIComponent(p.id);
// El nombre con su capacidad y su color, sin repetir lo que el título ya dice.
function nombreCompleto(p){
  const nombre = p.titulo || p.nombre;
  const yaDicho = String(nombre).toLowerCase();
  return [nombre, ...[p.gb, p.color].filter(v => v && !yaDicho.includes(String(v).toLowerCase()))].join(' ');
}

/**
 * La tarjeta de un producto: la foto, el nombre, lo que el nombre no dice (capacidad,
 * color, estado, batería) y el precio. Sin botón: toda la tarjeta lleva al producto.
 */
function tarjeta(p){
  const nombre = p.titulo || p.nombre;
  const yaDicho = String(nombre).toLowerCase();
  const detalle = [p.gb, p.color, p.estado].filter(v => v && !yaDicho.includes(String(v).toLowerCase())).map(esc);
  if (p.bateria != null) detalle.push(`<span class="bat">Batería ${esc(p.bateria)}%</span>`);

  return `<article class="prod" ${on('click', 'abrirFicha', p.id)}>
    <div class="prod-foto">${sello(p)}${fotoTarjeta(p)}</div>
    <div class="prod-info">
      <h3 class="prod-nombre"><a href="${esc(linkProducto(p))}" data-stop>${esc(nombre)}</a></h3>
      <div class="prod-detalle">${detalle.join(' · ')}</div>
      <div class="precio">${usd(p.precioUSD)}</div>
    </div>
  </article>`;
}

/** El link a WhatsApp con el producto ya escrito, o null si el local no cargó número. */
function linkWhatsApp(p){
  if (!LOCAL.whatsapp) return null;
  const texto = encodeURIComponent(`Hola! Me interesa el ${p.nombre}${p.gb ? ' ' + p.gb : ''}${p.color ? ' ' + p.color : ''} que vi en la tienda` +
    (p.tipo === 'pedido' ? ' (a pedido)' : ''));
  return `https://wa.me/${String(LOCAL.whatsapp).replace(/\D/g, '')}?text=${texto}`;
}
const waDelLocal = texto => LOCAL.whatsapp
  ? `https://wa.me/${String(LOCAL.whatsapp).replace(/\D/g, '')}${texto ? '?text=' + encodeURIComponent(texto) : ''}` : null;

// ── Las páginas ──────────────────────────────────────────────
//
// La tienda tiene dos zonas: el listado con sus filtros (#vista-tienda) y una página
// suelta (#vista-pagina) donde se arma el producto, el carrito, el checkout o el
// resultado del pedido. Cada una tiene su link y `desdeUrl` decide cuál se ve.

function mostrarPagina(html){
  document.getElementById('pagina').innerHTML = html;
  document.getElementById('vista-tienda').hidden = true;
  document.getElementById('vista-pagina').hidden = false;
  window.scrollTo({ top: 0 });
}
function mostrarTienda(){
  document.getElementById('vista-pagina').hidden = true;
  document.getElementById('vista-tienda').hidden = false;
}

const volver = (texto = 'Volver a la tienda', href = '#') =>
  `<a class="volver" href="${esc(href)}"><span aria-hidden="true">←</span> ${esc(texto)}</a>`;

let AVISO_T = null;
/** Un aviso que aparece abajo y se va solo. */
function aviso(texto, error){
  const el = document.getElementById('aviso-flotante');
  el.textContent = texto;
  el.className = 'aviso-flotante ver' + (error ? ' error' : '');
  clearTimeout(AVISO_T);
  AVISO_T = setTimeout(() => { el.className = 'aviso-flotante'; }, 2600);
}

/** Tocar una tarjeta o elegir una variante lleva a la página del producto (#p=id). */
window.abrirFicha = id => { location.hash = '#p=' + encodeURIComponent(id); };

/**
 * La página del producto: galería a la izquierda y, a la derecha, el precio, la
 * disponibilidad, las variantes, la cantidad y los botones de compra. El link (#p=id) se
 * puede pegar en WhatsApp o Instagram y cae directo acá.
 */
function paginaProducto(id){
  const p = PRODUCTOS.find(x => x.id === id);
  if (!p) {
    mostrarPagina(`<div class="vacio"><div class="vacio-icono">🔍</div><h2>Producto no encontrado</h2>
      <p>Puede que ya se haya vendido.</p><a class="btn-primario" href="#">Volver a la tienda</a></div>`);
    return;
  }
  const fotos = fotosDe(p);
  const wa = linkWhatsApp(p);
  const grupo = grupoDe(p);   // si es una variante de un modelo, la capacidad y el color van en selectores
  const max = cantidadMaxima(p);
  const specs = [
    p.gb && !grupo && `<span class="chip">${esc(p.gb)}</span>`,
    p.color && !grupo && `<span class="chip">${esc(p.color)}</span>`,
    p.bateria != null && `<span class="chip bat">Batería ${esc(p.bateria)}%</span>`,
    p.estado && `<span class="chip">${esc(p.estado)}</span>`,
  ].filter(Boolean).join('');
  const formas = formasDePago(p);

  mostrarPagina(`${volver('Volver a la tienda', hashVista() || '#')}
    <div class="producto" id="ficha">
      <div class="producto-fotos">
        <div class="producto-grande" id="ficha-grande">${fotos.length
          ? `<img src="${esc(fotos[0])}" alt="${esc(p.nombre)}" ${on('error', 'fotoFallo', '$this', inicial(p.nombre))}>`
          : `<span class="sin-foto">${esc(inicial(p.nombre))}</span>`}</div>
        ${fotos.length > 1 ? `<div class="producto-minis">${fotos.map((f, k) =>
          `<img src="${esc(f)}" class="${k === 0 ? 'on' : ''}" alt="" ${on('click', 'verGrande', '$this', f)} ${on('error', 'quitarImagen', '$this')}>`).join('')}</div>` : ''}
      </div>
      <div class="producto-datos">
        <h1 class="producto-nombre">${esc(p.titulo || p.nombre)}</h1>
        <div class="producto-precio">${usd(p.precioUSD)}</div>
        <div class="producto-stock ${p.tipo === 'pedido' ? 'pedido' : 'ok'}">${p.tipo === 'pedido'
          ? '📦 Entrega a pedido: te confirmamos la demora por WhatsApp'
          : '✓ Stock inmediato: está en el local'}</div>
        ${grupo ? selectoresVariante(p, grupo) : ''}
        ${specs ? `<div class="chips">${specs}</div>` : ''}
        <div class="producto-meta"><span>Categoría:</span> <a href="#c=${slug(catDe(p))}">${esc(catDe(p))}</a></div>
        <div class="producto-acciones">
          ${max > 1 ? `<div class="cantidad">
            <button type="button" aria-label="Reducir cantidad" ${on('click', 'cambiarCantidadFicha', -1)}>−</button>
            <input type="number" id="ficha-cantidad" value="1" min="1" max="${max}" aria-label="Cantidad" readonly>
            <button type="button" aria-label="Aumentar cantidad" ${on('click', 'cambiarCantidadFicha', 1)}>+</button>
          </div>` : ''}
          <button class="btn-primario" type="button" ${on('click', 'agregarAlCarrito', p.id)}>Agregar al carrito</button>
        </div>
        <button class="btn-oscuro" type="button" ${on('click', 'comprarAhora', p.id)}>Comprar ahora</button>
        <div class="producto-links">
          ${wa ? `<a href="${wa}" target="_blank" rel="noopener">${ICONO_WA} Preguntar por WhatsApp</a>` : ''}
          <button type="button" ${on('click', 'compartirFicha', p.id)}>Compartir</button>
        </div>
        <div class="producto-pagos">
          <h3>Medios de pago</h3>
          ${formas.map(f => `<div class="pago-fila"><span>${f.titulo}</span><strong>${f.total}</strong></div>`).join('')}
          <p>Precio en dólar billete, válido pagando en efectivo.</p>
        </div>
        ${p.descripcion ? `<div class="producto-desc"><h3>Descripción</h3><p>${esc(p.descripcion)}</p></div>` : ''}
      </div>
    </div>`);
  metaDeProducto(p);
}

// Los metadatos de la página siguen al producto abierto: sirven al compartir el link y a
// los buscadores. Al cerrar vuelven los de la tienda.
const META_BASE = { title: document.title, desc: document.querySelector('meta[name="description"]')?.content || '' };
function metaDeProducto(p){
  const titulo = p ? `${nombreCompleto(p)} — ${usd(p.precioUSD)} · MarplaCity` : META_BASE.title;
  const desc = p ? (p.seoDescripcion || p.descripcion || `${p.titulo || p.nombre} a ${usd(p.precioUSD)} en MarplaCity, Mar del Plata.`).slice(0, 160) : META_BASE.desc;
  document.title = titulo;
  for (const sel of ['meta[name="description"]', 'meta[property="og:description"]']) { const m = document.querySelector(sel); if (m) m.content = desc; }
  const og = document.querySelector('meta[property="og:title"]'); if (og) og.content = titulo;
  let kw = document.querySelector('meta[name="keywords"]');
  if (p?.keywords) { if (!kw) { kw = document.createElement('meta'); kw.name = 'keywords'; document.head.appendChild(kw); } kw.content = p.keywords; }
  else if (kw) kw.remove();
}

window.quitarImagen = el => el.remove();
window.fotoFallo = (el, texto) => { const s = document.createElement('span'); s.className = 'sin-foto'; s.textContent = texto; el.replaceWith(s); };

window.verGrande = (mini, src) => {
  document.getElementById('ficha-grande').innerHTML = `<img src="${esc(src)}" alt="">`;
  mini.parentNode.querySelectorAll('img').forEach(i => i.classList.toggle('on', i === mini));
};

window.cambiarCantidadFicha = delta => {
  const el = document.getElementById('ficha-cantidad');
  if (!el) return;
  el.value = Math.max(1, Math.min(Number(el.max) || 1, (Number(el.value) || 1) + delta));
};

/** Comparte el link del producto: la hoja del celular si existe, si no copia el link. */
window.compartirFicha = async id => {
  const p = PRODUCTOS.find(x => x.id === id);
  const url = location.origin + location.pathname + '#p=' + encodeURIComponent(id);
  const titulo = p ? `${p.nombre} — ${usd(p.precioUSD)}` : document.title;
  try {
    if (navigator.share) await navigator.share({ title: titulo, text: titulo, url });
    else { await navigator.clipboard.writeText(url); aviso('Link copiado'); }
  } catch (e) { /* canceló */ }
};

// ── El carrito ───────────────────────────────────────────────
//
// Vive en el navegador del cliente (no hay login): una lista de {id, cantidad}. Los
// precios nunca se guardan: salen siempre del catálogo publicado, acá y en el Worker.

const CLAVE_CARRITO = 'marplacity_carrito';
let CARRITO = [];

function leerCarrito(){
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || '[]');
    CARRITO = (Array.isArray(crudo) ? crudo : []).map(x => ({ id: String(x?.id || ''), cantidad: Math.floor(Number(x?.cantidad)) || 1 }));
  } catch (e) { CARRITO = []; }
  // Lo que ya no está publicado se va solo, y nadie pasa del máximo de su producto.
  CARRITO = CARRITO.filter(x => PRODUCTOS.some(p => p.id === x.id)).slice(0, 20);
  for (const x of CARRITO) x.cantidad = Math.max(1, Math.min(cantidadMaxima(PRODUCTOS.find(p => p.id === x.id)), x.cantidad));
}
function guardarCarrito(){
  try { localStorage.setItem(CLAVE_CARRITO, JSON.stringify(CARRITO)); } catch (e) { /* navegación privada: dura lo que dure la página */ }
  pintarGloboCarrito();
}
const unidadesCarrito = () => CARRITO.reduce((s, x) => s + x.cantidad, 0);
/** Las líneas del carrito con su producto y su subtotal. */
const lineasCarrito = () => CARRITO.map(x => ({ ...x, p: PRODUCTOS.find(p => p.id === x.id) })).filter(l => l.p)
  .map(l => ({ ...l, subtotal: (Number(l.p.precioUSD) || 0) * l.cantidad }));
const totalCarrito = () => lineasCarrito().reduce((s, l) => s + l.subtotal, 0);

function pintarGloboCarrito(){
  const n = unidadesCarrito();
  document.querySelectorAll('[data-carrito]').forEach(el => { el.textContent = n; if (el.classList.contains('carrito-globo')) el.hidden = !n; });
}

/** Suma al carrito respetando el máximo del producto. Devuelve si entró algo. */
function sumarAlCarrito(id, cantidad){
  const p = PRODUCTOS.find(x => x.id === id);
  if (!p) return false;
  const max = cantidadMaxima(p);
  const linea = CARRITO.find(x => x.id === id);
  if (linea) {
    if (linea.cantidad >= max) { aviso(max === 1 ? 'Ya está en tu carrito: es una unidad única' : `Máximo ${max} por pedido`, true); return false; }
    linea.cantidad = Math.min(max, linea.cantidad + cantidad);
  } else {
    if (CARRITO.length >= 20) { aviso('El carrito está lleno', true); return false; }
    CARRITO.push({ id, cantidad: Math.min(max, cantidad) });
  }
  guardarCarrito();
  return true;
}
const cantidadElegida = () => Number(document.getElementById('ficha-cantidad')?.value) || 1;

window.agregarAlCarrito = id => { if (sumarAlCarrito(id, cantidadElegida())) aviso('Producto agregado al carrito'); };
window.comprarAhora = id => {
  if (!CARRITO.some(x => x.id === id)) sumarAlCarrito(id, cantidadElegida());
  location.hash = '#checkout';
};
window.cambiarCantidad = (id, delta) => {
  const linea = CARRITO.find(x => x.id === id);
  if (!linea) return;
  const max = cantidadMaxima(PRODUCTOS.find(p => p.id === id));
  linea.cantidad = Math.max(1, Math.min(max, linea.cantidad + delta));
  guardarCarrito();
  paginaCarrito();
};
window.quitarDelCarrito = id => { CARRITO = CARRITO.filter(x => x.id !== id); guardarCarrito(); paginaCarrito(); };
window.vaciarCarrito = () => { CARRITO = []; guardarCarrito(); paginaCarrito(); };

const fotoMini = p => fotosDe(p)[0]
  ? `<img src="${esc(fotosDe(p)[0])}" alt="" loading="lazy" ${on('error', 'fotoFallo', '$this', inicial(p.nombre))}>`
  : `<span class="sin-foto">${esc(inicial(p.nombre))}</span>`;
const specsDe = p => [p.gb, p.color, p.estado, p.bateria != null && `Batería ${p.bateria}%`].filter(Boolean).join(' · ');

/** La página del carrito: los productos con su cantidad y, al costado, el resumen. */
function paginaCarrito(){
  const lineas = lineasCarrito();
  metaDeProducto(null);
  if (!lineas.length) {
    mostrarPagina(`<h1 class="pagina-titulo">Tu carrito</h1>
      <div class="vacio"><div class="vacio-icono">🛒</div><h2>Tu carrito está vacío</h2>
      <p>Agregá productos para empezar tu compra.</p><a class="btn-primario" href="#">Ver productos</a></div>`);
    return;
  }
  const total = totalCarrito();
  mostrarPagina(`${volver('Seguir comprando')}
    <h1 class="pagina-titulo">Tu carrito</h1>
    <div class="dos-columnas">
      <div class="carrito-lista">${lineas.map(l => {
        const max = cantidadMaxima(l.p);
        return `<div class="carrito-item">
          <a class="carrito-foto" href="${esc(linkProducto(l.p))}">${fotoMini(l.p)}</a>
          <div class="carrito-datos">
            <a class="n" href="${esc(linkProducto(l.p))}">${esc(l.p.titulo || l.p.nombre)}</a>
            <div class="d">${esc(specsDe(l.p))}</div>
            <div class="u">${usd(l.p.precioUSD)} c/u${l.p.tipo === 'pedido' ? ' · a pedido' : ''}</div>
          </div>
          <div class="carrito-cant">
            ${max > 1 ? `<div class="cantidad chica">
              <button type="button" aria-label="Reducir cantidad" ${on('click', 'cambiarCantidad', l.id, -1)}>−</button>
              <input type="number" value="${l.cantidad}" readonly aria-label="Cantidad">
              <button type="button" aria-label="Aumentar cantidad" ${on('click', 'cambiarCantidad', l.id, 1)}>+</button>
            </div>` : '<span class="unica">Unidad única</span>'}
            <div class="subtotal">${usd(l.subtotal)}</div>
            <button class="quitar" type="button" ${on('click', 'quitarDelCarrito', l.id)}>Quitar</button>
          </div>
        </div>`; }).join('')}
        <button class="link-suave" type="button" ${on('click', 'vaciarCarrito')}>Vaciar carrito</button>
      </div>
      <aside class="resumen">
        <h2>Resumen de compra</h2>
        <div class="resumen-fila"><span>Productos (${unidadesCarrito()})</span><span>${usd(total)}</span></div>
        <div class="resumen-fila"><span>Envío</span><span>A coordinar</span></div>
        <div class="resumen-total"><span>Total</span><span>${usd(total)}</span></div>
        <a class="btn-primario ancho" href="#checkout">Finalizar compra</a>
        <a class="btn-borde ancho" href="#">Seguir comprando</a>
        <p class="resumen-nota">Precio en dólar billete. En el próximo paso elegís cómo pagar.</p>
      </aside>
    </div>`);
}

// ── Las formas de pago ───────────────────────────────────────

const ars = n => Math.round(n).toLocaleString('es-AR') + ' pesos';

/**
 * Las formas de pago que le corresponden a un producto, con su monto.
 *
 *  - pesos por Mercado Pago: solo hasta cierto precio (los teléfonos no van por acá);
 *  - dólares con tarjeta: lleva recargo;
 *  - efectivo en el local: reserva sin pagar ahora.
 */
function formasDePago(p){
  const usd = Number(p.precioUSD) || 0;
  const tc = Number(COBRO.tc) || 0;
  const rec = Number(COBRO.recargoTarjetaPct) || 0;
  const recMp = Number(COBRO.recargoMpPct) || 0;
  const mpMax = Number(COBRO.mpMaxUSD) || 0;
  const formas = [];
  if (tc && mpMax && usd <= mpMax) formas.push({
    id: 'mp', titulo: 'En pesos con Mercado Pago',
    detalle: `${ars(usd * tc * (1 + recMp / 100))} · al dólar de hoy (${tc.toLocaleString('es-AR')})${recMp ? `, incluye ${recMp}% por Mercado Pago` : ''}`,
    total: ars(usd * tc * (1 + recMp / 100)), boton: 'Pagar con Mercado Pago',
  });
  formas.push({
    id: 'tarjeta', titulo: 'En dólares con tarjeta',
    detalle: rec ? `${usd_(usd * (1 + rec / 100))} · incluye ${rec}% por pago con tarjeta` : usd_(usd),
    total: usd_(usd * (1 + rec / 100)), boton: 'Pagar con tarjeta',
  });
  formas.push({
    id: 'efectivo', titulo: 'En efectivo en el local',
    detalle: 'Te lo reservamos 24 horas, sin pagar ahora',
    total: usd_(usd), boton: 'Reservar',
  });
  return formas;
}
const usd_ = n => 'u$s ' + Math.round(n).toLocaleString('es-AR');

// ── El checkout ──────────────────────────────────────────────

/** El resumen del pedido del checkout: los productos y el total según la forma de pago. */
function resumenCheckout(){
  return `<h2>Resumen del pedido</h2>
    ${lineasCarrito().map(l => `<div class="resumen-item">
      <div class="carrito-foto chica">${fotoMini(l.p)}<span class="cant">${l.cantidad}</span></div>
      <div class="n">${esc(l.p.titulo || l.p.nombre)}<div class="d">${esc(specsDe(l.p))}</div></div>
      <div class="s">${usd(l.subtotal)}</div>
    </div>`).join('')}
    <div class="resumen-fila"><span>Subtotal</span><span>${usd(totalCarrito())}</span></div>
    <div class="resumen-fila"><span>Envío</span><span id="resumen-envio">Retiro en el local</span></div>
    <div class="resumen-total"><span id="total-titulo">Total</span><span id="total-monto"></span></div>`;
}

/**
 * La página del checkout: contacto, entrega y pago en tarjetas numeradas y el resumen
 * al costado. Confirmar manda el carrito al Worker, que cobra con el precio publicado.
 */
function paginaCheckout(){
  metaDeProducto(null);
  if (!lineasCarrito().length) { location.hash = '#carrito'; return; }
  const formas = formasDePago({ precioUSD: totalCarrito() });
  const aPedido = lineasCarrito().some(l => l.p.tipo === 'pedido');
  mostrarPagina(`${volver('Volver al carrito', '#carrito')}
    <h1 class="pagina-titulo">Finalizar compra</h1>
    <form class="dos-columnas" id="form-pedido" ${on('submit', 'mandarPedido', '$event')}>
      <div class="checkout-pasos">
        <section class="paso">
          <h2><span class="num">1</span>Información de contacto</h2>
          <div class="campo"><label for="ck-nombre">Nombre y apellido *</label><input id="ck-nombre" name="nombre" required autocomplete="name"></div>
          <div class="campo-doble">
            <div class="campo"><label for="ck-wa">WhatsApp *</label><input id="ck-wa" name="whatsapp" type="tel" required autocomplete="tel" placeholder="223 ..."></div>
            <div class="campo"><label for="ck-email">Email (para el comprobante)</label><input id="ck-email" name="email" type="email" autocomplete="email"></div>
          </div>
        </section>
        <section class="paso">
          <h2><span class="num">2</span>Método de entrega</h2>
          <label class="opcion"><input type="radio" name="entrega" value="retiro" checked ${on('change', 'pintarEnvio')}>
            <div><div class="t">Retiro en el local</div><div class="d">${esc(LOCAL.direccion || 'Lo pasás a buscar')}${LOCAL.horarios ? ' · ' + esc(LOCAL.horarios) : ''}</div></div><span class="precio-op">Gratis</span></label>
          <label class="opcion"><input type="radio" name="entrega" value="envio" ${on('change', 'pintarEnvio')}>
            <div><div class="t">Envío a domicilio</div><div class="d">El costo te lo pasamos por WhatsApp según la zona</div></div><span class="precio-op">A coordinar</span></label>
          <div class="campo" id="campo-direccion" hidden><label for="ck-dir">Dirección de entrega *</label><textarea id="ck-dir" name="direccion" rows="2" placeholder="Calle y número, ciudad"></textarea></div>
        </section>
        <section class="paso">
          <h2><span class="num">3</span>Método de pago</h2>
          ${formas.map((f, k) => `<label class="opcion">
            <input type="radio" name="pago" value="${esc(f.id)}" ${k === 0 ? 'checked' : ''} ${on('change', 'pintarTotal')}>
            <div><div class="t">${f.titulo}</div><div class="d">${f.detalle}</div></div><span class="precio-op">${f.total}</span>
          </label>`).join('')}
          ${aPedido ? '<p class="paso-nota">Tu carrito tiene productos a pedido: te confirmamos la demora antes de entregarlos.</p>' : ''}
        </section>
      </div>
      <aside class="resumen">
        ${resumenCheckout()}
        <button class="btn-primario ancho" type="submit" id="btn-pedido"></button>
        ${LOCAL.whatsapp ? `<button class="btn-borde ancho" type="button" ${on('click', 'pedidoPorWhatsApp')}>Seguir por WhatsApp</button>` : ''}
        <p class="resumen-nota">Al confirmar te escribimos por WhatsApp para coordinar.</p>
      </aside>
    </form>`);
  window.pintarTotal();
}

window.pintarEnvio = () => {
  const f = document.getElementById('form-pedido');
  const envio = f.entrega.value === 'envio';
  document.getElementById('campo-direccion').hidden = !envio;
  f.direccion.required = envio;
  document.getElementById('resumen-envio').textContent = envio ? 'A coordinar' : 'Retiro en el local';
};

window.pintarTotal = () => {
  const f = document.getElementById('form-pedido');
  if (!f) return;
  const forma = formasDePago({ precioUSD: totalCarrito() }).find(x => x.id === f.pago.value);
  document.getElementById('total-monto').textContent = forma.total;
  document.getElementById('total-titulo').textContent = forma.id === 'efectivo' ? 'A pagar en el local' : 'Total';
  document.getElementById('btn-pedido').textContent = forma.boton;
};

/** El pedido escrito para WhatsApp, con lo que el cliente haya completado hasta ahí. */
function textoPedido(f){
  const forma = formasDePago({ precioUSD: totalCarrito() }).find(x => x.id === f.pago.value);
  const lineas = lineasCarrito();
  return [
    'Hola! Quiero comprar:',
    ...lineas.map(l => `• ${l.cantidad > 1 ? l.cantidad + ' x ' : ''}${nombreCompleto(l.p)} (${usd_(l.subtotal)})${l.p.tipo === 'pedido' ? ' — a pedido' : ''}`),
    `Pago: ${forma.titulo} — ${forma.total}`,
    f.entrega.value === 'envio' ? `Entrega: envío a ${f.direccion.value.trim() || '(a confirmar)'}` : 'Entrega: lo paso a buscar',
    f.nombre.value.trim() ? `Nombre: ${f.nombre.value.trim()}` : '',
    f.whatsapp.value.trim() ? `WhatsApp: ${f.whatsapp.value.trim()}` : '',
    f.email.value.trim() ? `Email: ${f.email.value.trim()}` : '',
  ].filter(Boolean).join('\n');
}

/** "Seguir por WhatsApp": sale con lo que haya, sin exigir los datos. El local cierra la venta como quiera. */
window.pedidoPorWhatsApp = () => {
  const url = waDelLocal(textoPedido(document.getElementById('form-pedido')));
  if (!url) { aviso('El local todavía no cargó su WhatsApp. Escribinos por Instagram.', true); return; }
  window.open(url, '_blank', 'noopener');
};

/**
 * Confirmar el pedido. Todo va al Worker: Mercado Pago y tarjeta devuelven a dónde ir a
 * pagar; la reserva en efectivo queda hecha y se muestra la pantalla final.
 */
window.mandarPedido = async ev => {
  ev.preventDefault();
  const f = ev.target;
  const lineas = lineasCarrito();
  if (!lineas.length) { location.hash = '#carrito'; return; }

  const btn = document.getElementById('btn-pedido');
  const texto = btn.textContent;
  btn.disabled = true; btn.textContent = 'Un momento…';
  try {
    const r = await fetch(`${TIENDA_URL}/pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: lineas.map(l => ({ id: l.id, cantidad: l.cantidad })),
        pago: f.pago.value, entrega: f.entrega.value, direccion: f.direccion.value,
        nombre: f.nombre.value, whatsapp: f.whatsapp.value, email: f.email.value,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `la tienda respondió ${r.status}`);
    // A pagar (Mercado Pago o Stripe): el carrito se vacía recién cuando vuelve pagado.
    if (d.url) { location.href = d.url; return; }
    const producto = lineas.length === 1 ? nombreCompleto(lineas[0].p) : `${unidadesCarrito()} productos`;
    CARRITO = []; guardarCarrito();
    pantallaPedido({ id: d.id, estado: d.estado, producto, pago: f.pago.value });
  } catch (e) {
    aviso('No pudimos tomar el pedido: ' + e.message + '. Podés seguir por WhatsApp.', true);
    btn.disabled = false; btn.textContent = texto;
  }
};

/** La pantalla final: qué pasó con el pedido y cómo seguir. */
function pantallaPedido(d){
  const MENSAJES = {
    pagado:    ['ok', '¡Pedido realizado con éxito!', 'Ya tenemos tu pago. Te escribimos por WhatsApp para coordinar la entrega.'],
    reservado: ['ok', '¡Pedido reservado!', 'Te lo guardamos 24 horas. Pasá por el local a retirarlo y pagalo ahí.'],
    creado:    ['espera', 'Pago pendiente', 'Todavía no nos llegó la confirmación del pago. Si ya pagaste, en unos minutos se actualiza.'],
    pendiente: ['espera', 'Pago en proceso', 'Mercado Pago está procesando el pago. Te avisamos cuando se acredite.'],
    rechazado: ['mal', 'El pago no se completó', 'Podés intentar de nuevo con otro medio, o seguir por WhatsApp.'],
    devuelto:  ['espera', 'Pago devuelto', 'Este pago fue devuelto. Si tenés dudas, escribinos.'],
  };
  const [clase, titulo, detalle] = MENSAJES[d.estado] || ['ok', 'Pedido recibido', ''];
  const producto = d.items?.length > 1 ? `${d.items.reduce((s, l) => s + (l.cantidad || 1), 0)} productos` : d.producto;
  const wa = waDelLocal(`Hola! Hice el pedido ${d.id.slice(0, 8)} (${producto}) desde la tienda`);
  mostrarPagina(`<div class="resultado ${clase}">
      <div class="resultado-icono">${clase === 'ok' ? '✓' : clase === 'mal' ? '×' : '…'}</div>
      <h1>${titulo}</h1>
      <p>${esc(detalle)}</p>
      <div class="resultado-dato">Pedido <strong>${esc(d.id.slice(0, 8))}</strong>${producto ? ' · ' + esc(producto) : ''}</div>
      <div class="resultado-acciones">
        ${wa ? `<a class="btn-primario" href="${wa}" target="_blank" rel="noopener">Seguir por WhatsApp</a>` : ''}
        ${d.estado === 'rechazado' ? '<a class="btn-borde" href="#checkout">Intentar de nuevo</a>' : ''}
        <a class="btn-borde" href="#">Volver a la tienda</a>
      </div>
    </div>`);
}

/**
 * Volviendo de Mercado Pago: la URL trae ?pedido=ID (y MP agrega status=approved|...).
 * Se le pregunta al Worker cómo quedó; si el aviso de MP todavía no llegó, vale lo que
 * dice la URL para no mostrar "pendiente" a alguien que acaba de pagar.
 */
async function pedidoDesdeUrl(){
  const q = new URLSearchParams(location.search);
  const id = q.get('pedido');
  if (!id) return;
  history.replaceState(null, '', location.pathname);
  let d = { id, estado: 'creado', producto: '' };
  try {
    const r = await fetch(`${TIENDA_URL}/pedido/${encodeURIComponent(id)}`);
    if (r.ok) d = await r.json();
  } catch (e) { /* sin red: se muestra lo que diga la URL */ }
  const st = q.get('status') || q.get('collection_status');
  if (d.estado === 'creado' && st === 'approved') d.estado = 'pagado';
  if (d.estado === 'creado' && (st === 'rejected' || st === 'cancelled')) d.estado = 'rechazado';
  // Si el pago no salió, el carrito sigue ahí para reintentar.
  if (['pagado', 'pendiente', 'reservado'].includes(d.estado)) { CARRITO = []; guardarCarrito(); }
  pantallaPedido(d);
}

// ── Navegación ───────────────────────────────────────────────
//
// Cada vista tiene su link: la portada es la página pelada, un rubro es #r=celulares,
// una categoría #c=iphone-usados, un producto #p=id, y #carrito y #checkout. Los links
// son <a href> comunes y `hashchange` arma la vista, así el botón "atrás" del celular
// funciona y los links se pueden pegar en WhatsApp o Instagram.

/** El slug de un nombre para el link: "Accesorios de carga" → accesorios-de-carga. */
const slug = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const categoriaPorSlug = sl => categorias().find(c => slug(c) === sl) || null;
const rubroPorSlug = sl => rubros().map(r => r.nombre).find(r => slug(r) === sl) || null;

/** El hash del listado donde estaba parado, para volver desde un producto. */
const hashVista = () => FILTRO !== 'todo' ? '#c=' + slug(FILTRO) : RUBRO ? '#r=' + slug(RUBRO) : '';

const POR_PAGINA = 20;
let PAGINA = 1, PRECIO_MIN = '', PRECIO_MAX = '';

/** Un filtro del costado: categoría, condición, entrega u orden. Solo la categoría va en la URL. */
window.setFiltro = (clave, valor, ev) => {
  if (ev?.preventDefault) ev.preventDefault();
  if (clave === 'cat') { location.hash = valor; return; }
  if (clave === 'cond') COND = valor;
  else if (clave === 'entrega') ENTREGA = valor;
  else if (clave === 'orden') ORDEN = valor;
  PAGINA = 1;
  pintarFiltros();
  pintarProductos();
};
window.setPrecio = () => {
  PRECIO_MIN = document.getElementById('precio-min').value;
  PRECIO_MAX = document.getElementById('precio-max').value;
  PAGINA = 1;
  document.getElementById('precio-limpiar').hidden = !(PRECIO_MIN || PRECIO_MAX);
  pintarProductos();
};
window.limpiarPrecio = () => { PRECIO_MIN = PRECIO_MAX = ''; PAGINA = 1; pintarFiltros(); pintarProductos(); };
window.limpiarFiltros = () => {
  COND = ENTREGA = PRECIO_MIN = PRECIO_MAX = ''; ORDEN = 'relevancia'; PAGINA = 1;
  document.getElementById('q').value = '';
  if (location.hash && !/^#p=/.test(location.hash)) { location.hash = ''; return; }
  pintarFiltros(); pintarProductos();
};
window.irPagina = n => { PAGINA = n; pintarProductos(); document.getElementById('vista-tienda').querySelector('.tienda').scrollIntoView({ behavior: 'smooth' }); };

/** Abre o cierra los filtros (en el celular son un panel que sube desde abajo). */
const verFiltros = abrir => { document.getElementById('filtros').classList.toggle('abierto', abrir); document.body.classList.toggle('con-filtros', abrir); };
window.toggleFiltros = () => verFiltros(!document.getElementById('filtros').classList.contains('abierto'));
window.cerrarTeclado = () => document.getElementById('q').blur();

/** Arma la vista que pide la URL. */
function desdeUrl(){
  const p = /^#p=(.+)$/.exec(location.hash);
  if (p) { paginaProducto(decodeURIComponent(p[1])); return; }
  if (location.hash === '#carrito') { paginaCarrito(); return; }
  if (location.hash === '#checkout') { paginaCheckout(); return; }
  if (location.hash === '#contacto') return;
  const c = /^#c=(.+)$/.exec(location.hash);
  const r = /^#r=(.+)$/.exec(location.hash);
  const cat = c && categoriaPorSlug(decodeURIComponent(c[1]));
  const rub = r && rubroPorSlug(decodeURIComponent(r[1]));
  FILTRO = cat || 'todo';
  RUBRO = cat ? rubroDe(cat) : rub || null;
  PAGINA = 1;
  if (!cat && !rub) document.getElementById('q').value = '';
  verFiltros(false);
  metaDeProducto(null);
  mostrarTienda();
  pintarFiltros();
  pintarProductos();
  window.scrollTo({ top: 0 });
}

const tipoDe = p => p.tipo || 'equipo';

// ── Variantes ────────────────────────────────────────────────
//
// Los equipos NUEVOS de un mismo modelo (iPhone 16 en 128 y 256, en cinco colores) se
// muestran como una sola tarjeta con "desde" y, en la ficha, selectores de capacidad y
// color. Los usados no: cada unidad es única (batería, estado) y eso es lo que vende.
// Los productos siguen publicados uno por uno; la agrupación es solo al mostrar.
let GRUPOS = new Map();   // clave → [productos]

const claveGrupo = p => (p.condicion === 'nuevo' && tipoDe(p) !== 'accesorio')
  ? `${catDe(p)}|${String(p.nombre || '').trim().toLowerCase()}` : null;

function armarGrupos(){
  GRUPOS = new Map();
  for (const p of PRODUCTOS) {
    const k = claveGrupo(p);
    if (k) (GRUPOS.get(k) || GRUPOS.set(k, []).get(k)).push(p);
  }
  for (const [k, lista] of GRUPOS) if (lista.length < 2) GRUPOS.delete(k);
}
const grupoDe = p => { const k = claveGrupo(p); return k && GRUPOS.get(k) || null; };
const numGb = g => parseFloat(String(g).replace(/[^\d.]/g, '')) * (/tb/i.test(g) ? 1024 : 1) || 0;

/**
 * Cómo se llama un grupo en su tarjeta: el título pulido sin la capacidad ni el color
 * (eso se elige adentro), si todas las variantes dicen lo mismo; si no, el nombre del modelo.
 */
function nombreDeGrupo(lista){
  const literal = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sinVariante = p => p.titulo
    ? [p.gb, p.color].filter(Boolean).reduce((t, v) => t.replace(new RegExp('\\s*' + literal(v), 'i'), ''), String(p.titulo)).replace(/\s+/g, ' ').trim()
    : '';
  const titulos = new Set(lista.map(sinVariante));
  return titulos.size === 1 && [...titulos][0] || lista[0].nombre;
}

/** La tarjeta de un grupo: la foto de la primera variante que tenga, "desde" el precio más bajo. */
function tarjetaGrupo(lista){
  const p = lista.find(x => fotosDe(x).length) || lista[0];
  const gbs = [...new Set(lista.map(x => x.gb).filter(Boolean))].sort((a, b) => numGb(a) - numGb(b));
  const colores = [...new Set(lista.map(x => x.color).filter(Boolean))];
  const desde = Math.min(...lista.map(x => Number(x.precioUSD) || Infinity));
  // Hay que elegir capacidad y color: eso se hace en la página del producto.
  return `<article class="prod" ${on('click', 'abrirFicha', p.id)}>
    <div class="prod-foto">${sello(p)}${fotoTarjeta(p)}</div>
    <div class="prod-info">
      <h3 class="prod-nombre"><a href="${esc(linkProducto(p))}" data-stop>${esc(nombreDeGrupo(lista))}</a></h3>
      <div class="prod-detalle">${[gbs.map(esc).join(' · '), colores.length > 1 ? `${colores.length} colores` : ''].filter(Boolean).join(' · ')}</div>
      <div class="precio"><span class="desde">desde</span>${usd(desde)}</div>
    </div>
  </article>`;
}

/** Cuántas tarjetas tiene una lista: los grupos cuentan una vez. */
const cuenta = lista => new Set(lista.map(p => claveGrupo(p) && GRUPOS.has(claveGrupo(p)) ? claveGrupo(p) : p.id)).size;

/** Las entradas de una lista de productos: cada grupo una sola vez, en el lugar de su primer producto. */
function entradasLista(lista){
  const vistos = new Set(), out = [];
  for (const p of lista) {
    const g = grupoDe(p);
    if (!g) { out.push(tarjeta(p)); continue; }
    const k = claveGrupo(p);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(tarjetaGrupo(g));
  }
  return out;
}
const entradas = lista => entradasLista(lista).join('');

/** Los selectores de capacidad y color de la ficha, para la variante elegida. */
function selectoresVariante(p, grupo){
  const gbs = [...new Set(grupo.map(x => x.gb).filter(Boolean))].sort((a, b) => numGb(a) - numGb(b));
  const delGb = grupo.filter(x => !p.gb || x.gb === p.gb);
  const colores = [...new Set(delGb.map(x => x.color).filter(Boolean))];
  // Al cambiar de capacidad se intenta conservar el color; si no existe, la primera de esa capacidad.
  const conGb = gb => grupo.find(x => x.gb === gb && x.color === p.color) || grupo.find(x => x.gb === gb);
  const conColor = c => grupo.find(x => x.gb === p.gb && x.color === c) || grupo.find(x => x.color === c);
  return `<div class="variantes">
    ${gbs.length > 1 ? `<div><div class="t">Capacidad</div><div class="opciones">${gbs.map(gb =>
      `<button class="opc${gb === p.gb ? ' on' : ''}" ${on('click', 'abrirFicha', conGb(gb).id)}>${esc(gb)}</button>`).join('')}</div></div>` : ''}
    ${colores.length > 1 ? `<div><div class="t">Color</div><div class="opciones">${colores.map(c =>
      `<button class="opc${c === p.color ? ' on' : ''}" ${on('click', 'abrirFicha', conColor(c).id)}>${esc(c)}</button>`).join('')}</div></div>` : ''}
  </div>`;
}

// ── Rubros y categorías ──────────────────────────────────────

const catDe = p => p.categoria || 'Otros';
const rubroDeProd = p => rubroDe(catDe(p));
/** Las categorías en el orden publicado, más las que aparezcan sin estar en la lista. */
function categorias(){
  const vistas = [...new Set(PRODUCTOS.map(catDe))];
  return [...CATEGORIAS.filter(c => vistas.includes(c)), ...vistas.filter(c => !CATEGORIAS.includes(c))];
}
/** Los rubros con productos, en el orden del menú; adentro, sus categorías publicadas. */
function rubros(){
  const orden = Object.keys(RUBROS_CATALOGO);
  const porRubro = new Map();
  for (const c of categorias()) {
    const r = rubroDe(c);
    (porRubro.get(r) || porRubro.set(r, []).get(r)).push(c);
  }
  return [...porRubro].sort((a, b) => orden.indexOf(a[0]) - orden.indexOf(b[0])).map(([nombre, cats]) => ({ nombre, categorias: cats }));
}
const delRubro = r => PRODUCTOS.filter(p => rubroDeProd(p) === r);
const deCategoria = c => PRODUCTOS.filter(p => catDe(p) === c);

const pasaFiltros = p => (!COND || (p.condicion || 'nuevo') === COND) && (!ENTREGA || (tipoDe(p) === 'pedido' ? 'pedido' : 'inmediato') === ENTREGA);
/**
 * El orden por defecto de una sección: primero las tarjetas con varias opciones de
 * capacidad y color, y dentro de cada tanda el modelo más nuevo y más alto arriba
 * (shared/orden-tienda.js). Las variantes de un modelo quedan juntas.
 */
function porRelevancia(lista){
  const tarjetas = new Map();
  for (const p of lista) {
    const k = claveGrupo(p) && GRUPOS.has(claveGrupo(p)) ? claveGrupo(p) : p.id;
    (tarjetas.get(k) || tarjetas.set(k, []).get(k)).push(p);
  }
  const peso = ps => {
    const grupo = grupoDe(ps[0]);
    return [grupo ? 1 : 0, ...rangoDeModelo(ps[0].nombre), grupo ? grupo.length : 1, Math.max(...ps.map(p => Number(p.precioUSD) || 0))];
  };
  return [...tarjetas.values()].map(ps => ({ ps, peso: peso(ps) })).sort((a, b) => compararPesos(a.peso, b.peso)).flatMap(x => x.ps);
}
const ordenar = lista => ORDEN === 'menor' ? [...lista].sort((a, b) => a.precioUSD - b.precioUSD)
  : ORDEN === 'mayor' ? [...lista].sort((a, b) => b.precioUSD - a.precioUSD) : porRelevancia(lista);

const pasaPrecio = p => (!PRECIO_MIN || p.precioUSD >= Number(PRECIO_MIN)) && (!PRECIO_MAX || p.precioUSD <= Number(PRECIO_MAX));

// ── Las pantallas ────────────────────────────────────────────

/**
 * La tira de categorías de abajo de la cabecera: "Todo" y un link por sección. En la tira
 * "Celulares Samsung" es "Samsung": el nombre entero queda en la portada y los filtros.
 */
function pintarNavegacion(){
  document.getElementById('nav-rubros').innerHTML = '<a class="rubro" href="#" data-rubro="">Todo</a>'
    + rubros().map(r => `<a class="rubro" href="#r=${slug(r.nombre)}" data-rubro="${esc(r.nombre)}">${esc(r.nombre.replace(/^Celulares (?=\S)/, ''))}</a>`).join('');
}

function pintarMiga(q){
  const partes = ['<a href="#">Inicio</a>'];
  if (q) partes.push('<span>Búsqueda</span>');
  else {
    if (RUBRO) partes.push(FILTRO !== 'todo' ? `<a href="#r=${slug(RUBRO)}">${esc(RUBRO)}</a>` : `<span>${esc(RUBRO)}</span>`);
    if (FILTRO !== 'todo') partes.push(`<span>${esc(FILTRO)}</span>`);
  }
  document.getElementById('miga').innerHTML = partes.length > 1 ? partes.join('<span class="sep">›</span>') : '';
}

const textoConteo = n => `${n} producto${n === 1 ? '' : 's'}`;

/** Los filtros del costado: categorías por rubro, condición, entrega, precio y orden. */
function pintarFiltros(){
  const base = RUBRO ? (FILTRO !== 'todo' ? deCategoria(FILTRO) : delRubro(RUBRO)) : PRODUCTOS;
  const conds = new Set(base.map(p => p.condicion || 'nuevo'));
  const entregas = new Set(base.map(p => tipoDe(p) === 'pedido' ? 'pedido' : 'inmediato'));
  const radio = (grupo, clave, valor, texto, marcado, extra = '') => `<label class="radio${extra}">
    <input type="radio" name="${grupo}" ${marcado ? 'checked' : ''} ${on('change', 'setFiltro', clave, valor)}><span>${texto}</span></label>`;
  const activos = !!(RUBRO || COND || ENTREGA || PRECIO_MIN || PRECIO_MAX);

  document.getElementById('filtros-grupos').innerHTML = `
    ${activos ? `<div class="filtros-activos"><span>Filtros activos</span><button type="button" ${on('click', 'limpiarFiltros')}>Limpiar todos</button></div>` : ''}
    <div class="grupo"><h3>Categoría</h3>
      ${radio('f-cat', 'cat', '', 'Todas las categorías', !RUBRO)}
      ${rubros().map(r => radio('f-cat', 'cat', '#r=' + slug(r.nombre), `${esc(r.nombre)}<em>${cuenta(delRubro(r.nombre))}</em>`, RUBRO === r.nombre && FILTRO === 'todo', ' rubro')
        + (RUBRO === r.nombre && r.categorias.length > 1 ? r.categorias.map(c =>
          radio('f-cat', 'cat', '#c=' + slug(c), `${esc(c)}<em>${cuenta(deCategoria(c))}</em>`, FILTRO === c, ' sub')).join('') : '')).join('')}
    </div>
    ${conds.size > 1 ? `<div class="grupo"><h3>Condición</h3>${[['', 'Todos'], ['nuevo', 'Nuevos'], ['usado', 'Usados']].map(([v, t]) => radio('f-cond', 'cond', v, t, COND === v)).join('')}</div>` : ''}
    ${entregas.size > 1 ? `<div class="grupo"><h3>Entrega</h3>${[['', 'Todos'], ['inmediato', 'En el local'], ['pedido', 'A pedido']].map(([v, t]) => radio('f-ent', 'entrega', v, t, ENTREGA === v)).join('')}</div>` : ''}
    <div class="grupo"><h3>Rango de precio (u$s)</h3>
      <div class="precios">
        <input type="number" id="precio-min" placeholder="Mínimo" min="0" inputmode="numeric" aria-label="Precio mínimo" value="${esc(PRECIO_MIN)}" ${on('input', 'setPrecio')}>
        <input type="number" id="precio-max" placeholder="Máximo" min="0" inputmode="numeric" aria-label="Precio máximo" value="${esc(PRECIO_MAX)}" ${on('input', 'setPrecio')}>
      </div>
      <button class="limpiar" id="precio-limpiar" type="button" ${PRECIO_MIN || PRECIO_MAX ? '' : 'hidden'} ${on('click', 'limpiarPrecio')}>Limpiar</button>
    </div>
    <div class="grupo"><h3>Ordenar</h3>
      <select aria-label="Ordenar" ${on('change', 'setFiltro', 'orden', '$value')}>${[['relevancia', 'Más relevantes'], ['menor', 'Menor precio'], ['mayor', 'Mayor precio']].map(([v, t]) =>
        `<option value="${v}"${ORDEN === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
    </div>`;
  document.querySelectorAll('#nav-rubros a').forEach(a => {
    a.classList.toggle('on', a.dataset.rubro === (RUBRO || ''));
    // La sección abierta queda a la vista en la tira, aunque haya que deslizarla.
    if (a.classList.contains('on')) a.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
}

/** La paginación de una grilla: anterior, los números cercanos y siguiente. */
function paginacion(total){
  const paginas = Math.ceil(total / POR_PAGINA);
  if (paginas < 2) return '';
  const nums = [];
  for (let n = 1; n <= paginas; n++) {
    if (n === 1 || n === paginas || Math.abs(n - PAGINA) <= 1) nums.push(`<button type="button" class="pag-num${n === PAGINA ? ' on' : ''}" ${n === PAGINA ? 'aria-current="page"' : ''} ${on('click', 'irPagina', n)}>${n}</button>`);
    else if (Math.abs(n - PAGINA) === 2) nums.push('<span class="pag-puntos">…</span>');
  }
  return `<nav class="paginacion" aria-label="Paginación de productos">
    <button type="button" class="pag-btn" ${PAGINA === 1 ? 'disabled' : ''} ${on('click', 'irPagina', PAGINA - 1)}>‹ Anterior</button>
    <div class="pag-nums">${nums.join('')}</div>
    <button type="button" class="pag-btn" ${PAGINA === paginas ? 'disabled' : ''} ${on('click', 'irPagina', PAGINA + 1)}>Siguiente ›</button>
  </nav>`;
}

/** Una grilla paginada. Los grupos de variantes cuentan como una tarjeta. */
function grilla(lista){
  const tarjetas = entradasLista(lista);
  PAGINA = Math.min(PAGINA, Math.max(1, Math.ceil(tarjetas.length / POR_PAGINA)));
  return `<div class="grilla">${tarjetas.slice((PAGINA - 1) * POR_PAGINA, PAGINA * POR_PAGINA).join('')}</div>${paginacion(tarjetas.length)}`;
}

const vacio = (icono, titulo, detalle) => `<div class="vacio"><div class="vacio-icono">${icono}</div><h2>${titulo}</h2><p>${detalle}</p></div>`;

/**
 * Qué se ve a la derecha: buscando o filtrando, una grilla con todo lo que coincida;
 * adentro de un rubro o una categoría, la suya; si no, la portada con una sección por
 * rubro, sus productos deslizando y "ver todos".
 */
function pintarProductos(){
  const q = document.getElementById('q').value.trim().toLowerCase();
  const coincide = p => `${p.titulo || ''} ${p.nombre} ${p.gb} ${p.color} ${p.estado} ${catDe(p)}`.toLowerCase().includes(q);
  const salida = document.getElementById('salida');
  const conteo = document.getElementById('conteo');
  conteo.textContent = '';
  pintarMiga(q);
  const filtrando = !!(COND || ENTREGA || PRECIO_MIN || PRECIO_MAX || ORDEN !== 'relevancia');
  const portada = !q && !RUBRO && !filtrando;

  if (!PRODUCTOS.length) {
    salida.innerHTML = vacio('📦', 'Próximamente productos disponibles', 'Por el momento no hay equipos publicados. Escribinos y te contamos qué hay.');
    return;
  }

  if (!portada) {
    const base = q ? PRODUCTOS.filter(coincide) : RUBRO ? (FILTRO !== 'todo' ? deCategoria(FILTRO) : delRubro(RUBRO)) : PRODUCTOS;
    const lista = ordenar(base.filter(p => pasaFiltros(p) && pasaPrecio(p)));
    const titulo = q ? '' : `<h2 class="listado-titulo">${esc(FILTRO !== 'todo' ? FILTRO : RUBRO || 'Todos los productos')}</h2>`;
    conteo.textContent = lista.length ? textoConteo(cuenta(lista)) + (q ? ` para “${q}”` : '') : '';
    salida.innerHTML = titulo + (lista.length ? grilla(lista) : vacio('🔍', 'No se encontraron productos', 'Probá con otra búsqueda o filtro.'));
    return;
  }

  conteo.textContent = textoConteo(cuenta(PRODUCTOS));
  salida.innerHTML = rubros().map(r => {
    const lista = delRubro(r.nombre);
    return `<section class="seccion">
      <div class="seccion-cab">
        <h2 class="seccion-titulo">${esc(r.nombre)}</h2>
        <a class="vertodos" href="#r=${slug(r.nombre)}">Ver todos (${cuenta(lista)}) <span aria-hidden="true">→</span></a>
      </div>
      <div class="fila">${entradasLista(porRelevancia(lista)).slice(0, 12).join('')}</div>
    </section>`;
  }).join('');
}
/** Todo junto, para quien lo llame desde afuera. */
function pintar(){ pintarFiltros(); pintarProductos(); }

function hace(iso){
  const min = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (min < 60) return 'hace un rato';
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} hora${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

/** El pie: los rubros, los datos del local y los legales. */
function pie(actualizado){
  const wa = LOCAL.whatsapp ? `https://wa.me/${String(LOCAL.whatsapp).replace(/\D/g, '')}` : null;
  const nombre = esc(LOCAL.nombre || 'MarplaCity');
  return `<div class="pie-cols">
    <div><h4>Categorías</h4>${rubros().map(r => `<a href="#r=${slug(r.nombre)}">${esc(r.nombre)}</a>`).join('')}</div>
    <div><h4>${nombre}</h4>
      ${LOCAL.direccion ? `<p>📍 ${esc(LOCAL.direccion)}</p>` : ''}
      ${LOCAL.horarios ? `<p>🕗 ${esc(LOCAL.horarios)}</p>` : ''}
      ${wa ? `<a href="${wa}" target="_blank" rel="noopener">💬 Escribinos por WhatsApp</a>` : ''}
    </div>
    <div><h4>Información</h4>
      <a href="privacidad.html">Política de privacidad</a>
      <a href="condiciones.html">Términos y condiciones</a>
      <a href="eliminacion-datos.html">Eliminación de datos</a>
    </div>
  </div>
  <div class="pie-base">
    <span>Precios en dólar billete. Sujetos a disponibilidad.${actualizado ? ' Actualizado ' + hace(actualizado) + '.' : ''}</span>
    <span>© ${new Date().getFullYear()} ${nombre}</span>
  </div>`;
}

(async () => {
  try{
    const r = await fetch(URL);
    if(!r.ok) throw new Error('no se pudo cargar');
    const d = campos((await r.json()).fields);

    // La capacidad y el color se acomodan al leer, no solo al publicar: lo ya publicado
    // puede traer "256gb" y "256GB", o el color adentro del nombre ("iPhone 15 Black //
    // SIM + eSIM"), y así cada color salía como un producto aparte.
    PRODUCTOS = (d.productos || []).filter(p => p && p.precioUSD > 0).map(p => ({ ...p, gb: capacidadPareja(p.gb), ...separarColor(p.nombre, p.color) }));
    armarGrupos();
    LOCAL = d.local || {};
    COBRO = d.cobro || {};
    CATEGORIAS = Array.isArray(d.categorias) ? d.categorias : [];
    leerCarrito();
    pintarGloboCarrito();

    if (LOCAL.nombre) { document.getElementById('marca').textContent = LOCAL.nombre; document.getElementById('portada-titulo').textContent = LOCAL.nombre; }
    const wa = waDelLocal();
    if (wa) for (const id of ['cab-wa', 'wa-flotante']) { const a = document.getElementById(id); a.href = wa; a.hidden = false; }
    document.getElementById('pie').innerHTML = pie(d.actualizado);

    pintarNavegacion();
    desdeUrl();
    pedidoDesdeUrl();
  }catch(e){
    document.getElementById('salida').innerHTML = vacio('⚠️', 'No pudimos cargar la tienda', 'Probá de nuevo en un rato.');
  }
})();

// El buscador vive en la cabecera, así que también se usa desde la página de un producto o
// del carrito: ahí se vuelve a la tienda sin perder lo escrito.
document.getElementById('q').addEventListener('input', () => {
  PAGINA = 1;
  if (document.getElementById('vista-tienda').hidden) {
    history.pushState(null, '', location.pathname + location.search + hashVista());
    metaDeProducto(null);
    mostrarTienda();
    pintarFiltros();
  }
  pintarProductos();
});
window.addEventListener('hashchange', desdeUrl);

// Compatibilidad de los controles HTML al pasar a módulos ES.
Object.assign(window, { tarjeta, linkWhatsApp, metaDeProducto, formasDePago, textoPedido, pantallaPedido, pedidoDesdeUrl, armarGrupos, tarjetaGrupo, entradas, selectoresVariante, categorias, rubros, pintar, hace, paginaProducto, paginaCarrito, paginaCheckout });
