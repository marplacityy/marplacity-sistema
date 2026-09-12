/** modulos/inicio: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { on } from '../../shared/seguridad.js';
import { getGFStatus, statusBadge } from './gastos-fijos.js';
import { esc } from '../core/interfaz.js';
import { cargarClientes, attachClienteAC } from './clientes.js';
import { renderIngresos } from './ingresos.js';

export
// ── Dashboard ─────────────────────────────────────────
function renderHome() {
  const hoy = contextoApp.today();
  const hora = new Date().getHours();
  const saludo = hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('home-saludo').textContent = saludo + ' 👋';
  document.getElementById('home-fecha').textContent = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });

  // Métricas de hoy
  const ventasHoy = contextoApp.ingresos.filter(v => v.fecha === hoy && v.origen !== 'repairdesk');
  const vARS = ventasHoy.reduce((s, v) => s + (v.totalARS || 0), 0);
  const vUSD = ventasHoy.reduce((s, v) => s + (v.totalUSD || 0), 0);
  const activas = contextoApp.reps.filter(r => contextoApp.estInfo(r.estado).activo);
  const listas = contextoApp.reps.filter(r => ['reparado', 'avisado'].includes(r.estado));
  const gfVencidos = contextoApp.fijosItems.filter(f => getGFStatus(f).status === 'vencido').length;
  const stockBajo = contextoApp.invItems.filter(p => contextoApp.invEstado(p) !== 'ok').length;
  document.getElementById('home-metrics').innerHTML = `
    <div class="metric"><div class="m-label">Ventas hoy</div><div class="m-val">${ventasHoy.length}</div><div class="m-sub">${[vARS ? contextoApp.fmtARS(vARS) : null, vUSD ? 'u$s ' + Math.round(vUSD * 100) / 100 : null].filter(Boolean).join(' + ') || '—'}</div></div>
    <div class="metric"><div class="m-label">Reparaciones en curso</div><div class="m-val">${activas.length}</div><div class="m-sub">${listas.length} listas p/ retirar</div></div>
    <div class="metric"><div class="m-label">Fijos vencidos</div><div class="m-val" style="color:${gfVencidos ? 'var(--neg)' : 'var(--text3)'}">${gfVencidos}</div></div>
    <div class="metric"><div class="m-label">Stock bajo / sin stock</div><div class="m-val" style="color:${stockBajo ? '#854F0B' : 'var(--text3)'}">${stockBajo}</div></div>
    ${(contextoApp.encarguesItems || []).filter(x => x.estado === 'pendiente').length ? `<div class="metric" style="cursor:pointer;" ${on('click', 'goTo', 'encargues')}><div class="m-label">📦 Encargues pendientes</div><div class="m-val">${contextoApp.encarguesItems.filter(x => x.estado === 'pendiente').length}</div><div class="m-sub">click para ver</div></div>` : ''}
  `;

  // Reparaciones listas
  const repList = listas.slice(0, 6).map(r => `
    <div class="home-list-item" ${on('click', 'abrirRep', r.id)}>
      <div><b>#${r.num}</b> ${esc(r.cliente || '')} <div class="sub">${esc(r.equipo || '')}</div></div>
      <div>${(r.saldo || 0) > 0 ? `<span style="color:var(--neg);font-weight:600;">saldo ${r.moneda === 'ARS' ? contextoApp.fmtARS(r.saldo) : 'u$s ' + r.saldo}</span>` : '<span style="color:#237A4B;">pago</span>'}</div>
    </div>`).join('');
  document.getElementById('home-reps').innerHTML = repList || '<div class="home-empty">Nada listo para retirar.</div>';

  // Gastos fijos vencidos/por vencer
  const gfAlerta = contextoApp.fijosItems.map(f => ({
    f,
    st: getGFStatus(f)
  })).filter(x => ['vencido', 'proximo'].includes(x.st.status));
  gfAlerta.sort((a, b) => (a.st.proxVenc || '').localeCompare(b.st.proxVenc || ''));
  document.getElementById('home-fijos').innerHTML = gfAlerta.slice(0, 6).map(x => `
    <div class="home-list-item" ${on('click', 'goTo', 'fijos')}>
      <div><b>${esc(x.f.nombre)}</b> <div class="sub">vence ${x.st.proxVenc || '—'}</div></div>
      <div>${statusBadge(x.st.status)}</div>
    </div>`).join('') || '<div class="home-empty">Todo al día ✓</div>';

  // Ventas de hoy
  document.getElementById('home-ventas').innerHTML = ventasHoy.slice(0, 6).map(v => `
    <div class="home-list-item" ${on('click', 'goTo', 'facturas')}>
      <div><b>${v.numVenta ? '#V-' + v.numVenta : ''}</b> ${esc(v.clienteNombre || '')} <div class="sub">${esc((v.nombre || '').slice(0, 60))}</div></div>
      <div style="font-family:'DM Mono',monospace;">${v.totalUSD ? 'u$s ' + v.totalUSD : v.totalARS ? contextoApp.fmtARS(v.totalARS) : ''}</div>
    </div>`).join('') || '<div class="home-empty">Sin ventas todavía hoy.</div>';

  // Stock bajo
  const bajos = contextoApp.invItems.filter(p => contextoApp.invEstado(p) !== 'ok');
  document.getElementById('home-stock').innerHTML = bajos.slice(0, 6).map(p => `
    <div class="home-list-item" ${on('click', 'abrirInv', p.id)}>
      <div><b>${esc(p.nombre)}</b> <div class="sub">${esc(p.categoria || '')}</div></div>
      <div>${contextoApp.invEstado(p) === 'out' ? '<span class="inv-alert alert-out">Sin stock</span>' : `<span class="inv-alert alert-low">Quedan ${p.qty}</span>`}</div>
    </div>`).join('') || '<div class="home-empty">Stock saludable ✓</div>';
}

// ── Búsqueda global ───────────────────────────────────
export async function buscarGlobal(q) {
  q = q.toLowerCase().trim();
  if (q.length < 2) return;
  await cargarClientes();
  const has = (...campos) => campos.join(' ').toLowerCase().includes(q);
  const R = [];
  const cl = contextoApp.clientesItems.filter(x => has(x.nombre || '', x.tel || '')).slice(0, 8);
  if (cl.length) R.push({
    t: 'Clientes',
    items: cl.map(x => ({
      txt: `<b>${esc(x.nombre)}</b>`,
      sub: x.tel || '',
      fn: on('click', 'abrirCliente', x.id)
    }))
  });
  const rp = contextoApp.reps.filter(r => has(String(r.num || ''), r.cliente || '', r.imei || '', r.equipo || '', r.tel || '')).slice(0, 8);
  if (rp.length) R.push({
    t: 'Reparaciones',
    items: rp.map(r => ({
      txt: `<b>#${r.num}</b> ${esc(r.cliente || '')} — ${esc(r.equipo || '')}`,
      sub: (r.imei ? 'IMEI ' + r.imei + ' · ' : '') + contextoApp.estInfo(r.estado).label,
      fn: on('click', 'abrirRep', r.id)
    }))
  });
  const vt = contextoApp.ingresos.filter(v => has(String(v.numVenta || ''), v.clienteNombre || '', v.nombre || '', v.imei || '', ...(v.items || []).map(i => i.imei || ''))).slice(0, 8);
  if (vt.length) R.push({
    t: 'Facturas',
    items: vt.map(v => ({
      txt: `<b>${v.numVenta ? '#V-' + v.numVenta : ''}</b> ${esc(v.clienteNombre || '')}`,
      sub: (v.fecha || '') + ' · ' + esc((v.nombre || '').slice(0, 60)),
      fn: on('click', 'buscarVentasDesdeInicio', q)
    }))
  });
  const eq = contextoApp.stockItems.filter(s => has(s.nombre || '', s.imei || '', s.color || '')).slice(0, 8);
  if (eq.length) R.push({
    t: 'Equipos',
    items: eq.map(s => ({
      txt: `<b>${esc(s.nombre)}</b> ${esc(s.color || '')}`,
      sub: (s.imei ? 'IMEI ' + s.imei + ' · ' : '') + (s.status === 'vendido' ? 'Vendido' : 'En stock'),
      fn: on('click', 'editarStock', s.id)
    }))
  });
  const cg = contextoApp.consigItems.filter(x => has(x.producto || '', x.imei || '', x.proveedor || '')).slice(0, 8);
  if (cg.length) R.push({
    t: 'Consignación',
    items: cg.map(x => ({
      txt: `<b>${esc(x.producto || '')}</b>`,
      sub: (x.proveedor || '') + ' · ' + (x.status === 'vendido' ? 'Vendido' : 'En stock'),
      fn: on('click', 'editarConsigItem', x.id)
    }))
  });
  const iv = contextoApp.invItems.filter(p => has(p.nombre || '', p.sku || '')).slice(0, 8);
  if (iv.length) R.push({
    t: 'Inventario',
    items: iv.map(p => ({
      txt: `<b>${esc(p.nombre)}</b>`,
      sub: (p.qty || 0) + ' unidades',
      fn: on('click', 'abrirInv', p.id)
    }))
  });
  document.getElementById('gs-results').innerHTML = R.length ? R.map(sec => `<div class="gs-section">${sec.t}</div>` + sec.items.map(it => `<div class="gs-item" ${it.fn}>${it.txt}<div class="sub">${it.sub}</div></div>`).join('')).join('') : '<div class="home-empty">Sin resultados para "' + esc(q) + '".</div>';
  document.getElementById('gs-modal').classList.add('open');
}

// Búsqueda global solo con Enter (recorrer 30k registros en cada pausa de tipeo pesa)
export function inicializarInicio() {
  window.buscarVentasDesdeInicio = q => { window.goTo('facturas'); document.getElementById('inc-fl-buscar').value = q; renderIngresos(); window.closeGS(); };
window.closeGS = function () {
    document.getElementById('gs-modal').classList.remove('open');
  };
  document.getElementById('gs-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') buscarGlobal(this.value);
  });
  document.getElementById('gs-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeGS();
  });
  document.getElementById('fe-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeFE();
  });
  attachClienteAC('pos-cliente', 'clientes-global-dl');
  attachClienteAC('fe-cliente', 'clientes-global-dl');
  attachClienteAC('r-cliente', 'clientes-dl');
  attachClienteAC('en-cliente', 'clientes-global-dl');
  document.getElementById('ent-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeEnt();
  });

  // ── Clientes ──────────────────────────────────────────

  // Autocompletado dinámico: puebla el datalist solo con matches (máx 20)
  // — un datalist con 7.000 opciones congela el navegador
}
