/** modulos/inventario: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, escJs, saveCfgData, showToast } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { addDoc, serverTimestamp, updateDoc, doc, deleteDoc } from 'firebase/firestore';

export
// ── Inventario ────────────────────────────────────────

function populateICatSelects() {
  const opts = '<option value="">Sin categoría</option>' + contextoApp.icats.map(x => `<option>${esc(x)}</option>`).join('');
  ['i-cat', 'im-cat'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = opts;
    el.value = prev;
  });
  const fl = document.getElementById('inv-fl-cat');
  if (fl) {
    const prev = fl.value;
    fl.innerHTML = '<option value="">Todas las categorías</option>' + contextoApp.icats.map(x => `<option>${esc(x)}</option>`).join('');
    fl.value = prev;
  }
}
export function renderICatTags() {
  const el = document.getElementById('icats-tags');
  if (!el) return;
  el.innerHTML = contextoApp.icats.map(x => `<div class="tag"><span>${esc(x)}</span><button onclick="eliminarICat('${escJs(x)}')">×</button></div>`).join('');
}
export function renderInv() {
  populateICatSelects();
  const fCat = document.getElementById('inv-fl-cat').value;
  const fSt = document.getElementById('inv-fl-stock').value;
  const fBus = (document.getElementById('inv-fl-buscar').value || '').toLowerCase().trim();
  let items = contextoApp.invItems.filter(p => {
    if (fCat && p.categoria !== fCat) return false;
    if (fSt && contextoApp.invEstado(p) !== fSt) return false;
    if (fBus && !((p.nombre || '') + ' ' + (p.sku || '')).toLowerCase().includes(fBus)) return false;
    return true;
  });

  // métricas sobre TODO el inventario, no el filtro
  const unidades = contextoApp.invItems.reduce((s, p) => s + (p.qty || 0), 0);
  const tcCfg = parseFloat(contextoApp.cfg.tc) || null;
  const capUSD = contextoApp.invItems.reduce((s, p) => {
    const cst = (p.costo || 0) * (p.qty || 0);
    return s + (p.moneda === 'USD' ? cst : tcCfg ? cst / tcCfg : 0);
  }, 0);
  const capARS = tcCfg ? capUSD * tcCfg : 0;
  const lows = contextoApp.invItems.filter(p => contextoApp.invEstado(p) === 'low').length;
  const outs = contextoApp.invItems.filter(p => contextoApp.invEstado(p) === 'out').length;
  document.getElementById('inv-metrics').innerHTML = `
    <div class="metric"><div class="m-label">Productos</div><div class="m-val">${contextoApp.invItems.length}</div><div class="m-sub">${unidades} unidades</div></div>
    <div class="metric"><div class="m-label">Capital en stock</div><div class="m-val">${capUSD ? contextoApp.fmtUSD(Math.round(capUSD * 100) / 100) : '—'}</div><div class="m-sub">${capARS ? contextoApp.fmtARS(Math.round(capARS)) + ' · ' : ''}a costo</div></div>
    <div class="metric"><div class="m-label">Stock bajo</div><div class="m-val" style="color:${lows ? '#854F0B' : 'var(--text3)'}">${lows}</div></div>
    <div class="metric"><div class="m-label">Sin stock</div><div class="m-val" style="color:${outs ? 'var(--neg)' : 'var(--text3)'}">${outs}</div></div>
  `;
  if (!items.length) {
    document.getElementById('inv-list').innerHTML = '<div class="empty" style="grid-column:1/-1;">Sin productos en este filtro.</div>';
    return;
  }
  document.getElementById('inv-list').innerHTML = items.map(p => {
    const st = contextoApp.invEstado(p);
    const cls = st === 'out' ? 'out' : st === 'low' ? 'low' : '';
    const badge = st === 'out' ? '<span class="inv-alert alert-out">Sin stock</span>' : st === 'low' ? '<span class="inv-alert alert-low">Quedan pocos</span>' : '';
    const m = v => p.moneda === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v;
    return `<div class="inv-card ${cls}" onclick="abrirInv('${p.id}')">
      <div class="inv-top">
        <div style="flex:1;min-width:0;">
          <div class="inv-nombre">${esc(p.nombre)}</div>
          <div class="inv-cat">${esc(p.categoria || 'Sin categoría')}${p.sku ? ' · ' + esc(p.sku) : ''}</div>
          ${badge ? `<div style="margin-top:5px;">${badge}</div>` : ''}
        </div>
        <div class="inv-qty">${p.qty || 0}<small>unid.</small></div>
      </div>
      <div class="inv-precios">
        <span><span class="c">Costo</span> <span class="v">${m(p.costo || 0)}</span></span>
        ${p.sugerido ? `<span><span class="c">Sug.</span> <span class="v">${m(p.sugerido)}</span></span>` : ''}
      </div>
      <div class="inv-acts">
        <button class="qty-btn" onclick="ajustarQty('${p.id}',-1,event)">−</button>
        <button class="qty-btn" onclick="ajustarQty('${p.id}',1,event)">+</button>
      </div>
    </div>`;
  }).join('');
}
export function inicializarInventario() {
  window.agregarICat = async function () {
    const v = document.getElementById('nueva-icat').value.trim();
    if (!v || contextoApp.icats.includes(v)) return;
    contextoApp.icats.push(v);
    document.getElementById('nueva-icat').value = '';
    renderICatTags();
    populateICatSelects();
    await saveCfgData();
    showToast('Categoría agregada ✓');
  };
  window.eliminarICat = async function (x) {
    contextoApp.icats = contextoApp.icats.filter(i => i !== x);
    renderICatTags();
    populateICatSelects();
    await saveCfgData();
  };
  window.setInvTab = function (tab, btn) {
    document.querySelectorAll('#page-inv .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('inv-tab-lista').style.display = tab === 'lista' ? 'block' : 'none';
    document.getElementById('inv-tab-nuevo').style.display = tab === 'nuevo' ? 'block' : 'none';
    if (tab === 'lista') renderInv();
  };
  contextoApp.invEstado = p => {
    const q = p.qty || 0,
      m = p.minimo ?? 3;
    if (q <= 0) return 'out';
    if (q <= m) return 'low';
    return 'ok';
  };
  window.guardarInv = async function () {
    const nombre = document.getElementById('i-nombre').value.trim();
    if (!nombre) {
      showToast('Completá el producto.', true);
      return;
    }
    const entry = {
      nombre,
      categoria: document.getElementById('i-cat').value,
      sku: document.getElementById('i-sku').value.trim(),
      qty: parseInt(document.getElementById('i-qty').value) || 0,
      costo: parseFloat(document.getElementById('i-costo').value) || 0,
      moneda: document.getElementById('i-moneda').value,
      sugerido: parseFloat(document.getElementById('i-sugerido').value) || 0,
      minimo: parseInt(document.getElementById('i-minimo').value) || 3,
      proveedor: document.getElementById('i-prov').value.trim(),
      notas: document.getElementById('i-notas').value.trim(),
      createdAt: {
        seconds: Date.now() / 1000
      }
    };
    const btn = document.getElementById('btn-i-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.invCol, contextoApp.withUser({
        ...entry,
        createdAt: serverTimestamp()
      }));
      showToast('Producto agregado ✓');
      ['i-nombre', 'i-sku', 'i-qty', 'i-costo', 'i-sugerido', 'i-prov', 'i-notas'].forEach(i => document.getElementById(i).value = '');
      document.getElementById('i-minimo').value = '3';
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Agregar al inventario';
  };

  // Ajuste rápido de cantidad (+/-) con update optimista
  window.ajustarQty = async function (id, delta, ev) {
    ev.stopPropagation();
    const p = contextoApp.invItems.find(x => x.id === id);
    if (!p) return;
    const nueva = Math.max(0, (p.qty || 0) + delta);
    if (nueva === p.qty) return;
    p.qty = nueva; // optimista
    renderInv();
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'inventario', id), {
        qty: nueva
      });
    } catch (e) {
      p.qty = nueva - delta;
      renderInv();
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  contextoApp.invEditId = null;
  window.abrirInv = function (id) {
    const p = contextoApp.invItems.find(x => x.id === id);
    if (!p) return;
    contextoApp.invEditId = id;
    populateICatSelects();
    document.getElementById('im-nombre2').value = p.nombre || '';
    document.getElementById('im-cat').value = p.categoria || '';
    document.getElementById('im-sku').value = p.sku || '';
    document.getElementById('im-qty').value = p.qty || 0;
    document.getElementById('im-costo2').value = p.costo || '';
    document.getElementById('im-moneda').value = p.moneda || 'ARS';
    document.getElementById('im-sugerido').value = p.sugerido || '';
    document.getElementById('im-minimo').value = p.minimo ?? 3;
    document.getElementById('im-prov').value = p.proveedor || '';
    document.getElementById('im-notas2').value = p.notas || '';
    document.getElementById('inv-modal').classList.add('open');
  };
  window.closeInvModal = function () {
    document.getElementById('inv-modal').classList.remove('open');
    contextoApp.invEditId = null;
  };
  window.saveInvModal = async function () {
    if (!contextoApp.invEditId) return;
    const nombre = document.getElementById('im-nombre2').value.trim();
    if (!nombre) {
      showToast('Completá el producto.', true);
      return;
    }
    const p = contextoApp.invItems.find(x => x.id === contextoApp.invEditId);
    const costoNuevo = parseFloat(document.getElementById('im-costo2').value) || 0;
    const data = {
      nombre,
      categoria: document.getElementById('im-cat').value,
      sku: document.getElementById('im-sku').value.trim(),
      qty: parseInt(document.getElementById('im-qty').value) || 0,
      costo: costoNuevo,
      moneda: document.getElementById('im-moneda').value,
      sugerido: parseFloat(document.getElementById('im-sugerido').value) || 0,
      minimo: parseInt(document.getElementById('im-minimo').value) || 3,
      proveedor: document.getElementById('im-prov').value.trim(),
      notas: document.getElementById('im-notas2').value.trim()
    };
    // ¿Cambió el costo en un producto con ventas? → distinguir corrección vs reposición
    if (p && p.costo != null && costoNuevo !== p.costo) {
      const tieneVentas = contextoApp.ingresos.some(v => (v.items || []).some(ci => ci.tipo === 'inv' && ci.refId === contextoApp.invEditId));
      if (tieneVentas) {
        const esReposicion = confirm(`El costo cambió de ${p.costo} a ${costoNuevo}.\n\n` + `¿Es un PRECIO NUEVO por reposición de mercadería?\n\n` + `• ACEPTAR → precio nuevo desde HOY. Las ventas pasadas conservan el costo anterior (${p.costo}) en los reportes.\n` + `• CANCELAR → es una CORRECCIÓN de error: el costo nuevo se aplica también a las ventas pasadas.`);
        if (esReposicion) {
          const hist = [...(p.costoHist || [])];
          // registrar el costo viejo con vigencia hasta ayer (si no hay historial previo, desde siempre)
          if (!hist.length) hist.push({
            desde: '0000-01-01',
            costo: p.costo,
            moneda: p.moneda || 'USD'
          });
          hist.push({
            desde: contextoApp.today(),
            costo: costoNuevo,
            moneda: data.moneda
          });
          data.costoHist = hist;
        }
      }
    }
    const btn = document.getElementById('inv-modal-save');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'inventario', contextoApp.invEditId), data);
      showToast('Producto actualizado ✓');
      window.closeInvModal();
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  };
  window.eliminarInv = async function () {
    if (!contextoApp.invEditId) return;
    if (!confirm('¿Eliminar este producto del inventario?')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'inventario', contextoApp.invEditId));
      window.closeInvModal();
      showToast('Producto eliminado');
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };

  // ── Repuestos en reparaciones ─────────────────────────
}
