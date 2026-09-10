/** modulos/caja: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, showToast } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { addDoc, serverTimestamp } from 'firebase/firestore';

export
// ── Cierre de caja ────────────────────────────────────
function movsCaja(fecha) {
  // clave: "medio|moneda" → {entradas, salidas}
  const m = new Map();
  const add = (medio, moneda, ent, sal) => {
    const k = (medio || 'Sin especificar') + '|' + (moneda || 'ARS');
    if (!m.has(k)) m.set(k, {
      medio: medio || 'Sin especificar',
      moneda: moneda || 'ARS',
      entradas: 0,
      salidas: 0
    });
    const x = m.get(k);
    x.entradas += ent;
    x.salidas += sal;
  };
  // ENTRADAS: ventas/ingresos del día (excluye importados sin medios)
  contextoApp.ingresos.filter(v => v.fecha === fecha).forEach(v => {
    if ((v.medios || []).length) {
      v.medios.forEach(mm => {
        if (/^Seña \(/.test(mm.medio || '')) return;
        add(mm.medio, mm.moneda, mm.valor || 0, 0);
      });
    } else {
      if (v.totalARS) add(v.medio || 'Sin especificar', 'ARS', v.totalARS, 0);
      if (v.totalUSD) add(v.medio || 'Sin especificar', 'USD', v.totalUSD, 0);
    }
  });
  // Señas de encargues registrados hoy
  contextoApp.encarguesItems.filter(x => x.fechaEncargue === fecha && (x.sena || 0) > 0).forEach(x => {
    add(x.senaMedio || 'Seña encargue', x.moneda || 'USD', x.sena, 0);
  });
  // Señas de reparaciones recibidas hoy
  contextoApp.reps.filter(r => r.fecha === fecha && (r.sena || 0) > 0 && r.origen !== 'repairdesk').forEach(r => {
    add(r.medio || 'Seña reparación', r.moneda || 'ARS', r.sena, 0);
  });
  // SALIDAS: gastos del día
  contextoApp.gastos.filter(g => g.fecha === fecha).forEach(g => {
    add(g.medio || 'Sin especificar', g.moneda || 'ARS', 0, g.monto || 0);
  });
  // Pagos a consignación del día
  contextoApp.pagosItems.filter(p => p.fecha === fecha).forEach(p => {
    add('Pago consignación', p.moneda || 'USD', 0, p.monto || 0);
  });
  return [...m.values()].sort((a, b) => a.medio.localeCompare(b.medio));
}
export function renderCaja() {
  const fecha = document.getElementById('caja-fecha').value || contextoApp.today();
  const movs = movsCaja(fecha);
  const fm = (v, mon) => mon === 'ARS' ? contextoApp.fmtARS(Math.round(v)) : 'u$s ' + Math.round(v * 100) / 100;
  let entARS = 0,
    entUSD = 0,
    salARS = 0,
    salUSD = 0;
  movs.forEach(x => {
    if (x.moneda === 'ARS') {
      entARS += x.entradas;
      salARS += x.salidas;
    } else {
      entUSD += x.entradas;
      salUSD += x.salidas;
    }
  });
  document.getElementById('caja-metrics').innerHTML = `
    <div class="metric"><div class="m-label">Entradas</div><div class="m-val" style="color:#237A4B">${entARS ? contextoApp.fmtARS(Math.round(entARS)) : '—'}</div><div class="m-sub">${entUSD ? 'u$s ' + Math.round(entUSD * 100) / 100 : ''}</div></div>
    <div class="metric"><div class="m-label">Salidas</div><div class="m-val" style="color:var(--neg)">${salARS ? contextoApp.fmtARS(Math.round(salARS)) : '—'}</div><div class="m-sub">${salUSD ? 'u$s ' + Math.round(salUSD * 100) / 100 : ''}</div></div>
    <div class="metric"><div class="m-label">Neto del día</div><div class="m-val">${contextoApp.fmtARS(Math.round(entARS - salARS))}</div><div class="m-sub">${entUSD - salUSD ? 'u$s ' + Math.round((entUSD - salUSD) * 100) / 100 : ''}</div></div>
  `;
  document.getElementById('caja-body').innerHTML = movs.length ? movs.map(x => `<tr>
        <td><span class="gf-nombre">${esc(x.medio)}</span> <span style="font-size:10px;color:var(--text3);">${x.moneda}</span></td>
        <td style="text-align:right;font-family:'DM Mono',monospace;color:#237A4B;">${x.entradas ? fm(x.entradas, x.moneda) : '—'}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--neg);">${x.salidas ? fm(x.salidas, x.moneda) : '—'}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;">${fm(x.entradas - x.salidas, x.moneda)}</td>
      </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:1.5rem;">Sin movimientos este día.</td></tr>';

  // Historial de cierres
  document.getElementById('caja-historial').innerHTML = contextoApp.cierresItems.slice(0, 15).map(cz => `
    <div class="pago-item">
      <div class="pago-info">
        <div style="font-size:13px;font-weight:500;">🔒 ${cz.fecha} ${cz.hora || ''}</div>
        <div class="pago-fecha">${(cz.resumen || []).map(x => esc(x.medio) + ' ' + (x.moneda === 'ARS' ? contextoApp.fmtARS(Math.round(x.neto)) : 'u$s ' + Math.round(x.neto * 100) / 100)).join(' · ')}${cz.notas ? ' · ' + esc(cz.notas) : ''}</div>
      </div>
    </div>`).join('') || '<div class="home-empty">Sin cierres registrados.</div>';
  const yaCerrada = contextoApp.cierresItems.some(cz => cz.fecha === fecha);
  const btn = document.getElementById('btn-cerrar-caja');
  btn.textContent = yaCerrada ? '🔒 Caja ya cerrada — cerrar de nuevo' : '🔒 Cerrar caja del día';
}
export function inicializarCaja() {
  window.cerrarCaja = async function () {
    const fecha = document.getElementById('caja-fecha').value || contextoApp.today();
    const movs = movsCaja(fecha);
    if (!movs.length) {
      showToast('No hay movimientos para cerrar.', true);
      return;
    }
    if (contextoApp.cierresItems.some(cz => cz.fecha === fecha) && !confirm('Ya hay un cierre para este día. ¿Registrar otro?')) return;
    const btn = document.getElementById('btn-cerrar-caja');
    btn.disabled = true;
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.cierresCol, contextoApp.withUser({
        fecha,
        hora: new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        resumen: movs.map(x => ({
          medio: x.medio,
          moneda: x.moneda,
          entradas: x.entradas,
          salidas: x.salidas,
          neto: x.entradas - x.salidas
        })),
        notas: document.getElementById('caja-notas').value.trim(),
        createdAt: serverTimestamp()
      }));
      document.getElementById('caja-notas').value = '';
      showToast('Caja cerrada ✓');
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
    btn.disabled = false;
  };

  // ── Dashboard ─────────────────────────────────────────
}
