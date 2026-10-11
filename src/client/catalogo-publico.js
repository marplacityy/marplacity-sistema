import { esc, on } from '../shared/seguridad.js';
import { RUBROS_CATALOGO, rubroDe } from '../shared/catalogo.js';
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
const ICONOS = { 'Celulares': '📱', 'Notebooks y tablets': '💻', 'Audio': '🎧', 'Smartwatch': '⌚', 'Accesorios': '🔌', 'Electrodomésticos': '🧊', 'Otros': '📦' };
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

/** La galería de la tarjeta: las fotos apiladas con puntitos, o la inicial si no hay. */
function galeria(p){
  const fotos = fotosDe(p);
  if (!fotos.length) return esc(inicial(p.nombre));
  // Si el archivo no carga, se quita: nunca una imagen rota.
  return `${fotos.map((f, k) => `<img src="${esc(f)}" alt="${esc(p.nombre)}" loading="lazy"
      class="${k === 0 ? 'ver' : ''}" ${on('error', 'quitarImagen', '$this')}>`).join('')}
    ${fotos.length > 1 ? `<div class="puntos">${fotos.map((_, k) =>
      `<button class="punto${k === 0 ? ' on' : ''}" aria-label="Foto ${k+1}" ${on('click', 'verFoto', '$this', k)}></button>`).join('')}</div>` : ''}`;
}

const sello = p => p.tipo === 'pedido' ? '<span class="sello">A pedido</span>' : '';
const notaPrecio = p => p.tipo === 'pedido' ? 'Se trae a pedido' : 'Disponible en el local';

/** Los botones de abajo de la tarjeta: comprar y, si el local cargó número, WhatsApp. */
function acciones(p, texto, handler){
  const wa = linkWhatsApp(p);
  return `<div class="prod-acciones">
    <button class="btn-comprar" type="button" ${on('click', handler, p.id)}>${texto}</button>
    ${wa ? `<a class="btn-wa" href="${wa}" target="_blank" rel="noopener" aria-label="Consultar por WhatsApp" data-stop>${ICONO_WA}</a>` : ''}
  </div>`;
}

function tarjeta(p){
  const specs = [
    p.gb && `<span class="chip">${esc(p.gb)}</span>`,
    p.color && `<span class="chip">${esc(p.color)}</span>`,
    p.bateria != null && `<span class="chip bat">Batería ${esc(p.bateria)}%</span>`,
    p.estado && `<span class="chip">${esc(p.estado)}</span>`,
  ].filter(Boolean).join('');

  // Tocar la tarjeta abre la ficha; el botón va directo al pedido.
  return `<article class="prod" ${on('click', 'abrirFicha', p.id)}>
    <div class="prod-foto">${sello(p)}${galeria(p)}</div>
    <div class="prod-nombre">${esc(p.titulo || p.nombre)}</div>
    <div class="chips">${specs}</div>
    <div class="precio">${usd(p.precioUSD)}</div>
    <div class="precio-nota">${notaPrecio(p)}</div>
    ${acciones(p, 'Comprar', 'abrirPedido')}
  </article>`;
}

/** El link a WhatsApp con el producto ya escrito, o null si el local no cargó número. */
function linkWhatsApp(p){
  if (!LOCAL.whatsapp) return null;
  const texto = encodeURIComponent(`Hola! Me interesa el ${p.nombre}${p.gb ? ' ' + p.gb : ''}${p.color ? ' ' + p.color : ''} que vi en la tienda` +
    (p.tipo === 'pedido' ? ' (a pedido)' : ''));
  return `https://wa.me/${String(LOCAL.whatsapp).replace(/\D/g, '')}?text=${texto}`;
}

/**
 * La ficha del producto. Se abre al tocar la tarjeta y queda en la URL (#p=id), así el
 * link a un producto puntual se puede pegar en WhatsApp o Instagram y cae ahí directo.
 */
