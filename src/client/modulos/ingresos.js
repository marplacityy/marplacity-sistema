/** modulos/ingresos: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, showToast } from '../core/interfaz.js';
import { setSyncDot, avisoVentana } from '../core/datos.js';
import { addDoc, serverTimestamp, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { handleStockFromIngreso } from './stock.js';
import { gananciaVentaUSD } from './costos.js';

export
// ── Ingresos ──────────────────────────────────────────

function populateIncMedioSel() {
  const sel = document.getElementById('inc-medio-sel');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = contextoApp.medios.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  sel.value = prev;
}
export function populateIncCatFilter() {
  const cats2 = [...new Set(contextoApp.ingresos.map(g => g.categoria).filter(Boolean))].sort();
  const sel = document.getElementById('inc-fl-cat');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">Todas las categorías</option>' + cats2.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = prev;
  // mes filter
  const meses = [...new Set(contextoApp.ingresos.map(g => (g.fecha || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const selM = document.getElementById('inc-fl-mes');
  const prevM = selM.value;
  selM.innerHTML = '<option value="">Todos los meses</option>' + meses.map(m => `<option value="${m}">${contextoApp.fmtMes(m)}</option>`).join('');
  selM.value = prevM;
}
export function renderIncMedioTags() {
  document.getElementById('inc-medios-tags').innerHTML = contextoApp.incMediosActuales.map((m, i) => `<div class="medio-tag"><span>${esc(m.medio)} · ${m.moneda === 'USD' ? 'u$s ' : '$ '}${m.valor.toLocaleString('es-AR')}</span><button onclick="removeIncMedio(${i})">×</button></div>`).join('');
}
export function renderIngresos() {
  populateIncCatFilter();
  const fCat = document.getElementById('inc-fl-cat').value;
  const fMes = document.getElementById('inc-fl-mes').value;
  const fBus = (document.getElementById('inc-fl-buscar').value || '').toLowerCase().trim();
  const fIncDesde = document.getElementById('inc-fl-desde').value;
  const fIncHasta = document.getElementById('inc-fl-hasta').value;
  const usingRange = fIncDesde || fIncHasta;
  let items = contextoApp.ingresos.filter(g => {
    if (usingRange) {
      if (fIncDesde && (g.fecha || '') < fIncDesde) return false;
      if (fIncHasta && (g.fecha || '') > fIncHasta) return false;
    } else {
      if (fMes && !(g.fecha || '').startsWith(fMes)) return false;
    }
    if (fCat && g.categoria !== fCat) return false;
    if (fBus && !((g.nombre || '') + ' ' + (g.clienteNombre || '') + ' v-' + (g.numVenta || '')).toLowerCase().includes(fBus)) return false;
    return true;
  });
  const totalInc = items.reduce((s, g) => s + (g.totalARS || 0), 0);
  const totalUSD = items.reduce((s, g) => s + (g.totalUSD || 0), 0);
  const ganDinM = new Map(items.map(g => [g.id, gananciaVentaUSD(g)]));
  const totalGanUSDm = items.reduce((s, g) => s + (ganDinM.get(g.id) || 0), 0);
  const totalGanARSm = items.reduce((s, g) => {
    const gu = ganDinM.get(g.id);
    const tc = g.tc || parseFloat(contextoApp.cfg.tc) || null;
    return s + (gu != null && tc ? gu * tc : g.gananciaARS || 0);
  }, 0);
  const hasGanARS = items.some(g => ganDinM.get(g.id) != null || g.gananciaARS != null);
  const hasGanUSD = items.some(g => ganDinM.get(g.id) != null);
  let ganStr = '—';
  if (hasGanARS && hasGanUSD) ganStr = contextoApp.fmtARS(totalGanARSm) + ' / ' + contextoApp.fmtUSD(totalGanUSDm);else if (hasGanARS) ganStr = contextoApp.fmtARS(totalGanARSm);else if (hasGanUSD) ganStr = contextoApp.fmtUSD(totalGanUSDm);
  const ganColor = totalGanARSm >= 0 && totalGanUSDm >= 0 ? '#237A4B' : 'var(--neg)';
  document.getElementById('inc-metrics').innerHTML = `
    <div class="metric"><div class="m-label">Ingresos ARS</div><div class="m-val" style="color:#237A4B">${totalInc > 0 ? contextoApp.fmtARS(totalInc) : '—'}</div><div class="m-sub">${items.length} ventas</div></div>
    <div class="metric"><div class="m-label">Ingresos USD</div><div class="m-val" style="color:#237A4B">${totalUSD > 0 ? contextoApp.fmtUSD(totalUSD) : '—'}</div></div>
    <div class="metric"><div class="m-label">Ganancia bruta</div><div class="m-val" style="color:${ganColor};font-size:15px;">${ganStr}</div></div>
  `;
  if (!items.length) {
    document.getElementById('inc-list-body').innerHTML = '<div class="empty">Sin ingresos en este filtro.</div>';
    return;
  }
  const _totF = items.length;
  if (_totF > 100) items = items.slice(0, 100);
  document.getElementById('inc-list-body').innerHTML = avisoVentana() + (_totF > 200 ? `<div class="empty" style="padding:.5rem;">Mostrando 100 de ${_totF} — refiná la búsqueda o el rango de fechas.</div>` : '') + items.map(g => {
    const mediosStr = g.medios && g.medios.length ? g.medios.map(m => `${esc(m.medio)} ${m.moneda === 'USD' ? 'u$s' : '$'}${Number(m.valor).toLocaleString('es-AR')}`).join(' + ') : '';
    const permutaStr = g.permuta ? ` + 💱 ${esc(g.permuta.descripcion || 'Permuta')} ${g.permuta.moneda === 'USD' ? 'u$s' : '$'}${Number(g.permuta.valor).toLocaleString('es-AR')}` : '';
    const ganValUSD = g.gananciaUSD != null && (g.totalUSD || 0) > 0 ? g.gananciaUSD : null;
    const ganValARS = g.gananciaARS != null && (g.totalARS || 0) > 0 ? g.gananciaARS : null;
    const ganDisplay = ganValUSD != null ? (ganValUSD >= 0 ? '+' : '') + contextoApp.fmtUSD(ganValUSD) : ganValARS != null ? (ganValARS >= 0 ? '+' : '') + contextoApp.fmtARS(ganValARS) : null;
    const ganColor2 = ganValUSD != null ? ganValUSD >= 0 ? 'profit-pos' : 'profit-neg' : ganValARS != null ? ganValARS >= 0 ? 'profit-pos' : 'profit-neg' : '';
    const ganStr = ganDisplay ? `<span class="${ganColor2}" style="font-size:11px;font-family:'DM Mono',monospace;font-weight:600;">${ganDisplay}</span>` : '';
    return `<div class="expense-item">
      <div class="ei-dot inc"></div>
      <div class="ei-info">
        <div class="ei-concepto">${g.numVenta ? `<span style="font-family:'DM Mono',monospace;font-weight:600;font-size:12px;">#V-${g.numVenta}</span> ` : ''}${g.itemId ? `<span style="color:var(--text3);font-weight:400;font-size:12px;">${esc(g.itemId)} </span>` : ''}${esc(g.nombre)}</div>
        <div class="ei-meta">
          <span>${g.fecha || ''}</span>
          <span class="inc-pill">${g.origen === 'pos' ? 'Factura' : 'Ingreso'}</span>
          ${(() => {
      const c = contextoApp.comprobanteDe(g.id);
      if (!c) return '';
      const num = `${String(c.ptoVta).padStart(4, '0')}-${String(c.cbteNro).padStart(8, '0')}`;
      const nc = contextoApp.notaCreditoDe(g.id);
      return c.estado === 'emitida' ? `<span class="inc-pill" style="background:${nc ? '#854F0B' : '#237A4B'};color:#fff;" title="CAE ${esc(c.cae || '')}">🧾 Factura ${c.letra} ${num}${nc ? ' · ↩️ NC ' + String(nc.cbteNro).padStart(8, '0') : ''}</span>` : `<span class="inc-pill" style="background:var(--neg);color:#fff;" title="${esc((c.errores || []).map(e => e.msg).join(' · '))}">🧾 rechazada</span>`;
    })()}
          ${g.clienteNombre ? `<span style="font-weight:500;">${esc(g.clienteNombre)}</span>` : ''}
          ${g.categoria ? `<span>${esc(g.categoria)}</span>` : ''}
          ${g.imei ? `<span style="font-family:'DM Mono',monospace;font-size:10px;">IMEI ${esc(g.imei)}</span>` : ''}
          ${g.bateria ? `<span>🔋 ${esc(g.bateria)}%</span>` : ''}
          ${g.ciclos ? `<span>${esc(g.ciclos)} ciclos</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text2);margin-top:3px;">${mediosStr}${permutaStr}</div>
        ${g.notas ? `<div style="font-size:12px;color:var(--text3);margin-top:2px;font-style:italic;">${esc(g.notas)}</div>` : ''}
      </div>
      <div class="ei-amounts">
        <div class="ei-ars" style="color:#237A4B">${contextoApp.fmtARS(g.totalARS || 0)}</div>
        ${g.totalUSD ? `<div class="ei-usd">${contextoApp.fmtUSD(g.totalUSD)}</div>` : ''}
        ${ganStr}
      </div>
      <div class="ei-actions">
        <button class="ei-btn" onclick="abrirFacturaArca('${g.id}')" title="${contextoApp.comprobanteDe(g.id) ? 'Ver la factura electrónica' : 'Emitir factura electrónica (ARCA)'}" style="color:${contextoApp.comprobanteDe(g.id) ? '#237A4B' : 'var(--text2)'};">🧾</button>
        <button class="ei-btn" onclick="enviarFacturaWa('${g.id}')" title="Enviar por WhatsApp" style="color:#1A6B3C;">📤</button>
        <button class="ei-btn" onclick="reimprimirFactura('${g.id}','termica')" title="Reimprimir ticket térmico">🖨</button>
        <button class="ei-btn" onclick="reimprimirFactura('${g.id}','a4')" title="Factura A4 (imprimir o guardar PDF)">📄</button>
        <button class="ei-btn" onclick="${g.items && g.items.length ? `abrirFE('${g.id}')` : `editarIngreso('${g.id}')`}" title="Editar">✎</button>
        <button class="ei-btn del" onclick="eliminarIngreso('${g.id}')" title="Eliminar">×</button>
      </div>
    </div>`;
  }).join('');
}

// ── Income edit modal state ──
export function renderImMedioTags() {
  document.getElementById('im-medios-tags').innerHTML = contextoApp.imMedios.map((m, i) => `<div class="medio-tag"><span>${esc(m.medio)} · ${m.moneda === 'USD' ? 'u$s ' : '$ '}${m.valor.toLocaleString('es-AR')}</span><button onclick="removeImMedio(${i})">×</button></div>`).join('');
}
export function inicializarIngresos() {
  window.togglePermuta = function () {
    const show = document.getElementById('inc-permuta').checked;
    document.getElementById('permuta-wrap').style.display = show ? 'block' : 'none';
    if (!show) {
      document.getElementById('inc-permuta-val').value = '';
      document.getElementById('inc-permuta-desc').value = '';
      document.getElementById('inc-permuta-imei').value = '';
    }
    window.calcIncProfit();
  };
  window.addIncMedio = function () {
    const sel = document.getElementById('inc-medio-sel');
    const val = parseFloat(document.getElementById('inc-medio-val').value);
    const mon = document.getElementById('inc-medio-moneda').value;
    if (!val || val <= 0) {
      showToast('Ingresá un monto', true);
      return;
    }
    contextoApp.incMediosActuales.push({
      medio: sel.value,
      valor: val,
      moneda: mon
    });
    document.getElementById('inc-medio-val').value = '';
    renderIncMedioTags();
    window.calcIncProfit();
  };
  window.removeIncMedio = function (i) {
    contextoApp.incMediosActuales.splice(i, 1);
    renderIncMedioTags();
    window.calcIncProfit();
  };
  window.calcIncProfit = function () {
    const tc = parseFloat(document.getElementById('inc-tc').value) || null;
    const hasPermuta = document.getElementById('inc-permuta').checked;
    // Rebuild medios preview
    let totalUSD = contextoApp.incMediosActuales.reduce((s, m) => s + (m.moneda === 'USD' ? m.valor : tc ? m.valor / tc : 0), 0);
    let totalARS = contextoApp.incMediosActuales.reduce((s, m) => s + (m.moneda === 'ARS' ? m.valor : tc ? m.valor * tc : 0), 0);
    if (hasPermuta) {
      const pv = parseFloat(document.getElementById('inc-permuta-val').value) || 0;
      const pm = document.getElementById('inc-permuta-moneda').value;
      if (pm === 'USD') {
        totalUSD += pv;
        if (tc) totalARS += pv * tc;
      } else {
        totalARS += pv;
        if (tc) totalUSD += pv / tc;
      }
    }
    const costo = parseFloat(document.getElementById('inc-costo').value) || 0;
    const costoMon = document.getElementById('inc-costo-moneda').value;
    const costoUSD = costoMon === 'USD' ? costo : tc ? costo / tc : null;
    const costoARSval = costoMon === 'ARS' ? costo : tc ? costo * tc : null;
    // Show in whichever currency we have
    const showUSD = totalUSD > 0;
    const ganUSD = showUSD && costoUSD != null ? totalUSD - costoUSD : null;
    const ganARS = totalARS > 0 && costoARSval != null ? totalARS - costoARSval : null;
    if (showUSD) {
      document.getElementById('pp-cobrado').textContent = 'u$s ' + totalUSD.toFixed(2) + (totalARS > 0 ? ' / ' + contextoApp.fmtARS(totalARS) : '');
      document.getElementById('pp-costo').textContent = costoUSD != null ? 'u$s ' + costoUSD.toFixed(2) + (costoARSval ? ' / ' + contextoApp.fmtARS(costoARSval) : '') : '—';
      const gEl = document.getElementById('pp-ganancia');
      if (ganUSD != null) {
        gEl.textContent = 'u$s ' + ganUSD.toFixed(2) + (ganARS != null ? ' / ' + contextoApp.fmtARS(ganARS) : '');
        gEl.className = 'profit-val ' + (ganUSD >= 0 ? 'profit-pos' : 'profit-neg');
      } else {
        gEl.textContent = '—';
        gEl.className = 'profit-val';
      }
    } else {
      document.getElementById('pp-cobrado').textContent = totalARS > 0 ? contextoApp.fmtARS(totalARS) : '—';
      document.getElementById('pp-costo').textContent = costoARSval != null ? contextoApp.fmtARS(costoARSval) : '—';
      const gEl = document.getElementById('pp-ganancia');
      if (ganARS != null) {
        gEl.textContent = contextoApp.fmtARS(ganARS) + (tc ? ' / ' + contextoApp.fmtUSD(ganARS / tc) : '');
        gEl.className = 'profit-val ' + (ganARS >= 0 ? 'profit-pos' : 'profit-neg');
      } else {
        gEl.textContent = '—';
        gEl.className = 'profit-val';
      }
    }
  };
  window.guardarIngreso = async function () {
    const nombre = document.getElementById('inc-nombre').value.trim();
    if (!nombre) {
      showToast('Completá el nombre del producto.', true);
      return;
    }
    if (contextoApp.incMediosActuales.length === 0 && !document.getElementById('inc-permuta').checked) {
      showToast('Agregá al menos un medio de cobro.', true);
      return;
    }
    const tc = parseFloat(document.getElementById('inc-tc').value) || null;
    const costo = parseFloat(document.getElementById('inc-costo').value) || null;
    const costoMon = document.getElementById('inc-costo-moneda').value;
    const hasPermuta = document.getElementById('inc-permuta').checked;
    const permuta = hasPermuta ? {
      descripcion: document.getElementById('inc-permuta-desc').value.trim(),
      valor: parseFloat(document.getElementById('inc-permuta-val').value) || 0,
      moneda: document.getElementById('inc-permuta-moneda').value,
      imei: document.getElementById('inc-permuta-imei').value.trim()
    } : null;
    // calc totals — always use TC to unify everything
    const tcUsed = tc || null;

    // Sum ALL medios to both ARS and USD (needs TC for cross-currency)
    let totalARS_calc = 0,
      totalUSD_calc = 0;
    contextoApp.incMediosActuales.forEach(m => {
      if (m.moneda === 'ARS') {
        totalARS_calc += m.valor;
        if (tcUsed) totalUSD_calc += m.valor / tcUsed;
      } else {
        totalUSD_calc += m.valor;
        if (tcUsed) totalARS_calc += m.valor * tcUsed;
      }
    });
    if (permuta) {
      if (permuta.moneda === 'ARS') {
        totalARS_calc += permuta.valor;
        if (tcUsed) totalUSD_calc += permuta.valor / tcUsed;
      } else {
        totalUSD_calc += permuta.valor;
        if (tcUsed) totalARS_calc += permuta.valor * tcUsed;
      }
    }

    // Only store ARS total if we have any ARS (or can convert from USD via TC)
    const hasARS = contextoApp.incMediosActuales.some(m => m.moneda === 'ARS') || permuta && permuta.moneda === 'ARS';
    const hasUSD = contextoApp.incMediosActuales.some(m => m.moneda === 'USD') || permuta && permuta.moneda === 'USD';
    const totalARS = hasARS || hasUSD && tcUsed ? Math.round(totalARS_calc) : null;
    const totalUSD = totalUSD_calc > 0 ? Math.round(totalUSD_calc * 100) / 100 : null;

    // Costo en ambas monedas
    const costoUSD = costo ? costoMon === 'USD' ? costo : tcUsed ? Math.round(costo / tcUsed * 100) / 100 : null : null;
    const costoARS = costo ? costoMon === 'ARS' ? costo : tcUsed ? Math.round(costo * tcUsed) : null : null;

    // Ganancia — prefer USD if available
    const gananciaUSD = totalUSD != null && costoUSD != null ? Math.round((totalUSD - costoUSD) * 100) / 100 : null;
    const gananciaARS = totalARS != null && costoARS != null ? Math.round(totalARS - costoARS) : null;
    const newInc = {
      fecha: document.getElementById('inc-fecha').value || contextoApp.today(),
      itemId: document.getElementById('inc-itemid').value.trim(),
      nombre,
      categoria: document.getElementById('inc-categoria').value,
      imei: document.getElementById('inc-imei').value.trim(),
      medios: [...contextoApp.incMediosActuales],
      permuta,
      costo,
      costoMoneda: costoMon,
      tc,
      totalARS: totalARS || null,
      totalUSD: totalUSD || null,
      gananciaARS: gananciaARS || null,
      gananciaUSD: gananciaUSD || null,
      notas: document.getElementById('inc-notas').value.trim(),
      createdAt: {
        seconds: Date.now() / 1000
      }
    };

    // Optimistic
    const tempId = 'tinc_' + Date.now();
    contextoApp.ingresos.unshift({
      id: tempId,
      ...newInc
    });
    contextoApp.ingresos.sort((a, b) => {
      const fd = (b.fecha || '').localeCompare(a.fecha || '');
      if (fd !== 0) return fd;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
    renderIngresos();
    const btn = document.getElementById('btn-inc-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      setSyncDot('syncing');
      await addDoc(contextoApp.ingresosCol, contextoApp.withUser({
        ...newInc,
        createdAt: serverTimestamp()
      }));
      handleStockFromIngreso(newInc); // fire and forget — non-blocking
      showToast('Ingreso registrado ✓');
      // Reset
      document.getElementById('inc-nombre').value = '';
      document.getElementById('inc-itemid').value = '';
      document.getElementById('inc-imei').value = '';
      document.getElementById('inc-costo').value = '';
      document.getElementById('inc-tc').value = '';
      document.getElementById('inc-notas').value = '';
      document.getElementById('inc-fecha').value = contextoApp.today();
      document.getElementById('inc-permuta').checked = false;
      document.getElementById('permuta-wrap').style.display = 'none';
      document.getElementById('inc-permuta-val').value = '';
      document.getElementById('inc-permuta-desc').value = '';
      document.getElementById('inc-permuta-imei').value = '';
      contextoApp.incMediosActuales = [];
      renderIncMedioTags();
      window.calcIncProfit();
    } catch (e) {
      contextoApp.ingresos = contextoApp.ingresos.filter(x => x.id !== tempId);
      renderIngresos();
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Registrar ingreso';
  };
  contextoApp.incEditingId = null;
  contextoApp.imMedios = []; // medios in edit modal
  window.editarIngreso = function (id) {
    const g = contextoApp.ingresos.find(x => x.id === id);
    if (!g) return;
    contextoApp.incEditingId = id;
    // Populate modal fields
    document.getElementById('im-fecha').value = g.fecha || contextoApp.today();
    document.getElementById('im-itemid').value = g.itemId || '';
    document.getElementById('im-nombre').value = g.nombre || '';
    document.getElementById('im-categoria').value = g.categoria || '';
    document.getElementById('im-imei').value = g.imei || '';
    document.getElementById('im-costo').value = g.costo || '';
    document.getElementById('im-costo-moneda').value = g.costoMoneda || 'ARS';
    document.getElementById('im-tc').value = g.tc || '';
    document.getElementById('im-notas').value = g.notas || '';
    // Medios
    contextoApp.imMedios = g.medios ? [...g.medios] : [];
    renderImMedioTags();
    // Permuta
    const hasP = !!g.permuta;
    document.getElementById('im-permuta').checked = hasP;
    document.getElementById('im-permuta-wrap').style.display = hasP ? 'block' : 'none';
    if (hasP && g.permuta) {
      document.getElementById('im-permuta-desc').value = g.permuta.descripcion || '';
      document.getElementById('im-permuta-val').value = g.permuta.valor || '';
      document.getElementById('im-permuta-moneda').value = g.permuta.moneda || 'ARS';
      document.getElementById('im-permuta-imei').value = g.permuta.imei || '';
    }
    // Populate medio select
    const sel = document.getElementById('im-medio-sel');
    sel.innerHTML = contextoApp.medios.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    window.calcImProfit();
    document.getElementById('inc-edit-modal').classList.add('open');
  };
  window.closeIncModal = function () {
    document.getElementById('inc-edit-modal').classList.remove('open');
    contextoApp.incEditingId = null;
    contextoApp.imMedios = [];
  };
  window.toggleImPermuta = function () {
    const show = document.getElementById('im-permuta').checked;
    document.getElementById('im-permuta-wrap').style.display = show ? 'block' : 'none';
    if (!show) {
      document.getElementById('im-permuta-val').value = '';
      document.getElementById('im-permuta-desc').value = '';
      document.getElementById('im-permuta-imei').value = '';
    }
    window.calcImProfit();
  };
  window.addImMedio = function () {
    const sel = document.getElementById('im-medio-sel');
    const val = parseFloat(document.getElementById('im-medio-val').value);
    const mon = document.getElementById('im-medio-moneda').value;
    if (!val || val <= 0) {
      showToast('Ingresá un monto', true);
      return;
    }
    contextoApp.imMedios.push({
      medio: sel.value,
      valor: val,
      moneda: mon
    });
    document.getElementById('im-medio-val').value = '';
    renderImMedioTags();
    window.calcImProfit();
  };
  window.removeImMedio = function (i) {
    contextoApp.imMedios.splice(i, 1);
    renderImMedioTags();
    window.calcImProfit();
  };
  window.calcImProfit = function () {
    const tc = parseFloat(document.getElementById('im-tc').value) || null;
    const hasPermuta = document.getElementById('im-permuta').checked;
    let totalUSD = 0,
      totalARS = 0;
    contextoApp.imMedios.forEach(m => {
      if (m.moneda === 'USD') {
        totalUSD += m.valor;
        if (tc) totalARS += m.valor * tc;
      } else {
        totalARS += m.valor;
        if (tc) totalUSD += m.valor / tc;
      }
    });
    if (hasPermuta) {
      const pv = parseFloat(document.getElementById('im-permuta-val').value) || 0;
      const pm = document.getElementById('im-permuta-moneda').value;
      if (pm === 'USD') {
        totalUSD += pv;
        if (tc) totalARS += pv * tc;
      } else {
        totalARS += pv;
        if (tc) totalUSD += pv / tc;
      }
    }
    const costo = parseFloat(document.getElementById('im-costo').value) || 0;
    const costoMon = document.getElementById('im-costo-moneda').value;
    const costoUSD = costoMon === 'USD' ? costo : tc ? costo / tc : null;
    const costoARSv = costoMon === 'ARS' ? costo : tc ? costo * tc : null;
    const showUSD = totalUSD > 0;
    if (showUSD) {
      document.getElementById('im-pp-cobrado').textContent = 'u$s ' + totalUSD.toFixed(2) + (totalARS > 0 ? ' / ' + contextoApp.fmtARS(totalARS) : '');
      document.getElementById('im-pp-costo').textContent = costoUSD != null ? 'u$s ' + costoUSD.toFixed(2) + (costoARSv ? ' / ' + contextoApp.fmtARS(costoARSv) : '') : '—';
      const g = document.getElementById('im-pp-ganancia');
      const ganU = costoUSD != null ? totalUSD - costoUSD : null;
      if (ganU != null) {
        g.textContent = 'u$s ' + ganU.toFixed(2);
        g.className = 'profit-val ' + (ganU >= 0 ? 'profit-pos' : 'profit-neg');
      } else {
        g.textContent = '—';
        g.className = 'profit-val';
      }
    } else {
      document.getElementById('im-pp-cobrado').textContent = totalARS > 0 ? contextoApp.fmtARS(totalARS) : '—';
      document.getElementById('im-pp-costo').textContent = costoARSv != null ? contextoApp.fmtARS(costoARSv) : '—';
      const g = document.getElementById('im-pp-ganancia');
      const ganA = costoARSv != null ? totalARS - costoARSv : null;
      if (ganA != null) {
        g.textContent = contextoApp.fmtARS(ganA) + (tc ? ' / ' + contextoApp.fmtUSD(ganA / tc) : '');
        g.className = 'profit-val ' + (ganA >= 0 ? 'profit-pos' : 'profit-neg');
      } else {
        g.textContent = '—';
        g.className = 'profit-val';
      }
    }
  };
  window.saveIncModal = async function () {
    if (!contextoApp.incEditingId) return;
    const nombre = document.getElementById('im-nombre').value.trim();
    if (!nombre) {
      showToast('Completá el nombre.', true);
      return;
    }
    if (contextoApp.imMedios.length === 0 && !document.getElementById('im-permuta').checked) {
      showToast('Agregá al menos un medio de cobro.', true);
      return;
    }
    const tc = parseFloat(document.getElementById('im-tc').value) || null;
    const costo = parseFloat(document.getElementById('im-costo').value) || null;
    const costoMon = document.getElementById('im-costo-moneda').value;
    const hasPermuta = document.getElementById('im-permuta').checked;
    const permuta = hasPermuta ? {
      descripcion: document.getElementById('im-permuta-desc').value.trim(),
      valor: parseFloat(document.getElementById('im-permuta-val').value) || 0,
      moneda: document.getElementById('im-permuta-moneda').value,
      imei: document.getElementById('im-permuta-imei').value.trim()
    } : null;
    // Same calc logic as guardarIngreso
    let totalARS_c = 0,
      totalUSD_c = 0;
    contextoApp.imMedios.forEach(m => {
      if (m.moneda === 'ARS') {
        totalARS_c += m.valor;
        if (tc) totalUSD_c += m.valor / tc;
      } else {
        totalUSD_c += m.valor;
        if (tc) totalARS_c += m.valor * tc;
      }
    });
    if (permuta) {
      if (permuta.moneda === 'ARS') {
        totalARS_c += permuta.valor;
        if (tc) totalUSD_c += permuta.valor / tc;
      } else {
        totalUSD_c += permuta.valor;
        if (tc) totalARS_c += permuta.valor * tc;
      }
    }
    const hasARS = contextoApp.imMedios.some(m => m.moneda === 'ARS') || permuta && permuta.moneda === 'ARS';
    const hasUSD = contextoApp.imMedios.some(m => m.moneda === 'USD') || permuta && permuta.moneda === 'USD';
    const totalARS = hasARS || hasUSD && tc ? Math.round(totalARS_c) : null;
    const totalUSD = totalUSD_c > 0 ? Math.round(totalUSD_c * 100) / 100 : null;
    const costoUSD = costo ? costoMon === 'USD' ? costo : tc ? Math.round(costo / tc * 100) / 100 : null : null;
    const costoARS = costo ? costoMon === 'ARS' ? costo : tc ? Math.round(costo * tc) : null : null;
    const gananciaUSD = totalUSD != null && costoUSD != null ? Math.round((totalUSD - costoUSD) * 100) / 100 : null;
    const gananciaARS = totalARS != null && costoARS != null ? Math.round(totalARS - costoARS) : null;
    const data = {
      fecha: document.getElementById('im-fecha').value || contextoApp.today(),
      itemId: document.getElementById('im-itemid').value.trim(),
      nombre,
      categoria: document.getElementById('im-categoria').value,
      imei: document.getElementById('im-imei').value.trim(),
      medios: [...contextoApp.imMedios],
      permuta,
      costo,
      costoMoneda: costoMon,
      tc,
      totalARS,
      totalUSD,
      gananciaARS,
      gananciaUSD,
      notas: document.getElementById('im-notas').value.trim()
    };
    const btn = document.getElementById('inc-modal-save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'ingresos', contextoApp.incEditingId), data);
      handleStockFromIngreso(data); // fire and forget — non-blocking
      showToast('Ingreso actualizado ✓');
      window.closeIncModal();
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  };

  // Close on backdrop click
  document.getElementById('inc-edit-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeIncModal();
  });
  window.eliminarIngreso = async function (id) {
    const v = contextoApp.ingresos.find(x => x.id === id);
    if (!v) return;
    const tieneItems = (v.items || []).length > 0;
    const msg = tieneItems ? '¿Eliminar esta factura?\n\nLos productos vuelven al stock:\n' + v.items.map(ci => '• ' + (ci.qty > 1 ? ci.qty + 'x ' : '') + ci.nombre).join('\n') : '¿Eliminar este ingreso?';
    if (!confirm(msg)) return;
    setSyncDot('syncing');
    try {
      // ── Revertir stock de cada item ──
      for (const ci of v.items || []) {
        if (ci.tipo === 'inv') {
          // devolver unidades al inventario
          const p = contextoApp.invItems.find(x => x.id === ci.refId);
          if (p) await updateDoc(doc(contextoApp.db, 'inventario', ci.refId), {
            qty: (p.qty || 0) + (ci.qty || 1)
          });
        } else if (ci.tipo === 'eq') {
          // el equipo vuelve a estar en stock
          const s = contextoApp.stockItems.find(x => x.id === ci.refId);
          if (s) await updateDoc(doc(contextoApp.db, 'stock', ci.refId), {
            status: 'en_stock',
            fechaVenta: null,
            ingresoVentaNombre: null
          });
        } else if (ci.tipo === 'consig') {
          const x = contextoApp.consigItems.find(y => y.id === ci.refId);
          if (x) await updateDoc(doc(contextoApp.db, 'consig', ci.refId), {
            status: 'en_stock',
            fechaVenta: null
          });
        } else if (ci.tipo === 'rep') {
          // renace el saldo de la reparación
          const r = contextoApp.reps.find(y => y.id === ci.refId);
          if (r) {
            const saldo = ci.precio || 0;
            const hist = [...(r.historial || []), {
              fecha: contextoApp.today(),
              texto: 'Factura de cobro eliminada → saldo restaurado'
            }];
            await updateDoc(doc(contextoApp.db, 'reparaciones', ci.refId), {
              saldo,
              sena: (r.precio || 0) - saldo,
              estado: 'avisado',
              historial: hist
            });
          }
        }
      }
      // ── Revertir permuta que entró al stock de equipos ──
      if (v.permuta && (v.permuta.imei || v.permuta.descripcion)) {
        let match = null;
        if (v.permuta.imei) match = contextoApp.stockItems.find(s => (s.imei || '').trim() === (v.permuta.imei || '').trim() && s.status === 'en_stock');
        if (!match) match = contextoApp.stockItems.find(s => s.origenIngreso === v.nombre && s.status === 'en_stock' && s.nombre === (v.permuta.descripcion || ''));
        if (match) await deleteDoc(doc(contextoApp.db, 'stock', match.id));
      }
      await deleteDoc(doc(contextoApp.db, 'ingresos', id));
      showToast('Factura eliminada — stock restaurado ✓');
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      showToast('Error al eliminar: ' + e.message, true);
      setSyncDot('error');
    }
  };

  // ── Diagnóstico ──
}
