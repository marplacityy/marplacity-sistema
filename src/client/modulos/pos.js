/** modulos/pos: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, escJs, showToast } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { resolverCliente } from './clientes.js';
import { addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { handleStockFromIngreso } from './stock.js';

export function costoCortesiasUSD() {
  let t = 0;
  if (contextoApp.posCortesias.vidrio) t += parseFloat(contextoApp.cfg.cortVidrio) || 2;
  if (contextoApp.posCortesias.funda) t += parseFloat(contextoApp.cfg.cortFunda) || 5;
  return t;
}
export function initPos() {
  const sel = document.getElementById('pos-medio-sel');
  if (sel && !sel.options.length) {
    sel.innerHTML = contextoApp.medios.map(m => `<option>${esc(m)}</option>`).join('');
    // La moneda se preselecciona sola según el medio elegido
    sel.addEventListener('change', () => {
      const n = sel.value.toLowerCase();
      const monEl = document.getElementById('pos-medio-moneda');
      if (/dolar|usd|d[oó]lares/.test(n)) monEl.value = 'USD';else if (/peso|transfer|mercado|tarjeta|d[eé]b|cr[eé]d|brubank|posnet/.test(n)) monEl.value = 'ARS';
    });
  }
  const tc = document.getElementById('pos-tc');
  if (tc && !tc.value && contextoApp.cfg.tc) tc.value = contextoApp.cfg.tc;
}

// ── Catálogo unificado ──
export function posCatalog() {
  const items = [];
  contextoApp.invItems.forEach(p => {
    items.push({
      tipo: 'inv',
      refId: p.id,
      nombre: p.nombre,
      sku: p.sku || '',
      qty: p.qty || 0,
      sugerido: p.sugerido || 0,
      moneda: p.moneda || 'ARS',
      costo: p.costo || 0,
      imei: '',
      cat: p.categoria || ''
    });
  });
  contextoApp.stockItems.filter(s => s.status === 'en_stock').forEach(s => {
    items.push({
      tipo: 'eq',
      refId: s.id,
      nombre: [s.nombre, s.color].filter(Boolean).join(' '),
      sku: '',
      qty: 1,
      sugerido: s.valorUSD || 0,
      moneda: 'USD',
      costo: s.valorUSD || 0,
      imei: s.imei || '',
      color: s.color || '',
      gb: s.gb || '',
      bateria: s.bateria || null,
      cat: 'Equipos'
    });
  });
  contextoApp.consigItems.filter(x => x.status === 'en_stock').forEach(x => {
    items.push({
      tipo: 'consig',
      refId: x.id,
      nombre: [x.producto, x.gb, x.color].filter(Boolean).join(' '),
      sku: '',
      qty: 1,
      sugerido: x.precioVentaUSD || x.precioUSD || 0,
      moneda: 'USD',
      costo: x.precioUSD || 0,
      imei: x.imei || '',
      color: x.color || '',
      gb: x.gb || '',
      bateria: x.bateria || null,
      cat: 'Consignación · ' + (x.proveedor || '')
    });
  });
  // Reparaciones listas con saldo pendiente → cobrables en el POS
  contextoApp.reps.filter(r => ['reparado', 'avisado'].includes(r.estado) && (r.saldo || 0) > 0).forEach(r => {
    items.push({
      tipo: 'rep',
      refId: r.id,
      nombre: '🔧 Rep. #' + r.num + ' · ' + (r.cliente || '') + ' · ' + (r.equipo || ''),
      sku: String(r.num),
      qty: 1,
      sugerido: r.saldo,
      moneda: r.moneda || 'ARS',
      costo: 0,
      imei: r.imei || '',
      cat: 'Reparaciones'
    });
  });
  return items;
}
export function posGrupos(items) {
  // agrupa el catálogo en "categorías" navegables estilo RD
  const grupos = [];
  const reps = items.filter(p => p.tipo === 'rep');
  if (reps.length) grupos.push({
    tipo: 'rep',
    cat: null,
    nombre: 'Reparaciones a cobrar',
    icon: '🔧',
    n: reps.length
  });
  const eqs = items.filter(p => p.tipo === 'eq');
  if (eqs.length) grupos.push({
    tipo: 'eq',
    cat: null,
    nombre: 'Equipos',
    icon: '📱',
    n: eqs.length
  });
  const cons = items.filter(p => p.tipo === 'consig');
  if (cons.length) grupos.push({
    tipo: 'consig',
    cat: null,
    nombre: 'Consignación',
    icon: '🤝',
    n: cons.length
  });
  const porCat = new Map();
  items.filter(p => p.tipo === 'inv').forEach(p => {
    const k = p.cat || 'Accesorios';
    porCat.set(k, (porCat.get(k) || 0) + 1);
  });
  [...porCat.entries()].sort((a, b) => contextoApp.COLL.compare(a[0], b[0])).forEach(([k, n]) => {
    grupos.push({
      tipo: 'inv',
      cat: k,
      nombre: k,
      icon: '📦',
      n
    });
  });
  return grupos;
}
export function renderPosGrid() {
  const fBus = (document.getElementById('pos-buscar').value || '').toLowerCase().trim();
  const todos = posCatalog();
  const bc = document.getElementById('pos-breadcrumb');

  // VISTAS PLANAS (Todos / Equipos / Consignación) — tiles directos
  if (!fBus && contextoApp.posView !== 'cat') {
    bc.innerHTML = '';
    let items = todos;
    if (contextoApp.posView === 'eq') items = items.filter(p => p.tipo === 'eq');
    if (contextoApp.posView === 'consig') items = items.filter(p => p.tipo === 'consig');
    renderPosTiles(items);
    return;
  }

  // NIVEL CATEGORÍAS (sin búsqueda ni navegación activa)
  if (!fBus && !contextoApp.posNav) {
    bc.innerHTML = '<span>⌂ Categorías</span>';
    const grupos = posGrupos(todos);
    document.getElementById('pos-grid').innerHTML = grupos.length ? grupos.map(g => `<div class="pos-cat-tile" onclick="posGoCat('${g.tipo}',${g.cat ? `'${escJs(g.cat)}'` : 'null'})">
          <div class="pos-cat-icon">${g.icon}</div>
          <div class="pos-cat-nombre">${esc(g.nombre)}</div>
          <div class="pos-cat-count">${g.n} ${g.n === 1 ? 'item' : 'items'}</div>
        </div>`).join('') : '<div class="empty" style="grid-column:1/-1;">Nada para vender. Cargá inventario o equipos.</div>';
    return;
  }

  // NIVEL ITEMS (categoría elegida o búsqueda global)
  let items = todos;
  if (fBus) {
    bc.innerHTML = `<a onclick="posGoCat(null)">⌂ Categorías</a><span>›</span><span>Búsqueda: "${esc(fBus)}"</span>`;
    items = items.filter(p => ((p.nombre || '') + ' ' + (p.sku || '') + ' ' + (p.imei || '')).toLowerCase().includes(fBus));
  } else {
    const g = posGrupos(todos).find(x => x.tipo === contextoApp.posNav.tipo && (x.cat || null) === (contextoApp.posNav.cat || null));
    bc.innerHTML = `<a onclick="posGoCat(null)">⌂ Categorías</a><span>›</span><span>${esc(g ? g.nombre : '')}</span>`;
    items = items.filter(p => p.tipo === contextoApp.posNav.tipo && (contextoApp.posNav.tipo !== 'inv' || (p.cat || 'Accesorios') === contextoApp.posNav.cat));
  }
  renderPosTiles(items);
}
export function renderPosTiles(items) {
  const badge = t => t === 'inv' ? '<span class="pos-tile-badge b-inv">Inventario</span>' : t === 'eq' ? '<span class="pos-tile-badge b-eq">Equipo</span>' : t === 'rep' ? '<span class="pos-tile-badge b-rep">Reparación</span>' : '<span class="pos-tile-badge b-consig">Consignación</span>';
  const m = p => p.sugerido ? p.moneda === 'ARS' ? contextoApp.fmtARS(p.sugerido) : 'u$s ' + p.sugerido : 'Sin precio';
  if (!items.length) {
    document.getElementById('pos-grid').innerHTML = '<div class="empty" style="grid-column:1/-1;">Nada para vender en esta vista.</div>';
    return;
  }
  document.getElementById('pos-grid').innerHTML = items.map(p => {
    const enCarrito = contextoApp.cart.filter(ci => ci.refId === p.refId).reduce((s, ci) => s + ci.qty, 0);
    const disp = p.tipo === 'inv' ? p.qty - enCarrito : enCarrito ? 0 : 1;
    const off = disp <= 0;
    return `<div class="pos-tile ${off ? 'agotado' : ''}" onclick="${off ? '' : `addToCart('${p.tipo}','${p.refId}')`}">
      <div>${badge(p.tipo)}<div class="pos-tile-nombre">${esc(p.nombre)}</div></div>
      <div>
        <div class="pos-tile-precio">${m(p)}</div>
        <div class="pos-tile-stock">${p.tipo === 'inv' ? disp + ' disp.' : p.imei ? 'IMEI ' + esc(p.imei.slice(-6)) : '1 unidad'}</div>
      </div>
    </div>`;
  }).join('');
}

// ── La barra de abajo, en el teléfono ────────────────────────
//
// Solo entran cuatro pantallas fijas; el resto vive en "Más". Llegó a tener diecisiete
// apretadas en un flex sin scroll, porque cada pantalla nueva se agregaba también acá.
// Para que no vuelva a pasar, la grilla de "Más" NO está escrita en el HTML: se arma
// leyendo los links del menú lateral. Una pantalla nueva aparece sola.

/** El alto real de la barra, para que el cajón del carrito y el panel se apoyen justo
    arriba. Se mide en vivo: depende de la fuente, del idioma y del recorte del iPhone. */
