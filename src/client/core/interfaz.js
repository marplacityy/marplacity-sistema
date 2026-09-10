/** core/interfaz: lógica preservada de la aplicación original. */
import { contextoApp } from './estado.js';
import { setSyncDot, fechasPreset } from './datos.js';
import { addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { medirBarra, initPos, renderPosGrid, renderCart } from '../modulos/pos.js';
import { renderHome } from '../modulos/inicio.js';
import { renderCaja } from '../modulos/caja.js';
import { renderEncargues } from '../modulos/encargues.js';
import { initRepPiezasGrid, populateRepModelosDL, renderRepInv, renderPreciosRef } from '../modulos/repuestos.js';
import { renderBandeja } from '../modulos/instagram.js';
import { pintarConocimiento, renderConocimiento } from '../modulos/conocimiento.js';
import { buildMonthChips, renderListado } from '../modulos/gastos.js';
import { populateIncMedioSel, populateIncCatFilter, renderIngresos } from '../modulos/ingresos.js';
import { renderStock } from '../modulos/stock.js';
import { populateGFSelects, renderFijos } from '../modulos/gastos-fijos.js';
import { initRepForm, renderReps } from '../modulos/reparaciones.js';
import { populateICatSelects, renderInv } from '../modulos/inventario.js';
import { cargarClientes, renderClientes } from '../modulos/clientes.js';
import { renderArcaBanner } from '../modulos/arca.js';
import { initFacturador } from '../modulos/facturador.js';
import { agPintar, agPintarFichas } from '../modulos/asistente.js';
import { renderCatalogo, renderPedidos } from '../modulos/catalogo.js';
import { populateProveedoresDL, populateConsigFilters, renderConsig, renderProveedores, renderPagos } from '../modulos/consignacion.js';
import { renderReporte } from '../modulos/reportes.js';
import { renderAmort } from '../modulos/amortizaciones.js';

export function escJs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
export function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function showToast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  setTimeout(() => t.className = 'toast', 2500);
}

// ── Pérdida extraordinaria (carga rápida) ──
export
// ── Populate selects ──
function populateCatSelects() {
  const opts = '<option value="">Sin categoría</option>' + contextoApp.cats.map(c => `<option>${esc(c)}</option>`).join('');
  ['categoria', 'm-categoria', 'fl-cat'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    if (id === 'fl-cat') {
      el.innerHTML = '<option value="">Todas las categorías</option>' + contextoApp.cats.map(c => `<option>${esc(c)}</option>`).join('');
    } else {
      el.innerHTML = opts;
    }
    el.value = prev;
  });
}
export function populateMedioSelects() {
  const opts = '<option value="">— opcional —</option>' + contextoApp.medios.map(m => `<option>${esc(m)}</option>`).join('');
  ['medio', 'm-medio', 'fl-medio'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    if (id === 'fl-medio') {
      el.innerHTML = '<option value="">Todos los medios</option>' + contextoApp.medios.map(m => `<option>${esc(m)}</option>`).join('');
    } else {
      el.innerHTML = opts;
    }
    el.value = prev;
  });
}
export function renderCatTags() {
  document.getElementById('cats-tags').innerHTML = contextoApp.cats.map(c => `<div class="tag"><span>${esc(c)}</span><button onclick="eliminarCat('${escJs(c)}')" title="Eliminar">×</button></div>`).join('');
}
export function renderMedioTags() {
  document.getElementById('medios-tags').innerHTML = contextoApp.medios.map(m => `<div class="tag"><span>${esc(m)}</span><button onclick="eliminarMedio('${escJs(m)}')" title="Eliminar">×</button></div>`).join('');
}
export async function saveCfgData() {
  setSyncDot('syncing');
  try {
    await setDoc(contextoApp.cfgDoc, contextoApp.withUser({
      ...contextoApp.cfg,
      cats: contextoApp.cats,
      medios: contextoApp.medios,
      icats: contextoApp.icats
    }), {
      merge: true
    });
    setSyncDot('ok');
  } catch (e) {
    setSyncDot('error');
  }
}
export function updateConceptosDL() {
  const set = [...new Set(contextoApp.gastos.map(g => g.concepto))];
  ['conceptos-dl', 'conceptos-dl2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = set.map(c => `<option value="${esc(c)}">`).join('');
  });
}