window.abrirFicha = id => {
  const p = PRODUCTOS.find(x => x.id === id);
  if (!p) return;
  const fotos = fotosDe(p);
  const wa = linkWhatsApp(p);
  const grupo = grupoDe(p);   // si es una variante de un modelo, la capacidad y el color van en selectores
  const specs = [
    p.tipo === 'pedido' && '<span class="chip pedido">A pedido</span>',
    p.gb && !grupo && `<span class="chip">${esc(p.gb)}</span>`,
    p.color && !grupo && `<span class="chip">${esc(p.color)}</span>`,
    p.bateria != null && `<span class="chip bat">Batería ${esc(p.bateria)}%</span>`,
    p.estado && `<span class="chip">${esc(p.estado)}</span>`,
  ].filter(Boolean).join('');

  document.getElementById('ficha-contenido').innerHTML = `
    <button class="ficha-cerrar" ${on('click', 'cerrarFicha')} aria-label="Cerrar">×</button>
    <div class="ficha-cuerpo">
      <div class="ficha-galeria">
        <div class="ficha-grande" id="ficha-grande">${fotos.length
          ? `<img src="${esc(fotos[0])}" alt="${esc(p.nombre)}" ${on('error', 'fotoFallo', '$this', inicial(p.nombre))}>`
          : esc(inicial(p.nombre))}</div>
        ${fotos.length > 1 ? `<div class="ficha-mini">${fotos.map((f, k) =>
          `<img src="${esc(f)}" class="${k === 0 ? 'on' : ''}" alt="" ${on('click', 'verGrande', '$this', f)} ${on('error', 'quitarImagen', '$this')}>`).join('')}</div>` : ''}
      </div>
      <div class="ficha-datos">
        <div class="ficha-nombre">${esc(p.titulo || p.nombre)}</div>
        ${grupo ? selectoresVariante(p, grupo) : ''}
        <div class="chips">${specs}</div>
        ${p.descripcion ? `<div class="ficha-desc">${esc(p.descripcion)}</div>` : ''}
        ${p.tipo === 'pedido'
          ? '<div class="ficha-nota">Este producto no está en el local: se trae a pedido. Escribinos y te decimos la demora.</div>'
          : '<div class="ficha-nota">Está en el local: lo podés pasar a ver y llevártelo en el momento.</div>'}
        <div class="ficha-precio">${usd(p.precioUSD)}</div>
        <div class="ficha-nota">Precio en dólar billete, válido pagando en efectivo. Por otros medios de pago, consultá.</div>
        <div class="ficha-acciones">
          <button class="consultar" ${on('click', 'abrirPedido', p.id)}>Comprar</button>
          ${wa ? `<a class="btn-sec" href="${wa}" target="_blank" rel="noopener">Preguntar por WhatsApp</a>` : ''}
          <button class="btn-sec" ${on('click', 'compartirFicha', p.id)}>Compartir</button>
        </div>
      </div>
    </div>`;

  const d = document.getElementById('ficha');
  if (!d.open) d.showModal();
  if (location.hash !== '#p=' + id) history.replaceState(null, '', '#p=' + encodeURIComponent(id));
  metaDeProducto(p);
};

// Los metadatos de la página siguen al producto abierto: sirven al compartir el link y a
// los buscadores. Al cerrar vuelven los de la tienda.
const META_BASE = { title: document.title, desc: document.querySelector('meta[name="description"]')?.content || '' };
function metaDeProducto(p){
  const titulo = p ? `${p.titulo || p.nombre}${p.gb ? ' ' + p.gb : ''}${p.color ? ' ' + p.color : ''} — ${usd(p.precioUSD)} · MarplaCity` : META_BASE.title;
  const desc = p ? (p.seoDescripcion || p.descripcion || `${p.titulo || p.nombre} a ${usd(p.precioUSD)} en MarplaCity, Mar del Plata.`).slice(0, 160) : META_BASE.desc;
  document.title = titulo;
  for (const sel of ['meta[name="description"]', 'meta[property="og:description"]']) { const m = document.querySelector(sel); if (m) m.content = desc; }
  const og = document.querySelector('meta[property="og:title"]'); if (og) og.content = titulo;
  let kw = document.querySelector('meta[name="keywords"]');
  if (p?.keywords) { if (!kw) { kw = document.createElement('meta'); kw.name = 'keywords'; document.head.appendChild(kw); } kw.content = p.keywords; }
  else if (kw) kw.remove();
}

