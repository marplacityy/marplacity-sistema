import { configuracion } from '../core/config-publica.js';
/** modulos/facturas: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, showToast } from '../core/interfaz.js';
import { posCatalog, imprimirTicketVenta } from './pos.js';
import { setSyncDot } from '../core/datos.js';
import { updateDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { resolverCliente } from './clientes.js';
import { waNumber } from './whatsapp.js';
import imprimirDocumentoUrl from '../core/imprimir-documento.js?url&no-inline';

export function renderFE() {
  document.getElementById('fe-items').innerHTML = contextoApp.feItems.length ? contextoApp.feItems.map((it, i) => `
    <div class="cart-item">
      <input type="text" class="cart-precio" style="flex:1;width:auto;text-align:left;font-family:inherit;" value="${esc(it.nombre)}" onchange="feSetNombre(${i},this.value)">
      ${it.tipo === 'inv' || it.tipo === 'imp' || it.tipo === 'manual' ? `
        <div class="cart-qty">
          <button onclick="feQty(${i},-1)">−</button><span>${it.qty || 1}</span><button onclick="feQty(${i},1)">+</button>
        </div>` : `<span style="font-size:11px;color:var(--text3);">×1</span>`}
      <input type="number" class="cart-precio" value="${esc(it.precio)}" step="0.01" min="0" onchange="feSetPrecio(${i},this.value)">
      <span style="font-size:10px;color:var(--text3);">${it.moneda}</span>
      <button class="cart-del" onclick="feDel(${i})">×</button>
    </div>`).join('') : '<div class="home-empty">Sin items — agregá al menos uno.</div>';
  renderFETot();
}
export function feTotals() {
  const v = contextoApp.ingresos.find(x => x.id === contextoApp.feId);
  const tc = v?.tc || parseFloat(contextoApp.cfg.tc) || null;
  let tARS = 0,
    tUSD = 0,
    pARS = 0,
    pUSD = 0;
  contextoApp.feItems.forEach(it => {
    const sub = (it.precio || 0) * (it.qty || 1);
    if (it.moneda === 'ARS') {
      tARS += sub;
      if (tc) tUSD += sub / tc;
    } else {
      tUSD += sub;
      if (tc) tARS += sub * tc;
    }
  });
  contextoApp.feMedios.forEach(mm => {
    if (mm.moneda === 'ARS') {
      pARS += mm.valor || 0;
      if (tc) pUSD += (mm.valor || 0) / tc;
    } else {
      pUSD += mm.valor || 0;
      if (tc) pARS += (mm.valor || 0) * tc;
    }
  });
  if (v?.permuta) {
    const pv = v.permuta.valor || 0;
    if (v.permuta.moneda === 'ARS') {
      pARS += pv;
      if (tc) pUSD += pv / tc;
    } else {
      pUSD += pv;
      if (tc) pARS += pv * tc;
    }
  }
  return {
    tc,
    tARS,
    tUSD,
    pARS,
    pUSD
  };
}
export function renderFEMedios() {
  document.getElementById('fe-medios-tags').innerHTML = contextoApp.feMedios.map((mm, i) => `<div class="medio-tag"><span>${esc(mm.medio)} · ${mm.moneda === 'USD' ? 'u$s ' : '$ '}${(mm.valor || 0).toLocaleString('es-AR')}</span><button onclick="feDelMedio(${i})">×</button></div>`).join('');
  renderFETot();
}
export function renderFETot() {
  const t = feTotals();
  document.getElementById('fe-tot').textContent = [t.tARS ? contextoApp.fmtARS(Math.round(t.tARS)) : null, t.tUSD ? 'u$s ' + Math.round(t.tUSD * 100) / 100 : null].filter(Boolean).join(' / ') || '—';
  document.getElementById('fe-pagado').textContent = [t.pARS ? contextoApp.fmtARS(Math.round(t.pARS)) : null, t.pUSD ? 'u$s ' + Math.round(t.pUSD * 100) / 100 : null].filter(Boolean).join(' / ') || '—';
  const el = document.getElementById('fe-resto');
  const resto = t.tc ? t.tUSD - t.pUSD : t.tUSD > 0 ? t.tUSD - t.pUSD : t.tARS - t.pARS;
  const restoStr = t.tc ? [contextoApp.fmtARS(Math.abs(Math.round(t.tARS - t.pARS))), 'u$s ' + Math.abs(Math.round((t.tUSD - t.pUSD) * 100) / 100)].join(' / ') : String(Math.abs(Math.round(resto * 100) / 100));
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
export function tokenPublico() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function publicarPDF(pdf, meta) {
  const b64 = pdf.output('datauristring').split(',')[1] || '';
  if (!b64) throw new Error('no se pudo serializar el PDF');
  // Firestore corta en 1 MiB por documento; el resto de los campos es despreciable
  // pero dejamos margen para no chocar contra el límite justo al guardar.
  if (b64.length > 800000) throw new Error('el PDF pesa demasiado para enviarse por link');
  const token = tokenPublico();
  await setDoc(doc(contextoApp.db, 'docs_publicos', token), contextoApp.withUser({
    ...meta,
    pdf: b64,
    createdAt: serverTimestamp()
  }));
  return contextoApp.BASE_PUBLICA + 'ver.html?id=' + token;
}

// La pestaña hay que abrirla ANTES del await de publicarPDF: si se abriera
// después, el navegador ya perdió el gesto del usuario y la bloquea como popup.
export function abrirPestanaDiferida() {
  let w = null;
  try {
    w = window.open('', '_blank');
  } catch (e) {/* bloqueada */}
  if (w && w.document) {
    w.document.write('<!doctype html><meta charset="utf-8"><title>Preparando…</title>' + '<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;' + 'height:100vh;margin:0;color:#57534e">Preparando el envío…</body>');
    w.document.close();
  }
  return w;
}
export async function mandarLinkWa(w, num, msg) {
  const url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
  if (w && !w.closed) {
    w.location.href = url;
    return;
  }
  if (window.open(url, '_blank')) return;
  // Popup bloqueado y sin pestaña previa: al menos que no pierda el mensaje
  try {
    await navigator.clipboard.writeText(msg);
    showToast('El navegador bloqueó la ventana — copiamos el mensaje con el link al portapapeles 📋');
  } catch (e) {
    showToast('El navegador bloqueó la ventana de WhatsApp. Permití las ventanas emergentes de este sitio.', true);
  }
}