// ── Guardar nuevo gasto ──
export function inicializarInterfaz() {
  // ── Helpers ──
  // Fecha LOCAL (no UTC): evita que después de las 21:00 (AR) las operaciones se fechen "mañana"
  contextoApp.isoLocal = d => {
    const x = new Date(d);
    x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    return x.toISOString().split('T')[0];
  };
  contextoApp.today = () => contextoApp.isoLocal(new Date());
  contextoApp.fmtARS = n => '$ ' + Math.round(n).toLocaleString('es-AR');
  contextoApp.fmtUSD = n => n != null ? 'u$s ' + Math.round(n).toLocaleString('es-AR') : '';
  contextoApp.MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  contextoApp.fmtMes = ym => {
    const [y, m] = ym.split('-');
    return contextoApp.MESES[+m - 1] + ' ' + y;
  };
  window.cargarExtraordinario = async function () {
    const concepto = document.getElementById('ext-concepto').value.trim();
    const monto = parseFloat(document.getElementById('ext-monto').value) || 0;
    if (!concepto || monto <= 0) {
      showToast('Completá qué pasó y el monto.', true);
      return;
    }
    const moneda = document.getElementById('ext-moneda').value;
    const tc = parseFloat(contextoApp.cfg.tc) || null;
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.gastosCol, contextoApp.withUser({
        fecha: contextoApp.today(),
        tipo: 'negocio',
        concepto,
        categoria: 'Extraordinarios / Pérdidas',
        monto,
        moneda,
        tc: moneda === 'ARS' ? tc : null,
        usd: moneda === 'USD' ? monto : tc ? Math.round(monto / tc * 100) / 100 : null,
        medio: '',
        notas: 'Pérdida extraordinaria',
        createdAt: serverTimestamp()
      }));
      ['ext-concepto', 'ext-monto'].forEach(i => document.getElementById(i).value = '');
      showToast('Pérdida registrada ✓ — impacta el reporte de hoy');
    } catch (e) {
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
  };
  window.agregarCat = async function () {
    const val = document.getElementById('nueva-cat').value.trim();
    if (!val || contextoApp.cats.includes(val)) return;
    contextoApp.cats.push(val);
    document.getElementById('nueva-cat').value = '';
    renderCatTags();
    populateCatSelects();
    await saveCfgData();
    showToast('Categoría agregada ✓');
  };
  window.eliminarCat = async function (c) {
    contextoApp.cats = contextoApp.cats.filter(x => x !== c);
    renderCatTags();
    populateCatSelects();
    await saveCfgData();
  };
  window.agregarMedio = async function () {
    const val = document.getElementById('nuevo-medio').value.trim();
    if (!val || contextoApp.medios.includes(val)) return;
    contextoApp.medios.push(val);
    document.getElementById('nuevo-medio').value = '';
    renderMedioTags();
    populateMedioSelects();
    await saveCfgData();
    showToast('Medio de pago agregado ✓');
  };
  window.eliminarMedio = async function (m) {
    contextoApp.medios = contextoApp.medios.filter(x => x !== m);
    renderMedioTags();
    populateMedioSelects();
    await saveCfgData();
  };

  // ── Nav ──
  window.goTo = function (page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`nav a[onclick*="'${page}'"]`).forEach(a => a.classList.add('active'));
    const enLaBarra = document.querySelectorAll(`.mobile-tab[onclick*="'${page}'"]`);
    enLaBarra.forEach(b => b.classList.add('active'));
    // Si la pantalla no es una de las cuatro fijas, se marca "Más": en el teléfono la
    // barra tiene que decir siempre dónde estás parado.
    if (!enLaBarra.length) document.getElementById('tab-mas')?.classList.add('active');
    medirBarra();
    contextoApp.currentPage = page;
    if (page === 'home') renderHome();
    if (page === 'caja') {
      const cf = document.getElementById('caja-fecha');
      if (!cf.value) cf.value = contextoApp.today();
      renderCaja();
    }
    if (page === 'encargues') {
      const ms = document.getElementById('en-sena-medio');
      if (!ms.options.length) ms.innerHTML = contextoApp.medios.map(m => `<option>${esc(m)}</option>`).join('');
      renderEncargues();
    }
    if (page === 'repuestos') {
      initRepPiezasGrid();
      populateRepModelosDL();
      renderRepInv();
      renderPreciosRef();
    }
    if (page === 'bandeja') renderBandeja();
    if (page === 'conocimiento') {
      pintarConocimiento();
      renderConocimiento();
    }
    if (page === 'listado') {
      if (!window._glInit) {
        window._glInit = true;
        const r = fechasPreset('hoy');
        document.getElementById('fl-desde').value = r.d;
        document.getElementById('fl-hasta').value = r.h;
      }
      buildMonthChips();
      renderListado();
    }
    if (page === 'ingresos') {
      populateIncMedioSel();
      initPos();
      renderPosGrid();
      renderCart();
    }
    if (page === 'stock') renderStock();
    if (page === 'fijos') {
      populateGFSelects();
      renderFijos();
    }
    if (page === 'rep') {
      initRepForm();
      renderReps();
    }
    if (page === 'inv') {
      populateICatSelects();
      renderInv();
    }
    if (page === 'clientes') {
      cargarClientes();
      renderClientes();
    }
    if (page === 'facturas' || page === 'rep' || page === 'ingresos') cargarClientes();
    if (page === 'facturas') {
      if (!window._incInit) {
        window._incInit = true;
        const r = fechasPreset('hoy');
        document.getElementById('inc-fl-desde').value = r.d;
        document.getElementById('inc-fl-hasta').value = r.h;
      }
    }
    if (page === 'facturas') {
      populateIncCatFilter();
      renderIngresos();
      renderArcaBanner();
    }
    if (page === 'facturador') initFacturador();
    if (page === 'asistente') {
      agPintar();
      agPintarFichas();
      document.getElementById('ag-input')?.focus();
    }
    if (page === 'catalogo') renderCatalogo();
    if (page === 'pedidos') renderPedidos();
    if (page === 'consig') {
      populateProveedoresDL();
      populateConsigFilters();
      renderConsig();
      renderProveedores();
      renderPagos();
    }
    if (page === 'reportes') renderReporte();
    if (page === 'amort') renderAmort();
  };

  // ── Form ──
  document.getElementById('fecha').value = contextoApp.today();
  document.getElementById('am-fecha').value = contextoApp.today();
  window.toggleVencimiento = function () {
    const show = document.getElementById('tiene-vencimiento').checked;
    document.getElementById('vencimiento-wrap').style.display = show ? 'block' : 'none';
    if (!show) document.getElementById('vencimiento').value = '';
  };
  window.toggleModalVencimiento = function () {
    const show = document.getElementById('m-tiene-vencimiento').checked;
    document.getElementById('m-vencimiento-wrap').style.display = show ? 'block' : 'none';
    if (!show) document.getElementById('m-vencimiento').value = '';
  };
  window.onGastosRangeChange = function () {
    // When user sets a date range, clear the month chip
    contextoApp.activeMonth = '';
    buildMonthChips();
    renderListado();
  };
  window.setGastosPreset = function (k, btn) {
    document.querySelectorAll('#gl-presets .ptab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const r = fechasPreset(k);
    document.getElementById('fl-desde').value = r.d;
    document.getElementById('fl-hasta').value = r.h;
    window.onGastosRangeChange();
  };
  window.clearGastosRange = function () {
    document.querySelectorAll('#gl-presets .ptab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#gl-presets .ptab')[4].classList.add('active');
    document.getElementById('fl-desde').value = '';
    document.getElementById('fl-hasta').value = '';
    renderListado();
  };
  window.setIncPreset = function (k, btn) {
    document.querySelectorAll('#inc-presets .ptab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const r = fechasPreset(k);
    document.getElementById('inc-fl-desde').value = r.d;
    document.getElementById('inc-fl-hasta').value = r.h;
    document.getElementById('inc-fl-mes').value = '';
    renderIngresos();
  };
  window.clearIngresosRange = function () {
    document.querySelectorAll('#inc-presets .ptab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#inc-presets .ptab')[4].classList.add('active');
    document.getElementById('inc-fl-desde').value = '';
    document.getElementById('inc-fl-hasta').value = '';
    renderIngresos();
  };
  window.setTipo = function (t) {
    contextoApp.tipoActual = t;
    document.getElementById('btn-neg').classList.toggle('active', t === 'negocio');
    document.getElementById('btn-per').classList.toggle('active', t === 'personal');
  };
  window.onMonedaChange = function () {
    const isUSD = document.getElementById('moneda').value === 'USD';
    document.getElementById('tc-wrap').style.display = isUSD ? 'none' : 'block';
    document.getElementById('equiv-wrap').style.display = isUSD ? 'none' : 'block';
    window.calcEquiv();
  };
  window.calcEquiv = function () {
    const m = parseFloat(document.getElementById('monto').value) || 0;
    const tc = parseFloat(document.getElementById('tc').value) || 0;
    document.getElementById('equiv-usd').value = tc > 0 && m > 0 ? (m / tc).toFixed(2) : '';
  };
}