export function medirBarra() {
  const b = document.querySelector('.mobile-bar');
  if (!b) return;
  const alto = b.offsetHeight;
  if (alto) document.documentElement.style.setProperty('--alto-barra', alto + 'px');
}
export function posTC() {
  return parseFloat(document.getElementById('pos-tc').value) || null;
}

// Total del carrito en USD (base) — cada item en su moneda convertido
export function cartTotals() {
  const tc = posTC();
  let totARS = 0,
    totUSD = 0,
    mixSinTC = false;
  contextoApp.cart.forEach(ci => {
    const sub = ci.precio * ci.qty;
    if (ci.moneda === 'ARS') {
      totARS += sub;
      if (tc) totUSD += sub / tc;else if (contextoApp.cart.some(x => x.moneda === 'USD')) mixSinTC = true;
    } else {
      totUSD += sub;
      if (tc) totARS += sub * tc;else if (contextoApp.cart.some(x => x.moneda === 'ARS')) mixSinTC = true;
    }
  });
  // pagado
  let pagARS = 0,
    pagUSD = 0;
  contextoApp.posMedios.forEach(mm => {
    if (mm.moneda === 'ARS') {
      pagARS += mm.valor;
      if (tc) pagUSD += mm.valor / tc;
    } else {
      pagUSD += mm.valor;
      if (tc) pagARS += mm.valor * tc;
    }
  });
  if (document.getElementById('pos-permuta').checked) {
    const pv = parseFloat(document.getElementById('pos-permuta-val').value) || 0;
    const pm = document.getElementById('pos-permuta-moneda').value;
    if (pm === 'ARS') {
      pagARS += pv;
      if (tc) pagUSD += pv / tc;
    } else {
      pagUSD += pv;
      if (tc) pagARS += pv * tc;
    }
  }
  return {
    tc,
    totARS,
    totUSD,
    pagARS,
    pagUSD,
    mixSinTC
  };
}
export function fmtDual(ars, usd, tc) {
  const hasA = ars > 0.01,
    hasU = usd > 0.01;
  if (hasA && hasU && tc) return contextoApp.fmtARS(Math.round(ars)) + ' / ' + contextoApp.fmtUSD(Math.round(usd * 100) / 100);
  if (hasU && !hasA) return contextoApp.fmtUSD(Math.round(usd * 100) / 100);
  if (hasA) return contextoApp.fmtARS(Math.round(ars));
  return '—';
}
export function renderCartTotalsOnly() {
  const t = cartTotals();
  document.getElementById('pos-medios-tags').innerHTML = contextoApp.posMedios.map((m, i) => `<div class="medio-tag"><span>${esc(m.medio)} · ${m.moneda === 'USD' ? 'u$s ' : '$ '}${m.valor.toLocaleString('es-AR')}</span><button onclick="removePosMedio(${i})">×</button></div>`).join('');
  document.getElementById('pos-total').textContent = fmtDual(t.totARS, t.totUSD, t.tc);

  // La barra del cajón, en el celular. Se actualiza acá y no en otro lado: este es el
  // único punto por donde pasan todos los cambios del carrito.
  const n = contextoApp.cart.reduce((a, ci) => a + (ci.qty || 1), 0);
  const phc = document.getElementById('ph-cant');
  if (phc) {
    phc.textContent = n ? `🛒 ${n} producto${n === 1 ? '' : 's'}` : '🛒 Carrito vacío';
    document.getElementById('ph-total').textContent = n ? fmtDual(t.totARS, t.totUSD, t.tc) : '';
  }
  document.getElementById('pos-pagado').textContent = fmtDual(t.pagARS, t.pagUSD, t.tc);
  // resto: comparar en la moneda con más info
  const restoUSD = t.totUSD - t.pagUSD;
  const restoARS = t.totARS - t.pagARS;
  const el = document.getElementById('pos-resto');
  const resto = t.tc ? restoUSD : t.totUSD > 0 ? restoUSD : restoARS;
  const restoStr = t.tc ? fmtDual(Math.abs(restoARS), Math.abs(restoUSD), t.tc) : t.totUSD > 0 ? contextoApp.fmtUSD(Math.abs(restoUSD)) : contextoApp.fmtARS(Math.abs(restoARS));
  if (Math.abs(resto) < 0.5) {
    el.textContent = '✓ Exacto';
    el.className = 'profit-val profit-pos';
  } else if (resto > 0) {
    el.textContent = 'Falta ' + restoStr;
    el.className = 'profit-val profit-neg';
  } else {
    el.textContent = 'Vuelto ' + restoStr;
    el.className = 'profit-val profit-pos';
  }
  if (t.mixSinTC) {
    el.textContent = '⚠ Cargá el TC para mezclar monedas';
    el.className = 'profit-val profit-neg';
  }
}
export function renderCart() {
  initPos();
  const box = document.getElementById('pos-cart-items');
  const tot = document.getElementById('pos-totales');
  if (!contextoApp.cart.length) {
    box.innerHTML = '<div class="empty" style="padding:1.5rem 0;">Tocá un producto para agregarlo →</div>';
    tot.style.display = 'none';
    return;
  }
  tot.style.display = 'block';
  box.innerHTML = contextoApp.cart.map((ci, i) => `
    <div class="cart-item">
      <div class="cart-nombre">${esc(ci.nombre)}${ci.imei ? `<small>IMEI ${esc(ci.imei)}</small>` : ''}</div>
      ${ci.tipo === 'inv' ? `
        <div class="cart-qty">
          <button onclick="cartQty(${i},-1)">−</button><span>${ci.qty}</span><button onclick="cartQty(${i},1)">+</button>
        </div>` : ''}
      <input type="number" class="cart-precio" value="${esc(ci.precio)}" step="0.01" min="0" onchange="cartPrecio(${i},this.value)" title="Precio en ${ci.moneda}">
      <span style="font-size:10px;color:var(--text3);">${ci.moneda}</span>
      <button class="cart-del" onclick="cartDel(${i})">×</button>
    </div>
  `).join('');
  renderCartTotalsOnly();
}