// Teléfono del cliente de una factura: ficha en Clientes → tel suelto (importadas)
export function telDeFactura(v) {
  let tel = '';
  if (v.clienteId) tel = contextoApp.clientesItems.find(x => x.id === v.clienteId)?.tel || '';
  return tel || v.tel || '';
}
export function generarFacturaPDF(v) {
  const {
    jsPDF
  } = window.jspdf;
  const d = new jsPDF({
    unit: 'mm',
    format: 'a4'
  });
  const items = v.items && v.items.length ? v.items : [{
    nombre: v.nombre || 'Venta',
    qty: 1,
    precio: v.totalARS || v.totalUSD || v.monto || 0,
    moneda: v.totalUSD && !v.totalARS ? 'USD' : 'ARS',
    imei: v.imei || ''
  }];
  const m = (val, mon) => mon === 'ARS' ? '$ ' + Math.round(val).toLocaleString('es-AR') : 'u$s ' + Math.round(val * 100) / 100;

  // Header
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
  d.setFontSize(16);
  d.setFont(undefined, 'bold');
  d.text('FACTURA ' + (v.numVenta ? '#V-' + v.numVenta : ''), 196, 20, {
    align: 'right'
  });
  d.setFontSize(9);
  d.setFont(undefined, 'normal');
  d.text('Fecha: ' + (v.fecha || '') + ' ' + (v.hora || ''), 196, 26, {
    align: 'right'
  });
  d.text(v.clienteNombre && v.clienteNombre !== 'Consumidor final' ? 'Cliente: ' + v.clienteNombre : 'Consumidor final', 196, 30.5, {
    align: 'right'
  });
  d.setDrawColor(0);
  d.setLineWidth(0.8);
  d.line(14, Math.max(y, 34), 196, Math.max(y, 34));

  // Tabla de items
  const rows = items.map(ci => {
    const specs = [ci.gb, ci.color, ci.bateria ? 'Bateria ' + ci.bateria + '%' : null].filter(Boolean).join(' · ');
    let det = ci.nombre;
    if (specs) det += '\n' + specs;
    if (ci.imei) det += '\nIMEI: ' + ci.imei;
    return [det, String(ci.qty || 1), m(ci.precio || 0, ci.moneda || 'ARS'), m((ci.precio || 0) * (ci.qty || 1), ci.moneda || 'ARS')];
  });
  (v.cortesias || []).forEach(co => rows.push(['🎁 ' + co.nombre + ' — CORTESIA', '1', '$ 0', '$ 0']));
  d.autoTable({
    startY: Math.max(y, 34) + 3,
    head: [['Detalle', 'Cant.', 'Precio', 'Subtotal']],
    body: rows,
    theme: 'plain',
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [200, 200, 200],
      lineWidth: {
        bottom: 0.2
      }
    },
    headStyles: {
      fontStyle: 'bold',
      lineWidth: {
        bottom: 0.6
      },
      lineColor: [0, 0, 0]
    },
    columnStyles: {
      1: {
        halign: 'center',
        cellWidth: 16
      },
      2: {
        halign: 'right',
        cellWidth: 30
      },
      3: {
        halign: 'right',
        cellWidth: 32
      }
    },
    margin: {
      left: 14,
      right: 14
    }
  });
  let yy = d.lastAutoTable.finalY + 6;
  const totalStr = [v.totalARS ? '$ ' + Math.round(v.totalARS).toLocaleString('es-AR') : null, v.totalUSD ? 'u$s ' + v.totalUSD : null].filter(Boolean).join('  /  ');
  d.setFontSize(13);
  d.setFont(undefined, 'bold');
  d.text('TOTAL: ' + (totalStr || '—'), 196, yy, {
    align: 'right'
  });
  yy += 6;
  d.setFontSize(9);
  d.setFont(undefined, 'normal');
  const medios = (v.medios || []).map(mm => mm.medio + ': ' + m(mm.valor, mm.moneda)).join(' · ');
  if (medios) {
    d.text('Pagado con: ' + medios, 14, yy);
    yy += 4.5;
  }
  if (v.permuta) {
    d.text('Permuta: ' + (v.permuta.descripcion || '') + ' — ' + m(v.permuta.valor, v.permuta.moneda), 14, yy);
    yy += 4.5;
  }
  if (v.tc) {
    d.text('TC del día: ' + v.tc, 14, yy);
    yy += 4.5;
  }
  if (v.notas) {
    d.text(String(v.notas).slice(0, 100), 14, yy);
    yy += 4.5;
  }

  // Términos si hay equipo con IMEI
  const tieneImei = items.some(ci => ci.imei) || !!v.imei;
  if (tieneImei) {
    yy += 3;
    d.setLineWidth(0.5);
    d.line(14, yy, 196, yy);
    yy += 5;
    d.setFont(undefined, 'bold');
    d.text('TÉRMINOS Y GARANTÍA', 14, yy);
    yy += 4.5;
    d.setFont(undefined, 'normal');
    d.setFontSize(7.5);
    const terms = contextoApp.cfg.termsVenta || contextoApp.TERMS_VENTA_DEFAULT;
    const lines = d.splitTextToSize(terms, 182);
    d.text(lines, 14, yy);
    yy += lines.length * 3.2 + 8;
  } else {
    yy += 10;
  }
  if (yy > 265) yy = 265;
  d.setFontSize(9);
  d.line(24, yy + 12, 90, yy + 12);
  d.text('Firma del cliente', 57, yy + 16.5, {
    align: 'center'
  });
  d.line(120, yy + 12, 186, yy + 12);
  d.text('Firma y sello del local', 153, yy + 16.5, {
    align: 'center'
  });
  return d;
}
export function imprimirFacturaA4(v) {
  const items = v.items && v.items.length ? v.items : [{
    nombre: v.nombre || 'Venta',
    qty: 1,
    precio: v.totalARS || v.totalUSD || v.monto || 0,
    moneda: v.totalUSD && !v.totalARS ? 'USD' : 'ARS',
    imei: v.imei || ''
  }];
  const m = (val, mon) => mon === 'ARS' ? contextoApp.fmtARS(val) : 'u$s ' + val;
  const tieneImei = items.some(ci => ci.imei);
  const totalStr = [v.totalARS ? contextoApp.fmtARS(v.totalARS) : null, v.totalUSD ? 'u$s ' + v.totalUSD : null].filter(Boolean).join('  /  ');
  const filas = items.map(ci => {
    const specs = [ci.gb, ci.color, ci.bateria ? 'Batería ' + ci.bateria + '%' : null].filter(Boolean).join(' · ');
    return `
    <tr>
      <td>${esc(ci.nombre)}${specs ? `<div style="font-size:11px;color:#444;">${esc(specs)}</div>` : ''}${ci.imei ? `<div style="font-size:10px;color:#666;">IMEI: ${esc(ci.imei)}</div>` : ''}</td>
      <td style="text-align:center;">${ci.qty || 1}</td>
      <td style="text-align:right;">${m(ci.precio || 0, ci.moneda || 'ARS')}</td>
      <td style="text-align:right;">${m((ci.precio || 0) * (ci.qty || 1), ci.moneda || 'ARS')}</td>
    </tr>`;
  }).join('');
  const medios = (v.medios || []).map(mm => `${esc(mm.medio)}: ${m(mm.valor, mm.moneda)}`).join(' · ');
  const terms = (contextoApp.cfg.termsVenta || contextoApp.TERMS_VENTA_DEFAULT).split('\n').map(l => `<p style="margin:2px 0;">${esc(l)}</p>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Factura ${v.numVenta ? '#V-' + v.numVenta : ''}</title>
  <style>
    @page{size:A4;margin:18mm;}
    body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:13px;line-height:1.5;max-width:750px;margin:0 auto;}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:12px;margin-bottom:18px;}
    h1{font-size:22px;margin:0 0 2px;}
    .fnum{font-size:26px;font-weight:bold;text-align:right;}
    table{width:100%;border-collapse:collapse;margin:14px 0;}
    th{text-align:left;border-bottom:2px solid #111;padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;}
    td{border-bottom:1px solid #ddd;padding:8px;}
    .tot{text-align:right;font-size:18px;font-weight:bold;margin:10px 0;}
    .terms{font-size:10px;color:#444;border-top:1px solid #111;margin-top:24px;padding-top:10px;}
    .sig{margin-top:60px;display:flex;justify-content:space-between;gap:40px;}
    .sig div{flex:1;border-top:1px solid #111;text-align:center;padding-top:4px;font-size:11px;}
    .meta{font-size:12px;color:#333;}
  </style></head><body>
    <div class="head">
      <div>
        <h1>${esc(contextoApp.cfg.localNombre || 'MarplaCity')}</h1>
        <div class="meta">
          ${contextoApp.cfg.localDir ? esc(contextoApp.cfg.localDir) + '<br>' : ''}
          ${contextoApp.cfg.localTel ? 'Tel: ' + esc(contextoApp.cfg.localTel) + '<br>' : ''}
          ${contextoApp.cfg.localWeb ? esc(contextoApp.cfg.localWeb) : ''}
        </div>
      </div>
      <div>
        <div class="fnum">FACTURA ${v.numVenta ? '#V-' + v.numVenta : ''}</div>
        <div class="meta" style="text-align:right;">
          Fecha: ${v.fecha || ''} ${v.hora || ''}<br>
          ${v.clienteNombre ? 'Cliente: <b>' + esc(v.clienteNombre) + '</b>' : 'Consumidor final'}
        </div>
      </div>
    </div>
    <table>
      <thead><tr><th>Detalle</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">Precio</th><th style="text-align:right;">Subtotal</th></tr></thead>
      <tbody>${filas}${(v.cortesias || []).map(co => `<tr><td>🎁 ${esc(co.nombre)} <b>— CORTESÍA</b></td><td style="text-align:center;">1</td><td style="text-align:right;">$ 0</td><td style="text-align:right;">$ 0</td></tr>`).join('')}</tbody>
    </table>
    <div class="tot">TOTAL: ${totalStr || '—'}</div>
    ${medios ? `<div class="meta"><b>Pagado con:</b> ${medios}</div>` : ''}
    ${v.permuta ? `<div class="meta"><b>Permuta:</b> ${esc(v.permuta.descripcion || '')} — ${m(v.permuta.valor, v.permuta.moneda)}${v.permuta.imei ? ' · IMEI ' + esc(v.permuta.imei) : ''}</div>` : ''}
    ${v.tc ? `<div class="meta">TC del día: ${v.tc}</div>` : ''}
    ${tieneImei ? `<div class="terms"><b>TÉRMINOS Y GARANTÍA</b>${terms}</div>` : ''}
    <div class="sig"><div>Firma del cliente</div><div>Firma y sello del local</div></div>
    <script defer src="${new URL(imprimirDocumentoUrl, location.href).href}"><\/script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    showToast('Permití las ventanas emergentes para imprimir.', true);
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  w.location.replace(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Gastos Fijos ──────────────────────────────────────
export function inicializarFacturas() {
  // ── Edición de facturas con items ─────────────────────
  contextoApp.feId = null;
  contextoApp.feItems = [];
  contextoApp.feCort = {
    vidrio: false,
    funda: false
  };
  contextoApp.feMedios = [];
  window.abrirFE = function (id) {
    const v = contextoApp.ingresos.find(x => x.id === id);
    if (!v) return;
    contextoApp.feId = id;
    contextoApp.feItems = (v.items || []).map(it => ({
      ...it
    }));
    contextoApp.feCort = {
      vidrio: (v.cortesias || []).some(co => /vidrio/i.test(co.nombre)),
      funda: (v.cortesias || []).some(co => /funda/i.test(co.nombre))
    };
    document.getElementById('fe-title').textContent = 'Editar factura ' + (v.numVenta ? '#V-' + v.numVenta : '');
    document.getElementById('fe-cliente').value = v.clienteNombre || '';
    document.getElementById('fe-cort-vidrio').classList.toggle('on', contextoApp.feCort.vidrio);
    document.getElementById('fe-cort-funda').classList.toggle('on', contextoApp.feCort.funda);
    contextoApp.feMedios = (v.medios || []).map(mm => ({
      ...mm
    }));
    const ms = document.getElementById('fe-med-sel');
    ms.innerHTML = contextoApp.medios.map(m => `<option>${esc(m)}</option>`).join('');
    if (!ms.dataset.auto) {
      ms.dataset.auto = '1';
      ms.addEventListener('change', () => {
        const n = ms.value.toLowerCase();
        const mon = document.getElementById('fe-med-mon');
        if (/dolar|usd|d[oó]lares/.test(n)) mon.value = 'USD';else if (/peso|transfer|mercado|tarjeta|d[eé]b|cr[eé]d|brubank|posnet/.test(n)) mon.value = 'ARS';
      });
    }
    renderFEMedios();
    // catálogo para agregar
    const cat = posCatalog().filter(p => p.tipo !== 'rep');
    document.getElementById('fe-add-sel').innerHTML = '<option value="">— elegir del stock —</option>' + cat.map(p => `<option value="${p.tipo}|${p.refId}">${esc(p.nombre)} (${p.tipo === 'inv' ? p.qty + ' disp.' : '1 u.'} · ${p.moneda === 'ARS' ? contextoApp.fmtARS(p.sugerido) : 'u$s ' + p.sugerido})</option>`).join('');
    renderFE();
    document.getElementById('fe-modal').classList.add('open');
  };
  window.closeFE = function () {
    document.getElementById('fe-modal').classList.remove('open');
    contextoApp.feId = null;
    contextoApp.feItems = [];
  };
  window.feAddMedio = function () {
    const val = parseFloat(document.getElementById('fe-med-val').value);
    if (!val || val <= 0) {
      showToast('Ingresá un monto', true);
      return;
    }
    let moneda = document.getElementById('fe-med-mon').value;
    if (moneda === 'USD' && val >= 20000 && confirm(`⚠️ u$s ${val.toLocaleString('es-AR')} parece un monto en PESOS. ¿Lo cargo como ARS?`)) moneda = 'ARS';
    if (moneda === 'ARS' && val <= 2000 && confirm(`⚠️ $ ${val.toLocaleString('es-AR')} pesos — ¿no serán dólares? ¿Lo cargo como USD?`)) moneda = 'USD';
    contextoApp.feMedios.push({
      medio: document.getElementById('fe-med-sel').value,
      valor: val,
      moneda
    });
    document.getElementById('fe-med-val').value = '';
    renderFEMedios();
  };
  window.feDelMedio = function (i) {
    contextoApp.feMedios.splice(i, 1);
    renderFEMedios();
  };
  window.feCompletar = function () {
    const t = feTotals();
    const moneda = document.getElementById('fe-med-mon').value;
    let resto = moneda === 'USD' ? Math.round((t.tUSD - t.pUSD) * 100) / 100 : Math.round(t.tARS - t.pARS);
    if (resto <= 0) {
      showToast('El pago ya está cubierto ✓');
      return;
    }
    document.getElementById('fe-med-val').value = resto;
    document.getElementById('fe-med-val').focus();
  };
  window.feSetPrecio = function (i, val) {
    if (!contextoApp.feItems[i]) return;
    contextoApp.feItems[i].precio = parseFloat(val) || 0;
    renderFETot();
  };
  window.feSetNombre = function (i, val) {
    if (!contextoApp.feItems[i]) return;
    contextoApp.feItems[i].nombre = (val || '').trim() || contextoApp.feItems[i].nombre;
  };
  window.feQty = function (i, delta) {
    const it = contextoApp.feItems[i];
    if (!it) return;
    const nueva = (it.qty || 1) + delta;
    if (nueva <= 0) {
      contextoApp.feItems.splice(i, 1);
      renderFE();
      return;
    }
    if (it.tipo === 'inv') {
      // stock disponible = qty actual del inventario + lo que esta factura ya tenía de este item
      const p = contextoApp.invItems.find(x => x.id === it.refId);
      const v = contextoApp.ingresos.find(x => x.id === contextoApp.feId);
      const original = (v?.items || []).find(o => o.refId === it.refId)?.qty || 0;
      const disp = (p?.qty || 0) + original;
      if (nueva > disp) {
        showToast('No hay más stock.', true);
        return;
      }
    }
    it.qty = nueva;
    renderFE();
  };
  window.feDel = function (i) {
    contextoApp.feItems.splice(i, 1);
    renderFE();
  };
  window.feAddCatalogo = function () {
    const val = document.getElementById('fe-add-sel').value;
    if (!val) return;
    const [tipo, refId] = val.split('|');
    const p = posCatalog().find(x => x.tipo === tipo && x.refId === refId);
    if (!p) return;
    const ex = contextoApp.feItems.find(it => it.refId === refId && it.tipo === tipo);
    if (ex && tipo === 'inv') {
      window.feQty(contextoApp.feItems.indexOf(ex), 1);
      return;
    }
    if (ex) return;
    contextoApp.feItems.push({
      tipo,
      refId,
      nombre: p.nombre,
      qty: 1,
      precio: p.sugerido || 0,
      moneda: p.moneda,
      costo: p.costo || 0,
      imei: p.imei || '',
      color: p.color || '',
      gb: p.gb || '',
      bateria: p.bateria || null
    });
    document.getElementById('fe-add-sel').value = '';
    renderFE();
  };
  window.feAddLibre = function () {
    const nombre = document.getElementById('fe-libre-nombre').value.trim();
    const precio = parseFloat(document.getElementById('fe-libre-precio').value) || 0;
    if (!nombre) {
      showToast('Poné la descripción.', true);
      return;
    }
    contextoApp.feItems.push({
      tipo: 'manual',
      refId: null,
      nombre,
      qty: 1,
      precio,
      moneda: document.getElementById('fe-libre-moneda').value,
      costo: 0,
      imei: ''
    });
    document.getElementById('fe-libre-nombre').value = '';
    document.getElementById('fe-libre-precio').value = '';
    renderFE();
  };
  window.feToggleCort = function (k) {
    contextoApp.feCort[k] = !contextoApp.feCort[k];
    document.getElementById('fe-cort-' + k).classList.toggle('on', contextoApp.feCort[k]);
  };
  window.saveFE = async function () {
    if (!contextoApp.feId) return;
    const v = contextoApp.ingresos.find(x => x.id === contextoApp.feId);
    if (!v) return;
    if (!contextoApp.feItems.length) {
      showToast('La factura no puede quedar sin items. Si querés anularla, usá Eliminar.', true);
      return;
    }
    const btn = document.getElementById('fe-save');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      const orig = v.items || [];
      // ── Deltas de stock ──
      // inventario: por diferencia de qty
      const qtyPor = arr => {
        const m = new Map();
        arr.filter(i => i.tipo === 'inv').forEach(i => m.set(i.refId, (m.get(i.refId) || 0) + (i.qty || 1)));
        return m;
      };
      const antes = qtyPor(orig),
        ahora = qtyPor(contextoApp.feItems);
      const refs = new Set([...antes.keys(), ...ahora.keys()]);
      for (const refId of refs) {
        const delta = (ahora.get(refId) || 0) - (antes.get(refId) || 0); // + = vendí más → descontar
        if (!delta) continue;
        const p = contextoApp.invItems.find(x => x.id === refId);
        if (p) await updateDoc(doc(contextoApp.db, 'inventario', refId), {
          qty: Math.max(0, (p.qty || 0) - delta)
        });
      }
      // equipos / consig: comparar presencia
      const setDe = (arr, t) => new Set(arr.filter(i => i.tipo === t).map(i => i.refId));
      for (const t of ['eq', 'consig']) {
        const a = setDe(orig, t),
          b = setDe(contextoApp.feItems, t);
        for (const refId of a) if (!b.has(refId)) {
          // quitado → vuelve al stock
          if (t === 'eq') await updateDoc(doc(contextoApp.db, 'stock', refId), {
            status: 'en_stock',
            fechaVenta: null,
            ingresoVentaNombre: null
          });else await updateDoc(doc(contextoApp.db, 'consig', refId), {
            status: 'en_stock',
            fechaVenta: null
          });
        }
        for (const refId of b) if (!a.has(refId)) {
          // agregado → vendido
          if (t === 'eq') await updateDoc(doc(contextoApp.db, 'stock', refId), {
            status: 'vendido',
            fechaVenta: contextoApp.today()
          });else await updateDoc(doc(contextoApp.db, 'consig', refId), {
            status: 'vendido',
            fechaVenta: contextoApp.today()
          });
        }
      }
      // reps quitadas → saldo restaurado
      for (const it of orig.filter(i => i.tipo === 'rep')) {
        if (!contextoApp.feItems.some(x => x.tipo === 'rep' && x.refId === it.refId)) {
          const r = contextoApp.reps.find(y => y.id === it.refId);
          if (r) {
            const hist = [...(r.historial || []), {
              fecha: contextoApp.today(),
              texto: 'Item quitado de factura → saldo restaurado'
            }];
            await updateDoc(doc(contextoApp.db, 'reparaciones', it.refId), {
              saldo: it.precio || 0,
              sena: (r.precio || 0) - (it.precio || 0),
              estado: 'avisado',
              historial: hist
            });
          }
        }
      }

      // ── Recalcular totales y ganancia ──
      const tc = v.tc || parseFloat(contextoApp.cfg.tc) || null;
      let tARS = 0,
        tUSD = 0,
        gUSD = 0,
        gARS = 0,
        hayCosto = false;
      contextoApp.feItems.forEach(it => {
        const sub = (it.precio || 0) * (it.qty || 1);
        if (it.moneda === 'ARS') {
          tARS += sub;
          if (tc) tUSD += sub / tc;
        } else {
          tUSD += sub;
          if (tc) tARS += sub * tc;
        }
        if (it.tipo === 'rep' || it.tipo === 'imp') return;
        if (!it.costo) return;
        hayCosto = true;
        const g = ((it.precio || 0) - (it.costo || 0)) * (it.qty || 1);
        if (it.moneda === 'USD') {
          gUSD += g;
          if (tc) gARS += g * tc;
        } else {
          gARS += g;
          if (tc) gUSD += g / tc;
        }
      });
      const cortesias = [];
      let cUSD = 0;
      if (contextoApp.feCort.vidrio) {
        const cv = parseFloat(contextoApp.cfg.cortVidrio) || 2;
        cortesias.push({
          nombre: 'Vidrio templado',
          costoUSD: cv
        });
        cUSD += cv;
      }
      if (contextoApp.feCort.funda) {
        const cf = parseFloat(contextoApp.cfg.cortFunda) || 5;
        cortesias.push({
          nombre: 'Funda silicone case',
          costoUSD: cf
        });
        cUSD += cf;
      }
      if (cUSD > 0) {
        hayCosto = true;
        gUSD -= cUSD;
        if (tc) gARS -= cUSD * tc;
      }
      const clienteNombre = document.getElementById('fe-cliente').value.trim() || 'Consumidor final';
      const cl = clienteNombre !== 'Consumidor final' ? await resolverCliente(clienteNombre, '') : null;
      const nombre = contextoApp.feItems.length === 1 ? contextoApp.feItems[0].nombre : contextoApp.feItems.map(it => it.qty > 1 ? it.qty + 'x ' + it.nombre : it.nombre).join(' + ').slice(0, 200);
      await updateDoc(doc(contextoApp.db, 'ingresos', contextoApp.feId), {
        items: contextoApp.feItems,
        medios: contextoApp.feMedios,
        cortesias,
        nombre,
        clienteNombre,
        clienteId: cl ? cl.id : null,
        imei: contextoApp.feItems.find(it => it.imei)?.imei || '',
        totalARS: tARS > 0 ? Math.round(tARS) : null,
        totalUSD: tUSD > 0 ? Math.round(tUSD * 100) / 100 : null,
        gananciaARS: hayCosto && gARS ? Math.round(gARS) : null,
        gananciaUSD: hayCosto && gUSD ? Math.round(gUSD * 100) / 100 : null,
        editado: true
      });
      showToast('Factura actualizada ✓ — stock ajustado');
      window.closeFE();
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  };

  // ── Publicar un PDF y mandarlo por WhatsApp ───────────
  //
  // WhatsApp no deja adjuntar un archivo desde un link wa.me: sólo viaja texto.
  // Así que el PDF se guarda en `docs_publicos` bajo un token aleatorio y al
  // cliente le mandamos el link a ver.html, que lo muestra y lo deja descargar.
  // El token es lo único que protege el documento (las reglas permiten `get`
  // pero no `list`), por eso sale de crypto y no de un contador.
  contextoApp.BASE_PUBLICA = configuracion.basePublica;
  window.enviarFacturaWa = async function (id) {
    const v = contextoApp.ingresos.find(x => x.id === id);
    if (!v) {
      showToast('Factura no encontrada.', true);
      return;
    }
    const tel = telDeFactura(v);
    if (!tel) {
      showToast('El cliente de esta factura no tiene teléfono cargado. Agregalo en Clientes.', true);
      return;
    }
    const num = waNumber(tel);
    if (!num) {
      showToast('El teléfono del cliente no es válido.', true);
      return;
    }
    const nombreArchivo = 'Factura-' + (v.numVenta ? 'V-' + v.numVenta : v.fecha || '') + '.pdf';
    let pdf;
    try {
      pdf = generarFacturaPDF(v);
    } catch (e) {
      console.error(e);
      showToast('Error generando el PDF: ' + e.message, true);
      return;
    }
    const w = abrirPestanaDiferida();
    const saludo = `Hola ${(v.clienteNombre || '').split(' ')[0]}! 🧾 Te enviamos la factura ${v.numVenta ? '#V-' + v.numVenta : ''} de tu compra en ${contextoApp.cfg.localNombre || 'MarplaCity'}. ¡Gracias por elegirnos!`;
    let link;
    try {
      link = await publicarPDF(pdf, {
        tipo: 'factura',
        titulo: 'Factura' + (v.numVenta ? ' #V-' + v.numVenta : ''),
        cliente: v.clienteNombre && v.clienteNombre !== 'Consumidor final' ? v.clienteNombre : '',
        fecha: v.fecha || contextoApp.today(),
        local: contextoApp.cfg.localNombre || 'MarplaCity',
        archivo: nombreArchivo
      });
    } catch (e) {
      console.error(e);
      // Sin link no se pierde el envío: se descarga el PDF y se adjunta a mano
      if (w && !w.closed) w.close();
      pdf.save(nombreArchivo);
      await mandarLinkWa(null, num, saludo);
      showToast('No se pudo publicar el link (' + e.message + ') — PDF descargado, arrastralo al chat 📎', true);
      return;
    }
    await mandarLinkWa(w, num, saludo + '\n\n📄 Descargala acá:\n' + link);
  };

  // ── Reimpresión de facturas ──────────────────────────
  window.reimprimirFactura = function (id, formato) {
    const v = contextoApp.ingresos.find(x => x.id === id);
    if (!v) {
      showToast('Factura no encontrada.', true);
      return;
    }
    if (formato === 'termica') {
      // normalizar: ingresos manuales no tienen items
      const vv = v.items && v.items.length ? v : {
        ...v,
        numVenta: v.numVenta || '—',
        items: [{
          tipo: 'inv',
          nombre: v.nombre || 'Venta',
          qty: 1,
          precio: v.totalARS || v.totalUSD || v.monto || 0,
          moneda: v.totalUSD && !v.totalARS ? 'USD' : 'ARS',
          imei: v.imei || ''
        }],
        medios: v.medios || []
      };
      imprimirTicketVenta(vv);
      return;
    }
    imprimirFacturaA4(v);
  };
}
