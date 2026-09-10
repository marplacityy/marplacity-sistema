/** modulos/gastos-fijos: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, showToast } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { addDoc, serverTimestamp, deleteDoc, doc, writeBatch } from 'firebase/firestore';

export
// ── Gastos Fijos ──────────────────────────────────────

function populateGFSelects() {
  const catEl = document.getElementById('gf-cat');
  if (catEl) catEl.innerHTML = '<option value="">Sin categoría</option>' + contextoApp.cats.map(x => `<option>${esc(x)}</option>`).join('');
  const medEl = document.getElementById('gf-medio');
  if (medEl) medEl.innerHTML = '<option value="">— opcional —</option>' + contextoApp.medios.map(x => `<option>${esc(x)}</option>`).join('');
  const gfpMed = document.getElementById('gfp-medio');
  if (gfpMed) gfpMed.innerHTML = '<option value="">— opcional —</option>' + contextoApp.medios.map(x => `<option>${esc(x)}</option>`).join('');
}
export function calcProxVenc(diaVenc) {
  if (!diaVenc) return null;
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-indexed
  // If we're past the due day this month, next venc is next month
  if (now.getDate() >= diaVenc) month++;
  if (month > 11) {
    month = 0;
    year++;
  }
  const d = Math.min(diaVenc, new Date(year, month + 1, 0).getDate());
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function getGFStatus(fijo) {
  const pagos = contextoApp.pagosFijosItems.filter(p => p.fijoId === fijo.id).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const lastPago = pagos[0] || null;
  const hoy = contextoApp.today();
  const diasAlerta = fijo.diasAlerta || 5;

  // El seguimiento de vencimiento es OPCIONAL. Solo se activa si el gasto fijo
  // tiene un día de vencimiento configurado (fijo.diaVenc).
  if (!fijo.diaVenc) {
    // Sin vencimiento configurado: solo registramos pagos, nunca marca vencido.
    return {
      lastPago,
      proxVenc: null,
      status: 'sin_venc',
      pagos
    };
  }

  // El próximo vencimiento sale del último pago (si el usuario lo fijó) o se calcula.
  // Pero si ese proxVenc ya pasó y HAY un pago posterior o del mismo ciclo, se recalcula.
  let proxVenc = lastPago?.proxVenc || calcProxVenc(fijo.diaVenc);
  // Si el proxVenc guardado quedó viejo pero el último pago es reciente, recalcular desde hoy
  if (proxVenc && proxVenc < hoy && lastPago && lastPago.fecha) {
    const recalc = calcProxVencDesde(fijo.diaVenc, lastPago.fecha);
    if (recalc && recalc > proxVenc) proxVenc = recalc;
  }
  let status = 'al_dia';
  if (proxVenc) {
    const diff = (new Date(proxVenc) - new Date(hoy)) / (1000 * 60 * 60 * 24);
    if (diff < 0) status = 'vencido';else if (diff <= diasAlerta) status = 'proximo';else status = 'al_dia';
  }
  return {
    lastPago,
    proxVenc,
    status,
    pagos
  };
}

// Próximo vencimiento a partir de una fecha base (el último pago)
export function calcProxVencDesde(diaVenc, fechaBase) {
  if (!diaVenc || !fechaBase) return null;
  const base = new Date(fechaBase);
  let year = base.getFullYear();
  let month = base.getMonth() + 1; // el ciclo siguiente al del pago
  if (month > 11) {
    month = 0;
    year++;
  }
  const d = Math.min(diaVenc, new Date(year, month + 1, 0).getDate());
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function statusBadge(status) {
  if (status === 'sin_venc') return '<span style="color:var(--text3);font-size:12px;">— sin vencim.</span>';
  if (status === 'al_dia') return '<span class="gf-status gf-ok">✓ Al día</span>';
  if (status === 'proximo') return '<span class="gf-status gf-warn">⚡ Por vencer</span>';
  if (status === 'vencido') return '<span class="gf-status gf-late">✗ Vencido</span>';
  return '<span class="gf-status gf-none">— Sin datos</span>';
}
export function renderFijos() {
  ['negocio', 'personal'].forEach(tipo => {
    const items = contextoApp.fijosItems.filter(f => f.tipo === tipo);
    const tbody = document.getElementById('gf-' + tipo.slice(0, 3) + '-body');
    const summary = document.getElementById('gf-' + tipo.slice(0, 3) + '-summary');
    if (!tbody) return;
    let totalMensual = 0;
    let vencidos = 0,
      proximos = 0,
      alDia = 0;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:2rem;">Sin gastos fijos. Agregá uno desde el tab "+ Agregar".</td></tr>`;
      if (summary) summary.innerHTML = '';
      return;
    }
    tbody.innerHTML = items.map(f => {
      const {
        lastPago,
        proxVenc,
        status
      } = getGFStatus(f);
      if (status === 'vencido') vencidos++;else if (status === 'proximo') proximos++;else if (status === 'al_dia') alDia++;
      const importe = lastPago?.importe || f.importe || 0;
      const moneda = lastPago?.moneda || f.moneda || 'ARS';
      if (moneda === 'ARS') totalMensual += importe;
      const importeStr = importe ? moneda === 'ARS' ? contextoApp.fmtARS(importe) : 'u$s ' + importe : '<span style="color:var(--text3)">Variable</span>';
      return `<tr>
        <td>
          <div class="gf-nombre">${esc(f.nombre)}</div>
          ${f.idCuenta ? `<div class="gf-id">${esc(f.idCuenta)}</div>` : ''}
          ${f.notas ? `<div class="gf-id">${esc(f.notas)}</div>` : ''}
        </td>
        <td>
          ${lastPago ? `<div style="font-size:13px;">${lastPago.fecha}</div><div class="gf-id">${lastPago.comprobante ? esc(lastPago.comprobante) : ''}</div>` : '<span style="color:var(--text3);font-size:13px;">—</span>'}
        </td>
        <td style="font-size:13px;">${proxVenc ? proxVenc : '<span style="color:var(--text3)">—</span>'}</td>
        <td style="font-size:13px;">${esc(lastPago?.medio || f.medio || '—')}</td>
        <td class="gf-monto">${importeStr}</td>
        <td>${statusBadge(status)}</td>
        <td style="display:flex;gap:4px;flex-wrap:wrap;">
          <button class="btn-pagar" onclick="abrirPagoFijo('${f.id}')">💳 Pagar</button>
          <button class="btn-pagar-outline" onclick="verHistorialFijo('${f.id}')" title="Historial de pagos">📋</button>
          <button class="btn-pagar-outline" onclick="eliminarFijo('${f.id}')">×</button>
        </td>
      </tr>`;
    }).join('');
    if (summary) summary.innerHTML = `
      <div class="gf-summary-item"><div class="label">Total mensual ARS</div><div class="val" style="color:var(--text)">${contextoApp.fmtARS(totalMensual)}</div></div>
      <div class="gf-summary-item"><div class="label">Vencidos</div><div class="val" style="color:${vencidos ? 'var(--neg)' : 'var(--text3)'}">${vencidos}</div></div>
      <div class="gf-summary-item"><div class="label">Por vencer</div><div class="val" style="color:${proximos ? '#854F0B' : 'var(--text3)'}">${proximos}</div></div>
      <div class="gf-summary-item"><div class="label">Al día</div><div class="val" style="color:#237A4B">${alDia}</div></div>
    `;
  });
}
export function inicializarGastosFijos() {
  window.setFijosTab = function (tab, btn) {
    contextoApp.gfTabActual = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['negocio', 'personal', 'nuevo'].forEach(t => {
      const el = document.getElementById('fijos-tab-' + t);
      if (el) el.style.display = t === tab ? 'block' : 'none';
    });
    if (tab !== 'nuevo') renderFijos();
  };
  window.setGFTipo = function (t) {
    contextoApp.gfTipoActual = t;
    document.getElementById('gf-btn-neg').classList.toggle('active', t === 'negocio');
    document.getElementById('gf-btn-per').classList.toggle('active', t === 'personal');
  };
  window.guardarFijo = async function () {
    const nombre = document.getElementById('gf-nombre').value.trim();
    if (!nombre) {
      showToast('Completá el nombre.', true);
      return;
    }
    const entry = {
      nombre,
      tipo: contextoApp.gfTipoActual,
      categoria: document.getElementById('gf-cat').value,
      idCuenta: document.getElementById('gf-id-cuenta').value.trim(),
      importe: parseFloat(document.getElementById('gf-importe').value) || 0,
      moneda: document.getElementById('gf-moneda').value,
      medio: document.getElementById('gf-medio').value,
      diaVenc: parseInt(document.getElementById('gf-dia-venc').value) || null,
      diasAlerta: parseInt(document.getElementById('gf-dias-alerta').value) || 5,
      notas: document.getElementById('gf-notas').value.trim(),
      createdAt: {
        seconds: Date.now() / 1000
      }
    };
    const btn = document.getElementById('btn-gf-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.fijosCol, contextoApp.withUser({
        ...entry,
        createdAt: serverTimestamp()
      }));
      showToast('Gasto fijo agregado ✓');
      ['gf-nombre', 'gf-id-cuenta', 'gf-importe', 'gf-dia-venc', 'gf-notas'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('gf-dias-alerta').value = '5';
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Agregar gasto fijo';
  };
  contextoApp.gfPagoFijoId = null;
  window.calcGFPUsd = function () {
    const imp = parseFloat(document.getElementById('gfp-importe').value) || 0;
    const mon = document.getElementById('gfp-moneda').value;
    const tc = parseFloat(document.getElementById('gfp-tc').value) || null;
    const out = document.getElementById('gfp-usd');
    if (mon === 'USD') {
      out.value = imp ? 'u$s ' + imp : '';
      return;
    }
    out.value = imp && tc ? 'u$s ' + (Math.round(imp / tc * 100) / 100).toLocaleString('es-AR') : '';
  };
  window.abrirPagoFijo = function (id) {
    const f = contextoApp.fijosItems.find(x => x.id === id);
    if (!f) return;
    contextoApp.gfPagoFijoId = id;
    document.getElementById('gf-pago-modal-title').textContent = 'Pagar — ' + f.nombre;
    document.getElementById('gfp-fecha').value = contextoApp.today();
    document.getElementById('gfp-importe').value = f.importe || '';
    document.getElementById('gfp-moneda').value = f.moneda || 'ARS';
    document.getElementById('gfp-medio').value = f.medio || '';
    // Próximo vencimiento sugerido: solo si el gasto fijo tiene día de venc configurado
    document.getElementById('gfp-prox-venc').value = f.diaVenc ? calcProxVencDesde(f.diaVenc, contextoApp.today()) || '' : '';
    document.getElementById('gfp-comprobante').value = '';
    document.getElementById('gfp-tc').value = contextoApp.cfg.tc || '';
    window.calcGFPUsd();
    populateGFSelects();
    document.getElementById('gf-pago-modal').classList.add('open');
  };
  window.verHistorialFijo = function (id) {
    const f = contextoApp.fijosItems.find(x => x.id === id);
    if (!f) return;
    const pagos = contextoApp.pagosFijosItems.filter(p => p.fijoId === id).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    document.getElementById('gf-hist-title').textContent = 'Pagos — ' + f.nombre;
    const totalUSD = pagos.reduce((s, p) => s + (p.usd || 0), 0);
    const totalARS = pagos.filter(p => p.moneda === 'ARS').reduce((s, p) => s + (p.importe || 0), 0);
    document.getElementById('gf-hist-summary').innerHTML = `${pagos.length} pago${pagos.length === 1 ? '' : 's'} registrado${pagos.length === 1 ? '' : 's'}` + (pagos.length ? ` · total histórico: ${totalARS ? contextoApp.fmtARS(totalARS) : ''}${totalARS && totalUSD ? ' · ' : ''}${totalUSD ? 'aprox u$s ' + Math.round(totalUSD) : ''}` : '');
    document.getElementById('gf-hist-body').innerHTML = pagos.length ? pagos.map(p => {
      const imp = p.moneda === 'ARS' ? contextoApp.fmtARS(p.importe) : 'u$s ' + p.importe;
      const usdEq = p.moneda === 'ARS' && p.usd ? ` · u$s ${p.usd}` : '';
      return `<div class="home-list-item" style="cursor:default;">
      <div>
        <div style="font-weight:600;">${p.fecha}</div>
        <div class="sub">${p.medio ? esc(p.medio) : '—'}${p.comprobante ? ' · ' + esc(p.comprobante) : ''}${p.proxVenc ? ' · próx. venc: ' + p.proxVenc : ''}</div>
      </div>
      <div style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;">${imp}<div style="font-size:11px;color:var(--text3);font-weight:400;">${usdEq}</div></div>
    </div>`;
    }).join('') : '<div class="home-empty">Todavía no registraste pagos de este gasto.</div>';
    document.getElementById('gf-hist-modal').classList.add('open');
  };
  window.closeGFPagoModal = function () {
    document.getElementById('gf-pago-modal').classList.remove('open');
    contextoApp.gfPagoFijoId = null;
  };
  window.guardarPagoFijo = async function () {
    if (!contextoApp.gfPagoFijoId) return;
    const f = contextoApp.fijosItems.find(x => x.id === contextoApp.gfPagoFijoId);
    const importe = parseFloat(document.getElementById('gfp-importe').value) || 0;
    if (!importe) {
      showToast('Ingresá el importe.', true);
      return;
    }
    const moneda = document.getElementById('gfp-moneda').value;
    const tc = parseFloat(document.getElementById('gfp-tc').value) || null;
    const usd = moneda === 'USD' ? importe : tc ? Math.round(importe / tc * 100) / 100 : null;
    const fecha = document.getElementById('gfp-fecha').value || contextoApp.today();
    const medio = document.getElementById('gfp-medio').value;
    const pago = {
      fijoId: contextoApp.gfPagoFijoId,
      fecha,
      importe,
      moneda,
      tc,
      usd,
      medio,
      proxVenc: document.getElementById('gfp-prox-venc').value || null,
      comprobante: document.getElementById('gfp-comprobante').value.trim(),
      createdAt: {
        seconds: Date.now() / 1000
      }
    };
    const btn = document.getElementById('gf-pago-save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.pagosFijosCol, contextoApp.withUser({
        ...pago,
        createdAt: serverTimestamp()
      }));
      // El pago también entra como GASTO → aparece en reportes con su USD
      await addDoc(contextoApp.gastosCol, contextoApp.withUser({
        fecha,
        tipo: f?.tipo || 'negocio',
        concepto: f?.nombre || 'Gasto fijo',
        categoria: f?.categoria || '',
        monto: importe,
        moneda,
        tc,
        usd,
        medio,
        notas: 'Pago gasto fijo' + (pago.comprobante ? ' · ' + pago.comprobante : ''),
        pagado: true,
        vencimiento: null,
        origen: 'gasto_fijo',
        createdAt: serverTimestamp()
      }));
      showToast('Pago registrado ✓' + (usd ? ' · u$s ' + usd : ''));
      window.closeGFPagoModal();
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Registrar pago';
  };
  window.eliminarFijo = async function (id) {
    if (!confirm('¿Eliminar este gasto fijo? Se eliminará también su historial de pagos.')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'gastos_fijos', id));
      // Also delete payments
      const pagos = contextoApp.pagosFijosItems.filter(p => p.fijoId === id);
      const batch = writeBatch(contextoApp.db);
      pagos.forEach(p => batch.delete(doc(contextoApp.db, 'pagos_fijos', p.id)));
      if (pagos.length) await batch.commit();
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  document.getElementById('gf-pago-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeGFPagoModal();
  });
  document.getElementById('gf-hist-modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('open');
  });

  // ── Etiquetas Brother QL-800 (62 x 100 mm) ────────────
}
