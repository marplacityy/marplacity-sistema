/** modulos/reparaciones: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, showToast } from '../core/interfaz.js';
import { populateClientesDL, resolverCliente } from './clientes.js';
import { populateRepuestoSelects, renderRepuestosTags, origenRep, ajustarStockRepuesto, costoRepuestosUSD } from './costos.js';
import { parse3uReport } from './stock.js';
import { setDoc, addDoc, serverTimestamp, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { setSyncDot, textoVentana } from '../core/datos.js';
import { imprimirTicketVenta, printTicket80 } from './pos.js';
import { waNumber, waTpl } from './whatsapp.js';
import { abrirPestanaDiferida, publicarPDF, mandarLinkWa } from './facturas.js';

export function initRepForm() {
  document.getElementById('r-checklist').innerHTML = contextoApp.CHECKLIST.map(i => `
    <div class="chk-item">
      <span>${i.label}</span>
      <div class="chk-btns">
        <button class="chk-b si" id="chk-${i.k}-si" onclick="setChk('${i.k}',true)">Si</button>
        <button class="chk-b no" id="chk-${i.k}-no" onclick="setChk('${i.k}',false)">No</button>
      </div>
    </div>`).join('');
  const med = document.getElementById('r-medio');
  if (med) med.innerHTML = '<option value="">— opcional —</option>' + contextoApp.medios.map(m => `<option>${esc(m)}</option>`).join('');
  const fl = document.getElementById('rep-fl-estado');
  if (fl && fl.options.length <= 1) fl.innerHTML = '<option value="">Todos los estados</option>' + contextoApp.ESTADOS.map(e => `<option value="${e.k}">${e.label}</option>`).join('');
  const rm = document.getElementById('rm-estado');
  if (rm && !rm.options.length) rm.innerHTML = contextoApp.ESTADOS.map(e => `<option value="${e.k}">${e.label}</option>`).join('');
  if (contextoApp.cfg.tc && !document.getElementById('r-tc').value) document.getElementById('r-tc').value = contextoApp.cfg.tc;
  populateClientesDL();
  populateRepuestoSelects();
}
export
/**
 * El próximo número de ticket. Sale de cfg.repUltimoNum, no del array: el array está
 * acotado a la ventana y una ventana sin reparaciones repetiría números. Por las dudas
 * se toma el mayor entre lo guardado y lo que haya en memoria, y se persiste al usarlo.
 */
