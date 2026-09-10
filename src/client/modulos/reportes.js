import { configuracion } from '../core/config-publica.js';
/** modulos/reportes: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, showToast } from '../core/interfaz.js';
import { getRange } from './gastos.js';
import { gananciaVentaUSD, costoRepuestosUSD } from './costos.js';
import { avisoVentana } from '../core/datos.js';

export
// Llamada segura al Worker: incluye el token de Firebase del usuario logueado
async function workerHeaders() {
  const h = {
    'Content-Type': 'application/json'
  };
  try {
    if (contextoApp.auth.currentUser) h['X-Firebase-Token'] = await contextoApp.auth.currentUser.getIdToken();
  } catch (e) {
    console.warn('No se pudo obtener el token', e);
  }
  return h;
}

// Lee el texto de una respuesta de la API de Claude.
// OJO: no sirve content[0].text — los modelos actuales piensan por defecto y el
// primer bloque de content es de tipo "thinking" (sin campo .text). Hay que
// juntar los bloques de tipo "text".
export function textoDeIA(data) {
  if (!data) throw new Error('Sin respuesta del servidor');
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (data.stop_reason === 'refusal') throw new Error('La IA rechazó la consulta por sus políticas de contenido.');
  const txt = (Array.isArray(data.content) ? data.content : []).filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
  if (!txt) {
    throw new Error(data.stop_reason === 'max_tokens' ? 'La respuesta se cortó por límite de tokens. Probá con menos datos de entrada.' : 'La IA no devolvió texto: ' + JSON.stringify(data).slice(0, 200));
  }
  return txt;
}
export function buildDataContext(from, to) {
  const gPeriod = contextoApp.gastos.filter(g => g.fecha >= from && g.fecha <= to);
  const iPeriod = contextoApp.ingresos.filter(g => g.fecha >= from && g.fecha <= to);
  const sPeriod = contextoApp.stockItems;
  const cPeriod = contextoApp.consigItems;
  const pPeriod = contextoApp.pagosItems;

  // Previous period for comparison
  const daysDiff = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24);
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - daysDiff);
  const prevFromStr = prevFrom.toISOString().split('T')[0];
  const prevToStr = prevTo.toISOString().split('T')[0];
  const gPrev = contextoApp.gastos.filter(g => g.fecha >= prevFromStr && g.fecha <= prevToStr);
  const iPrev = contextoApp.ingresos.filter(g => g.fecha >= prevFromStr && g.fecha <= prevToStr);
  return {
    periodo: {
      desde: from,
      hasta: to,
      diasComparado: Math.round(daysDiff)
    },
    periodoPrevio: {
      desde: prevFromStr,
      hasta: prevToStr
    },
    ingresos: iPeriod.map(i => ({
      fecha: i.fecha,
      nombre: i.nombre,
      categoria: i.categoria,
      totalARS: i.totalARS,
      totalUSD: i.totalUSD,
      gananciaARS: i.gananciaARS,
      gananciaUSD: i.gananciaUSD,
      medios: (i.medios || []).map(m => m.medio),
      permuta: i.permuta ? true : false
    })),
    ingresosPrevios: iPrev.map(i => ({
      nombre: i.nombre,
      totalARS: i.totalARS,
      totalUSD: i.totalUSD,
      gananciaARS: i.gananciaARS,
      gananciaUSD: i.gananciaUSD
    })),
    gastos: gPeriod.map(g => ({
      fecha: g.fecha,
      concepto: g.concepto,
      categoria: g.categoria,
      monto: g.monto,
      moneda: g.moneda,
      usd: g.usd,
      tipo: g.tipo
    })),
    gastosPrevios: gPrev.map(g => ({
      concepto: g.concepto,
      categoria: g.categoria,
      usd: g.usd,
      tipo: g.tipo
    })),
    stockPermutas: sPeriod.map(s => ({
      nombre: s.nombre,
      valorUSD: s.valorUSD,
      status: s.status,
      tipo: s.tipo
    })),
    consignacion: cPeriod.map(c => ({
      proveedor: c.proveedor,
      producto: c.producto,
      precioUSD: c.precioUSD,
      status: c.status
    })),
    deudaProveedores: [...new Set(cPeriod.map(c => c.proveedor))].map(p => ({
      proveedor: p,
      deudaUSD: cPeriod.filter(x => x.proveedor === p && x.status === 'en_stock').reduce((s, x) => s + (x.precioUSD || 0), 0),
      pagadoUSD: pPeriod.filter(x => x.proveedor === p && x.moneda === 'USD').reduce((s, x) => s + (x.monto || 0), 0)
    }))
  };
}
export function buildSystemPrompt(data) {
  return `Sos el analista financiero de un negocio de venta y reparación de celulares y tecnología en Argentina. Tenés acceso a todos los datos del negocio.

DATOS DEL PERÍODO ${data.periodo.desde} al ${data.periodo.hasta}:
${JSON.stringify(data, null, 1)}

Tu rol es analizar estos datos y dar insights accionables, claros y directos. Usá emojis para hacer el reporte más visual. Respondé siempre en español rioplatense. Cuando hagas cálculos mostrá los números claramente. Si algo llama la atención (positivo o negativo) mencionalo.`;
}
export function buildInitialPrompt(data) {
  return `Generá un reporte completo del período ${data.periodo.desde} al ${data.periodo.hasta}. Estructuralo así:

## 🏆 Resumen ejecutivo
3 puntos clave del período en pocas líneas.

## 💰 Ingresos y ventas
- Total cobrado y ganancia bruta (ARS y USD)
- Producto más vendido y con mejor margen
- Producto con menor margen (¿conviene seguir vendiéndolo?)
- Ticket promedio

## 📦 Stock y consignación
- Capital parado en permutas sin vender
- Proveedor con más stock inmovilizado
- Deuda total con proveedores vs lo pagado

## 💸 Análisis de gastos del negocio
- Total gastado desglosado por categoría
- Impuestos, honorarios, servicios, sueldos
- ¿Los ingresos cubren los gastos?

## 🏠 Gastos personales
- Total gastado personal
- Categoría más alta

## 📊 Comparativa con período anterior
- ¿Mejoró o empeoró la ganancia?
- ¿Qué cambió?

## 🎯 Opinión y recomendaciones
- Un gasto que considerás excesivo
- Una oportunidad que ves en los datos
- Una alerta importante si la hay

Sé directo, específico con los números, y útil.`;
}
export function renderMarkdown(text) {
  let html = text;
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  html = html.replace(/^[-•] (.+)$/gm, '<li>$1</li>');
  const lines = html.split('\n');
  const out = [];
  let inUL = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('<li>')) {
      if (!inUL) {
        out.push('<ul>');
        inUL = true;
      }
      out.push(t);
    } else {
      if (inUL) {
        out.push('</ul>');
        inUL = false;
      }
      if (!t) continue;
      if (t.startsWith('<h') || t.startsWith('<ul') || t.startsWith('</ul')) out.push(t);else out.push('<p>' + t + '</p>');
    }
  }
  if (inUL) out.push('</ul>');
  return out.join('');
}
export function addChatMessage(role, content, isTyping = false) {
  const container = document.getElementById('ai-chat-messages');
  if (isTyping) {
    const div = document.createElement('div');
    div.className = 'typing-dots';
    div.id = 'typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return;
  }
  const div = document.createElement('div');
  div.className = 'ai-chat-msg ' + role;
  div.innerHTML = role === 'ai' ? renderMarkdown(content) : esc(content);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
export function removeTyping() {
  const t = document.getElementById('typing-indicator');
  if (t) t.remove();
}
export function renderReporte() {
  const [from, to] = getRange(contextoApp.currentPeriod);
  const items = contextoApp.gastos.filter(g => g.fecha >= from && g.fecha <= to);
  const incItems = contextoApp.ingresos.filter(g => g.fecha >= from && g.fecha <= to);
  const neg = items.filter(g => g.tipo === 'negocio');
  const per = items.filter(g => g.tipo === 'personal');
  const sumUSD = arr => arr.reduce((s, g) => s + (g.usd || 0), 0);
  const totalGastosUSD = sumUSD(items);
  const totalIncARS = incItems.reduce((s, g) => s + (g.totalARS || 0), 0);
  const totalIncUSD = incItems.reduce((s, g) => s + (g.totalUSD || 0), 0);
  const ganDin = new Map(incItems.map(g => [g.id, gananciaVentaUSD(g)]));
  const totalGanUSD = incItems.reduce((s, g) => s + (ganDin.get(g.id) || 0), 0);
  const totalGanARS = incItems.reduce((s, g) => {
    const gu = ganDin.get(g.id);
    const tc = g.tc || parseFloat(contextoApp.cfg.tc) || null;
    return s + (gu != null && tc ? gu * tc : g.gananciaARS || 0);
  }, 0);
  const hasRepGanARS = incItems.some(g => ganDin.get(g.id) != null || g.gananciaARS != null);
  const hasRepGanUSD = incItems.some(g => ganDin.get(g.id) != null);
  let repGanStr = '—';
  if (hasRepGanARS && hasRepGanUSD) repGanStr = contextoApp.fmtARS(totalGanARS) + ' / ' + contextoApp.fmtUSD(totalGanUSD);else if (hasRepGanARS) repGanStr = contextoApp.fmtARS(totalGanARS);else if (hasRepGanUSD) repGanStr = contextoApp.fmtUSD(totalGanUSD);
  const negUSD = sumUSD(neg),
    perUSD = sumUSD(per);
  const cats2 = {};
  items.forEach(g => {
    const c = g.categoria || 'Sin categoría';
    cats2[c] = (cats2[c] || 0) + (g.usd || 0);
  });
  const catArr = Object.entries(cats2).sort((a, b) => b[1] - a[1]);
  const maxCat = catArr[0]?.[1] || 1;
  const concs = {};
  items.forEach(g => {
    concs[g.concepto] = (concs[g.concepto] || 0) + (g.usd || 0);
  });
  const concArr = Object.entries(concs).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const byMes = {};
  items.forEach(g => {
    const m = (g.fecha || '').slice(0, 7);
    if (m) {
      if (!byMes[m]) byMes[m] = {
        g: 0,
        i: 0
      };
      byMes[m].g += g.usd || 0;
    }
  });
  incItems.forEach(g => {
    const m = (g.fecha || '').slice(0, 7);
    if (m) {
      if (!byMes[m]) byMes[m] = {
        g: 0,
        i: 0
      };
      byMes[m].i += g.totalUSD || 0;
    }
  });
  const mesArr = Object.entries(byMes).sort((a, b) => a[0].localeCompare(b[0]));
  const maxMes = Math.max(...mesArr.map(x => Math.max(x[1].g, x[1].i)), 1);
  const noData = !items.length && !incItems.length;
  if (noData) {
    document.getElementById('reporte-content').innerHTML = '<div class="empty">Sin datos en este período.</div>';
    return;
  }
  let html = `
    <div class="metrics">
      <div class="metric"><div class="m-label">Ingresos ARS</div><div class="m-val" style="color:#237A4B">${contextoApp.fmtARS(totalIncARS)}</div><div class="m-sub">${incItems.length} ventas</div></div>
      <div class="metric"><div class="m-label">Gastos USD</div><div class="m-val">${contextoApp.fmtUSD(totalGastosUSD)}</div><div class="m-sub">${items.length} gastos</div></div>
      <div class="metric"><div class="m-label">Ganancia bruta</div><div class="m-val" style="color:${totalGanARS >= 0 && totalGanUSD >= 0 ? '#237A4B' : 'var(--neg)'};font-size:14px;">${repGanStr}</div></div>
    </div>`;
  if (catArr.length) html += `<div class="card"><div class="card-title">Gastos por categoría (USD)</div>
    ${catArr.map(([cat, val], i) => `<div class="bar-row"><div class="bar-label" title="${esc(cat)}">${esc(cat)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(val / maxCat * 100)}%;background:${contextoApp.COLORS[i % contextoApp.COLORS.length]}"></div></div><div class="bar-val">${contextoApp.fmtUSD(val)}</div></div>`).join('')}
  </div>`;
  if (concArr.length) html += `<div class="card"><div class="card-title">Top gastos (USD)</div>
    ${concArr.map(([conc, val], i) => `<div class="bar-row"><div class="bar-label" title="${esc(conc)}">${esc(conc)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(val / concArr[0][1] * 100)}%;background:${contextoApp.COLORS[i]}"></div></div><div class="bar-val">${contextoApp.fmtUSD(val)}</div></div>`).join('')}
  </div>`;
  if (mesArr.length > 1) html += `<div class="card"><div class="card-title">Ingresos vs Gastos por mes (USD)</div>
    <div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px;"><span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:2px;background:#1D9E75;display:inline-block;"></span>Ingresos</span><span style="display:flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:2px;background:#D85A30;display:inline-block;"></span>Gastos</span></div>
    ${mesArr.map(([m, v]) => `
      <div style="margin-bottom:10px;">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">${contextoApp.fmtMes(m)}</div>
        <div class="bar-row" style="margin-bottom:4px;"><div class="bar-label" style="width:60px;font-size:11px;color:#237A4B">Ingresos</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(v.i / maxMes * 100)}%;background:#1D9E75"></div></div><div class="bar-val">${contextoApp.fmtUSD(v.i)}</div></div>
        <div class="bar-row"><div class="bar-label" style="width:60px;font-size:11px;color:var(--neg)">Gastos</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(v.g / maxMes * 100)}%;background:#D85A30"></div></div><div class="bar-val">${contextoApp.fmtUSD(v.g)}</div></div>
      </div>`).join('')}
  </div>`;
  // ── Tabla de operaciones (ventas + reparaciones) ──
  const usd = (val, mon, tcOp) => {
    if (val == null) return null;
    if (mon === 'USD') return val;
    return tcOp ? val / tcOp : null;
  };
  let rows = [];
  incItems.forEach(v => {
    let venta = v.totalUSD ?? usd(v.totalARS, 'ARS', v.tc);
    const gan = ganDin.get(v.id) ?? v.gananciaUSD ?? usd(v.gananciaARS, 'ARS', v.tc);
    // Restar la porción que es cobro de saldo de reparaciones:
    // esa plata ya figura en la fila propia de la reparación (evita doble conteo)
    const repPart = (v.items || []).filter(ci => ci.tipo === 'rep').reduce((s, ci) => {
      const sub = (ci.precio || 0) * (ci.qty || 1);
      return s + (ci.moneda === 'USD' ? sub : v.tc ? sub / v.tc : 0);
    }, 0);
    if (venta != null && repPart) venta = Math.max(0, venta - repPart);
    // Si la venta era SOLO cobro de reparación → no mostrar la fila
    const soloRep = (v.items || []).length > 0 && (v.items || []).every(ci => ci.tipo === 'rep');
    if (soloRep) return;
    const costo = venta != null && gan != null ? Math.max(0, venta - gan) : null;
    rows.push({
      fecha: v.fecha,
      num: v.numVenta ? '#V-' + v.numVenta : v.itemId || '—',
      cliente: v.clienteNombre || '—',
      desc: (v.nombre || '') + (repPart ? ' (sin saldo de rep.)' : ''),
      venta,
      costo,
      gan
    });
  });
  const fechaOpRep = r => {
    if (r.fechaRetiro) return r.fechaRetiro;
    if (r.estado === 'retirado' && r.origen !== 'repairdesk') {
      const h = [...(r.historial || [])].reverse().find(x => /retir|cobrad|facturad/i.test(x.texto || ''));
      if (h && h.fecha) return h.fecha;
    }
    return r.fecha;
  };
  contextoApp.reps.filter(r => {
    // solo operaciones CONCRETADAS: el equipo se retiró (ahí se cobró o se asumió el costo)
    if (r.estado !== 'retirado') return false;
    if (r.origen === 'refurb') return false; // el costo del refurb viaja en el equipo, no acá
    const fOp = fechaOpRep(r);
    return fOp >= from && fOp <= to && ((r.precio || 0) > 0 || costoRepuestosUSD(r) > 0);
  }).forEach(r => {
    const tcOp = r.tc || null;
    const esGarantia = (r.precio || 0) === 0;
    const venta = esGarantia ? 0 : usd(r.precio, r.moneda || 'ARS', tcOp) ?? (r.moneda === 'USD' ? r.precio : null);
    const costo = costoRepuestosUSD(r) || 0;
    const gan = venta != null ? venta - costo : null;
    rows.push({
      fecha: fechaOpRep(r),
      num: '#' + r.num,
      cliente: r.cliente || '—',
      desc: '🔧 ' + (r.trabajo || '') + ' (' + (r.equipo || '') + ')' + (esGarantia ? ' 🛡 SIN CARGO' : ''),
      venta,
      costo: costo || null,
      gan
    });
  });
  rows.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const totalRows = rows.length;
  const rowsCortadas = totalRows > 300;
  if (rowsCortadas) rows = rows.slice(0, 300);
  if (rows.length) {
    const f = v => v == null ? '—' : 'u$s ' + (Math.round(v * 100) / 100).toLocaleString('es-AR');
    const totV = rows.reduce((s, r) => s + (r.venta || 0), 0);
    const totC = rows.reduce((s, r) => s + (r.costo || 0), 0);
    const totG = rows.reduce((s, r) => s + (r.gan || 0), 0);
    html += `<div class="card"><div class="card-title">Detalle de operaciones (USD)</div>
      ${rowsCortadas ? `<p style="font-size:12px;color:var(--text2);margin-bottom:8px;">Mostrando las últimas 300 de ${totalRows} operaciones — achicá el período para ver un rango específico. Los totales del pie corresponden a lo mostrado.</p>` : ''}
      <div style="overflow-x:auto;"><table class="gf-table" style="min-width:640px;">
        <thead><tr><th>Ticket</th><th>Cliente</th><th>Producto / Trabajo</th><th style="text-align:right">Venta</th><th style="text-align:right">Costo</th><th style="text-align:right">Ganancia</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td style="font-family:'DM Mono',monospace;font-size:12px;white-space:nowrap;">${esc(r.num)}<div style="font-size:10px;color:var(--text3);">${r.fecha || ''}</div></td>
            <td style="font-size:13px;">${esc(r.cliente)}</td>
            <td style="font-size:13px;max-width:260px;">${esc(r.desc)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${f(r.venta)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--text3);">${f(r.costo)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;color:${(r.gan || 0) >= 0 ? '#237A4B' : 'var(--neg)'};">${f(r.gan)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr style="border-top:2px solid var(--border);">
          <td colspan="3" style="font-weight:600;">TOTAL · ${rows.length} operaciones</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;">${f(totV)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--text3);">${f(totC)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:#237A4B;">${f(totG)}</td>
        </tr></tfoot>
      </table></div>
    </div>`;
  }
  document.getElementById('reporte-content').innerHTML = avisoVentana() + html;
}

// ── Amortizaciones ──
export function inicializarReportes() {
  // ── AI Reports ────────────────────────────────────────
  contextoApp.WORKER_URL = configuracion.api.ia;
  contextoApp.aiChatHistory = [];
  contextoApp.aiReportContext = null;
  window.generarReporteIA = async function () {
    const [from, to] = getRange(contextoApp.currentPeriod);
    const data = buildDataContext(from, to);
    contextoApp.aiReportContext = data;
    contextoApp.aiChatHistory = [];
    const btn = document.getElementById('btn-generar-reporte');
    btn.disabled = true;
    btn.textContent = '⏳ Analizando datos...';
    document.getElementById('ai-report-section').style.display = 'block';
    document.getElementById('ai-chat-messages').innerHTML = '';
    document.getElementById('report-period-label').textContent = `Período: ${from} → ${to} · ${data.ingresos.length} ventas · ${data.gastos.length} gastos`;
    addChatMessage('ai', '', true); // typing dots

    const systemPrompt = buildSystemPrompt(data);
    const userPrompt = buildInitialPrompt(data);
    contextoApp.aiChatHistory.push({
      role: 'user',
      content: userPrompt
    });
    try {
      const response = await fetch(contextoApp.WORKER_URL, {
        method: 'POST',
        headers: await workerHeaders(),
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 8000,
          output_config: {
            effort: 'medium'
          },
          system: systemPrompt,
          messages: contextoApp.aiChatHistory
        })
      });
      const data2 = await response.json();
      const reply = textoDeIA(data2);
      contextoApp.aiChatHistory.push({
        role: 'assistant',
        content: reply
      });
      removeTyping();
      addChatMessage('ai', reply);
    } catch (e) {
      removeTyping();
      addChatMessage('ai', '⚠️ Error al generar el reporte: ' + e.message);
    }
    btn.disabled = false;
    btn.textContent = '✨ Generar reporte del período';
  };
  window.enviarPreguntaIA = async function () {
    if (!contextoApp.aiReportContext) {
      showToast('Generá un reporte primero.', true);
      return;
    }
    const input = document.getElementById('ai-chat-input');
    const pregunta = input.value.trim();
    if (!pregunta) return;
    input.value = '';
    addChatMessage('user', pregunta);
    contextoApp.aiChatHistory.push({
      role: 'user',
      content: pregunta
    });
    const sendBtn = document.getElementById('ai-chat-send');
    sendBtn.disabled = true;
    addChatMessage('ai', '', true);
    try {
      const response = await fetch(contextoApp.WORKER_URL, {
        method: 'POST',
        headers: await workerHeaders(),
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 8000,
          output_config: {
            effort: 'medium'
          },
          system: buildSystemPrompt(contextoApp.aiReportContext),
          messages: contextoApp.aiChatHistory
        })
      });
      const data = await response.json();
      const reply = textoDeIA(data);
      contextoApp.aiChatHistory.push({
        role: 'assistant',
        content: reply
      });
      removeTyping();
      addChatMessage('ai', reply);
    } catch (e) {
      removeTyping();
      addChatMessage('ai', '⚠️ Error: ' + e.message);
    }
    sendBtn.disabled = false;
  };
  contextoApp.COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#D4537E', '#7F77DD', '#BA7517', '#639922', '#888780', '#E24B4A', '#0F6E56'];
}
