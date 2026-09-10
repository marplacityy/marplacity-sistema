/** modulos/consignacion: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, escJs, showToast } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { addDoc, serverTimestamp, updateDoc, doc, deleteDoc, writeBatch } from 'firebase/firestore';
import { printTicket80 } from './pos.js';

export function populateProveedoresDL() {
  const provs = [...new Set(contextoApp.consigItems.map(c => c.proveedor).filter(Boolean))].sort();
  ['proveedores-dl', 'proveedores-dl2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = provs.map(p => `<option value="${esc(p)}">`).join('');
  });
  // pago filter
  const pflSel = document.getElementById('pago-fl-proveedor');
  if (pflSel) {
    const prev = pflSel.value;
    pflSel.innerHTML = '<option value="">Todos los proveedores</option>' + provs.map(p => `<option value="${esc(p)}" ${p === prev ? 'selected' : ''}>${esc(p)}</option>`).join('');
  }
}
export function populateConsigFilters() {
  const provs = [...new Set(contextoApp.consigItems.map(c => c.proveedor).filter(Boolean))].sort();
  const sel = document.getElementById('cp-fl-proveedor');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">Todos los proveedores</option>' + provs.map(p => `<option value="${esc(p)}" ${p === prev ? 'selected' : ''}>${esc(p)}</option>`).join('');
}
export
// El pago vale en dólares: el que se hizo en pesos, a la cotización que se guardó
// cuando se cargó. Los viejos, que se cargaron antes de que existiera el campo, caen
// al TC habitual y se muestran marcados como estimados.
function pagoUSD(p) {
  if (p.moneda !== 'ARS') return p.monto || 0;
  const tc = p.tc || parseFloat(contextoApp.cfg.tc) || null;
  return tc ? (p.monto || 0) / tc : 0;
}
export function renderConsig() {
  populateConsigFilters();
  populateProveedoresDL();
  const fProv = document.getElementById('cp-fl-proveedor').value;
  const fEstSt = document.getElementById('cp-fl-estado-stock').value;
  const fBus = (document.getElementById('cp-fl-buscar').value || '').toLowerCase().trim();
  let items = contextoApp.consigItems.filter(g => {
    if (fProv && g.proveedor !== fProv) return false;
    if (fEstSt && g.status !== fEstSt) return false;
    if (fBus && !((g.producto || '').toLowerCase().includes(fBus) || (g.imei || '').toLowerCase().includes(fBus))) return false;
    return true;
  });
  const enStock = items.filter(g => g.status === 'en_stock');
  const {
    deuda: totalDeudaUSD,
    espera: esperaUSD
  } = deudaConsignacion(items);
  document.getElementById('consig-metrics').innerHTML = `
    <div class="metric"><div class="m-label">En stock</div><div class="m-val">${enStock.length}</div><div class="m-sub">productos</div></div>
    <div class="metric"><div class="m-label">Deuda total USD</div><div class="m-val" style="color:${totalDeudaUSD > 0 ? 'var(--neg)' : '#237A4B'}">${contextoApp.fmtUSD(totalDeudaUSD)}</div>${esperaUSD > 0.5 ? `<div class="m-sub">${contextoApp.fmtUSD(esperaUSD)} en espera 48 hs</div>` : '<div class="m-sub">menos lo ya pagado</div>'}</div>
    <div class="metric"><div class="m-label">Vendidos</div><div class="m-val">${items.filter(g => g.status === 'vendido').length}</div></div>
  `;
  if (!items.length) {
    document.getElementById('consig-list-body').innerHTML = '<div class="empty">Sin productos en este filtro.</div>';
    return;
  }
  document.getElementById('consig-list-body').innerHTML = items.map(g => {
    const vendido = g.status === 'vendido';
    let badge = '<span class="stock-badge-en">● En stock</span>';
    if (vendido) {
      const dias = g.fechaVenta ? Math.floor((new Date(contextoApp.today()) - new Date(g.fechaVenta)) / 86400000) : 99;
      badge = g.tipoProveedor === 'fijo' || dias >= 2 ? '<span class="gf-status gf-ok">💰 Pagar al dueño</span>' : `<span class="gf-status gf-warn">⏳ Espera 48hs (${2 - dias}d)</span>`;
    }
    const specs = [g.color, g.gb, g.estadoProducto].filter(Boolean).join(' · ');
    return `<div class="stock-item">
      <div class="stock-dot${vendido ? ' vendido' : ''}"></div>
      <div class="stock-info">
        <div class="stock-nombre">${esc(g.producto || '')}</div>
        <div class="stock-meta">
          <span style="font-weight:500">${esc(g.proveedor || '')}</span>
          ${badge}
          ${specs ? `<span>${esc(specs)}</span>` : ''}
          ${g.imei ? `<span style="font-family:'DM Mono',monospace;font-size:10px;">IMEI ${esc(g.imei)}</span>` : ''}
          ${g.bateria ? `<span>🔋 ${esc(g.bateria)}%</span>` : ''}
          ${g.ciclos ? `<span>${esc(g.ciclos)} ciclos</span>` : ''}
          <span>${g.fechaEntrada || ''}</span>
          ${g.precioVentaUSD == null && !g.precioVenta && !vendido ? '<span style="color:var(--neg);">⚠ sin precio de venta</span>' : ''}
        </div>
        ${g.notas ? `<div style="font-size:12px;color:var(--text3);margin-top:2px;font-style:italic;">${esc(g.notas)}</div>` : ''}
      </div>
      <div class="stock-val">
        ${g.precioUSD != null ? `<div class="stock-usd" style="${vendido ? 'color:var(--text3)' : ''}">${contextoApp.fmtUSD(g.precioUSD)}</div>` : ''}
        ${g.precioARS != null ? `<div class="stock-sub">${contextoApp.fmtARS(g.precioARS)}</div>` : ''}
      </div>
      <div class="ei-actions">
        <button class="ei-btn" onclick="labelConsig('${g.id}')" title="Imprimir etiqueta 62x100mm">🏷</button>
        <button class="ei-btn" onclick="editarConsig('${g.id}')" title="Editar">✎</button>
        <button class="ei-btn" onclick="marcarConsigVendido('${g.id}',${vendido})" title="${vendido ? 'Volver a stock' : 'Marcar vendido'}">${vendido ? '↩' : '✓'}</button>
        <button class="ei-btn del" onclick="eliminarConsig('${g.id}')" title="Eliminar">×</button>
      </div>
    </div>`;
  }).join('');
}
export function esProvFijo(prov) {
  return contextoApp.consigItems.some(g => g.proveedor === prov && g.tipoProveedor === 'fijo');
}

// Agrupa consignación y pagos por proveedor en una sola pasada, para que el
// listado no re-escanee ambos arrays una vez por proveedor.
export function indiceProveedores() {
  const items = new Map(),
    pagos = new Map();
  const push = (m, k, v) => {
    if (!k) return;
    const a = m.get(k);
    if (a) a.push(v);else m.set(k, [v]);
  };
  contextoApp.consigItems.forEach(g => push(items, g.proveedor, g));
  contextoApp.pagosItems.forEach(p => push(pagos, p.proveedor, p));
  return {
    items,
    pagos
  };
}

// Lo que ya se le debe al proveedor, cada renglón con su fecha y lo más viejo primero.
// Al fijo se le debe desde que el equipo entra: lo retiraste y ya lo debés, se haya
// vendido o no. Al casual recién 48 hs después de vendido su equipo; antes de eso la
// plata está en espera.
export function deudaLiberada(items, fijo) {
  const hoy = new Date(contextoApp.today());
  return (fijo ? items.filter(g => g.fechaEntrada).map(g => ({
    fecha: g.fechaEntrada,
    monto: g.precioUSD || 0
  })) : items.filter(g => g.status === 'vendido' && g.fechaVenta && (hoy - new Date(g.fechaVenta)) / 86400000 >= 2).map(g => ({
    fecha: g.fechaVenta,
    monto: g.precioUSD || 0
  }))).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Deuda real de la consignación: por cada proveedor que aparece en la vista, lo que
// ya se le debe menos lo que se le pagó. Antes esta métrica sumaba el precio de los
// equipos en stock, que no es lo que debés: al casual no le debés nada hasta venderle
// el equipo, y del fijo ya podías haber pagado la mitad.
// Se suma proveedor por proveedor y sin bajar de cero, para que uno al que le pagaste
// de más no tape la deuda que tenés con otro.
export function deudaConsignacion(itemsVista) {
  const idx = indiceProveedores();
  const hoy = new Date(contextoApp.today());
  let deuda = 0,
    espera = 0;
  for (const prov of new Set(itemsVista.map(g => g.proveedor).filter(Boolean))) {
    const its = idx.items.get(prov) || [];
    const fijo = its.some(g => g.tipoProveedor === 'fijo');
    // Todo lo que entró a la cuenta, incluso lo que todavía está en espera de 48 hs
    const cargado = (fijo ? its : its.filter(g => g.status === 'vendido' && g.fechaVenta)).reduce((s, g) => s + (g.precioUSD || 0), 0);
    const pagado = (idx.pagos.get(prov) || []).reduce((s, p) => s + pagoUSD(p), 0);
    const saldo = Math.max(0, cargado - pagado);
    deuda += saldo;
    if (!fijo && saldo > 0) espera += its.filter(g => g.status === 'vendido' && g.fechaVenta && (hoy - new Date(g.fechaVenta)) / 86400000 < 2).reduce((s, g) => s + (g.precioUSD || 0), 0);
  }
  return {
    deuda,
    espera: Math.min(espera, deuda)
  };
}
export function proveedorAging(prov, idx) {
  // Antigüedad de la deuda: hace cuántos días se liberó plata que todavía no se pagó
  const items = idx ? idx.items.get(prov) || [] : contextoApp.consigItems.filter(g => g.proveedor === prov);
  const hoy = new Date(contextoApp.today());
  const liberados = deudaLiberada(items, esProvFijo(prov));
  const pagosProv = idx ? idx.pagos.get(prov) || [] : contextoApp.pagosItems.filter(p => p.proveedor === prov);
  const pagadoUSD = pagosProv.reduce((s, p) => s + pagoUSD(p), 0);
  // FIFO: los pagos consumen la deuda más vieja primero
  let restante = pagadoUSD;
  let masVieja = null;
  for (const g of liberados) {
    if (restante >= g.monto) {
      restante -= g.monto;
      continue;
    }
    masVieja = g;
    break;
  }
  if (!masVieja) return null;
  return Math.floor((hoy - new Date(masVieja.fecha)) / 86400000);
}
export function renderProveedores() {
  const provs = [...new Set(contextoApp.consigItems.map(c => c.proveedor).filter(Boolean))].sort();
  if (!provs.length) {
    document.getElementById('proveedores-list').innerHTML = '<div class="empty">Sin proveedores registrados aún.</div>';
    return;
  }

  // Ordenar: deuda más vieja primero (los que urge pagar arriba de todo)
  const _idxProv = indiceProveedores();
  const conAging = provs.map(prov => ({
    prov,
    dias: proveedorAging(prov, _idxProv)
  }));
  conAging.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
  document.getElementById('proveedores-list').innerHTML = conAging.map(({
    prov,
    dias
  }) => {
    const items = _idxProv.items.get(prov) || [];
    const esFijo = items.some(g => g.tipoProveedor === 'fijo');
    const enStock = items.filter(g => g.status === 'en_stock');
    const vendidos = items.filter(g => g.status === 'vendido');
    const hoy = new Date(contextoApp.today());
    const enEspera = esFijo ? [] : vendidos.filter(g => g.fechaVenta && (hoy - new Date(g.fechaVenta)) / 86400000 < 2);
    const liberadoUSD = deudaLiberada(items, esFijo).reduce((s, d) => s + d.monto, 0);
    const esperaUSD = enEspera.reduce((s, g) => s + (g.precioUSD || 0), 0);
    const pagosProv = _idxProv.pagos.get(prov) || [];
    const pagado = pagosProv.reduce((s, p) => s + pagoUSD(p), 0);
    const pagadoARS = pagosProv.filter(p => p.moneda === 'ARS').reduce((s, p) => s + (p.monto || 0), 0);
    const aPagar = Math.max(0, liberadoUSD - pagado);
    const dni = items.find(g => g.provDni)?.provDni || '';
    const tel = items.find(g => g.provTel)?.provTel || '';
    let alerta = '';
    if (aPagar > 0 && dias != null) {
      if (dias >= 7) alerta = `<div class="proveedor-alerta alerta-urgente">⚠️ Hay deuda de hace <b>${dias} días</b> sin pagar — se está juntando.</div>`;else if (dias >= 3) alerta = `<div class="proveedor-alerta alerta-atencion">🔔 Deuda de hace ${dias} días — conviene ir pagando.</div>`;
    }
    return `<div class="proveedor-card" onclick="abrirCuentaCorriente('${escJs(prov)}')">
      <div class="proveedor-header">
        <div>
          <div class="proveedor-nombre">${esc(prov)} ${esFijo ? '<span class="tipo-tag tipo-fijo">🔁 Fijo</span>' : '<span class="tipo-tag tipo-casual">👤 Casual</span>'}</div>
          ${dni || tel ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">${dni ? 'DNI ' + esc(dni) : ''}${dni && tel ? ' · ' : ''}${tel ? esc(tel) : ''}</div>` : ''}
        </div>
        <span class="deuda-badge ${aPagar <= 0 ? 'deuda-ok' : ''}">${aPagar > 0 ? '💰 Pagar ' + contextoApp.fmtUSD(aPagar) : 'Al día'}</span>
      </div>
      ${alerta}
      <div class="proveedor-stats">
        <div class="proveedor-stat">En stock: <strong>${enStock.length}</strong></div>
        <div class="proveedor-stat">Vendidos: <strong>${vendidos.length}</strong></div>
        ${esperaUSD ? `<div class="proveedor-stat">⏳ En espera 48hs: <strong style="color:#854F0B">${contextoApp.fmtUSD(esperaUSD)}</strong></div>` : ''}
        <div class="proveedor-stat">${esFijo ? '💰 Le debés' : '💰 Disponible p/ pagar'}: <strong style="color:${aPagar > 0 ? '#237A4B' : 'var(--text3)'}">${contextoApp.fmtUSD(aPagar)}</strong></div>
        <div class="proveedor-stat">Pagado: <strong style="color:#237A4B">${contextoApp.fmtUSD(pagado)}</strong>${pagadoARS ? ` <span style="color:var(--text3)">(incluye ${contextoApp.fmtARS(pagadoARS)})</span>` : ''}</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn-pagar-outline" onclick="event.stopPropagation();abrirCuentaCorriente('${escJs(prov)}')">📋 Cuenta corriente</button>
        <button class="btn-pagar-outline" onclick="event.stopPropagation();imprimirComprobanteConsig('${escJs(prov)}')">🖨 Comprobante</button>
      </div>
    </div>`;
  }).join('');
}

// ── Cuenta corriente: libro mayor de retiros y pagos ──
export async function borrarCuentaProveedor(prov) {
  if (!prov) return;
  const items = contextoApp.consigItems.filter(g => g.proveedor === prov && !String(g.id).startsWith('tmp_'));
  const pagos = contextoApp.pagosItems.filter(p => p.proveedor === prov && !String(p.id).startsWith('tmp_'));
  if (!items.length && !pagos.length) {
    showToast('Esa cuenta ya está vacía.');
    return;
  }
  const enStock = items.filter(g => g.status !== 'vendido').length;
  if (!confirm(`⚠️ Dejar en 0 la cuenta de ${prov}\n\nSe borran ${items.length} equipo(s)${enStock ? ' — ' + enStock + ' todavía en stock' : ''} y ${pagos.length} pago(s).\n\nLos equipos también desaparecen de Consignación. No se puede deshacer.`)) return;
  const escrito = prompt(`Último paso.\n\nEscribí  BORRAR  para dejar la cuenta de ${prov} en cero:`);
  if ((escrito || '').trim().toUpperCase() !== 'BORRAR') {
    showToast('Cancelado — no se borró nada.');
    return;
  }
  setSyncDot('syncing');
  try {
    const refs = [...items.map(g => doc(contextoApp.db, 'consig', g.id)), ...pagos.map(x => doc(contextoApp.db, 'pagos_consig', x.id))];
    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(contextoApp.db);
      refs.slice(i, i + 400).forEach(r => batch.delete(r));
      await batch.commit();
    }
    document.getElementById('cc-modal').classList.remove('open');
    showToast('Cuenta de ' + prov + ' en cero ✓');
    setSyncDot('ok');
  } catch (e) {
    console.error(e);
    showToast('Error al borrar: ' + e.message, true);
    setSyncDot('error');
  }
}

// ── Comprobante de consignación (térmico) ─────────────
export function renderPagos() {
  populateProveedoresDL();
  const fProv = document.getElementById('pago-fl-proveedor').value;
  const items = contextoApp.pagosItems.filter(p => !fProv || p.proveedor === fProv);
  if (!items.length) {
    document.getElementById('pagos-list').innerHTML = '<div class="empty">Sin pagos registrados.</div>';
    return;
  }
  document.getElementById('pagos-list').innerHTML = items.map(p => `
    <div class="pago-item">
      <div class="pago-info">
        <div style="font-size:14px;font-weight:500;">${esc(p.proveedor || '')}</div>
        <div class="pago-fecha">${p.fecha || ''} ${p.medio ? '· ' + esc(p.medio) : ''} ${p.notas ? '· ' + esc(p.notas) : ''}</div>
      </div>
      <div class="pago-monto">${p.moneda === 'USD' ? contextoApp.fmtUSD(p.monto) : contextoApp.fmtARS(p.monto)}${p.moneda === 'ARS' ? `<div style="font-size:10.5px;color:var(--text3);font-weight:400;">${contextoApp.fmtUSD(pagoUSD(p))}${p.tc ? ' · TC ' + p.tc : ' · TC estimado'}</div>` : ''}</div>
      <button class="ei-btn del" onclick="eliminarPago('${p.id}')">×</button>
    </div>
  `).join('');
}
export function inicializarConsignacion() {
  // ── Consignación ──────────────────────────────────────
  contextoApp.consigTabActual = 'productos';
  window.setConsigTab = function (tab, btn) {
    contextoApp.consigTabActual = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['productos', 'proveedores', 'pagos', 'lista'].forEach(t => {
      document.getElementById('consig-tab-' + t).style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'proveedores') renderProveedores();
    if (tab === 'pagos') renderPagos();
    if (tab === 'productos') renderConsig();
  };
  window.autoTipoProveedor = function () {
    const nombre = document.getElementById('cp-proveedor').value.trim();
    if (!nombre) return;
    const item = contextoApp.consigItems.find(x => x.proveedor === nombre);
    if (item && item.tipoProveedor) document.getElementById('cp-tipo').value = item.tipoProveedor;
  };
  window.guardarConsig = async function () {
    const proveedor = document.getElementById('cp-proveedor').value.trim();
    const producto = document.getElementById('cp-producto').value.trim();
    if (!proveedor) {
      showToast('Completá el proveedor.', true);
      return;
    }
    if (!producto) {
      showToast('Completá el producto.', true);
      return;
    }
    const precio = parseFloat(document.getElementById('cp-precio').value) || 0;
    const moneda = document.getElementById('cp-moneda').value;
    const tc = parseFloat(document.getElementById('cp-tc').value) || null;
    const precioUSD = moneda === 'USD' ? precio : tc ? Math.round(precio / tc * 100) / 100 : null;
    const precioARS = moneda === 'ARS' ? precio : tc ? Math.round(precio * tc) : null;
    const precioVenta = parseFloat(document.getElementById('cp-precio-venta').value) || 0;
    const precioVentaUSD = precioVenta ? moneda === 'USD' ? precioVenta : tc ? Math.round(precioVenta / tc * 100) / 100 : null : null;
    const entry = {
      proveedor,
      producto,
      tipoProveedor: document.getElementById('cp-tipo').value,
      provDni: document.getElementById('cp-prov-dni').value.trim(),
      provTel: document.getElementById('cp-prov-tel').value.trim(),
      precioVenta: precioVenta || null,
      precioVentaUSD,
      color: document.getElementById('cp-color').value.trim(),
      gb: document.getElementById('cp-gb').value.trim(),
      estadoProducto: document.getElementById('cp-estado').value,
      imei: document.getElementById('cp-imei').value.trim(),
      fechaEntrada: document.getElementById('cp-fecha').value || contextoApp.today(),
      precio,
      moneda,
      tc,
      precioUSD,
      precioARS,
      bateria: document.getElementById('cp-bateria').value || null,
      ciclos: document.getElementById('cp-ciclos').value || null,
      notas: document.getElementById('cp-notas').value.trim(),
      status: 'en_stock',
      fechaVenta: null,
      createdAt: {
        seconds: Date.now() / 1000
      }
    };
    const btn = document.getElementById('btn-cp-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      // Optimistic
      contextoApp.consigItems.unshift({
        id: 'tmp_' + Date.now(),
        ...entry
      });
      renderConsig();
      await addDoc(contextoApp.consigCol, contextoApp.withUser({
        ...entry,
        createdAt: serverTimestamp()
      }));
      showToast('Producto agregado ✓');
      ['cp-proveedor', 'cp-producto', 'cp-color', 'cp-gb', 'cp-imei', 'cp-notas', 'cp-bateria', 'cp-ciclos', 'cp-prov-dni', 'cp-prov-tel'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('cp-precio').value = '';
      document.getElementById('cp-precio-venta').value = '';
      document.getElementById('cp-tc').value = '';
      document.getElementById('cp-fecha').value = contextoApp.today();
      populateProveedoresDL();
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Agregar producto';
  };
  window.pagoTcToggle = function () {
    const ars = document.getElementById('pago-moneda').value === 'ARS';
    document.getElementById('pago-tc-wrap').style.display = ars ? '' : 'none';
    const tcIn = document.getElementById('pago-tc');
    if (ars && !tcIn.value) tcIn.value = contextoApp.cfg.tc || '';
    window.pagoTcPreview();
  };
  window.pagoTcPreview = function () {
    const el = document.getElementById('pago-tc-preview');
    if (!el) return;
    const monto = parseFloat(document.getElementById('pago-monto').value) || 0;
    const tc = parseFloat(document.getElementById('pago-tc').value) || 0;
    el.textContent = monto && tc ? 'Descuenta ' + contextoApp.fmtUSD(monto / tc) + ' del saldo.' : 'Con esto el pago en pesos descuenta del saldo en dólares.';
  };
  window.guardarPago = async function () {
    const proveedor = document.getElementById('pago-proveedor').value.trim();
    const monto = parseFloat(document.getElementById('pago-monto').value);
    if (!proveedor) {
      showToast('Completá el proveedor.', true);
      return;
    }
    if (!monto || monto <= 0) {
      showToast('Completá el monto.', true);
      return;
    }
    const moneda = document.getElementById('pago-moneda').value;
    // El pago en pesos guarda su cotización, si no no hay forma de bajarlo del saldo
    // en dólares: convertirlo después, con el TC de hoy, falsearía un pago viejo.
    const tc = moneda === 'ARS' ? parseFloat(document.getElementById('pago-tc').value) || parseFloat(contextoApp.cfg.tc) || null : null;
    if (moneda === 'ARS' && !tc) {
      showToast('Poné la cotización del día para el pago en pesos.', true);
      return;
    }
    const entry = {
      proveedor,
      monto,
      moneda,
      tc,
      medio: document.getElementById('pago-medio').value,
      fecha: document.getElementById('pago-fecha').value || contextoApp.today(),
      notas: document.getElementById('pago-notas').value.trim(),
      createdAt: {
        seconds: Date.now() / 1000
      }
    };
    const btn = document.getElementById('btn-pago-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.pagosCol, contextoApp.withUser({
        ...entry,
        createdAt: serverTimestamp()
      }));
      showToast('Pago registrado ✓');
      document.getElementById('pago-proveedor').value = '';
      document.getElementById('pago-monto').value = '';
      document.getElementById('pago-notas').value = '';
      window.pagoTcPreview();
      document.getElementById('pago-fecha').value = contextoApp.today();
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Registrar pago';
  };
  window.marcarConsigVendido = async function (id, esVendido) {
    const newStatus = esVendido ? 'en_stock' : 'vendido';
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'consig', id), {
        status: newStatus,
        fechaVenta: esVendido ? null : contextoApp.today()
      });
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.eliminarConsig = async function (id) {
    if (!confirm('¿Eliminar este producto?')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'consig', id));
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  contextoApp.ccProv = null;
  window.abrirCuentaCorriente = function (prov) {
    contextoApp.ccProv = prov;
    const items = contextoApp.consigItems.filter(g => g.proveedor === prov);
    const pagos = contextoApp.pagosItems.filter(p => p.proveedor === prov);
    const fijo = esProvFijo(prov);
    const hoy = new Date(contextoApp.today());
    const fFecha = f => f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(2, 4) : '—';

    // Al proveedor fijo se le debe desde que el equipo entra: lo retirás y ya lo debés,
    // se haya vendido o no. Al casual recién cuando se vende su equipo.
    const movs = [];
    items.forEach(g => {
      const specs = [g.gb, g.color].filter(Boolean).join(' ');
      const det = `${g.producto || '—'}${specs ? ' ' + specs : ''}${g.imei ? ' · ' + g.imei.slice(-6) : ''}`;
      if (fijo) {
        movs.push({
          fecha: g.fechaEntrada || '',
          peso: 0,
          detalle: det,
          nota: g.status === 'vendido' ? 'vendido' : 'en stock',
          debe: g.precioUSD || 0
        });
      } else if (g.status === 'vendido' && g.fechaVenta) {
        const espera = (hoy - new Date(g.fechaVenta)) / 86400000 < 2;
        movs.push({
          fecha: g.fechaVenta,
          peso: 0,
          detalle: 'Vendido: ' + det,
          nota: espera ? 'en espera 48 hs' : '',
          debe: g.precioUSD || 0,
          espera
        });
      }
    });
    pagos.forEach(p => {
      const ars = p.moneda === 'ARS';
      const usd = pagoUSD(p);
      const tc = p.tc || parseFloat(contextoApp.cfg.tc) || null;
      movs.push({
        fecha: p.fecha || '',
        peso: 1,
        detalle: 'Pago' + (p.medio ? ' · ' + p.medio : '') + (p.notas ? ' — ' + p.notas : ''),
        nota: ars ? contextoApp.fmtARS(p.monto || 0) + ' a ' + (p.tc ? 'TC ' + tc : 'TC ' + tc + ' estimado') : '',
        haber: usd,
        haberARS: ars ? p.monto || 0 : 0,
        tcPropio: !!p.tc
      });
    });
    movs.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.peso - b.peso);

    // Saldo corriente, de arriba (lo más viejo) hacia abajo, como en un libro mayor
    let saldo = 0,
      totDebe = 0,
      totHaber = 0,
      totHaberARS = 0,
      esperaUSD = 0;
    movs.forEach(m => {
      saldo += (m.debe || 0) - (m.haber || 0);
      m.saldo = saldo;
      totDebe += m.debe || 0;
      totHaber += m.haber || 0;
      totHaberARS += m.haberARS || 0;
      if (m.espera) esperaUSD += m.debe || 0;
    });
    const disponible = Math.max(0, saldo - esperaUSD);
    const dias = proveedorAging(prov);
    const sinVender = fijo ? [] : items.filter(g => g.status !== 'vendido');
    const sinVenderUSD = sinVender.reduce((s, g) => s + (g.precioUSD || 0), 0);
    const colDebe = fijo ? 'Retiros' : 'Ventas';
    const num = n => Math.abs(n) < 0.5 ? '0' : contextoApp.fmtUSD(Math.abs(n));
    document.getElementById('cc-title').textContent = 'Cuenta corriente — ' + prov + (fijo ? ' 🔁' : ' 👤');
    document.getElementById('cc-summary').innerHTML = `
    <div class="profit-row"><span class="profit-label">${fijo ? 'Total retirado' : 'Total vendido'}</span><span class="profit-val">${contextoApp.fmtUSD(totDebe)}</span></div>
    <div class="profit-row"><span class="profit-label">Total pagado</span><span class="profit-val" style="color:#237A4B">${contextoApp.fmtUSD(totHaber)}${totHaberARS ? `<span style="color:var(--text3);font-size:11px;"> · incluye ${contextoApp.fmtARS(totHaberARS)}</span>` : ''}</span></div>
    <div class="profit-row"><span class="profit-label" style="font-weight:700">${saldo < -0.5 ? 'SALDO A FAVOR' : 'SALDO A PAGAR'}</span><span class="profit-val tk-b" style="color:${saldo > 0.5 ? 'var(--neg)' : '#237A4B'}">${Math.abs(saldo) < 0.5 ? '✓ AL DÍA' : contextoApp.fmtUSD(Math.abs(saldo))}</span></div>
    ${esperaUSD > 0.5 ? `<div class="profit-row"><span class="profit-label">Disponible para pagar hoy</span><span class="profit-val">${contextoApp.fmtUSD(disponible)} <span style="color:var(--text3);font-size:11px;">· ${contextoApp.fmtUSD(esperaUSD)} en espera 48 hs</span></span></div>` : ''}
    ${saldo > 0.5 && dias != null && dias >= 3 ? `<div class="proveedor-alerta ${dias >= 7 ? 'alerta-urgente' : 'alerta-atencion'}" style="margin-top:8px;">${dias >= 7 ? '⚠️' : '🔔'} La deuda más vieja tiene <b>${dias} días</b>.</div>` : ''}
  `;
    document.getElementById('cc-timeline').innerHTML = movs.length ? `
    <div style="overflow-x:auto;"><table class="tkh-table">
      <thead><tr>
        <th style="width:76px;">Fecha</th><th>Detalle</th>
        <th style="text-align:right;width:88px;">${colDebe}</th>
        <th style="text-align:right;width:88px;">Pagos</th>
        <th style="text-align:right;width:96px;">Saldo</th>
      </tr></thead>
      <tbody>${movs.map(m => `
        <tr>
          <td style="font-family:'DM Mono',monospace;color:var(--text3);white-space:nowrap;">${fFecha(m.fecha)}</td>
          <td>${esc(m.detalle)}${m.nota ? `<div style="font-size:10.5px;color:var(--text3);">${esc(m.nota)}</div>` : ''}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;${m.debe ? 'color:#B45309;' : 'color:var(--text3);'}">${m.debe ? contextoApp.fmtUSD(m.debe) : '—'}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;${m.haber ? 'color:#237A4B;' : 'color:var(--text3);'}">${m.haber ? contextoApp.fmtUSD(m.haber) : '—'}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;">${m.saldo < -0.5 ? 'a favor ' + num(m.saldo) : num(m.saldo)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr style="font-weight:700;">
        <td colspan="2" style="text-align:right;border-bottom:none;">TOTALES</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;color:#B45309;border-bottom:none;">${contextoApp.fmtUSD(totDebe)}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;color:#237A4B;border-bottom:none;">${contextoApp.fmtUSD(totHaber)}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;border-bottom:none;color:${saldo > 0.5 ? 'var(--neg)' : '#237A4B'};">${Math.abs(saldo) < 0.5 ? '✓ 0' : (saldo < 0 ? 'a favor ' : '') + num(saldo)}</td>
      </tr></tfoot>
    </table></div>
    ${sinVender.length ? `<div style="font-size:11.5px;color:var(--text3);margin-top:8px;">📦 ${sinVender.length} equipo(s) suyo(s) en stock sin vender (${contextoApp.fmtUSD(sinVenderUSD)}) — todavía no suman a la cuenta.</div>` : ''}
    ${movs.some(m => m.haberARS && !m.tcPropio) ? `<div style="font-size:11.5px;color:var(--text3);margin-top:4px;">Los pagos marcados <i>estimado</i> se cargaron sin cotización: se convierten al TC habitual (${contextoApp.cfg.tc || '—'}).</div>` : ''}
  ` : '<div class="home-empty">Sin movimientos.</div>';
    document.getElementById('cc-modal').classList.add('open');
  };

  // Deja la cuenta de un proveedor en cero borrando sus equipos y sus pagos. Es a
  // propósito destructivo: el que quiere conservar el historial no usa este botón.
  window.borrarCuentaProveedorActual = function () {
    return borrarCuentaProveedor(contextoApp.ccProv);
  };
  window.imprimirComprobanteConsig = function (prov) {
    const items = contextoApp.consigItems.filter(g => g.proveedor === prov && g.status === 'en_stock');
    if (!items.length) {
      showToast('Este dueño no tiene items en stock.', true);
      return;
    }
    const dni = items.find(g => g.provDni)?.provDni || '';
    const tel = items.find(g => g.provTel)?.provTel || '';
    const m = g => g.precio ? g.moneda === 'ARS' ? contextoApp.fmtARS(g.precio) : 'u$s ' + g.precio : '—';
    const itemsHtml = items.map(g => {
      const specs = [g.gb, g.color, g.estadoProducto].filter(Boolean).join(' · ');
      return `
      <div class="tk-r"><span class="tk-b">${esc(g.producto || '')}</span><span class="v tk-b">${m(g)}</span></div>
      ${specs ? `<div class="tk-r" style="font-size:10px;"><span>${esc(specs)}</span><span></span></div>` : ''}
      ${g.imei ? `<div class="tk-r" style="font-size:9px;"><span>IMEI/Serie: ${esc(g.imei)}</span><span></span></div>` : ''}
      ${g.bateria ? `<div class="tk-r" style="font-size:9px;"><span>Bateria ${esc(g.bateria)}%${g.ciclos ? ' · ' + esc(g.ciclos) + ' ciclos' : ''}</span><span></span></div>` : ''}
      <div style="height:1.5mm;"></div>`;
    }).join('');
    const TERMS_CONSIG = `1. El local recibe los articulos detallados para su venta por cuenta y orden del propietario.
2. El propietario declara ser dueno legitimo de los articulos entregados.
3. El importe indicado es el que recibira el propietario una vez concretada la venta.
4. El pago al propietario queda disponible a partir de las 48 hs habiles de concretada la venta.
5. El retiro de articulos o cobro se realiza unicamente con este comprobante y DNI.`;
    document.getElementById('ticket-print').innerHTML = `
    <div class="tk-h1">COMPROBANTE DE<br>CONSIGNACION</div>
    <div class="tk-local">
      <div class="tk-b">${esc(contextoApp.cfg.localNombre || 'MarplaCity')}</div>
      ${contextoApp.cfg.localDir ? `<div>${esc(contextoApp.cfg.localDir)}</div>` : ''}
      ${contextoApp.cfg.localTel ? `<div>Tel: ${esc(contextoApp.cfg.localTel)}</div>` : ''}
    </div>
    <div class="tk-sep"></div>
    <div class="tk-r"><span>Fecha</span><span class="v">${contextoApp.today()} ${new Date().toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit'
    })}</span></div>
    <div class="tk-r"><span>Propietario</span><span class="v tk-b">${esc(prov)}</span></div>
    ${dni ? `<div class="tk-r"><span>DNI</span><span class="v">${esc(dni)}</span></div>` : ''}
    ${tel ? `<div class="tk-r"><span>Tel</span><span class="v">${esc(tel)}</span></div>` : ''}
    <div class="tk-sep"></div>
    <div class="tk-b" style="margin-bottom:1.5mm;">ARTICULOS RECIBIDOS (${items.length})</div>
    ${itemsHtml}
    <div class="tk-sep"></div>
    <div class="tk-b" style="margin-bottom:1mm;">CONDICIONES</div>
    <div class="tk-terms">${TERMS_CONSIG}</div>
    <div class="tk-sig">Firma del propietario</div>
    <div style="height:6mm;"></div>
    <div class="tk-sig">Firma del local</div>
    <div class="tk-sep"></div>
    <div class="tk-c" style="font-size:9px;">Conserve este comprobante para el retiro o cobro.</div>
  `;
    printTicket80('Comprobante consignación');
  };
  window.eliminarPago = async function (id) {
    if (!confirm('¿Eliminar este pago?')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'pagos_consig', id));
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };

  // ── Edit consig modal ── (reuse stock modal structure, add consig-specific modal)
  contextoApp.consigEditingId = null;
  window.editarConsig = function (id) {
    const g = contextoApp.consigItems.find(x => x.id === id);
    if (!g) return;
    contextoApp.consigEditingId = id;
    // Populate stock edit modal fields that overlap
    document.getElementById('sm-nombre').value = g.producto || '';
    document.getElementById('sm-imei').value = g.imei || '';
    document.getElementById('sm-valor').value = g.precio || '';
    document.getElementById('sm-precio-venta').value = g.precioVentaUSD || '';
    document.getElementById('sm-moneda').value = g.moneda || 'USD';
    document.getElementById('sm-tc').value = g.tc || '';
    document.getElementById('sm-fecha').value = g.fechaEntrada || contextoApp.today();
    document.getElementById('sm-status').value = g.status || 'en_stock';
    document.getElementById('sm-fecha-venta').value = g.fechaVenta || '';
    document.getElementById('sm-origen').value = g.proveedor || '';
    document.getElementById('sm-color').value = g.color || '';
    document.getElementById('sm-gb').value = g.gb || '';
    document.getElementById('sm-bateria').value = g.bateria || '';
    document.getElementById('sm-ciclos').value = g.ciclos || '';
    document.getElementById('sm-estado-prod').value = g.estadoProducto || '';
    document.getElementById('sm-notas').value = g.notas || '';
    document.getElementById('sm-tipo-wrap').style.display = 'none';
    document.getElementById('sm-venta-wrap').style.display = g.status === 'vendido' ? 'block' : 'none';
    // Override title
    document.querySelector('#stock-edit-modal .modal-header h2').textContent = 'Editar producto consignación';
    document.getElementById('sm-origen').previousElementSibling.textContent = 'Proveedor';
    document.getElementById('stock-modal-save-btn').onclick = window.saveConsigModal;
    document.getElementById('stock-edit-modal').classList.add('open');
  };
  window.saveConsigModal = async function () {
    if (!contextoApp.consigEditingId) return;
    const producto = document.getElementById('sm-nombre').value.trim();
    if (!producto) {
      showToast('Completá el producto.', true);
      return;
    }
    const precio = parseFloat(document.getElementById('sm-valor').value) || 0;
    const moneda = document.getElementById('sm-moneda').value;
    const tc = parseFloat(document.getElementById('sm-tc').value) || null;
    const precioUSD = moneda === 'USD' ? precio : tc ? Math.round(precio / tc * 100) / 100 : null;
    const precioARS = moneda === 'ARS' ? precio : tc ? Math.round(precio * tc) : null;
    const status = document.getElementById('sm-status').value;
    // El modal pide el precio de venta en USD; `precioVenta` se mantiene coherente
    // en la moneda del ítem para que las dos vistas muestren lo mismo.
    const precioVentaUSD = parseFloat(document.getElementById('sm-precio-venta').value) || null;
    const precioVenta = precioVentaUSD == null ? null : moneda === 'USD' ? precioVentaUSD : tc ? Math.round(precioVentaUSD * tc) : null;
    const data = {
      producto,
      imei: document.getElementById('sm-imei').value.trim(),
      precio,
      moneda,
      tc,
      precioUSD,
      precioARS,
      precioVenta,
      precioVentaUSD,
      fechaEntrada: document.getElementById('sm-fecha').value || contextoApp.today(),
      proveedor: document.getElementById('sm-origen').value.trim(),
      color: document.getElementById('sm-color').value.trim(),
      gb: document.getElementById('sm-gb').value.trim(),
      bateria: document.getElementById('sm-bateria').value || null,
      ciclos: document.getElementById('sm-ciclos').value || null,
      estadoProducto: document.getElementById('sm-estado-prod').value.trim(),
      notas: document.getElementById('sm-notas').value.trim(),
      status,
      fechaVenta: status === 'vendido' ? document.getElementById('sm-fecha-venta').value || null : null
    };
    const btn = document.getElementById('stock-modal-save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'consig', contextoApp.consigEditingId), data);
      showToast('Producto actualizado ✓');
      window.closeStockModal();
      // Reset modal
      document.querySelector('#stock-edit-modal .modal-header h2').textContent = 'Editar item de stock';
      document.getElementById('stock-modal-save-btn').onclick = window.saveStockModal;
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  };

  // ── AI Reports ────────────────────────────────────────
}
