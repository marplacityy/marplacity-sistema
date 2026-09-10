/** modulos/gastos: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { showToast, esc, populateCatSelects, populateMedioSelects } from '../core/interfaz.js';
import { renderReporte } from './reportes.js';
import { setSyncDot, avisoVentana, fechasPreset } from '../core/datos.js';
import { addDoc, serverTimestamp, updateDoc, doc, deleteDoc } from 'firebase/firestore';

export
// ── Month chips ──
function buildMonthChips() {
  const meses = [...new Set(contextoApp.gastos.map(g => (g.fecha || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const container = document.getElementById('month-chips');
  container.innerHTML = `<button class="mchip all ${contextoApp.activeMonth === '' ? 'active' : ''}" onclick="setMonth('')">Todos</button>` + meses.map(m => `<button class="mchip ${contextoApp.activeMonth === m ? 'active' : ''}" onclick="setMonth('${m}')">${contextoApp.fmtMes(m)}</button>`).join('');
}
export
// ── Listado ──
function refreshDropdowns() {
  // Llama solo cuando cambia la lista de gastos, no en cada filtro
  const fCat = document.getElementById('fl-cat').value;
  const fMed = document.getElementById('fl-medio').value;
  const cats2 = [...new Set(contextoApp.gastos.map(g => g.categoria).filter(Boolean))].sort();
  const meds = [...new Set(contextoApp.gastos.map(g => g.medio).filter(Boolean))].sort();
  // Solo reconstruir si los valores cambiaron de verdad
  const newCatHTML = '<option value="">Todas las categorías</option>' + cats2.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const newMedHTML = '<option value="">Todos los medios</option>' + meds.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  document.getElementById('fl-cat').innerHTML = newCatHTML;
  document.getElementById('fl-medio').innerHTML = newMedHTML;
  document.getElementById('fl-cat').value = fCat;
  document.getElementById('fl-medio').value = fMed;
}
export function renderListado() {
  const fTipo = document.getElementById('fl-tipo').value;
  const fCat = document.getElementById('fl-cat').value;
  const fMed = document.getElementById('fl-medio').value;
  const fEstado = document.getElementById('fl-estado').value;
  const fBus = (document.getElementById('fl-buscar').value || '').toLowerCase().trim();
  const fDesde = document.getElementById('fl-desde').value;
  const fHasta = document.getElementById('fl-hasta').value;
  let items = contextoApp.gastos.filter(g => {
    if (fDesde && (g.fecha || '') < fDesde) return false;
    if (fHasta && (g.fecha || '') > fHasta) return false;
    if (!fDesde && !fHasta && contextoApp.activeMonth && !(g.fecha || '').startsWith(contextoApp.activeMonth)) return false;
    if (fTipo && g.tipo !== fTipo) return false;
    if (fCat && g.categoria !== fCat) return false;
    if (fMed && g.medio !== fMed) return false;
    if (fEstado === 'pagado' && g.pagado === false) return false;
    if (fEstado === 'pendiente' && g.pagado !== false) return false;
    if (fBus && !(g.concepto || '').toLowerCase().includes(fBus)) return false;
    return true;
  });
  const totalARS = items.filter(g => g.moneda === 'ARS').reduce((s, g) => s + g.monto, 0);
  const totalUSD = items.reduce((s, g) => s + (g.usd || 0), 0);
  const negUSD = items.filter(g => g.tipo === 'negocio').reduce((s, g) => s + (g.usd || 0), 0);
  const perUSD = items.filter(g => g.tipo === 'personal').reduce((s, g) => s + (g.usd || 0), 0);
  document.getElementById('listado-metrics').innerHTML = `
    <div class="metric"><div class="m-label">Total ARS</div><div class="m-val">${contextoApp.fmtARS(totalARS)}</div><div class="m-sub">${items.length} registros</div></div>
    <div class="metric"><div class="m-label">Total USD</div><div class="m-val">${contextoApp.fmtUSD(totalUSD)}</div></div>
    <div class="metric"><div class="m-label">Negocio</div><div class="m-val">${contextoApp.fmtUSD(negUSD)}</div></div>
    <div class="metric"><div class="m-label">Personal</div><div class="m-val">${contextoApp.fmtUSD(perUSD)}</div></div>
  `;
  if (!items.length) {
    document.getElementById('listado-body').innerHTML = '<div class="empty">Sin gastos en este filtro.</div>';
    return;
  }

  // Tope de filas: las métricas de arriba siguen calculadas sobre TODO el filtro,
  // solo se acota el DOM (miles de filas congelan el navegador).
  const _totG = items.length;
  if (_totG > 100) items = items.slice(0, 100);
  document.getElementById('listado-body').innerHTML = avisoVentana() + (_totG > 100 ? `<div class="empty" style="padding:.5rem;">Mostrando 100 de ${_totG} — refiná los filtros para ver el resto.</div>` : '') + items.map(g => {
    const pagado = g.pagado !== false;
    const hoy = contextoApp.today();
    const venc = g.vencimiento || null;
    const vencido = venc && venc < hoy && !pagado;
    const venceProx = venc && venc >= hoy && !pagado;
    let statusHtml = '';
    if (pagado) statusHtml = '<span class="status-pagado">✓ Pagado</span>';else if (vencido) statusHtml = '<span class="status-vencido">✗ Vencido</span>';else statusHtml = '<span class="status-pendiente">✗ Pendiente</span>';
    let vencHtml = '';
    if (venc && !pagado) {
      if (vencido) vencHtml = `<span class="status-vencido" style="font-size:10px;">Venció ${venc}</span>`;else vencHtml = `<span class="status-vence">Vence ${venc}</span>`;
    } else if (venc && pagado) {
      vencHtml = `<span style="font-size:11px;color:var(--text3);">Vencía ${venc}</span>`;
    }
    return `<div class="expense-item">
      <div class="ei-dot ${g.tipo}"></div>
      <div class="ei-info">
        <div class="ei-concepto">${esc(g.concepto)}</div>
        <div class="ei-meta">
          <span>${g.fecha || ''}</span>
          <span class="badge badge-${g.tipo}">${g.tipo}</span>
          ${statusHtml}
          ${vencHtml}
          ${g.categoria ? `<span>${esc(g.categoria)}</span>` : ''}
          ${g.medio ? `<span>${esc(g.medio)}</span>` : ''}
        </div>
        ${g.notas ? `<div style="font-size:12px;color:var(--text3);margin-top:3px;font-style:italic;">${esc(g.notas)}</div>` : ''}
      </div>
      <div class="ei-amounts">
        <div class="ei-ars">${g.moneda === 'ARS' ? contextoApp.fmtARS(g.monto) : 'u$s ' + g.monto}</div>
        ${g.usd && g.moneda === 'ARS' ? `<div class="ei-usd">${contextoApp.fmtUSD(g.usd)}</div>` : ''}
      </div>
      <div class="ei-actions">
        <button class="pay-toggle" onclick="togglePagado('${g.id}',${pagado})" title="${pagado ? 'Marcar como pendiente' : 'Marcar como pagado'}">${pagado ? '✅' : '⬜'}</button>
        <button class="ei-btn" onclick="editarGasto('${g.id}')" title="Editar">✎</button>
        <button class="ei-btn" onclick="duplicarGasto('${g.id}')" title="Duplicar">⧉</button>
        <button class="ei-btn del" onclick="eliminar('${g.id}')" title="Eliminar">×</button>
      </div>
    </div>`;
  }).join('');
}
export function populateModal(g) {
  contextoApp.modalTipo = g.tipo || 'negocio';
  document.getElementById('modal-btn-neg').classList.toggle('active', contextoApp.modalTipo === 'negocio');
  document.getElementById('modal-btn-per').classList.toggle('active', contextoApp.modalTipo === 'personal');
  document.getElementById('m-concepto').value = g.concepto || '';
  populateCatSelects();
  populateMedioSelects();
  document.getElementById('m-categoria').value = g.categoria || '';
  document.getElementById('m-monto').value = g.monto || '';
  document.getElementById('m-moneda').value = g.moneda || 'ARS';
  document.getElementById('m-tc').value = g.tc || '';
  document.getElementById('m-equiv').value = g.usd || '';
  document.getElementById('m-fecha').value = g.fecha || contextoApp.today();
  document.getElementById('m-medio').value = g.medio || '';
  document.getElementById('m-notas').value = g.notas || '';
  document.getElementById('m-pagado').checked = g.pagado !== false;
  const hasVenc = !!g.vencimiento;
  document.getElementById('m-tiene-vencimiento').checked = hasVenc;
  document.getElementById('m-vencimiento-wrap').style.display = hasVenc ? 'block' : 'none';
  document.getElementById('m-vencimiento').value = g.vencimiento || '';
  const isUSD = g.moneda === 'USD';
  document.getElementById('m-tc-wrap').style.display = isUSD ? 'none' : 'block';
  document.getElementById('m-equiv-wrap').style.display = isUSD ? 'none' : 'block';
}
export function getRange(p) {
  const now = new Date();
  if (p === 'custom') {
    const desde = document.getElementById('rep-desde').value;
    const hasta = document.getElementById('rep-hasta').value;
    return [desde || '0000-01-01', hasta || '9999-12-31'];
  }
  if (p === 'hoy') {
    const r = fechasPreset('hoy');
    return [r.d, r.h];
  }
  if (p === 'semana') {
    const r = fechasPreset('semana');
    return [r.d, r.h];
  }
  if (p === 'mesant') {
    const r = fechasPreset('mesant');
    return [r.d, r.h];
  }
  if (p === 'mes') {
    const y = now.getFullYear(),
      m = now.getMonth();
    return [contextoApp.isoLocal(new Date(y, m, 1)), contextoApp.isoLocal(new Date(y, m + 1, 0))];
  }
  if (p === 'semana') {
    const d = new Date(now);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    const s = contextoApp.isoLocal(d);
    d.setDate(d.getDate() + 6);
    return [s, contextoApp.isoLocal(d)];
  }
  if (p === 'anio') return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
  return ['0000-01-01', '9999-12-31'];
}

// ── Ingresos ──────────────────────────────────────────
export function inicializarGastos() {
  // ── Guardar nuevo gasto ──
  window.guardar = async function () {
    const concepto = document.getElementById('concepto').value.trim();
    const monto = parseFloat(document.getElementById('monto').value);
    if (!concepto) {
      showToast('Completá el concepto.', true);
      return;
    }
    if (!monto || monto <= 0) {
      showToast('Completá el monto.', true);
      return;
    }
    const moneda = document.getElementById('moneda').value;
    const tc = parseFloat(document.getElementById('tc').value) || null;
    const usd = moneda === 'USD' ? monto : tc ? Math.round(monto / tc * 100) / 100 : null;
    const btn = document.getElementById('btn-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    const newData = {
      fecha: document.getElementById('fecha').value || contextoApp.today(),
      tipo: contextoApp.tipoActual,
      concepto,
      categoria: document.getElementById('categoria').value,
      monto,
      moneda,
      tc,
      usd,
      medio: document.getElementById('medio').value,
      notas: document.getElementById('notas').value.trim(),
      pagado: document.getElementById('pagado').checked,
      vencimiento: document.getElementById('tiene-vencimiento').checked ? document.getElementById('vencimiento').value || null : null,
      createdAt: {
        seconds: Date.now() / 1000
      }
    };
    // Actualización optimista: mostrar inmediatamente sin esperar Firebase
    const tempId = 'temp_' + Date.now();
    contextoApp.gastos.unshift({
      id: tempId,
      ...newData
    });
    contextoApp.gastos.sort((a, b) => {
      const fd = (b.fecha || '').localeCompare(a.fecha || '');
      if (fd !== 0) return fd;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
    buildMonthChips();
    if (contextoApp.currentPage === 'listado') {
      refreshDropdowns();
      renderListado();
    }
    if (contextoApp.currentPage === 'reportes') renderReporte();
    document.getElementById('concepto').value = '';
    document.getElementById('monto').value = '';
    document.getElementById('notas').value = '';
    document.getElementById('equiv-usd').value = '';
    document.getElementById('fecha').value = contextoApp.today();
    document.getElementById('pagado').checked = true;
    document.getElementById('tiene-vencimiento').checked = false;
    document.getElementById('vencimiento-wrap').style.display = 'none';
    document.getElementById('vencimiento').value = '';
    try {
      setSyncDot('syncing');
      await addDoc(contextoApp.gastosCol, contextoApp.withUser({
        ...newData,
        createdAt: serverTimestamp()
      }));
      showToast('Gasto guardado ✓');
    } catch (e) {
      // Revertir si falla
      contextoApp.gastos = contextoApp.gastos.filter(g => g.id !== tempId);
      if (contextoApp.currentPage === 'listado') renderListado();
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar gasto';
  };
  window.setMonth = function (m) {
    contextoApp.activeMonth = m;
    buildMonthChips();
    renderListado();
  };
  window.togglePagado = async function (id, current) {
    // Optimistic
    const g = contextoApp.gastos.find(x => x.id === id);
    if (g) {
      g.pagado = !current;
      renderListado();
    }
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'gastos', id), {
        pagado: !current
      });
    } catch (e) {
      if (g) g.pagado = current;
      renderListado();
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.eliminar = async function (id) {
    if (!confirm('¿Eliminar este gasto?')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'gastos', id));
    } catch (e) {
      showToast('Error al eliminar', true);
      setSyncDot('error');
    }
  };
  window.duplicarGasto = async function (id) {
    const g = contextoApp.gastos.find(x => x.id === id);
    if (!g) return;
    const {
      id: _,
      ...data
    } = g;
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.gastosCol, contextoApp.withUser({
        ...data,
        fecha: contextoApp.today()
      }));
      showToast('Gasto duplicado ✓');
    } catch (e) {
      showToast('Error al duplicar', true);
      setSyncDot('error');
    }
  };

  // ── Edit modal ──
  window.editarGasto = function (id) {
    const g = contextoApp.gastos.find(x => x.id === id);
    if (!g) return;
    contextoApp.editingId = id;
    contextoApp.modalMode = 'edit';
    document.getElementById('modal-title').textContent = 'Editar gasto';
    document.getElementById('modal-save-btn').textContent = 'Guardar cambios';
    populateModal(g);
    document.getElementById('edit-modal').classList.add('open');
  };
  window.closeModal = function () {
    document.getElementById('edit-modal').classList.remove('open');
    contextoApp.editingId = null;
    contextoApp.modalMode = null;
  };
  window.setModalTipo = function (t) {
    contextoApp.modalTipo = t;
    document.getElementById('modal-btn-neg').classList.toggle('active', t === 'negocio');
    document.getElementById('modal-btn-per').classList.toggle('active', t === 'personal');
  };
  window.onModalMonedaChange = function () {
    const isUSD = document.getElementById('m-moneda').value === 'USD';
    document.getElementById('m-tc-wrap').style.display = isUSD ? 'none' : 'block';
    document.getElementById('m-equiv-wrap').style.display = isUSD ? 'none' : 'block';
    window.calcModalEquiv();
  };
  window.calcModalEquiv = function () {
    const m = parseFloat(document.getElementById('m-monto').value) || 0;
    const tc = parseFloat(document.getElementById('m-tc').value) || 0;
    document.getElementById('m-equiv').value = tc > 0 && m > 0 ? (m / tc).toFixed(2) : '';
  };
  window.saveModal = async function () {
    const concepto = document.getElementById('m-concepto').value.trim();
    const monto = parseFloat(document.getElementById('m-monto').value);
    if (!concepto) {
      showToast('Completá el concepto.', true);
      return;
    }
    if (!monto || monto <= 0) {
      showToast('Completá el monto.', true);
      return;
    }
    const moneda = document.getElementById('m-moneda').value;
    const tc = parseFloat(document.getElementById('m-tc').value) || null;
    const usd = moneda === 'USD' ? monto : tc ? Math.round(monto / tc * 100) / 100 : null;
    const data = {
      fecha: document.getElementById('m-fecha').value || contextoApp.today(),
      tipo: contextoApp.modalTipo,
      concepto,
      categoria: document.getElementById('m-categoria').value,
      monto,
      moneda,
      tc,
      usd,
      medio: document.getElementById('m-medio').value,
      notas: document.getElementById('m-notas').value.trim(),
      pagado: document.getElementById('m-pagado').checked,
      vencimiento: document.getElementById('m-tiene-vencimiento').checked ? document.getElementById('m-vencimiento').value || null : null
    };
    const btn = document.getElementById('modal-save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'gastos', contextoApp.editingId), data);
      showToast('Gasto actualizado ✓');
      window.closeModal();
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  };

  // Close modal on backdrop click
  document.getElementById('edit-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeModal();
  });

  // ── Reportes ──
  window.setPeriod = function (p, btn) {
    contextoApp.currentPeriod = p;
    document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('rep-date-range').style.display = p === 'custom' ? 'flex' : 'none';
    renderReporte();
  };
}