window.cerrarFicha = () => document.getElementById('ficha').close();
window.quitarImagen = el => el.remove();
window.fotoFallo = (el, texto) => { el.parentNode.textContent = texto; };
window.cerrarFichaSiFondo = (e, el) => { if (e.target === el) window.cerrarFicha(); };
// Al cerrar —por el botón, Escape o tocando afuera— el link vuelve a ser el de la vista
// (la categoría o el rubro donde estaba parado, o la portada).
document.getElementById('ficha').addEventListener('close', () => {
  if (/^#p=/.test(location.hash)) history.replaceState(null, '', hashVista() || location.pathname + location.search);
  metaDeProducto(null);
});

window.verGrande = (mini, src) => {
  document.getElementById('ficha-grande').innerHTML = `<img src="${esc(src)}" alt="">`;
  mini.parentNode.querySelectorAll('img').forEach(i => i.classList.toggle('on', i === mini));
};

/** Comparte el link del producto: la hoja del celular si existe, si no copia el link. */
window.compartirFicha = async id => {
  const p = PRODUCTOS.find(x => x.id === id);
  const url = location.origin + location.pathname + '#p=' + encodeURIComponent(id);
  const titulo = p ? `${p.nombre} — ${usd(p.precioUSD)}` : document.title;
  try {
    if (navigator.share) await navigator.share({ title: titulo, text: titulo, url });
    else { await navigator.clipboard.writeText(url); alert('Link copiado'); }
  } catch (e) { /* canceló */ }
};

// ── El pedido ────────────────────────────────────────────────

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

let PEDIDO_ID = null;   // el producto que se está pidiendo

window.abrirPedido = id => {
  const p = PRODUCTOS.find(x => x.id === id);
  if (!p) return;
  PEDIDO_ID = id;
  const foto = fotosDe(p)[0];
  const formas = formasDePago(p);
  const specs = [p.gb, p.color, p.estado, p.bateria != null && `Batería ${esc(p.bateria)}%`].filter(Boolean).join(' · ');

  document.getElementById('ficha-contenido').innerHTML = `
    <button class="ficha-cerrar" ${on('click', 'cerrarFicha')} aria-label="Cerrar">×</button>
    <form class="pedido-form" id="form-pedido" ${on('submit', 'mandarPedido', '$event', p.id)}>
      <button type="button" class="volver" ${on('click', 'abrirFicha', p.id)}>← Volver al producto</button>
      <div class="pedido-titulo">Tu pedido</div>
      <div class="pedido-prod">
        ${foto ? `<img src="${esc(foto)}" alt="">` : ''}
        <div><div class="n">${esc(p.nombre)}</div><div style="font-size:12px;color:var(--text2);">${esc(specs)}</div><div class="p">${usd_(p.precioUSD)}</div></div>
      </div>
      ${p.tipo === 'pedido' ? '<div class="ficha-nota">Este producto se trae a pedido: te confirmamos la demora antes de cobrarlo.</div>' : ''}

      <div class="pedido-sec">¿Cómo querés pagar?</div>
      ${formas.map((f, k) => `<label class="opcion">
        <input type="radio" name="pago" value="${esc(f.id)}" ${k === 0 ? 'checked' : ''} ${on('change', 'pintarTotal')}>
        <div><div class="t">${f.titulo}</div><div class="d">${f.detalle}</div></div>
      </label>`).join('')}

      <div class="pedido-sec">¿Cómo lo recibís?</div>
      <label class="opcion"><input type="radio" name="entrega" value="retiro" checked ${on('change', 'pintarEnvio')}>
        <div><div class="t">Lo paso a buscar</div><div class="d">${esc(LOCAL.direccion || 'por el local')}${LOCAL.horarios ? ' · ' + esc(LOCAL.horarios) : ''}</div></div></label>
      <label class="opcion"><input type="radio" name="entrega" value="envio" ${on('change', 'pintarEnvio')}>
        <div><div class="t">Envío a domicilio</div><div class="d">El costo del envío te lo pasamos por WhatsApp según la zona</div></div></label>
      <div class="campo" id="campo-direccion" hidden><span>Dirección de entrega</span><textarea name="direccion" rows="2" placeholder="Calle y número, ciudad"></textarea></div>

      <div class="pedido-sec">Tus datos</div>
      <div class="campo"><span>Nombre y apellido</span><input name="nombre" required autocomplete="name"></div>
      <div class="campo"><span>WhatsApp</span><input name="whatsapp" type="tel" required autocomplete="tel" placeholder="223 ..."></div>
      <div class="campo"><span>Email (para el comprobante)</span><input name="email" type="email" autocomplete="email"></div>

      <div class="pedido-total"><span class="s" id="total-titulo">Total</span><span class="m" id="total-monto"></span></div>
      <button class="consultar" type="submit" id="btn-pedido"></button>
      <button class="btn-sec" type="button" ${on('click', 'pedidoPorWhatsApp', p.id)}>Seguir por WhatsApp</button>
      <div class="ficha-nota">Al confirmar te escribimos por WhatsApp para coordinar.</div>
    </form>`;

  window.pintarTotal();
  const d = document.getElementById('ficha');
  if (!d.open) d.showModal();
  d.scrollTop = 0;
};

window.pintarEnvio = () => {
  const f = document.getElementById('form-pedido');
  const envio = f.entrega.value === 'envio';
  document.getElementById('campo-direccion').hidden = !envio;
  f.direccion.required = envio;
};

window.pintarTotal = () => {
  const f = document.getElementById('form-pedido');
  const p = PRODUCTOS.find(x => x.id === PEDIDO_ID);
  if (!p || !f) return;
  const forma = formasDePago(p).find(x => x.id === f.pago.value);
  document.getElementById('total-monto').textContent = forma.total;
  document.getElementById('total-titulo').textContent = forma.id === 'efectivo' ? 'A pagar en el local' : 'Total';
  document.getElementById('btn-pedido').textContent = forma.boton;
};

/** El pedido escrito para WhatsApp, con lo que el cliente haya completado hasta ahí. */
function textoPedido(p, f){
  const forma = formasDePago(p).find(x => x.id === f.pago.value);
  return [
    `Hola! Quiero comprar: ${p.nombre}${p.gb ? ' ' + p.gb : ''}${p.color ? ' ' + p.color : ''} (${usd_(p.precioUSD)})`,
    `Pago: ${forma.titulo} — ${forma.total}`,
    f.entrega.value === 'envio' ? `Entrega: envío a ${f.direccion.value.trim() || '(a confirmar)'}` : 'Entrega: lo paso a buscar',
    f.nombre.value.trim() ? `Nombre: ${f.nombre.value.trim()}` : '',
    f.whatsapp.value.trim() ? `WhatsApp: ${f.whatsapp.value.trim()}` : '',
    f.email.value.trim() ? `Email: ${f.email.value.trim()}` : '',
    p.tipo === 'pedido' ? '(producto a pedido)' : '',
  ].filter(Boolean).join('\n');
}

/** "Seguir por WhatsApp": sale con lo que haya, sin exigir los datos. El local cierra la venta como quiera. */
window.pedidoPorWhatsApp = id => {
  const p = PRODUCTOS.find(x => x.id === id);
  if (!LOCAL.whatsapp) { alert('El local todavía no cargó su WhatsApp. Escribinos por Instagram.'); return; }
  window.open(`https://wa.me/${String(LOCAL.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(textoPedido(p, document.getElementById('form-pedido')))}`, '_blank', 'noopener');
};

/**
 * Confirmar el pedido. Todo va al Worker: Mercado Pago y tarjeta devuelven a dónde ir a
 * pagar; la reserva en efectivo queda hecha y se muestra la pantalla final.
 */
window.mandarPedido = async (ev, id) => {
  ev.preventDefault();
  const p = PRODUCTOS.find(x => x.id === id);
  const f = ev.target;

  const btn = document.getElementById('btn-pedido');
  const texto = btn.textContent;
  btn.disabled = true; btn.textContent = 'Un momento…';
  try {
    const r = await fetch(`${TIENDA_URL}/pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productoId: p.id, pago: f.pago.value, entrega: f.entrega.value, direccion: f.direccion.value,
        nombre: f.nombre.value, whatsapp: f.whatsapp.value, email: f.email.value,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `la tienda respondió ${r.status}`);
    if (d.url) { location.href = d.url; return; }      // a pagar (Mercado Pago o Stripe)
    pantallaPedido({ id: d.id, estado: d.estado, producto: p.nombre, pago: f.pago.value });
  } catch (e) {
    alert('No pudimos tomar el pedido: ' + e.message + '\n\nPodés seguir por WhatsApp.');
    btn.disabled = false; btn.textContent = texto;
  }
};

/** La pantalla final: qué pasó con el pedido y cómo seguir. */
function pantallaPedido(d){
  const MENSAJES = {
    pagado:    ['✅ Pago aprobado', 'Ya tenemos tu pedido. Te escribimos por WhatsApp para coordinar la entrega.'],
    reservado: ['✅ Reservado', 'Te lo guardamos 24 horas. Pasá por el local a retirarlo y pagalo ahí.'],
    creado:    ['⏳ Pago pendiente', 'Todavía no nos llegó la confirmación del pago. Si ya pagaste, en unos minutos se actualiza.'],
    pendiente: ['⏳ Pago en proceso', 'Mercado Pago está procesando el pago. Te avisamos cuando se acredite.'],
    rechazado: ['❌ El pago no se completó', 'Podés intentar de nuevo con otro medio, o seguir por WhatsApp.'],
    devuelto:  ['↩️ Pago devuelto', 'Este pago fue devuelto. Si tenés dudas, escribinos.'],
  };
  const [titulo, detalle] = MENSAJES[d.estado] || ['Pedido recibido', ''];
  const wa = LOCAL.whatsapp
    ? `https://wa.me/${String(LOCAL.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(`Hola! Hice el pedido ${d.id.slice(0, 8)} (${d.producto}) desde la tienda`)}`
    : null;
  document.getElementById('ficha-contenido').innerHTML = `
    <button class="ficha-cerrar" ${on('click', 'cerrarFicha')} aria-label="Cerrar">×</button>
    <div class="pedido-form">
      <div class="pedido-titulo">${titulo}</div>
      <div class="ficha-desc">${esc(detalle)}</div>
      <div class="ficha-nota">Pedido ${esc(d.id.slice(0, 8))} · ${esc(d.producto)}</div>
      <div class="ficha-acciones">
        ${wa ? `<a class="consultar" href="${wa}" target="_blank" rel="noopener">Seguir por WhatsApp</a>` : ''}
        <button class="btn-sec" type="button" ${on('click', 'cerrarFicha')}>Volver a la tienda</button>
      </div>
    </div>`;
  const dlg = document.getElementById('ficha');
  if (!dlg.open) dlg.showModal();
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
  pantallaPedido(d);
}

/** Cambia la foto que se ve. Vive en window porque la llama el click del puntito. */
window.verFoto = (boton, k) => {
  const caja = boton.closest('.prod-foto');
  caja.querySelectorAll('img').forEach((img, i) => img.classList.toggle('ver', i === k));
  caja.querySelectorAll('.punto').forEach((b, i) => b.classList.toggle('on', i === k));
};

// ── Navegación ───────────────────────────────────────────────
//
// Cada vista tiene su link: la portada es la página pelada, un rubro es #r=celulares y
// una categoría #c=iphone-usados. Los links son <a href> comunes y `hashchange` arma la
// vista, así el botón "atrás" del celular funciona y los links se pueden pegar en
// WhatsApp o Instagram.

/** El slug de un nombre para el link: "Accesorios de carga" → accesorios-de-carga. */
const slug = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const categoriaPorSlug = sl => categorias().find(c => slug(c) === sl) || null;
const rubroPorSlug = sl => rubros().map(r => r.nombre).find(r => slug(r) === sl) || null;

/** El hash de la vista actual, sin contar la ficha abierta. */
const hashVista = () => FILTRO !== 'todo' ? '#c=' + slug(FILTRO) : RUBRO ? '#r=' + slug(RUBRO) : '';

/** Abre una categoría (o vuelve a la portada con 'todo'). */
window.filtrar = cat => { location.hash = cat === 'todo' ? '' : '#c=' + slug(cat); };

/** Un filtro de la página de rubro: condición, entrega u orden. No va en la URL. */
window.setFiltro = (clave, valor, ev) => {
  if (ev) ev.preventDefault();
  if (clave === 'cond') COND = valor;
  else if (clave === 'entrega') ENTREGA = valor;
  else if (clave === 'orden') ORDEN = valor;
  pintar();
};

window.toggleMenu = () => { const m = document.getElementById('menu'); m.hidden = !m.hidden; };
const cerrarMenu = () => { document.getElementById('menu').hidden = true; };
window.cerrarTeclado = () => document.getElementById('q').blur();

/** Arma la vista que pide la URL: #p=id es una ficha; #c y #r, una categoría o un rubro. */
function desdeUrl(){
  const p = /^#p=(.+)$/.exec(location.hash);
  if (p) { window.abrirFicha(decodeURIComponent(p[1])); return; }
  const c = /^#c=(.+)$/.exec(location.hash);
  const r = /^#r=(.+)$/.exec(location.hash);
  const cat = c && categoriaPorSlug(decodeURIComponent(c[1]));
  const rub = r && rubroPorSlug(decodeURIComponent(r[1]));
  FILTRO = cat || 'todo';
  RUBRO = cat ? rubroDe(cat) : rub || null;
  if (!cat && !rub) document.getElementById('q').value = '';
  cerrarMenu();
  pintar();
  document.getElementById('ficha').close();
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

/** La tarjeta de un grupo: la foto de la primera variante que tenga, "desde" el precio más bajo. */
function tarjetaGrupo(lista){
  const p = lista.find(x => fotosDe(x).length) || lista[0];
  const gbs = [...new Set(lista.map(x => x.gb).filter(Boolean))].sort((a, b) => numGb(a) - numGb(b));
  const colores = [...new Set(lista.map(x => x.color).filter(Boolean))];
  const desde = Math.min(...lista.map(x => Number(x.precioUSD) || Infinity));
  const foto = fotosDe(p)[0];
  // Hay que elegir capacidad y color: el botón abre la ficha, no el pedido.
  return `<article class="prod" ${on('click', 'abrirFicha', p.id)}>
    <div class="prod-foto">${sello(p)}${foto ? `<img src="${esc(foto)}" alt="${esc(p.nombre)}" loading="lazy" ${on('error', 'quitarImagen', '$this')}>` : esc(inicial(p.nombre))}</div>
    <div class="prod-nombre">${esc(p.nombre)}</div>
    <div class="chips">${gbs.length ? `<span class="chip">${esc(gbs.join(' · '))}</span>` : ''}${colores.length > 1 ? `<span class="chip">${colores.length} colores</span>` : ''}</div>
    <div class="precio"><span class="desde">desde</span>${usd(desde)}</div>
    <div class="precio-nota">${notaPrecio(p)}</div>
    ${acciones(p, 'Ver opciones', 'abrirFicha')}
  </article>`;
}

/** Cuántas tarjetas tiene una lista: los grupos cuentan una vez. */
const cuenta = lista => new Set(lista.map(p => claveGrupo(p) && GRUPOS.has(claveGrupo(p)) ? claveGrupo(p) : p.id)).size;

/** Las entradas de una lista de productos: cada grupo una sola vez, en el lugar de su primer producto. */
function entradas(lista){
  const vistos = new Set(), out = [];
  for (const p of lista) {
    const g = grupoDe(p);
    if (!g) { out.push(tarjeta(p)); continue; }
    const k = claveGrupo(p);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(tarjetaGrupo(g));
  }
  return out.join('');
}

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
const ordenar = lista => ORDEN === 'menor' ? [...lista].sort((a, b) => a.precioUSD - b.precioUSD)
  : ORDEN === 'mayor' ? [...lista].sort((a, b) => b.precioUSD - a.precioUSD) : lista;

// ── Las pantallas ────────────────────────────────────────────

/** El menú de rubros de la barra, el desplegable y las burbujas de la portada. */
function pintarNavegacion(){
  const rs = rubros();
  document.getElementById('nav-rubros').innerHTML = rs.map(r =>
    `<a href="#r=${slug(r.nombre)}" class="${RUBRO === r.nombre ? 'on' : ''}">${esc(r.nombre)}</a>`).join('');
  document.getElementById('menu-contenido').innerHTML = `<div class="menu-cols">${rs.map(r => `<div class="menu-rubro">
      <a class="t" href="#r=${slug(r.nombre)}">${esc(r.nombre)}</a>
      ${r.categorias.map(c => `<a class="c" href="#c=${slug(c)}">${esc(c)}<span class="n">${cuenta(deCategoria(c))}</span></a>`).join('')}
    </div>`).join('')}</div>`;
  // La burbuja lleva la foto de algún producto del rubro; si ninguno tiene, un ícono.
  document.getElementById('burbujas').innerHTML = rs.map(r => {
    const icono = ICONOS[r.nombre] || '📦';
    const conFoto = delRubro(r.nombre).find(p => fotosDe(p).length);
    return `<a class="burbuja" href="#r=${slug(r.nombre)}"><div class="c">${conFoto
      ? `<img src="${esc(fotosDe(conFoto)[0])}" alt="" loading="lazy" ${on('error', 'fotoFallo', '$this', icono)}>`
      : icono}</div><span>${esc(r.nombre)}</span></a>`;
  }).join('');
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

/** La página de un rubro o de una categoría: filtros a la izquierda y la grilla. */
function pintarListado(){
  const cat = FILTRO !== 'todo' ? FILTRO : null;
  const todos = delRubro(RUBRO);
  const base = cat ? todos.filter(p => catDe(p) === cat) : todos;
  const lista = ordenar(base.filter(pasaFiltros));
  const conds = new Set(base.map(p => p.condicion || 'nuevo'));
  const entregas = new Set(base.map(p => tipoDe(p) === 'pedido' ? 'pedido' : 'inmediato'));
  const opciones = (clave, actual, pares) => pares.map(([v, t]) =>
    `<a class="f${actual === v ? ' on' : ''}" href="#" ${on('click', 'setFiltro', clave, v, '$event')}>${t}</a>`).join('');

  const filtros = `<aside class="filtros">
    <div class="grupo"><div class="t">Categorías</div>
      <a class="f${!cat ? ' on' : ''}" href="#r=${slug(RUBRO)}">Todo ${esc(RUBRO)}<span class="n">${cuenta(todos)}</span></a>
      ${rubros().find(r => r.nombre === RUBRO)?.categorias.map(c =>
        `<a class="f${c === cat ? ' on' : ''}" href="#c=${slug(c)}">${esc(c)}<span class="n">${cuenta(deCategoria(c))}</span></a>`).join('') || ''}
    </div>
    ${conds.size > 1 ? `<div class="grupo"><div class="t">Condición</div>${opciones('cond', COND, [['', 'Todos'], ['nuevo', 'Nuevos'], ['usado', 'Usados']])}</div>` : ''}
    ${entregas.size > 1 ? `<div class="grupo"><div class="t">Entrega</div>${opciones('entrega', ENTREGA, [['', 'Todos'], ['inmediato', 'En el local'], ['pedido', 'A pedido']])}</div>` : ''}
    <div class="grupo"><div class="t">Ordenar</div>
      <select aria-label="Ordenar" ${on('change', 'setFiltro', 'orden', '$value')}>${[['relevancia', 'Más relevantes'], ['menor', 'Menor precio'], ['mayor', 'Mayor precio']].map(([v, t]) =>
        `<option value="${v}"${ORDEN === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
    </div>
  </aside>`;

  document.getElementById('salida').innerHTML = `<h1 class="listado-titulo">${esc(cat || RUBRO)}</h1>
    <div class="listado">${filtros}<div>
      <div class="conteo">${textoConteo(cuenta(lista))}</div>
      ${lista.length ? `<div class="grilla">${entradas(lista)}</div>` : '<div class="aviso">No hay productos con esos filtros.</div>'}
    </div></div>`;
}

/**
 * Qué se ve: buscando, todo lo que coincida en una grilla; adentro de un rubro o una
 * categoría, su página con filtros; si no, la portada con una sección por rubro.
 */
function pintar(){
  const q = document.getElementById('q').value.trim().toLowerCase();
  const coincide = p => `${p.titulo || ''} ${p.nombre} ${p.gb} ${p.color} ${p.estado} ${catDe(p)}`.toLowerCase().includes(q);
  const salida = document.getElementById('salida');
  const conteo = document.getElementById('conteo');
  conteo.textContent = '';
  pintarMiga(q);
  document.getElementById('burbujas').hidden = !!(q || RUBRO);
  document.querySelectorAll('#nav-rubros a').forEach(a => a.classList.toggle('on', !q && a.textContent === RUBRO));

  if (!PRODUCTOS.length) {
    salida.innerHTML = '<div class="aviso">Por el momento no hay equipos publicados. Escribinos y te contamos qué hay.</div>';
    return;
  }

  if (q) {
    const lista = ordenar(PRODUCTOS.filter(p => coincide(p) && pasaFiltros(p)));
    conteo.textContent = lista.length ? `${textoConteo(cuenta(lista))} para “${q}”` : '';
    salida.innerHTML = lista.length ? `<div class="grilla">${entradas(lista)}</div>` : '<div class="aviso">No encontré nada con esa búsqueda.</div>';
    return;
  }

  if (RUBRO) { pintarListado(); return; }

  // La portada: una sección por rubro, con sus productos deslizando y "ver todos".
  salida.innerHTML = rubros().map(r => {
    const lista = delRubro(r.nombre);
    return `<section class="seccion">
      <div class="seccion-cab">
        <h2 class="seccion-titulo">${esc(r.nombre)}</h2>
        <a class="vertodos" href="#r=${slug(r.nombre)}">Ver todos (${cuenta(lista)}) ›</a>
      </div>
      <div class="fila">${entradas(lista.slice(0, 12))}</div>
    </section>`;
  }).join('');
}

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

    PRODUCTOS = (d.productos || []).filter(p => p && p.precioUSD > 0);
    armarGrupos();
    LOCAL = d.local || {};
    COBRO = d.cobro || {};
    CATEGORIAS = Array.isArray(d.categorias) ? d.categorias : [];

    if(LOCAL.nombre) document.getElementById('marca').textContent = LOCAL.nombre;
    const wa = document.getElementById('cab-wa');
    if (LOCAL.whatsapp) { wa.href = `https://wa.me/${String(LOCAL.whatsapp).replace(/\D/g, '')}`; wa.hidden = false; }
    document.getElementById('pie').innerHTML = pie(d.actualizado);

    pintarNavegacion();
    desdeUrl();
    pedidoDesdeUrl();
  }catch(e){
    document.getElementById('salida').innerHTML =
      '<div class="aviso">No pudimos cargar la tienda en este momento. Probá de nuevo en un rato.</div>';
  }
})();

document.getElementById('q').addEventListener('input', pintar);
window.addEventListener('hashchange', desdeUrl);
// El menú se cierra tocando afuera.
document.addEventListener('click', e => { if (!e.target.closest('#cab')) cerrarMenu(); });

// Compatibilidad de los controles HTML al pasar a módulos ES.
Object.assign(window, { tarjeta, linkWhatsApp, metaDeProducto, formasDePago, textoPedido, pantallaPedido, pedidoDesdeUrl, armarGrupos, tarjetaGrupo, entradas, selectoresVariante, categorias, rubros, pintar, hace });