// ── Cobrar ──
export
// ── Ticket de venta térmico ──
// CSS del ticket como documento autónomo (para la ticketera remota)
function tkDocAutonomo(html) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page{size:80mm auto;margin:0;}
    html,body{margin:0;padding:0;background:#fff;}
    body{width:76mm;padding:2mm 2mm 8mm 2mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:12px;line-height:1.45;font-weight:500;-webkit-font-smoothing:none;}
    *{color:#000!important;background:transparent!important;}
    .tk-c{text-align:center;}.tk-b{font-weight:700;}
    .tk-h1{font-size:17px;font-weight:700;text-align:center;line-height:1.2;margin-bottom:2mm;}
    .tk-local{text-align:center;font-size:12px;margin-bottom:2mm;line-height:1.35;}
    .tk-sep{border:0;border-top:2px solid #000;margin:2mm 0;height:0;}
    .tk-r{display:flex;justify-content:space-between;gap:6px;margin-bottom:.8mm;font-size:12px;}
    .tk-r .v{text-align:right;}
    .tk-tot{font-size:15px;font-weight:700;display:flex;justify-content:space-between;margin:1.5mm 0;}
    .tk-terms{font-size:10px;line-height:1.4;white-space:pre-wrap;}
    .tk-sig{margin-top:14mm;border-top:2px solid #000;padding-top:1.5mm;text-align:center;font-size:11px;}
    .tk-obs{font-size:12px;white-space:pre-wrap;border:2px solid #000;padding:2mm;margin:1.5mm 0;font-weight:700;}
  </style></head><body>${html}</body></html>`;
}

// Imprime el contenido actual de #ticket-print: acá o en la ticketera del local
export async function printTicket80(titulo) {
  if ((contextoApp.cfg.printMode || 'pantalla') === 'local') {
    try {
      await addDoc(contextoApp.colaCol, contextoApp.withUser({
        html: tkDocAutonomo(document.getElementById('ticket-print').innerHTML),
        titulo: titulo || 'Ticket',
        fecha: contextoApp.today(),
        hora: new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        estado: 'pendiente',
        createdAt: serverTimestamp()
      }));
      showToast('🖨 Enviado a la ticketera del local');
      return;
    } catch (e) {
      console.error(e);
      showToast('No se pudo encolar — imprimiendo acá.', true);
    }
  }
  window.print();
}
export function imprimirTicketVenta(v) {
  const tc = v.tc;
  const tieneImei = (v.items || []).some(ci => ci.imei) || !!v.imei;
  const mLine = (val, mon) => mon === 'ARS' ? contextoApp.fmtARS(val) : 'u$s ' + val;
  const itemsHtml = (v.items || []).map(ci => {
    const specs = [ci.gb, ci.color, ci.bateria ? 'Bateria ' + ci.bateria + '%' : null].filter(Boolean).join(' · ');
    return `
    <div class="tk-r"><span>${ci.qty > 1 ? ci.qty + 'x ' : ''}${esc(ci.nombre)}</span><span class="v">${mLine(ci.precio * ci.qty, ci.moneda)}</span></div>
    ${specs ? `<div class="tk-r" style="font-size:10px;"><span>${esc(specs)}</span><span></span></div>` : ''}
    ${ci.imei ? `<div class="tk-r" style="font-size:9px;"><span>IMEI ${esc(ci.imei)}</span><span></span></div>` : ''}
  `;
  }).join('');
  const mediosHtml = (v.medios || []).map(m => `<div class="tk-r"><span>${esc(m.medio)}</span><span class="v">${mLine(m.valor, m.moneda)}</span></div>`).join('');
  const totalStr = [v.totalARS ? contextoApp.fmtARS(v.totalARS) : null, v.totalUSD ? 'u$s ' + v.totalUSD : null].filter(Boolean).join(' / ');
  document.getElementById('ticket-print').innerHTML = `
    <div class="tk-h1">TICKET DE VENTA<br>#V-${v.numVenta}</div>
    <div class="tk-local">
      <div class="tk-b">${esc(contextoApp.cfg.localNombre || 'MarplaCity')}</div>
      ${contextoApp.cfg.localDir ? `<div>${esc(contextoApp.cfg.localDir)}</div>` : ''}
      ${contextoApp.cfg.localTel ? `<div>Tel: ${esc(contextoApp.cfg.localTel)}</div>` : ''}
      ${contextoApp.cfg.localWeb ? `<div>${esc(contextoApp.cfg.localWeb)}</div>` : ''}
    </div>
    <div class="tk-sep"></div>
    <div class="tk-r"><span>Fecha</span><span class="v">${v.fecha} ${v.hora || ''}</span></div>
    ${v.clienteNombre && v.clienteNombre !== 'Consumidor final' ? `<div class="tk-r"><span>Cliente</span><span class="v tk-b">${esc(v.clienteNombre)}</span></div>` : ''}
    ${v.notas ? `<div class="tk-r"><span>Nota</span><span class="v">${esc(v.notas)}</span></div>` : ''}
    <div class="tk-sep"></div>
    ${itemsHtml}
    ${(v.cortesias || []).map(co => `<div class="tk-r"><span>🎁 ${esc(co.nombre)} — CORTESIA</span><span class="v">$ 0</span></div>`).join('')}
    <div class="tk-sep"></div>
    <div class="tk-tot"><span>TOTAL</span><span>${totalStr}</span></div>
    ${v.tc ? `<div class="tk-r" style="font-size:9px;"><span>TC del dia</span><span class="v">${v.tc}</span></div>` : ''}
    <div class="tk-b" style="margin:1.5mm 0 .5mm;">PAGADO CON</div>
    ${mediosHtml}
    ${v.permuta ? `<div class="tk-r"><span>Permuta: ${esc(v.permuta.descripcion || '')}</span><span class="v">${mLine(v.permuta.valor, v.permuta.moneda)}</span></div>` : ''}
    <div class="tk-sep"></div>
    ${tieneImei ? `
      <div class="tk-b" style="margin-bottom:1mm;">TERMINOS Y GARANTIA</div>
      <div class="tk-terms">${esc(contextoApp.cfg.termsVenta || contextoApp.TERMS_VENTA_DEFAULT)}</div>
      <div class="tk-sig">Firma del cliente</div>
      <div class="tk-sep"></div>
    ` : `
      <div class="tk-c" style="font-size:10px;">Conserve este ticket para cambios o reclamos.</div>
    `}
    <div class="tk-c tk-b" style="margin-top:2mm;">Gracias por su compra!</div>
  `;
  printTicket80('Venta');
}

// ── Inventario ────────────────────────────────────────
export function inicializarPos() {
  // ── POS ───────────────────────────────────────────────
  contextoApp.cart = []; // {tipo:'inv'|'eq'|'consig', refId, nombre, qty, precio, moneda, costoUSD, costoARS, imei}
  contextoApp.posMedios = [];
  contextoApp.posCortesias = {
    vidrio: false,
    funda: false
  };
  window.toggleCortesia = function (k) {
    contextoApp.posCortesias[k] = !contextoApp.posCortesias[k];
    document.getElementById('cort-' + k).classList.toggle('on', contextoApp.posCortesias[k]);
  };
  contextoApp.ventaNumCache = null;
  window.setPosTab = function (tab, btn) {
    document.querySelectorAll('#page-ingresos .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['vender', 'manual'].forEach(t => {
      document.getElementById('pos-tab-' + t).style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'vender') {
      initPos();
      renderPosGrid();
      renderCart();
    }
  };
  contextoApp.posNav = null; // null = nivel categorías; sino {tipo, cat}
  contextoApp.posView = 'cat'; // 'cat' | 'all' | 'eq' | 'consig'
  window.setPosView = function (v, btn) {
    contextoApp.posView = v;
    contextoApp.posNav = null;
    document.querySelectorAll('.pos-catalog .tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderPosGrid();
  };
  window.posGoCat = function (tipo, cat) {
    contextoApp.posNav = tipo === null ? null : {
      tipo,
      cat: cat || null
    };
    document.getElementById('pos-buscar').value = '';
    renderPosGrid();
  };
  addEventListener('resize', medirBarra);
  addEventListener('orientationchange', () => setTimeout(medirBarra, 200));
  window.toggleMas = function () {
    const panel = document.getElementById('mas-panel');
    const fondo = document.getElementById('mas-fondo');
    const abriendo = !panel.classList.contains('abierto');
    if (abriendo) {
      // Se arma cada vez: así refleja la pantalla en la que estás y cualquier link que se
      // haya agregado al menú lateral desde la última vez.
      const links = [...document.querySelectorAll('.sidebar nav a[onclick*="goTo("]')];
      document.getElementById('mas-grid').innerHTML = links.map(a => {
        const pag = (a.getAttribute('onclick').match(/goTo\('([^']+)'\)/) || [])[1];
        const svg = a.querySelector('svg')?.outerHTML || '';
        const nombre = a.textContent.trim();
        return `<button class="mas-item ${pag === contextoApp.currentPage ? 'activa' : ''}" onclick="irDesdeMas('${escJs(pag)}')">${svg}<span>${esc(nombre)}</span></button>`;
      }).join('');
    }
    panel.classList.toggle('abierto', abriendo);
    fondo.classList.toggle('abierto', abriendo);
    document.getElementById('tab-mas')?.classList.toggle('active', abriendo);
  };
  window.irDesdeMas = function (pagina) {
    window.toggleMas();
    window.goTo(pagina);
  };

  /** Abre o cierra el cajón del carrito en el celular. */
  window.togglePosCajon = function () {
    document.getElementById('pos-cart')?.classList.toggle('plegado');
  };
  window.addToCart = function (tipo, refId) {
    const p = posCatalog().find(x => x.tipo === tipo && x.refId === refId);
    if (!p) return;
    const existing = contextoApp.cart.find(ci => ci.refId === refId);
    if (existing && tipo === 'inv') {
      if (existing.qty >= p.qty) {
        showToast('No hay más stock.', true);
        return;
      }
      existing.qty++;
    } else if (existing) {
      return; // equipos: máx 1
    } else {
      contextoApp.cart.push({
        tipo,
        refId,
        nombre: p.nombre,
        qty: 1,
        precio: p.sugerido || 0,
        moneda: p.moneda,
        costo: p.costo || 0,
        imei: p.imei || '',
        color: p.color || '',
        gb: p.gb || '',
        bateria: p.bateria || null
      });
    }
    renderCart();
    renderPosGrid();
  };
  window.cartQty = function (i, delta) {
    const ci = contextoApp.cart[i];
    if (!ci) return;
    if (ci.tipo !== 'inv') return;
    const p = posCatalog().find(x => x.refId === ci.refId);
    const nueva = ci.qty + delta;
    if (nueva <= 0) {
      contextoApp.cart.splice(i, 1);
    } else if (p && nueva > p.qty) {
      showToast('No hay más stock.', true);
      return;
    } else ci.qty = nueva;
    renderCart();
    renderPosGrid();
  };
  window.cartPrecio = function (i, val) {
    const ci = contextoApp.cart[i];
    if (!ci) return;
    ci.precio = parseFloat(val) || 0;
    renderCartTotalsOnly();
  };
  window.cartDel = function (i) {
    contextoApp.cart.splice(i, 1);
    renderCart();
    renderPosGrid();
  };
  window.vaciarCarrito = function () {
    if (contextoApp.cart.length && !confirm('¿Vaciar el carrito?')) return;
    contextoApp.cart = [];
    contextoApp.posMedios = [];
    contextoApp.posCortesias = {
      vidrio: false,
      funda: false
    };
    const cv = document.getElementById('cort-vidrio'),
      cf = document.getElementById('cort-funda');
    if (cv) cv.classList.remove('on');
    if (cf) cf.classList.remove('on');
    ['pos-permuta-desc', 'pos-permuta-val', 'pos-permuta-imei', 'pos-notas', 'pos-medio-val'].forEach(i => {
      const e = document.getElementById(i);
      if (e) e.value = '';
    });
    document.getElementById('pos-permuta').checked = false;
    document.getElementById('pos-permuta-wrap').style.display = 'none';
    renderCart();
    renderPosGrid();
  };
  window.togglePosPermuta = function () {
    const on = document.getElementById('pos-permuta').checked;
    document.getElementById('pos-permuta-wrap').style.display = on ? 'block' : 'none';
    renderCartTotalsOnly();
  };
  window.addPosMedio = function () {
    const val = parseFloat(document.getElementById('pos-medio-val').value);
    if (!val || val <= 0) {
      showToast('Ingresá un monto', true);
      return;
    }
    const medio = document.getElementById('pos-medio-sel').value;
    let moneda = document.getElementById('pos-medio-moneda').value;
    // Guardia anti-dedazo: un monto enorme en USD casi seguro son pesos
    if (moneda === 'USD' && val >= 20000) {
      if (confirm(`⚠️ Cargaste u$s ${val.toLocaleString('es-AR')} — parece un monto en PESOS.\n\n¿Lo cargo como ARS?`)) moneda = 'ARS';
    }
    // Y al revés: monto chiquito en ARS probablemente son dólares
    if (moneda === 'ARS' && val > 0 && val <= 2000) {
      if (confirm(`⚠️ Cargaste $ ${val.toLocaleString('es-AR')} PESOS — ¿no serán dólares?\n\n¿Lo cargo como USD?`)) moneda = 'USD';
    }
    contextoApp.posMedios.push({
      medio,
      valor: val,
      moneda
    });
    document.getElementById('pos-medio-val').value = '';
    renderCartTotalsOnly();
  };

  // ⚡ Autocompleta el input con lo que falta pagar, en la moneda seleccionada
  window.completarPago = function () {
    const t = cartTotals();
    const moneda = document.getElementById('pos-medio-moneda').value;
    let resto;
    if (moneda === 'USD') {
      resto = t.totUSD - t.pagUSD;
      resto = Math.round(resto * 100) / 100;
    } else {
      resto = t.totARS - t.pagARS;
      resto = Math.round(resto);
    }
    if (resto <= 0) {
      showToast('El pago ya está cubierto ✓');
      return;
    }
    if (!t.tc && t.totUSD > 0 && moneda === 'ARS') {
      showToast('Cargá el TC para calcular en pesos.', true);
      return;
    }
    document.getElementById('pos-medio-val').value = resto;
    document.getElementById('pos-medio-val').focus();
  };
  window.removePosMedio = function (i) {
    contextoApp.posMedios.splice(i, 1);
    renderCartTotalsOnly();
  };
  window.cobrarPos = async function (imprimir) {
    if (!contextoApp.cart.length) {
      showToast('El carrito está vacío.', true);
      return;
    }
    if (!contextoApp.posMedios.length && !document.getElementById('pos-permuta').checked) {
      showToast('Agregá al menos un medio de cobro.', true);
      return;
    }
    const t = cartTotals();
    if (t.mixSinTC) {
      showToast('Cargá el TC del día para mezclar monedas.', true);
      return;
    }
    const tc = t.tc;
    const hasPermuta = document.getElementById('pos-permuta').checked;
    const permuta = hasPermuta ? {
      descripcion: document.getElementById('pos-permuta-desc').value.trim(),
      valor: parseFloat(document.getElementById('pos-permuta-val').value) || 0,
      moneda: document.getElementById('pos-permuta-moneda').value,
      imei: document.getElementById('pos-permuta-imei').value.trim()
    } : null;

    // Ganancia: sum(precio - costo) por item, en USD si hay TC
    let ganUSD = 0,
      ganARS = 0,
      costoTieneDatos = false;
    contextoApp.cart.forEach(ci => {
      if (ci.tipo === 'rep') return; // la ganancia de la reparación se computa en la reparación misma
      if (!ci.costo) return;
      costoTieneDatos = true;
      const gan = (ci.precio - ci.costo) * ci.qty;
      if (ci.moneda === 'USD') {
        ganUSD += gan;
        if (tc) ganARS += gan * tc;
      } else {
        ganARS += gan;
        if (tc) ganUSD += gan / tc;
      }
    });
    // Cortesías: costo directo que resta ganancia
    const cortUSD = costoCortesiasUSD();
    const cortesias = [];
    if (contextoApp.posCortesias.vidrio) cortesias.push({
      nombre: 'Vidrio templado',
      costoUSD: parseFloat(contextoApp.cfg.cortVidrio) || 2
    });
    if (contextoApp.posCortesias.funda) cortesias.push({
      nombre: 'Funda silicone case',
      costoUSD: parseFloat(contextoApp.cfg.cortFunda) || 5
    });
    if (cortUSD > 0) {
      costoTieneDatos = true;
      ganUSD -= cortUSD;
      if (tc) ganARS -= cortUSD * tc;
    }
    const nombreVenta = contextoApp.cart.length === 1 ? contextoApp.cart[0].nombre : contextoApp.cart.map(ci => ci.qty > 1 ? ci.qty + 'x ' + ci.nombre : ci.nombre).join(' + ');
    const numVenta = contextoApp.ingresos.reduce((m, x) => Math.max(m, x.numVenta || 0), 0) + 1;
    const venta = {
      fecha: contextoApp.today(),
      hora: new Date().toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      numVenta,
      nombre: nombreVenta,
      categoria: 'Venta producto',
      imei: contextoApp.cart.find(ci => ci.imei)?.imei || '',
      items: contextoApp.cart.map(ci => ({
        tipo: ci.tipo,
        refId: ci.refId,
        nombre: ci.nombre,
        qty: ci.qty,
        precio: ci.precio,
        moneda: ci.moneda,
        costo: ci.costo,
        imei: ci.imei,
        color: ci.color || '',
        gb: ci.gb || '',
        bateria: ci.bateria || null
      })),
      medios: [...contextoApp.posMedios],
      cortesias,
      permuta,
      tc,
      totalARS: t.totARS > 0 ? Math.round(t.totARS) : null,
      totalUSD: t.totUSD > 0 ? Math.round(t.totUSD * 100) / 100 : null,
      gananciaARS: costoTieneDatos && ganARS ? Math.round(ganARS) : null,
      gananciaUSD: costoTieneDatos && ganUSD ? Math.round(ganUSD * 100) / 100 : null,
      notas: document.getElementById('pos-notas').value.trim(),
      origen: 'pos',
      createdAt: {
        seconds: Date.now() / 1000
      }
    };
    const btn = document.getElementById('btn-pos-cobrar');
    btn.disabled = true;
    btn.textContent = 'Cobrando...';
    setSyncDot('syncing');
    try {
      // 0. Cliente (vacío = Consumidor final)
      const cl = await resolverCliente(document.getElementById('pos-cliente').value, document.getElementById('pos-cliente-tel').value.trim());
      venta.clienteId = cl ? cl.id : null;
      venta.clienteNombre = cl ? cl.nombre : 'Consumidor final';

      // 1. Guardar venta como ingreso
      await addDoc(contextoApp.ingresosCol, contextoApp.withUser({
        ...venta,
        createdAt: serverTimestamp()
      }));

      // 2. Descontar / marcar vendidos
      for (const ci of contextoApp.cart) {
        if (ci.tipo === 'inv') {
          const p = contextoApp.invItems.find(x => x.id === ci.refId);
          if (p) await updateDoc(doc(contextoApp.db, 'inventario', ci.refId), {
            qty: Math.max(0, (p.qty || 0) - ci.qty)
          });
        } else if (ci.tipo === 'eq') {
          await updateDoc(doc(contextoApp.db, 'stock', ci.refId), {
            status: 'vendido',
            fechaVenta: contextoApp.today(),
            ingresoVentaNombre: nombreVenta
          });
        } else if (ci.tipo === 'consig') {
          await updateDoc(doc(contextoApp.db, 'consig', ci.refId), {
            status: 'vendido',
            fechaVenta: contextoApp.today()
          });
        } else if (ci.tipo === 'rep') {
          const r = contextoApp.reps.find(x => x.id === ci.refId);
          if (r) {
            const hist = [...(r.historial || []), {
              fecha: contextoApp.today(),
              texto: `Saldo cobrado (venta #V-${numVenta}) → Retirado`
            }];
            await updateDoc(doc(contextoApp.db, 'reparaciones', ci.refId), {
              sena: r.precio,
              saldo: 0,
              estado: 'retirado',
              historial: hist
            });
          }
        }
      }

      // 3. Permuta → entra a equipos
      if (permuta && (permuta.descripcion || permuta.imei)) {
        handleStockFromIngreso(venta); // fire and forget, ya maneja errores
      }
      showToast(`Venta #${numVenta} registrada ✓`);
      if (imprimir) imprimirTicketVenta(venta);

      // Reset
      contextoApp.cart = [];
      contextoApp.posMedios = [];
      contextoApp.posNav = null;
      contextoApp.posCortesias = {
        vidrio: false,
        funda: false
      };
      document.getElementById('cort-vidrio').classList.remove('on');
      document.getElementById('cort-funda').classList.remove('on');
      ['pos-permuta-desc', 'pos-permuta-val', 'pos-permuta-imei', 'pos-notas', 'pos-cliente', 'pos-cliente-tel'].forEach(i => document.getElementById(i).value = '');
      document.getElementById('pos-permuta').checked = false;
      document.getElementById('pos-permuta-wrap').style.display = 'none';
      renderCart();
      renderPosGrid();
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      showToast('Error al cobrar: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = '🖨 Cobrar e imprimir';
  };
}