function nextRepNum() {
  const enMemoria = contextoApp.reps.reduce((m, r) => Math.max(m, r.num || 0), 0);
  const num = Math.max(Number(contextoApp.cfg.repUltimoNum) || 0, enMemoria, 1000) + 1;
  contextoApp.cfg.repUltimoNum = num;
  setDoc(contextoApp.cfgDoc, contextoApp.withUser({
    repUltimoNum: num
  }), {
    merge: true
  }).catch(() => {});
  return num;
}
export function renderReps() {
  initRepForm();
  const fEst = document.getElementById('rep-fl-estado').value;
  const fBus = (document.getElementById('rep-fl-buscar').value || '').toLowerCase().trim();
  let items = contextoApp.reps.filter(r => {
    if (contextoApp.repTab === 'activas' && !contextoApp.estInfo(r.estado).activo) return false;
    if (fEst && r.estado !== fEst) return false;
    if (fBus) {
      const hay = [String(r.num), r.cliente, r.equipo, r.imei, r.trabajo].join(' ').toLowerCase();
      if (!hay.includes(fBus)) return false;
    }
    return true;
  });
  const activas = contextoApp.reps.filter(r => contextoApp.estInfo(r.estado).activo);
  const listas = contextoApp.reps.filter(r => r.estado === 'reparado' || r.estado === 'avisado');
  const cobrar = activas.reduce((s, r) => s + (r.saldo || 0) * (r.moneda === 'USD' && r.tc ? r.tc : 1), 0);
  document.getElementById('rep-metrics').innerHTML = `
    <div class="metric"><div class="m-label">En curso</div><div class="m-val">${activas.length}</div><div class="m-sub">equipos</div></div>
    <div class="metric"><div class="m-label">Listos para retirar</div><div class="m-val" style="color:#237A4B">${listas.length}</div></div>
    <div class="metric"><div class="m-label">Por cobrar (aprox ARS)</div><div class="m-val">${cobrar ? contextoApp.fmtARS(cobrar) : '—'}</div></div>
  `;
  if (!items.length) {
    document.getElementById('rep-list').innerHTML = '<div class="empty" style="grid-column:1/-1;">Sin reparaciones en este filtro.</div>';
    return;
  }
  const MAX_RENDER = 100;
  const totalItems = items.length;
  items = items.slice(0, MAX_RENDER);
  document.getElementById('rep-list').innerHTML = (contextoApp.ventanaDesde ? `<div class="empty" style="grid-column:1/-1;padding:.5rem;">📅 ${textoVentana()} — los tickets anteriores no están cargados. Ampliá el rango en Configuración.</div>` : '') + (totalItems > MAX_RENDER ? `<div class="empty" style="grid-column:1/-1;padding:.5rem;">Mostrando ${MAX_RENDER} de ${totalItems} — refiná la búsqueda para ver el resto.</div>` : '') + items.map(r => {
    const e = contextoApp.estInfo(r.estado);
    const pv = r.moneda === 'ARS' ? contextoApp.fmtARS(r.precio) : 'u$s ' + r.precio;
    const sd = r.saldo > 0 ? r.moneda === 'ARS' ? contextoApp.fmtARS(r.saldo) : 'u$s ' + r.saldo : null;
    return `<div class="rep-card" onclick="abrirRep('${r.id}')">
      <div class="rep-card-top">
        <span class="rep-num">#${r.num}</span>
        <span class="est ${e.cls}">${e.label}</span>
      </div>
      <div class="rep-cliente">${esc(r.cliente)}</div>
      <div class="rep-equipo">${esc(r.equipo)}</div>
      <div class="rep-meta">
        <span>${r.fecha}</span>
        ${r.tel ? `<span>${esc(r.tel)}</span>` : ''}
        ${r.imei ? `<span style="font-family:'DM Mono',monospace;font-size:10px;">${esc(r.imei)}</span>` : ''}
      </div>
      <div class="rep-precio">${pv}${sd ? ` <span style="color:var(--neg);font-weight:500;">· saldo ${sd}</span>` : ' <span style="color:#237A4B;font-weight:500;">· pago</span>'}</div>
    </div>`;
  }).join('');
}
export
// ── Lista de precios ──────────────────────────────────
function rankModelo(nombre) {
  const n = (nombre || '').toLowerCase();
  const gen = (n.match(/iphone\s*(\d+)/) || [])[1];
  if (!gen) return null; // no es iPhone
  let variante = 2; // base
  if (/pro\s*max/.test(n)) variante = 5;else if (/pro/.test(n)) variante = 4;else if (/plus/.test(n)) variante = 3;else if (/mini/.test(n)) variante = 1;else if (/\d+\s*e\b/.test(n)) variante = 0;
  const cap = (n.match(/(\d+)\s*tb/) || [])[1] ? parseInt(n.match(/(\d+)\s*tb/)[1]) * 1024 : parseInt((n.match(/(\d+)\s*gb/) || [])[1] || 0);
  return {
    gen: parseInt(gen),
    variante,
    cap
  };
}
export function renderTkHistory() {
  const fEst = document.getElementById('tkh-estado').value;
  const q = (document.getElementById('tkh-buscar').value || '').toLowerCase().trim();
  let items = contextoApp.reps.filter(r => {
    if (fEst === 'activas' && !contextoApp.estInfo(r.estado).activo) return false;
    if (q && !((r.num || '') + ' ' + (r.cliente || '') + ' ' + (r.imei || '') + ' ' + (r.equipo || '') + ' ' + (r.tel || '')).toLowerCase().includes(q)) return false;
    return true;
  });
  const total = items.length;
  items = items.slice(0, 25);
  const money = r => (r.saldo || 0) > 0 ? r.moneda === 'ARS' ? contextoApp.fmtARS(r.saldo) : 'u$s ' + r.saldo : '—';
  document.getElementById('tkh-body').innerHTML = items.length ? items.map(r => `
    <tr>
      <td style="font-family:'DM Mono',monospace;font-weight:600;">#${r.num}</td>
      <td>${r.fecha || ''}</td>
      <td>${esc(r.cliente || '')}</td>
      <td>${esc((r.equipo || '').slice(0, 28))}</td>
      <td><span class="est-badge ${contextoApp.estInfo(r.estado).cls}" style="font-size:9px;">${contextoApp.estInfo(r.estado).label}</span></td>
      <td style="text-align:right;font-family:'DM Mono',monospace;${(r.saldo || 0) > 0 ? 'color:var(--neg);font-weight:600;' : ''}">${money(r)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="tkh-open" onclick="closeTkH();abrirRep('${r.id}')">Abrir</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:1.5rem;">Sin resultados.</td></tr>';
  document.getElementById('tkh-count').textContent = total > 25 ? `Mostrando 25 de ${total} — refiná la búsqueda.` : `${total} tickets.`;
}
export function renderFkHistory() {
  const q = (document.getElementById('fkh-buscar').value || '').toLowerCase().trim();
  let items = contextoApp.ingresos.filter(v => {
    if (q && !((v.numVenta || '') + ' ' + (v.clienteNombre || '') + ' ' + (v.nombre || '') + ' ' + (v.imei || '')).toLowerCase().includes(q)) return false;
    return true;
  });
  const total = items.length;
  items = items.slice(0, 25);
  const money = v => [v.totalARS ? contextoApp.fmtARS(v.totalARS) : null, v.totalUSD ? 'u$s ' + v.totalUSD : null].filter(Boolean).join(' / ') || '—';
  document.getElementById('fkh-body').innerHTML = items.length ? items.map(v => `
    <tr>
      <td style="font-family:'DM Mono',monospace;font-weight:600;">${v.numVenta ? '#V-' + v.numVenta : '—'}</td>
      <td>${v.fecha || ''}</td>
      <td>${esc(v.clienteNombre || '')}</td>
      <td>${esc((v.nombre || '').slice(0, 32))}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;">${money(v)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="tkh-open" onclick="reimprimirFactura('${v.id}','termica')" title="Reimprimir">🖨</button>
        <button class="tkh-open" onclick="closeFkH();abrirFE('${v.id}')" title="Editar" ${v.items && v.items.length ? '' : 'disabled style="opacity:.4"'}>✎</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:1.5rem;">Sin resultados.</td></tr>';
  document.getElementById('fkh-count').textContent = total > 25 ? `Mostrando 25 de ${total} — refiná la búsqueda.` : `${total} facturas.`;
}

// ── Cobro de reparación al retirar ────────────────────
export function abrirCR(r) {
  contextoApp.crRep = r;
  contextoApp.crMedios = [];
  const sinCargo = (r.precio || 0) === 0;
  const money = v => (r.moneda === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v) + (r.tc ? r.moneda === 'ARS' ? ' / ' + contextoApp.fmtUSD(Math.round(v / r.tc * 100) / 100) : ' / ' + contextoApp.fmtARS(Math.round(v * r.tc)) : '');
  document.getElementById('cr-title').textContent = sinCargo ? `Retirar #${r.num} — ${r.cliente || ''} (sin cargo)` : `Cobrar #${r.num} — ${r.cliente || ''}`;
  const costoRep = costoRepuestosUSD(r) || 0;
  document.getElementById('cr-resumen').innerHTML = sinCargo ? `
    <div class="profit-row"><span class="profit-label">${esc(r.trabajo || 'Reparación')}</span><span class="profit-val">🛡 SIN CARGO</span></div>
    ${costoRep ? `<div class="profit-row"><span class="profit-label">Costo asumido (repuestos)</span><span class="profit-val" style="color:var(--neg)">− u$s ${costoRep}</span></div>` : ''}
    <div class="profit-row" style="font-size:12px;color:var(--text3);"><span>Se genera una factura en $0 que documenta la garantía. El costo impacta como pérdida en el reporte.</span></div>
  ` : `
    <div class="profit-row"><span class="profit-label">${esc(r.trabajo || 'Reparación')}</span><span class="profit-val">${money(r.precio || 0)}</span></div>
    ${r.sena ? `<div class="profit-row"><span class="profit-label">Seña ya entregada${r.medio ? ' (' + esc(r.medio) + ')' : ''}</span><span class="profit-val">− ${money(r.sena)}</span></div>` : ''}
    <div class="profit-row"><span class="profit-label tk-b" style="font-weight:700">SALDO A COBRAR</span><span class="profit-val tk-b">${money(r.saldo || 0)}</span></div>
  `;
  // ocultar la sección de medios si es sin cargo
  document.querySelectorAll('#cr-modal .field, #cr-modal .permuta-box:not(#cr-resumen)').forEach(el => {
    if (el.id !== 'cr-resumen') el.style.display = sinCargo ? 'none' : '';
  });
  document.getElementById('btn-cr-cobrar').textContent = sinCargo ? '🛡 Facturar en $0 y retirar' : '🖨 Cobrar, facturar y retirar';
  const sel = document.getElementById('cr-med-sel');
  sel.innerHTML = contextoApp.medios.map(m => `<option>${esc(m)}</option>`).join('');
  if (!sel.dataset.auto) {
    sel.dataset.auto = '1';
    sel.addEventListener('change', () => {
      const n = sel.value.toLowerCase();
      const mon = document.getElementById('cr-med-mon');
      if (/dolar|usd|d[oó]lares/.test(n)) mon.value = 'USD';else if (/peso|transfer|mercado|tarjeta|d[eé]b|cr[eé]d|brubank|posnet/.test(n)) mon.value = 'ARS';
    });
  }
  document.getElementById('cr-med-mon').value = r.moneda || 'ARS';
  document.getElementById('cr-med-val').value = '';
  renderCRMedios();
  document.getElementById('cr-modal').classList.add('open');
}
export function crTotals() {
  const r = contextoApp.crRep;
  if (!r) return {
    saldoUSD: 0,
    saldoARS: 0,
    pUSD: 0,
    pARS: 0,
    tc: null
  };
  const tc = r.tc || parseFloat(contextoApp.cfg.tc) || null;
  const saldo = r.saldo || 0;
  const saldoUSD = r.moneda === 'USD' ? saldo : tc ? saldo / tc : 0;
  const saldoARS = r.moneda === 'ARS' ? saldo : tc ? saldo * tc : 0;
  let pUSD = 0,
    pARS = 0;
  contextoApp.crMedios.forEach(mm => {
    if (mm.moneda === 'ARS') {
      pARS += mm.valor;
      if (tc) pUSD += mm.valor / tc;
    } else {
      pUSD += mm.valor;
      if (tc) pARS += mm.valor * tc;
    }
  });
  return {
    saldoUSD,
    saldoARS,
    pUSD,
    pARS,
    tc
  };
}
export function renderCRMedios() {
  document.getElementById('cr-medios-tags').innerHTML = contextoApp.crMedios.map((mm, i) => `<div class="medio-tag"><span>${esc(mm.medio)} · ${mm.moneda === 'USD' ? 'u$s ' : '$ '}${mm.valor.toLocaleString('es-AR')}</span><button onclick="crDelMedio(${i})">×</button></div>`).join('');
  const t = crTotals();
  document.getElementById('cr-pagado').textContent = [t.pARS ? contextoApp.fmtARS(Math.round(t.pARS)) : null, t.pUSD ? 'u$s ' + Math.round(t.pUSD * 100) / 100 : null].filter(Boolean).join(' / ') || '—';
  const resto = t.tc ? t.saldoUSD - t.pUSD : contextoApp.crRep?.moneda === 'USD' ? t.saldoUSD - t.pUSD : t.saldoARS - t.pARS;
  const el = document.getElementById('cr-resto');
  const restoStr = t.tc ? [contextoApp.fmtARS(Math.abs(Math.round(t.saldoARS - t.pARS))), 'u$s ' + Math.abs(Math.round((t.saldoUSD - t.pUSD) * 100) / 100)].join(' / ') : String(Math.abs(Math.round(resto * 100) / 100));
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
}
export
// ── Orden de reparación en PDF A4 ─────────────────────
// `opts.publico` omite la clave del equipo: el PDF que sale por WhatsApp queda
// detrás de un link, y una clave de desbloqueo no viaja por ahí.

function generarOrdenPDF(r, opts) {
  const publico = !!(opts && opts.publico);
  const {
    jsPDF
  } = window.jspdf;
  const d = new jsPDF({
    unit: 'mm',
    format: 'a4'
  });
  const money = v => {
    if (!v) return r.moneda === 'ARS' ? '$ 0' : 'u$s 0';
    const base = r.moneda === 'ARS' ? '$ ' + Math.round(v).toLocaleString('es-AR') : 'u$s ' + v;
    const alt = r.tc ? r.moneda === 'ARS' ? 'u$s ' + Math.round(v / r.tc * 100) / 100 : '$ ' + Math.round(v * r.tc).toLocaleString('es-AR') : null;
    return alt ? base + ' / ' + alt : base;
  };

  // Encabezado
  d.setFontSize(18);
  d.setFont(undefined, 'bold');
  d.text(contextoApp.cfg.localNombre || 'MarplaCity', 14, 20);
  d.setFontSize(9);
  d.setFont(undefined, 'normal');
  let y = 26;
  if (contextoApp.cfg.localDir) {
    d.text(contextoApp.cfg.localDir, 14, y);
    y += 4.5;
  }
  if (contextoApp.cfg.localTel) {
    d.text('Tel: ' + contextoApp.cfg.localTel, 14, y);
    y += 4.5;
  }
  if (contextoApp.cfg.localWeb) {
    d.text(contextoApp.cfg.localWeb, 14, y);
    y += 4.5;
  }
  d.setFontSize(15);
  d.setFont(undefined, 'bold');
  d.text('ORDEN DE REPARACIÓN', 196, 20, {
    align: 'right'
  });
  d.setFontSize(13);
  d.text('#' + (r.num || ''), 196, 26.5, {
    align: 'right'
  });
  d.setFontSize(9);
  d.setFont(undefined, 'normal');
  d.text('Fecha: ' + (r.fecha || '') + ' ' + (r.hora || ''), 196, 32, {
    align: 'right'
  });
  d.setDrawColor(0);
  d.setLineWidth(0.8);
  const yTop = Math.max(y, 36);
  d.line(14, yTop, 196, yTop);

  // Cliente y equipo, en dos columnas
  const datos = [['Cliente', r.cliente || '—', 'Equipo', r.equipo || '—'], ['Teléfono', r.tel || '—', 'IMEI', r.imei || '—'], ['Garantía', r.garantia || '—', 'Batería', r.bateria ? r.bateria + '%' : '—'], ['Entrega estimada', r.entrega || 'a confirmar', publico ? '' : 'Clave', publico ? '' : r.clave || '—']];
  d.autoTable({
    startY: yTop + 4,
    body: datos,
    theme: 'plain',
    styles: {
      fontSize: 9,
      cellPadding: 1.6
    },
    columnStyles: {
      0: {
        fontStyle: 'bold',
        cellWidth: 32
      },
      1: {
        cellWidth: 58
      },
      2: {
        fontStyle: 'bold',
        cellWidth: 26
      },
      3: {
        cellWidth: 'auto'
      }
    },
    margin: {
      left: 14,
      right: 14
    }
  });

  // Trabajo a realizar
  let yy = d.lastAutoTable.finalY + 5;
  d.setFontSize(10);
  d.setFont(undefined, 'bold');
  d.text('TRABAJO A REALIZAR', 14, yy);
  yy += 5;
  d.setFontSize(9);
  d.setFont(undefined, 'normal');
  const lTrabajo = d.splitTextToSize(r.trabajo || '—', 182);
  d.text(lTrabajo, 14, yy);
  yy += lTrabajo.length * 4.2 + 3;

  // Estado al ingresar (checklist en dos columnas)
  const mitad = Math.ceil(contextoApp.CHECKLIST.length / 2);
  const filasChk = [];
  for (let i = 0; i < mitad; i++) {
    const a = contextoApp.CHECKLIST[i],
      b = contextoApp.CHECKLIST[i + mitad];
    const val = it => {
      const v = it && r.checklist?.[it.k];
      return v === true ? 'SÍ' : v === false ? 'NO' : '—';
    };
    filasChk.push([a ? a.label : '', val(a), b ? b.label : '', b ? val(b) : '']);
  }
  d.autoTable({
    startY: yy,
    head: [['Estado al ingresar', '', '', '']],
    body: filasChk,
    theme: 'plain',
    styles: {
      fontSize: 8.5,
      cellPadding: 1.4,
      lineColor: [220, 220, 220],
      lineWidth: {
        bottom: 0.1
      }
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 10,
      lineWidth: {
        bottom: 0.6
      },
      lineColor: [0, 0, 0]
    },
    columnStyles: {
      0: {
        cellWidth: 60
      },
      1: {
        cellWidth: 31,
        fontStyle: 'bold'
      },
      2: {
        cellWidth: 60
      },
      3: {
        cellWidth: 31,
        fontStyle: 'bold'
      }
    },
    margin: {
      left: 14,
      right: 14
    }
  });
  yy = d.lastAutoTable.finalY + 5;
  if (r.obs) {
    d.setFontSize(9);
    d.setFont(undefined, 'bold');
    d.text('Observaciones: ', 14, yy);
    d.setFont(undefined, 'normal');
    const lObs = d.splitTextToSize(r.obs, 182);
    d.text(lObs, 14, yy + 4.2);
    yy += lObs.length * 4.2 + 6;
  }

  // Importes
  d.setDrawColor(0);
  d.setLineWidth(0.5);
  d.line(120, yy, 196, yy);
  yy += 5;
  d.setFontSize(9);
  d.setFont(undefined, 'normal');
  d.text('Presupuesto', 120, yy);
  d.text(money(r.precio), 196, yy, {
    align: 'right'
  });
  yy += 4.8;
  if (r.sena) {
    d.text('Seña' + (r.medio ? ' (' + r.medio + ')' : ''), 120, yy);
    d.text(money(r.sena), 196, yy, {
      align: 'right'
    });
    yy += 4.8;
  }
  d.setFont(undefined, 'bold');
  d.setFontSize(11);
  d.text(r.saldo > 0 ? 'SALDO A ABONAR' : 'PAGADO', 120, yy);
  d.text(money(r.saldo > 0 ? r.saldo : 0), 196, yy, {
    align: 'right'
  });
  yy += 5;
  if (r.tc) {
    d.setFont(undefined, 'normal');
    d.setFontSize(8);
    d.text('TC del día: ' + r.tc, 196, yy, {
      align: 'right'
    });
    yy += 4;
  }

  // Términos
  yy += 3;
  d.setLineWidth(0.5);
  d.line(14, yy, 196, yy);
  yy += 5;
  d.setFontSize(9);
  d.setFont(undefined, 'bold');
  d.text('TÉRMINOS Y CONDICIONES', 14, yy);
  yy += 4.5;
  d.setFont(undefined, 'normal');
  d.setFontSize(7.5);
  const lTerms = d.splitTextToSize(contextoApp.cfg.terms || contextoApp.TERMS_DEFAULT, 182);
  d.text(lTerms, 14, yy);
  yy += lTerms.length * 3.2 + 8;
  if (yy > 258) yy = 258;
  d.setFontSize(9);
  d.line(24, yy + 12, 90, yy + 12);
  d.text('Firma del cliente', 57, yy + 16.5, {
    align: 'center'
  });
  d.line(120, yy + 12, 186, yy + 12);
  d.text('Firma y sello del local', 153, yy + 16.5, {
    align: 'center'
  });
  d.setFontSize(8);
  d.text('Presentar esta orden para retirar el equipo.', 105, yy + 24, {
    align: 'center'
  });
  return d;
}

// Manda la orden en PDF por WhatsApp, como link a ver.html
export function inicializarReparaciones() {
  // ── Reparaciones ──────────────────────────────────────
  contextoApp.TERMS_VENTA_DEFAULT = `1. Garantia de equipos usados: 4 meses. Equipos nuevos: garantia del fabricante (no somos agentes oficiales).
2. La garantia cubre fallas de fabrica y aplica reparacion sin cargo. Devolucion del dinero solo dentro de las 48 hs de la compra.
3. La garantia se anula si: el equipo regresa sin caja y accesorios, presenta golpes, pantalla rota o sin templado, humedad, o fue cargado con cargador/toma defectuosa que dane un circuito.
4. Presentar este ticket para todo reclamo.`;
  contextoApp.TERMS_DEFAULT = `1. Si el equipo ingresa apagado, no podemos verificar su estado previo. La garantia cubre unicamente la reparacion detallada en esta orden.
2. Garantia: 90 dias en reparaciones generales, 30 dias en placa. Cubre solo la falla reparada.
3. Se anula la garantia si el equipo presenta golpes, humedad, o si las partes colocadas fueron manipuladas.
4. Dano por liquido: sin garantia de ningun tipo.
5. Garantia de pantalla: cubre fallas del tactil. No cubre roturas ni rayas por impacto.
6. Los plazos son estimativos y dependen de la disponibilidad de repuestos.
7. Pasados 60 dias del aviso de retiro, el equipo se considera abandonado (Arts. 2525/2526 CCyC).
8. El equipo se entrega contra presentacion de esta orden.`;
  contextoApp.CHECKLIST = [{
    k: 'prendido',
    label: 'Llega prendido'
  }, {
    k: 'faceid',
    label: 'Funciona el Face ID'
  }];
  contextoApp.ESTADOS = [{
    k: 'recibido',
    label: 'Recibido',
    cls: 'est-recibido',
    activo: true
  }, {
    k: 'taller',
    label: 'En taller de placa',
    cls: 'est-taller',
    activo: true
  }, {
    k: 'repuesto',
    label: 'Esperando repuesto',
    cls: 'est-repuesto',
    activo: true
  }, {
    k: 'reparado',
    label: 'Reparado',
    cls: 'est-reparado',
    activo: true
  }, {
    k: 'avisado',
    label: 'Cliente avisado',
    cls: 'est-avisado',
    activo: true
  }, {
    k: 'retirado',
    label: 'Retirado',
    cls: 'est-retirado',
    activo: false
  }, {
    k: 'cancel_cli',
    label: 'Cancelado por cliente',
    cls: 'est-cancel',
    activo: false
  }, {
    k: 'cancel_loc',
    label: 'Cancelado por local',
    cls: 'est-cancel',
    activo: false
  }, {
    k: 'abandono',
    label: 'Sin retirar +90 dias',
    cls: 'est-abandono',
    activo: false
  }, {
    k: 'importado_rd',
    label: 'Importado de RD',
    cls: 'est-retirado',
    activo: false
  }];
  contextoApp.estInfo = k => contextoApp.ESTADOS.find(e => e.k === k) || contextoApp.ESTADOS[0];
  contextoApp.repChecklist = {};
  contextoApp.repEditId = null;
  window.setChk = function (k, val) {
    contextoApp.repChecklist[k] = val;
    document.getElementById(`chk-${k}-si`).classList.toggle('on', val === true);
    document.getElementById(`chk-${k}-no`).classList.toggle('on', val === false);
  };
  window.setRepTab = function (tab, btn) {
    contextoApp.repTab = tab;
    document.querySelectorAll('#page-rep .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('rep-tab-lista').style.display = tab === 'nueva' ? 'none' : 'block';
    document.getElementById('rep-tab-nueva').style.display = tab === 'nueva' ? 'block' : 'none';
    if (tab !== 'nueva') renderReps();
  };
  window.calcRepTotales = function () {
    const p = parseFloat(document.getElementById('r-precio').value) || 0;
    const s = parseFloat(document.getElementById('r-sena').value) || 0;
    const m = document.getElementById('r-moneda').value;
    const tc = parseFloat(document.getElementById('r-tc').value) || null;
    const f = v => {
      if (!v) return '—';
      const otra = tc ? m === 'ARS' ? ' / ' + contextoApp.fmtUSD(v / tc) : ' / ' + contextoApp.fmtARS(v * tc) : '';
      return (m === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v) + otra;
    };
    document.getElementById('rp-total').textContent = f(p);
    document.getElementById('rp-sena').textContent = f(s);
    const sal = document.getElementById('rp-saldo');
    sal.textContent = f(p - s);
    sal.className = 'profit-val ' + (p - s <= 0 ? 'profit-pos' : '');
  };
  window.import3uRep = function () {
    const fi = document.getElementById('r-3u-file');
    const file = fi.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = e => {
      const d = parse3uReport(e.target.result);
      if (d.modelName) document.getElementById('r-equipo').value = [d.modelName, d.capacity, d.color].filter(Boolean).join(' ');
      if (d.imei) document.getElementById('r-imei').value = d.imei;
      if (d.bateria) document.getElementById('r-bateria').value = d.bateria;
      const ok = document.getElementById('r-import-ok');
      ok.style.display = 'block';
      setTimeout(() => ok.style.display = 'none', 3000);
      fi.value = '';
    };
    rd.readAsText(file);
  };
  window.guardarRep = async function () {
    const cliente = document.getElementById('r-cliente').value.trim();
    const equipo = document.getElementById('r-equipo').value.trim();
    const trabajo = document.getElementById('r-trabajo').value.trim();
    if (!cliente) {
      showToast('Completá el nombre del cliente.', true);
      return;
    }
    if (!equipo) {
      showToast('Completá el equipo.', true);
      return;
    }
    if (!trabajo) {
      showToast('Completá el trabajo a realizar.', true);
      return;
    }
    const precio = parseFloat(document.getElementById('r-precio').value) || 0;
    const sena = parseFloat(document.getElementById('r-sena').value) || 0;
    const moneda = document.getElementById('r-moneda').value;
    const tc = parseFloat(document.getElementById('r-tc').value) || null;
    const num = nextRepNum();
    const rep = {
      num,
      fecha: contextoApp.today(),
      hora: new Date().toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      cliente,
      tel: document.getElementById('r-tel').value.trim(),
      equipo,
      imei: document.getElementById('r-imei').value.trim(),
      clave: document.getElementById('r-clave').value.trim(),
      bateria: document.getElementById('r-bateria').value || null,
      checklist: {
        ...contextoApp.repChecklist
      },
      obs: document.getElementById('r-obs').value.trim(),
      trabajo,
      precio,
      sena,
      moneda,
      tc,
      saldo: precio - sena,
      medio: document.getElementById('r-medio').value,
      garantia: document.getElementById('r-garantia').value,
      entrega: document.getElementById('r-entrega').value || null,
      repuestos: [...contextoApp.repRepuestos],
      stockDescontado: false,
      estado: 'recibido',
      historial: [{
        fecha: contextoApp.today(),
        texto: 'Equipo recibido'
      }],
      createdAt: {
        seconds: Date.now() / 1000
      }
    };
    const btn = document.getElementById('btn-r-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      const cl = await resolverCliente(rep.cliente, rep.tel);
      if (cl) rep.clienteId = cl.id;
      const ref = await addDoc(contextoApp.repCol, contextoApp.withUser({
        ...rep,
        createdAt: serverTimestamp()
      }));
      showToast(`Ticket #${num} creado ✓`);
      ['r-cliente', 'r-tel', 'r-equipo', 'r-imei', 'r-clave', 'r-bateria', 'r-obs', 'r-trabajo', 'r-precio', 'r-sena', 'r-entrega'].forEach(i => document.getElementById(i).value = '');
      contextoApp.repChecklist = {};
      contextoApp.repRepuestos = [];
      renderRepuestosTags();
      contextoApp.CHECKLIST.forEach(i => {
        document.getElementById(`chk-${i.k}-si`).classList.remove('on');
        document.getElementById(`chk-${i.k}-no`).classList.remove('on');
      });
      window.calcRepTotales();
      // Abrir el ticket recién creado para imprimir
      setTimeout(() => window.abrirRep(ref.id), 400);
    } catch (e) {
      console.error(e);
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Recibir equipo y generar ticket';
  };
  window.abrirRep = function (id) {
    const r = contextoApp.reps.find(x => x.id === id);
    if (!r) return;
    contextoApp.repEditId = id;
    document.getElementById('rep-modal-title').textContent = `Ticket #${r.num}`;
    document.getElementById('rm-estado').value = r.estado;
    const chk = contextoApp.CHECKLIST.map(i => {
      const v = r.checklist?.[i.k];
      const t = v === true ? '<span style="color:#237A4B;font-weight:600">Si</span>' : v === false ? '<span style="color:var(--neg);font-weight:600">No</span>' : '—';
      return `<div class="rep-detail-row"><span class="k">${i.label}</span><span class="v">${t}</span></div>`;
    }).join('');
    const row = (k, v) => v ? `<div class="rep-detail-row"><span class="k">${k}</span><span class="v">${esc(String(v))}</span></div>` : '';
    const money = v => v ? (r.moneda === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v) + (r.tc ? r.moneda === 'ARS' ? ` / ${contextoApp.fmtUSD(v / r.tc)}` : ` / ${contextoApp.fmtARS(v * r.tc)}` : '') : '';
    document.getElementById('rep-modal-body').innerHTML = `
    ${row('Cliente', r.cliente)}
    ${row('Teléfono', r.tel)}
    ${row('Fecha', r.fecha + (r.hora ? ' ' + r.hora : ''))}
    ${row('Equipo', r.equipo)}
    ${row('IMEI', r.imei)}
    ${row('Clave', r.clave)}
    ${row('Batería', r.bateria ? r.bateria + '%' : '')}
    ${chk}
    ${r.obs ? `<div class="rep-detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="k">Observaciones</span><span class="v" style="text-align:left;font-weight:400;white-space:pre-wrap;">${esc(r.obs)}</span></div>` : ''}
    ${row('Trabajo', r.trabajo)}
    ${row('Garantía', r.garantia)}
    ${row('Entrega estimada', r.entrega)}
    <div class="rep-detail-row"><span class="k">Total</span><span class="v">${money(r.precio)}</span></div>
    ${r.sena ? `<div class="rep-detail-row"><span class="k">Seña${r.medio ? ' (' + esc(r.medio) + ')' : ''}</span><span class="v">${money(r.sena)}</span></div>` : ''}
    <div class="rep-detail-row"><span class="k" style="font-weight:600">Saldo</span><span class="v" style="color:${r.saldo > 0 ? 'var(--neg)' : '#237A4B'}">${r.saldo > 0 ? money(r.saldo) : 'PAGADO'}</span></div>
    ${r.tc ? `<div class="rep-detail-row"><span class="k">TC del ticket</span><span class="v">${r.tc}</span></div>` : ''}
  `;
    populateRepuestoSelects();
    document.getElementById('rm-repuestos-list').innerHTML = (r.repuestos || []).length ? r.repuestos.map((x, i) => `<div class="pago-item">
        <div class="pago-info"><div style="font-size:13px;">${x.libre ? '' : origenRep(x) === 'rep' ? '🧩 ' : '📦 '}${x.qty}x ${esc(x.nombre)}${x.libre ? ' <span style="font-size:10px;color:var(--text3);">🛒 comprado aparte</span>' : ''}</div>
        <div class="pago-fecha">${x.moneda === 'ARS' ? contextoApp.fmtARS((x.costo || 0) * x.qty) : 'u$s ' + (x.costo || 0) * x.qty}</div></div>
        <button class="ei-btn del" onclick="quitarRepuestoModal(${i})">×</button>
      </div>`).join('') + (r.stockDescontado ? '<div style="font-size:11px;color:var(--text3);margin-top:4px;">✓ Ya descontados del stock</div>' : '') : '<div style="font-size:12px;color:var(--text3);">Sin repuestos cargados.</div>';
    const h = (r.historial || []).slice().reverse();
    document.getElementById('rep-historial').innerHTML = h.length ? '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Historial</div>' + h.map(x => `<div class="pago-item"><div class="pago-info"><div style="font-size:13px;">${esc(x.texto)}</div><div class="pago-fecha">${x.fecha}</div></div></div>`).join('') : '';
    document.getElementById('rep-modal').classList.add('open');
  };
  window.closeRepModal = function () {
    document.getElementById('rep-modal').classList.remove('open');
    contextoApp.repEditId = null;
  };
  window.cambiarEstadoRep = async function () {
    if (!contextoApp.repEditId) return;
    const nuevo = document.getElementById('rm-estado').value;
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) return;
    if (r.estado === nuevo) return;
    // Retirar con saldo pendiente → cobrar y facturar primero
    // Retirar sin cargo (garantía) → ofrecer factura en $0
    if (nuevo === 'retirado' && r.origen !== 'repairdesk' && r.origen !== 'refurb' && ((r.saldo || 0) > 0 || (r.precio || 0) === 0)) {
      document.getElementById('rm-estado').value = r.estado; // revertir hasta confirmar
      abrirCR(r);
      return;
    }
    const hist = [...(r.historial || []), {
      fecha: contextoApp.today(),
      texto: 'Estado → ' + contextoApp.estInfo(nuevo).label
    }];
    const updates = {
      estado: nuevo,
      historial: hist
    };
    setSyncDot('syncing');
    try {
      // Al pasar a "reparado": descontar repuestos del inventario (una sola vez)
      if (nuevo === 'reparado' && !r.stockDescontado && (r.repuestos || []).length) {
        for (const x of r.repuestos) {
          if (x.libre || !x.refId) continue; // comprado aparte: no toca stock
          await ajustarStockRepuesto(origenRep(x), x.refId, -(x.qty || 1));
        }
        updates.stockDescontado = true;
        hist.push({
          fecha: contextoApp.today(),
          texto: 'Repuestos descontados del stock'
        });
      }
      // Refurbishment terminado: sumar el costo de repuestos al costo del equipo
      if (r.origen === 'refurb' && (nuevo === 'reparado' || nuevo === 'retirado') && r.refEquipoId) {
        const eq = contextoApp.stockItems.find(x => x.id === r.refEquipoId);
        const costoRep = Math.round(costoRepuestosUSD(r) * 100) / 100;
        if (eq) {
          const nuevoValor = Math.round(((eq.valorUSD || 0) + costoRep) * 100) / 100;
          await updateDoc(doc(contextoApp.db, 'stock', r.refEquipoId), {
            refurb: false,
            valorUSD: nuevoValor,
            notas: ((eq.notas ? eq.notas + ' · ' : '') + `Refurb #${r.num}: +u$s ${costoRep} en repuestos`).slice(0, 500)
          });
          hist.push({
            fecha: contextoApp.today(),
            texto: `✅ Refurb terminado — u$s ${costoRep} sumados al costo del equipo (nuevo costo: u$s ${nuevoValor})`
          });
        }
        updates.estado = 'retirado';
        updates.fechaRetiro = contextoApp.today();
        updates.historial = hist;
      }
      await updateDoc(doc(contextoApp.db, 'reparaciones', contextoApp.repEditId), updates);
      showToast('Estado actualizado ✓');
      setTimeout(() => window.abrirRep(contextoApp.repEditId), 300);
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.agregarNotaRep = async function () {
    if (!contextoApp.repEditId) return;
    const inp = document.getElementById('rm-nota');
    const txt = inp.value.trim();
    if (!txt) return;
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) return;
    const hist = [...(r.historial || []), {
      fecha: contextoApp.today(),
      texto: txt
    }];
    inp.value = '';
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'reparaciones', contextoApp.repEditId), {
        historial: hist
      });
      setTimeout(() => window.abrirRep(contextoApp.repEditId), 300);
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.eliminarRep = async function () {
    if (!contextoApp.repEditId) return;
    if (!confirm('¿Eliminar este ticket? No se puede deshacer.')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'reparaciones', contextoApp.repEditId));
      window.closeRepModal();
      showToast('Ticket eliminado');
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.generarListaPrecios = function () {
    const disponibles = [...contextoApp.stockItems.filter(s => s.status === 'en_stock' && !s.refurb).map(s => ({
      nombre: s.nombre || '',
      gb: s.gb || '',
      color: s.color || '',
      bateria: s.bateria,
      ciclos: s.ciclos,
      precio: Math.round(s.precioVentaUSD || s.valorUSD || 0)
    })), ...contextoApp.consigItems.filter(x => x.status === 'en_stock').map(x => ({
      nombre: [x.producto, x.gb].filter(Boolean).join(' '),
      gb: x.gb || '',
      color: x.color || '',
      bateria: x.bateria,
      ciclos: x.ciclos,
      precio: Math.round(x.precioVentaUSD || x.precioUSD || 0)
    }))];
    if (!disponibles.length) {
      showToast('No hay equipos en stock.', true);
      return;
    }
    const iphones = [],
      otros = [];
    disponibles.forEach(e => {
      e.rank = rankModelo(e.nombre);
      (e.rank ? iphones : otros).push(e);
    });
    iphones.sort((a, b) => a.rank.gen - b.rank.gen || a.rank.variante - b.rank.variante || a.rank.cap - b.rank.cap || a.precio - b.precio);
    otros.sort((a, b) => contextoApp.COLL.compare(a.nombre, b.nombre));
    const fmt = e => {
      let nombre = e.nombre;
      if (e.gb && !nombre.toLowerCase().includes(e.gb.toLowerCase().replace(/\s/g, '')) && !nombre.toLowerCase().includes(e.gb.toLowerCase())) nombre += ' ' + e.gb;
      nombre = nombre.replace(/(\d+)(gb|tb)/i, '$1 ' + '$2'.toUpperCase()).replace(/(\d+) (gb|tb)/i, (m, d, u) => d + ' ' + u.toUpperCase());
      const lineas = [`▪️ ${nombre} — USD ${e.precio.toLocaleString('es-AR')}`];
      if (e.color) lineas.push(`▫️ Color: ${e.color}`);
      if (e.bateria) lineas.push(`▫️ Batería: ${e.bateria}%${e.ciclos ? ` (${e.ciclos} ciclos)` : ''}`);
      return lineas.join('\n');
    };
    let out = `📱 IPHONES USADOS INMACULADOS\n✨ Todo original. Sin pulir.\n📦 Incluyen caja, cable original, funda y vidrio.\n`;
    out += iphones.map(fmt).join('\n');
    if (otros.length) out += `\n\n📟 OTROS EQUIPOS\n` + otros.map(fmt).join('\n');
    document.getElementById('pl-text').value = out;
    document.getElementById('pl-modal').classList.add('open');
  };
  window.copiarLista = async function () {
    try {
      await navigator.clipboard.writeText(document.getElementById('pl-text').value);
      showToast('Lista copiada ✓ — pegala donde quieras');
    } catch (e) {
      document.getElementById('pl-text').select();
      document.execCommand('copy');
      showToast('Lista copiada ✓');
    }
  };
  window.compartirListaWa = function () {
    const txt = document.getElementById('pl-text').value;
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
  };

  // ── Historiales rápidos del POS (estilo RepairDesk) ───
  // ── Refurbishment: reparación interna de un equipo del stock ──
  window.mandarARefurb = async function (stockId) {
    const s = contextoApp.stockItems.find(x => x.id === stockId);
    if (!s) return;
    const trabajo = prompt(`🔨 ${s.nombre}\n\n¿Qué hay que repararle? (ej: cambio de pantalla y batería)`);
    if (trabajo === null) return;
    setSyncDot('syncing');
    try {
      const num = nextRepNum();
      await addDoc(contextoApp.repCol, contextoApp.withUser({
        num,
        fecha: contextoApp.today(),
        cliente: 'MarplaCity (interno)',
        clienteId: null,
        tel: '',
        equipo: [s.nombre, s.color].filter(Boolean).join(' '),
        imei: s.imei || '',
        clave: '',
        trabajo: trabajo.trim() || 'Reacondicionamiento',
        precio: 0,
        sena: 0,
        saldo: 0,
        moneda: 'USD',
        tc: null,
        checklist: {},
        obs: 'Equipo propio del stock — refurbishment',
        garantia: '',
        entrega: null,
        repuestos: [],
        stockDescontado: false,
        estado: 'recibido',
        origen: 'refurb',
        refEquipoId: s.id,
        historial: [{
          fecha: contextoApp.today(),
          texto: '🔨 Enviado a refurbishment'
        }],
        createdAt: serverTimestamp()
      }));
      await updateDoc(doc(contextoApp.db, 'stock', s.id), {
        refurb: true
      });
      showToast(`🔨 Ticket #${num} creado — ${s.nombre} en fila de reparación`);
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
  };
  window.abrirTkHistory = function () {
    document.getElementById('tkh-modal').classList.add('open');
    renderTkHistory();
  };
  window.closeTkH = function () {
    document.getElementById('tkh-modal').classList.remove('open');
  };
  window.abrirFactHistory = function () {
    document.getElementById('fkh-modal').classList.add('open');
    renderFkHistory();
  };
  window.closeFkH = function () {
    document.getElementById('fkh-modal').classList.remove('open');
  };
  contextoApp.crRep = null;
  contextoApp.crMedios = [];
  window.closeCR = function () {
    document.getElementById('cr-modal').classList.remove('open');
    contextoApp.crRep = null;
    contextoApp.crMedios = [];
  };
  window.crAddMedio = function () {
    const val = parseFloat(document.getElementById('cr-med-val').value);
    if (!val || val <= 0) {
      showToast('Ingresá un monto', true);
      return;
    }
    let moneda = document.getElementById('cr-med-mon').value;
    if (moneda === 'USD' && val >= 20000 && confirm(`⚠️ u$s ${val.toLocaleString('es-AR')} parece un monto en PESOS. ¿Lo cargo como ARS?`)) moneda = 'ARS';
    if (moneda === 'ARS' && val <= 2000 && confirm(`⚠️ $ ${val.toLocaleString('es-AR')} pesos — ¿no serán dólares? ¿Lo cargo como USD?`)) moneda = 'USD';
    contextoApp.crMedios.push({
      medio: document.getElementById('cr-med-sel').value,
      valor: val,
      moneda
    });
    document.getElementById('cr-med-val').value = '';
    renderCRMedios();
  };
  window.crDelMedio = function (i) {
    contextoApp.crMedios.splice(i, 1);
    renderCRMedios();
  };
  window.crCompletar = function () {
    const t = crTotals();
    const moneda = document.getElementById('cr-med-mon').value;
    let resto = moneda === 'USD' ? Math.round((t.saldoUSD - t.pUSD) * 100) / 100 : Math.round(t.saldoARS - t.pARS);
    if (resto <= 0) {
      showToast('El saldo ya está cubierto ✓');
      return;
    }
    document.getElementById('cr-med-val').value = resto;
    document.getElementById('cr-med-val').focus();
  };
  window.cobrarRep = async function (imprimir) {
    const r = contextoApp.crRep;
    if (!r) return;
    const sinCargo = (r.precio || 0) === 0;
    if (!sinCargo && !contextoApp.crMedios.length) {
      showToast('Agregá al menos un medio de cobro.', true);
      return;
    }
    const btn = document.getElementById('btn-cr-cobrar');
    btn.disabled = true;
    btn.textContent = 'Cobrando...';
    setSyncDot('syncing');
    try {
      const numVenta = contextoApp.ingresos.reduce((m, x) => Math.max(m, x.numVenta || 0), 0) + 1;
      const tc = r.tc || parseFloat(contextoApp.cfg.tc) || null;
      const saldo = r.saldo || 0;
      const totalARS = r.moneda === 'ARS' ? saldo : tc ? Math.round(saldo * tc) : null;
      const totalUSD = r.moneda === 'USD' ? saldo : tc ? Math.round(saldo / tc * 100) / 100 : null;
      const venta = {
        fecha: contextoApp.today(),
        hora: new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        numVenta,
        nombre: `Reparación #${r.num} — ${r.trabajo || ''}${sinCargo ? ' — SIN CARGO (garantía)' : ''}`,
        categoria: 'Reparación',
        clienteId: r.clienteId || null,
        clienteNombre: r.cliente || 'Consumidor final',
        imei: r.imei || '',
        items: [{
          tipo: 'rep',
          refId: r.id,
          nombre: `🔧 Rep. #${r.num} · ${r.equipo || ''} · ${r.trabajo || ''}`,
          qty: 1,
          precio: saldo,
          moneda: r.moneda || 'ARS',
          costo: 0,
          imei: r.imei || ''
        }],
        medios: [...contextoApp.crMedios],
        permuta: null,
        tc,
        totalARS,
        totalUSD,
        gananciaARS: null,
        gananciaUSD: null,
        notas: sinCargo ? '🛡 Trabajo sin cargo — cubierto por garantía del local' : r.sena ? `Seña previa: ${r.moneda === 'ARS' ? contextoApp.fmtARS(r.sena) : 'u$s ' + r.sena}${r.medio ? ' (' + r.medio + ')' : ''} — ${r.fecha}` : '',
        origen: 'pos',
        createdAt: {
          seconds: Date.now() / 1000
        }
      };
      await addDoc(contextoApp.ingresosCol, contextoApp.withUser({
        ...venta,
        createdAt: serverTimestamp()
      }));
      const hist = [...(r.historial || []), {
        fecha: contextoApp.today(),
        texto: `💰 Saldo cobrado y facturado (#V-${numVenta}) → Retirado`
      }];
      await updateDoc(doc(contextoApp.db, 'reparaciones', r.id), {
        sena: r.precio || 0,
        saldo: 0,
        estado: 'retirado',
        fechaRetiro: contextoApp.today(),
        historial: hist
      });
      showToast(`Factura #V-${numVenta} generada ✓`);
      if (imprimir) imprimirTicketVenta(venta);
      window.closeCR();
      setTimeout(() => window.abrirRep(r.id), 300);
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = '🖨 Cobrar, facturar y retirar';
  };
  window.retirarSinFacturar = async function () {
    const r = contextoApp.crRep;
    if (!r) return;
    if (!confirm('El equipo se marca como retirado con el saldo en cero, SIN generar factura. ¿Continuar?')) return;
    setSyncDot('syncing');
    try {
      const hist = [...(r.historial || []), {
        fecha: contextoApp.today(),
        texto: 'Retirado sin facturar (marcado manualmente)'
      }];
      await updateDoc(doc(contextoApp.db, 'reparaciones', r.id), {
        sena: r.precio || 0,
        saldo: 0,
        estado: 'retirado',
        fechaRetiro: contextoApp.today(),
        historial: hist
      });
      window.closeCR();
      setTimeout(() => window.abrirRep(r.id), 300);
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };

  // ── Edición de tickets ──
  contextoApp.repEditFormId = null;
  window.abrirRepEdit = function () {
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) return;
    contextoApp.repEditFormId = contextoApp.repEditId;
    // cerrar el modal de detalle para que no tape (sin perder el id)
    document.getElementById('rep-modal').classList.remove('open');
    document.getElementById('red-title').textContent = 'Editar ticket #' + r.num;
    document.getElementById('red-cliente').value = r.cliente || '';
    document.getElementById('red-tel').value = r.tel || '';
    document.getElementById('red-equipo').value = r.equipo || '';
    document.getElementById('red-imei').value = r.imei || '';
    document.getElementById('red-clave').value = r.clave || '';
    document.getElementById('red-bateria').value = r.bateria || '';
    document.getElementById('red-obs').value = r.obs || '';
    document.getElementById('red-trabajo').value = r.trabajo || '';
    document.getElementById('red-precio').value = r.precio || '';
    document.getElementById('red-moneda').value = r.moneda || 'ARS';
    document.getElementById('red-tc').value = r.tc || '';
    document.getElementById('red-sena').value = r.sena || '';
    document.getElementById('red-garantia').value = r.garantia || '90 días';
    document.getElementById('red-entrega').value = r.entrega || '';
    document.getElementById('rep-edit-modal').classList.add('open');
  };
  window.closeRepEditModal = function () {
    document.getElementById('rep-edit-modal').classList.remove('open');
  };
  window.saveRepEdit = async function () {
    if (!contextoApp.repEditFormId) return;
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditFormId);
    if (!r) return;
    const cliente = document.getElementById('red-cliente').value.trim();
    const equipo = document.getElementById('red-equipo').value.trim();
    if (!cliente || !equipo) {
      showToast('Cliente y equipo no pueden quedar vacíos.', true);
      return;
    }
    const precio = parseFloat(document.getElementById('red-precio').value) || 0;
    const sena = parseFloat(document.getElementById('red-sena').value) || 0;
    const data = {
      cliente,
      tel: document.getElementById('red-tel').value.trim(),
      equipo,
      imei: document.getElementById('red-imei').value.trim(),
      clave: document.getElementById('red-clave').value.trim(),
      bateria: document.getElementById('red-bateria').value || null,
      obs: document.getElementById('red-obs').value.trim(),
      trabajo: document.getElementById('red-trabajo').value.trim(),
      precio,
      sena,
      saldo: precio - sena,
      moneda: document.getElementById('red-moneda').value,
      tc: parseFloat(document.getElementById('red-tc').value) || null,
      garantia: document.getElementById('red-garantia').value,
      entrega: document.getElementById('red-entrega').value || null,
      historial: [...(r.historial || []), {
        fecha: contextoApp.today(),
        texto: '✏️ Ticket editado'
      }]
    };
    const btn = document.getElementById('red-save');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      const cl = await resolverCliente(cliente, data.tel);
      if (cl) data.clienteId = cl.id;
      await updateDoc(doc(contextoApp.db, 'reparaciones', contextoApp.repEditFormId), data);
      showToast('Ticket actualizado ✓');
      window.closeRepEditModal();
      setTimeout(() => window.abrirRep(contextoApp.repEditFormId), 300);
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  };

  // ── Ticket térmico 80mm ──
  window.imprimirTicket = function () {
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) return;
    const money = v => {
      if (!v) return r.moneda === 'ARS' ? contextoApp.fmtARS(0) : 'u$s 0';
      const base = r.moneda === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v;
      const alt = r.tc ? r.moneda === 'ARS' ? contextoApp.fmtUSD(v / r.tc) : contextoApp.fmtARS(v * r.tc) : null;
      return alt ? `${base} / ${alt}` : base;
    };
    const chk = contextoApp.CHECKLIST.map(i => {
      const v = r.checklist?.[i.k];
      return `<div class="tk-r"><span>${i.label}</span><span class="v tk-b">${v === true ? 'SI' : v === false ? 'NO' : '-'}</span></div>`;
    }).join('');
    document.getElementById('ticket-print').innerHTML = `
    <div class="tk-h1">ORDEN DE REPARACION<br>#${r.num}</div>
    <div class="tk-local">
      <div class="tk-b">${esc(contextoApp.cfg.localNombre || 'MarplaCity')}</div>
      ${contextoApp.cfg.localDir ? `<div>${esc(contextoApp.cfg.localDir)}</div>` : ''}
      ${contextoApp.cfg.localTel ? `<div>Tel: ${esc(contextoApp.cfg.localTel)}</div>` : ''}
      ${contextoApp.cfg.localWeb ? `<div>${esc(contextoApp.cfg.localWeb)}</div>` : ''}
    </div>
    <div class="tk-sep"></div>
    <div class="tk-r"><span>Fecha</span><span class="v">${r.fecha} ${r.hora || ''}</span></div>
    <div class="tk-r"><span>Cliente</span><span class="v tk-b">${esc(r.cliente)}</span></div>
    ${r.tel ? `<div class="tk-r"><span>Tel</span><span class="v">${esc(r.tel)}</span></div>` : ''}
    <div class="tk-sep"></div>
    <div class="tk-r"><span>Equipo</span><span class="v tk-b">${esc(r.equipo)}</span></div>
    ${r.imei ? `<div class="tk-r"><span>IMEI</span><span class="v">${esc(r.imei)}</span></div>` : ''}
    ${r.clave ? `<div class="tk-r"><span>Clave</span><span class="v">${esc(r.clave)}</span></div>` : ''}
    ${r.bateria ? `<div class="tk-r"><span>Bateria</span><span class="v">${esc(r.bateria)}%</span></div>` : ''}
    <div class="tk-sep"></div>
    <div class="tk-b" style="margin-bottom:1mm;">TRABAJO A REALIZAR</div>
    <div>${esc(r.trabajo)}</div>
    <div class="tk-sep"></div>
    <div class="tk-b" style="margin-bottom:1mm;">ESTADO AL INGRESAR</div>
    ${chk}
    ${r.obs ? `<div class="tk-obs">${esc(r.obs)}</div>` : ''}
    <div class="tk-sep"></div>
    <div class="tk-tot"><span>TOTAL</span><span>${money(r.precio)}</span></div>
    ${r.sena ? `<div class="tk-r"><span>Sena${r.medio ? ' (' + esc(r.medio) + ')' : ''}</span><span class="v">${money(r.sena)}</span></div>` : ''}
    <div class="tk-tot"><span>${r.saldo > 0 ? 'SALDO' : 'PAGADO'}</span><span>${r.saldo > 0 ? money(r.saldo) : money(0)}</span></div>
    ${r.tc ? `<div class="tk-r" style="font-size:9px;"><span>TC del dia</span><span class="v">${r.tc}</span></div>` : ''}
    <div class="tk-r"><span>Garantia</span><span class="v tk-b">${esc(r.garantia || '-')}</span></div>
    ${r.entrega ? `<div class="tk-r"><span>Entrega estimada</span><span class="v">${r.entrega}</span></div>` : ''}
    <div class="tk-sep"></div>
    <div class="tk-b" style="margin-bottom:1mm;">TERMINOS Y CONDICIONES</div>
    <div class="tk-terms">${esc(contextoApp.cfg.terms || contextoApp.TERMS_DEFAULT)}</div>
    <div class="tk-sig">Firma del cliente</div>
    <div class="tk-sep"></div>
    <div class="tk-c tk-b" style="font-size:14px;margin:2mm 0;">#${r.num}</div>
    <div class="tk-c" style="font-size:9px;">Presentar esta orden para retirar el equipo</div>
  `;
    printTicket80('Ticket reparación');
  };
  window.enviarOrdenWa = async function (id) {
    const r = contextoApp.reps.find(x => x.id === (id || contextoApp.repEditId));
    if (!r) {
      showToast('Ticket no encontrado.', true);
      return;
    }
    if (!r.tel) {
      showToast('Este ticket no tiene teléfono cargado. Agregalo con ✏️ Editar.', true);
      return;
    }
    const num = waNumber(r.tel);
    if (!num) {
      showToast('El teléfono del ticket no es válido.', true);
      return;
    }
    const nombreArchivo = 'Orden-' + (r.num || '') + '.pdf';
    let pdf;
    try {
      pdf = generarOrdenPDF(r, {
        publico: true
      });
    } catch (e) {
      console.error(e);
      showToast('Error generando el PDF: ' + e.message, true);
      return;
    }
    const w = abrirPestanaDiferida();
    const tpl = waTpl(contextoApp.cfg.waCreado, contextoApp.WA_DEFAULTS.creado);
    const texto = tpl.replaceAll('{cliente}', (r.cliente || '').split(' ')[0]).replaceAll('{ticket}', String(r.num || '')).replaceAll('{equipo}', r.equipo || '').replaceAll('{imei}', r.imei || '—').replaceAll('{trabajo}', r.trabajo || '').replaceAll('{saldo}', (r.saldo || 0) > 0 ? 'Saldo a abonar: ' + (r.moneda === 'ARS' ? contextoApp.fmtARS(r.saldo) : 'u$s ' + r.saldo) + '. ' : '').replaceAll('{horario}', contextoApp.cfg.localHorario || 'consultar').replaceAll('{local}', contextoApp.cfg.localNombre || 'MarplaCity');
    let link;
    try {
      link = await publicarPDF(pdf, {
        tipo: 'orden',
        titulo: 'Orden de reparación #' + (r.num || ''),
        cliente: r.cliente || '',
        fecha: r.fecha || contextoApp.today(),
        local: contextoApp.cfg.localNombre || 'MarplaCity',
        archivo: nombreArchivo
      });
    } catch (e) {
      console.error(e);
      if (w && !w.closed) w.close();
      pdf.save(nombreArchivo);
      await mandarLinkWa(null, num, texto);
      showToast('No se pudo publicar el link (' + e.message + ') — PDF descargado, arrastralo al chat 📎', true);
      return;
    }
    await mandarLinkWa(w, num, texto + '\n\n📄 Tu orden en PDF:\n' + link);
    const hist = [...(r.historial || []), {
      fecha: contextoApp.today(),
      texto: '📱 WhatsApp enviado: orden creada (PDF)'
    }];
    updateDoc(doc(contextoApp.db, 'reparaciones', r.id), {
      historial: hist
    }).catch(() => {});
  };

  // Descargar la orden en A4 sin enviarla (acá sí va la clave del equipo)
  window.ordenPDFActual = function () {
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) {
      showToast('Ticket no encontrado.', true);
      return;
    }
    try {
      generarOrdenPDF(r).save('Orden-' + (r.num || '') + '.pdf');
    } catch (e) {
      console.error(e);
      showToast('Error generando el PDF: ' + e.message, true);
    }
  };

  // ── Stock permutas ────────────────────────────────────
}
