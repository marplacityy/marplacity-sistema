/** modulos/facturador: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { renderArcaBanner, arcaPedir, confirmarProduccion, htmlComprobante } from './arca.js';
import { esc, showToast } from '../core/interfaz.js';
import { deb } from '../core/datos.js';
import { renderCaja } from './caja.js';
import { renderCart } from './pos.js';
import { renderRepInv } from './repuestos.js';
import { renderReporte } from './reportes.js';
import { renderTkHistory } from './reparaciones.js';

export async function initFacturador() {
  renderArcaBanner('fac-banner');
  document.getElementById('fac-ptovta').value = contextoApp.cfg.arcaPtoVta || '';
  if (!contextoApp.facRenglones.length) contextoApp.facRenglones = [contextoApp.facRenglonVacio()];
  try {
    if (!contextoApp.arcaTablas || !contextoApp.arcaTablas.condiciones) {
      const t = await arcaPedir('/tablas');
      if (t.error) throw new Error(t.error);
      contextoApp.arcaTablas = t;
    }
  } catch (e) {
    document.getElementById('fac-aviso').innerHTML = `<div class="proveedor-alerta alerta-urgente">No se pudieron leer las tablas de ARCA: ${esc(e.message)}</div>`;
    return;
  }
  const sel = (id, filas, valor) => {
    const el = document.getElementById(id);
    if (el.options.length && el.value) return false; // no pisar lo que ya eligió
    el.innerHTML = filas.map(f => `<option value="${f.id}" ${String(f.id) === String(valor) ? 'selected' : ''}>${esc(f.desc)}</option>`).join('');
    return true;
  };
  const primeraVez = sel('fac-cond', contextoApp.arcaTablas.condiciones, 5);
  sel('fac-doctipo', contextoApp.arcaTablas.documentos, 99);
  // La letra se sugiere al llenar los selectores, no cada vez que se entra a la pantalla:
  // si el usuario la cambió a mano y salió a mirar otra cosa, al volver sigue la suya.
  if (primeraVez) window.facCondCambio();else window.facPintarAviso();
  facRenderRenglones();
}

/** La condición de IVA sugiere la letra. Sugiere: no la impone. */
export
// ── Renglones ──
function facRenderRenglones() {
  const alics = contextoApp.arcaTablas?.iva || [{
    id: 5,
    desc: '21%'
  }];
  document.getElementById('fac-items').innerHTML = contextoApp.facRenglones.map((r, i) => `
    <tr>
      <td><input type="text" value="${esc(r.descripcion || '')}" placeholder="Ej: Service de iPhone" oninput="facSet(${i},'descripcion',this.value)"
            style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);"></td>
      <td><input type="number" value="${r.cantidad}" min="1" step="1" oninput="facSet(${i},'cantidad',this.value)"
            style="width:100%;text-align:right;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-family:'DM Mono',monospace;font-size:13px;color:var(--text);"></td>
      <td><input type="number" value="${r.precioUnitario ?? ''}" step="0.01" min="0" placeholder="0" oninput="facSet(${i},'precioUnitario',this.value)"
            style="width:100%;text-align:right;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-family:'DM Mono',monospace;font-size:13px;color:var(--text);"></td>
      <td><select onchange="facSet(${i},'alicuotaIva',this.value)"
            style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text);">
            ${alics.map(a => {
    const v = parseFloat(a.desc);
    return `<option value="${v}" ${v === Number(r.alicuotaIva) ? 'selected' : ''}>${esc(a.desc)}</option>`;
  }).join('')}
          </select></td>
      <td>${contextoApp.facRenglones.length > 1 ? `<button class="ei-btn del" onclick="facQuitarRenglon(${i})" title="Quitar">×</button>` : ''}</td>
    </tr>`).join('');
  window.facTotales();
}
export function inicializarFacturador() {
  // ══ Facturador: una factura suelta, sin venta detrás ═════════
  //
  // Comparte TODO con la factura de una venta: el mismo Worker, las mismas tablas de ARCA,
  // las mismas reglas de letra y alícuotas, el mismo render del resultado y el mismo PDF.
  // Lo único propio de esta pantalla es el formulario. Las reglas de negocio no se
  // duplican: el día que ARCA cambie algo, se toca en un solo lugar.
  contextoApp.facRenglones = []; // [{descripcion, cantidad, precioUnitario, alicuotaIva}]
  contextoApp.facRenglonVacio = () => ({
    descripcion: '',
    cantidad: 1,
    precioUnitario: null,
    alicuotaIva: 21
  });
  window.facCondCambio = function () {
    const fila = (contextoApp.arcaTablas?.condiciones || []).find(f => f.id === Number(document.getElementById('fac-cond').value));
    const esRI = /responsable\s+inscripto/i.test(fila?.desc || '');
    document.getElementById('fac-tipo').value = esRI ? '1' : '6';
    // A un Responsable Inscripto hay que facturarle con CUIT, así que se adelanta el
    // tipo de documento en vez de esperar el rechazo de ARCA.
    if (esRI) {
      const cuit = (contextoApp.arcaTablas?.documentos || []).find(f => f.id === 80);
      if (cuit) document.getElementById('fac-doctipo').value = '80';
    }
    window.facPintarAviso();
  };

  /** Lo que ARCA va a rechazar, dicho antes de emitir. */
  window.facPintarAviso = function () {
    const tipo = Number(document.getElementById('fac-tipo').value);
    const docTipo = Number(document.getElementById('fac-doctipo').value);
    const docNro = (document.getElementById('fac-docnro').value || '').replace(/\D/g, '');
    const cond = (contextoApp.arcaTablas?.condiciones || []).find(f => f.id === Number(document.getElementById('fac-cond').value));
    const esRI = /responsable\s+inscripto/i.test(cond?.desc || '');
    const problemas = [];
    if (tipo === 1 && docTipo !== 80) problemas.push('La factura A necesita el <b>CUIT</b> del cliente. Con otro documento, ARCA la rechaza.');
    if (tipo === 1 && docTipo === 80 && docNro.length !== 11) problemas.push('El CUIT tiene que tener 11 dígitos.');
    if (docTipo !== 99 && !docNro) problemas.push('Falta el número de documento.');
    if (esRI && tipo === 6) problemas.push('Le estás por hacer una <b>B</b> a un Responsable Inscripto: es válido, pero no va a poder computar el IVA.');
    document.getElementById('fac-aviso').innerHTML = problemas.length ? `<div class="proveedor-alerta ${tipo === 1 && docTipo !== 80 ? 'alerta-urgente' : 'alerta-atencion'}">${problemas.join('<br>')}</div>` : `<div class="proveedor-alerta">Va a salir una <b>Factura ${tipo === 1 ? 'A' : 'B'}</b>.</div>`;
  };
  window.facSet = function (i, campo, valor) {
    contextoApp.facRenglones[i][campo] = campo === 'descripcion' ? valor : valor === '' ? null : Number(valor);
    window.facTotales();
  };
  window.facAgregarRenglon = function () {
    contextoApp.facRenglones.push(contextoApp.facRenglonVacio());
    facRenderRenglones();
  };
  window.facQuitarRenglon = function (i) {
    contextoApp.facRenglones.splice(i, 1);
    facRenderRenglones();
  };
  window.facLimpiar = function () {
    if (!confirm('¿Vaciar el formulario?')) return;
    contextoApp.facRenglones = [contextoApp.facRenglonVacio()];
    ['fac-nombre', 'fac-docnro'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fac-resultado').innerHTML = '';
    facRenderRenglones();
  };

  /**
   * Los tres números, siempre a la vista. Se calculan igual que en el Worker —redondeando
   * POR ALÍCUOTA y sumando después— así que lo que ves acá es exactamente lo que se le
   * manda a ARCA.
   */
  window.facTotales = function () {
    const finales = document.getElementById('fac-modo').value === 'final';
    const porAlic = new Map();
    for (const r of contextoApp.facRenglones) {
      const bruto = (Number(r.precioUnitario) || 0) * (Number(r.cantidad) || 0);
      const a = Number(r.alicuotaIva) || 0;
      porAlic.set(a, (porAlic.get(a) || 0) + (finales ? bruto / (1 + a / 100) : bruto));
    }
    let neto = 0,
      iva = 0,
      detalle = '';
    for (const [a, n] of [...porAlic.entries()].sort((x, y) => x[0] - y[0])) {
      const base = Math.round(n * 100) / 100,
        imp = Math.round(base * a) / 100;
      neto += base;
      iva += imp;
      if (base) detalle += `<div class="profit-row"><span class="profit-label">IVA ${a}% sobre ${contextoApp.fmtARS(base)}</span><span class="profit-val">${contextoApp.fmtARS(imp)}</span></div>`;
    }
    neto = Math.round(neto * 100) / 100;
    iva = Math.round(iva * 100) / 100;
    document.getElementById('fac-totales').innerHTML = `
    <div class="profit-row"><span class="profit-label">Neto gravado</span><span class="profit-val">${contextoApp.fmtARS(neto)}</span></div>
    ${detalle}
    <div class="profit-row"><span class="profit-label" style="font-weight:700">TOTAL</span><span class="profit-val tk-b">${contextoApp.fmtARS(neto + iva)}</span></div>
    <div style="font-size:11px;color:var(--text3);margin-top:6px;">${finales ? 'Los precios que cargaste son finales: el neto sale de desagregarles el IVA.' : 'Los precios que cargaste son netos: el IVA se suma encima.'}</div>`;
  };
  window.facEmitir = async function () {
    const items = contextoApp.facRenglones.filter(r => (r.descripcion || '').trim() && Number(r.precioUnitario) > 0).map(r => ({
      descripcion: r.descripcion.trim(),
      cantidad: Number(r.cantidad) || 1,
      precioUnitario: Number(r.precioUnitario),
      alicuotaIva: Number(r.alicuotaIva)
    }));
    if (!items.length) {
      showToast('Cargá al menos un renglón con descripción y precio.', true);
      return;
    }
    const ptoVta = parseInt(document.getElementById('fac-ptovta').value);
    if (!ptoVta) {
      showToast('Falta el punto de venta.', true);
      return;
    }
    const cliente = {
      nombre: document.getElementById('fac-nombre').value.trim() || 'Consumidor Final',
      condicionIvaId: Number(document.getElementById('fac-cond').value),
      docTipo: Number(document.getElementById('fac-doctipo').value),
      docNro: (document.getElementById('fac-docnro').value || '').replace(/\D/g, '') || 0
    };
    const finales = document.getElementById('fac-modo').value === 'final';
    const cbteTipo = Number(document.getElementById('fac-tipo').value);
    const total = items.reduce((s, i) => {
      const b = i.precioUnitario * i.cantidad;
      return s + (finales ? b : b * (1 + i.alicuotaIva / 100));
    }, 0);
    if (!confirmarProduccion(`Esta factura ${cbteTipo === 1 ? 'A' : 'B'}`, `Cliente: ${cliente.nombre}\nTotal: ${contextoApp.fmtARS(Math.round(total * 100) / 100)}`)) return;
    const btn = document.getElementById('btn-fac-emitir');
    btn.disabled = true;
    btn.textContent = 'Pidiendo el CAE…';
    const res = document.getElementById('fac-resultado');
    res.innerHTML = '<div class="home-empty">Emitiendo…</div>';
    try {
      const r = await arcaPedir('/emitir', {
        method: 'POST',
        body: JSON.stringify({
          ptoVta,
          cbteTipo,
          cliente,
          items,
          precioIncluyeIva: finales,
          manual: true,
          // sin venta detrás
          confirmoProduccion: contextoApp.arcaEnProduccion()
        })
      });
      if (r.comprobante) {
        res.innerHTML = htmlComprobante(r.comprobante, {
          conNotaCredito: false
        });
        showToast(r.ok ? 'Factura emitida ✓' : 'ARCA rechazó el comprobante', !r.ok);
        if (r.ok) {
          contextoApp.facRenglones = [contextoApp.facRenglonVacio()];
          facRenderRenglones();
        }
      } else {
        res.innerHTML = `<div class="proveedor-alerta alerta-urgente"><b>No se pudo emitir.</b><br>${esc(r.error || 'error desconocido')}
        ${r.problemas?.length ? '<ul style="margin:6px 0 0 18px;">' + r.problemas.map(p => `<li>${esc(p)}</li>`).join('') + '</ul>' : ''}
        ${r.estadoDesconocido ? `<div style="margin-top:6px;">⚠️ Revisá a mano el comprobante ${r.estadoDesconocido.ptoVta}-${r.estadoDesconocido.cbteNro} antes de volver a intentar.</div>` : ''}</div>`;
      }
    } catch (e) {
      res.innerHTML = `<div class="proveedor-alerta alerta-urgente">${esc(e.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '🧾 Emitir y pedir el CAE';
  };
  window.reintentarFacturaArca = function () {
    const v = contextoApp.feaVenta;
    if (!v) return;
    // El rechazado queda guardado como antecedente; se arma el pedido de nuevo.
    contextoApp.comprobantes = contextoApp.comprobantes.filter(c => !(c.ventaId === v.id && c.estado === 'rechazada'));
    window.abrirFacturaArca(v.id);
  };
  Object.assign(window, {
    deb,
    renderCaja,
    renderCart,
    renderRepInv,
    renderReporte,
    renderTkHistory,
    renderArcaBanner
  });
}
