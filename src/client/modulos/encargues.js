/** modulos/encargues: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { showToast, esc } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { resolverCliente } from './clientes.js';
import { addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { waNumber } from './whatsapp.js';
import { imprimirTicketVenta } from './pos.js';

export function renderEncargues() {
  const pend = contextoApp.encarguesItems.filter(x => x.estado === 'pendiente');
  const senasUSD = pend.reduce((s, x) => s + (x.moneda === 'USD' ? x.sena || 0 : 0), 0);
  const senasARS = pend.reduce((s, x) => s + (x.moneda === 'ARS' ? x.sena || 0 : 0), 0);
  document.getElementById('en-metrics').innerHTML = `
    <div class="metric"><div class="m-label">Pendientes</div><div class="m-val">${pend.length}</div></div>
    <div class="metric"><div class="m-label">Señas en mano</div><div class="m-val">${senasUSD ? 'u$s ' + senasUSD : ''} ${senasARS ? contextoApp.fmtARS(senasARS) : ''}</div><div class="m-sub">plata de clientes esperando producto</div></div>
  `;
  const m = (v, mon) => mon === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v;
  document.getElementById('en-list').innerHTML = contextoApp.encarguesItems.slice(0, 50).map(x => {
    const pendiente = x.estado === 'pendiente';
    const saldo = (x.precio || 0) - (x.sena || 0);
    const atrasado = pendiente && x.fechaEstimada && x.fechaEstimada < contextoApp.today();
    return `<div class="card" style="margin-bottom:10px;${pendiente ? '' : 'opacity:.6;'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:600;font-size:15px;">📦 ${esc(x.producto)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">${esc(x.cliente)}${x.tel ? ' · ' + esc(x.tel) : ''} · encargado ${x.fechaEncargue}${x.fechaEstimada ? ' · llega ~' + x.fechaEstimada : ''}</div>
          ${x.notas ? `<div style="font-size:12px;color:var(--text2);margin-top:4px;">${esc(x.notas)}</div>` : ''}
          ${atrasado ? '<div class="proveedor-alerta alerta-atencion" style="margin-top:6px;">🔔 Pasó la fecha estimada — reclamale al proveedor o avisale al cliente.</div>' : ''}
        </div>
        <div style="text-align:right;">
          <div style="font-family:'DM Mono',monospace;font-weight:700;">${m(x.precio || 0, x.moneda)}</div>
          <div style="font-size:11px;color:var(--text3);">Seña ${m(x.sena || 0, x.moneda)} · Saldo <b style="color:${saldo > 0 ? 'var(--neg)' : '#237A4B'}">${m(saldo, x.moneda)}</b></div>
          <div style="font-size:11px;margin-top:2px;">${pendiente ? '<span class="est-badge est-recibido" style="font-size:9px;">PENDIENTE</span>' : x.estado === 'entregado' ? '<span class="est-badge est-retirado" style="font-size:9px;">ENTREGADO' + (x.numVenta ? ' #V-' + x.numVenta : '') + '</span>' : '<span class="est-badge est-abandono" style="font-size:9px;">CANCELADO</span>'}</div>
        </div>
      </div>
      ${pendiente ? `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn-pagar-outline" onclick="abrirEnt('${x.id}')">✓ Llegó — entregar</button>
        ${x.tel ? `<button class="btn-pagar-outline" onclick="avisarEncargue('${x.id}')">📱 Avisar que llegó</button>` : ''}
        <button class="btn-pagar-outline" style="color:var(--neg);" onclick="cancelarEncargue('${x.id}')">✕ Cancelar</button>
      </div>` : ''}
    </div>`;
  }).join('') || '<div class="empty">Sin encargues registrados.</div>';
}
export function entTotals() {
  const x = contextoApp.encarguesItems.find(e => e.id === contextoApp.entId);
  if (!x) return {
    saldoUSD: 0,
    saldoARS: 0,
    pUSD: 0,
    pARS: 0,
    tc: null
  };
  const tc = x.tc || parseFloat(contextoApp.cfg.tc) || null;
  const saldo = (x.precio || 0) - (x.sena || 0);
  const saldoUSD = x.moneda === 'USD' ? saldo : tc ? saldo / tc : 0;
  const saldoARS = x.moneda === 'ARS' ? saldo : tc ? saldo * tc : 0;
  let pUSD = 0,
    pARS = 0;
  contextoApp.entMedios.forEach(mm => {
    if (mm.moneda === 'ARS') {
      pARS += mm.valor;
      if (tc) pUSD += mm.valor / tc;
    } else {
      pUSD += mm.valor;
      if (tc) pARS += mm.valor * tc;
    }
  });
  return {
    x,
    tc,
    saldo,
    saldoUSD,
    saldoARS,
    pUSD,
    pARS
  };
}
export function renderEntMedios() {
  document.getElementById('ent-medios-tags').innerHTML = contextoApp.entMedios.map((mm, i) => `<div class="medio-tag"><span>${esc(mm.medio)} · ${mm.moneda === 'USD' ? 'u$s ' : '$ '}${mm.valor.toLocaleString('es-AR')}</span><button onclick="entDelMedio(${i})">×</button></div>`).join('');
  const t = entTotals();
  document.getElementById('ent-pagado').textContent = [t.pARS ? contextoApp.fmtARS(Math.round(t.pARS)) : null, t.pUSD ? 'u$s ' + Math.round(t.pUSD * 100) / 100 : null].filter(Boolean).join(' / ') || '—';
  const resto = t.tc ? t.saldoUSD - t.pUSD : t.x?.moneda === 'USD' ? t.saldoUSD - t.pUSD : t.saldoARS - t.pARS;
  const el = document.getElementById('ent-resto');
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
export function inicializarEncargues() {
  // ── Encargues ─────────────────────────────────────────
  window.guardarEncargue = async function () {
    const cliente = document.getElementById('en-cliente').value.trim();
    const producto = document.getElementById('en-producto').value.trim();
    if (!cliente || !producto) {
      showToast('Completá cliente y producto.', true);
      return;
    }
    const precio = parseFloat(document.getElementById('en-precio').value) || 0;
    const sena = parseFloat(document.getElementById('en-sena').value) || 0;
    if (sena > precio && precio > 0) {
      showToast('La seña no puede superar el precio.', true);
      return;
    }
    const btn = document.getElementById('btn-encargue');
    btn.disabled = true;
    setSyncDot('syncing');
    try {
      const tel = document.getElementById('en-tel').value.trim();
      const cl = await resolverCliente(cliente, tel);
      await addDoc(contextoApp.encarguesCol, contextoApp.withUser({
        cliente,
        clienteId: cl ? cl.id : null,
        tel,
        producto,
        precio,
        moneda: document.getElementById('en-moneda').value,
        tc: parseFloat(document.getElementById('en-tc').value) || parseFloat(contextoApp.cfg.tc) || null,
        sena,
        senaMedio: document.getElementById('en-sena-medio').value,
        fechaEncargue: contextoApp.today(),
        fechaEstimada: document.getElementById('en-fecha-est').value || null,
        notas: document.getElementById('en-notas').value.trim(),
        estado: 'pendiente',
        createdAt: serverTimestamp()
      }));
      ['en-cliente', 'en-tel', 'en-producto', 'en-precio', 'en-sena', 'en-notas', 'en-fecha-est'].forEach(i => document.getElementById(i).value = '');
      showToast('Encargue registrado ✓' + (sena ? ' — la seña entró a la caja de hoy' : ''));
    } catch (e) {
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
  };
  window.avisarEncargue = function (id) {
    const x = contextoApp.encarguesItems.find(e => e.id === id);
    if (!x || !x.tel) return;
    const saldo = (x.precio || 0) - (x.sena || 0);
    const m = v => x.moneda === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v;
    const msg = `Hola ${x.cliente.split(' ')[0]}! 🎉 Llegó tu *${x.producto}* que habías encargado. Podés pasar a retirarlo${saldo > 0 ? ` — saldo a abonar: ${m(saldo)}` : ''}. Te esperamos! — ${contextoApp.cfg.localNombre || 'MarplaCity'}`;
    window.open('https://wa.me/' + waNumber(x.tel) + '?text=' + encodeURIComponent(msg), '_blank');
  };
  window.cancelarEncargue = async function (id) {
    const x = contextoApp.encarguesItems.find(e => e.id === id);
    if (!x) return;
    if (!confirm(`¿Cancelar el encargue de ${x.producto}?${x.sena ? `\n\nOJO: tiene seña de ${x.moneda === 'ARS' ? contextoApp.fmtARS(x.sena) : 'u$s ' + x.sena}. Si la devolvés, registrala como GASTO para que la caja cierre.` : ''}`)) return;
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'encargues', id), {
        estado: 'cancelado'
      });
      showToast('Encargue cancelado');
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };

  // ── Entrega ──
  contextoApp.entId = null;
  contextoApp.entMedios = [];
  window.abrirEnt = function (id) {
    const x = contextoApp.encarguesItems.find(e => e.id === id);
    if (!x) return;
    contextoApp.entId = id;
    contextoApp.entMedios = [];
    const m = v => x.moneda === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v;
    const saldo = (x.precio || 0) - (x.sena || 0);
    document.getElementById('ent-title').textContent = `Entregar — ${x.cliente}`;
    document.getElementById('ent-resumen').innerHTML = `
    <div class="profit-row"><span class="profit-label">${esc(x.producto)}</span><span class="profit-val">${m(x.precio || 0)}</span></div>
    ${x.sena ? `<div class="profit-row"><span class="profit-label">Seña (${x.fechaEncargue}${x.senaMedio ? ' · ' + esc(x.senaMedio) : ''})</span><span class="profit-val">− ${m(x.sena)}</span></div>` : ''}
    <div class="profit-row"><span class="profit-label tk-b" style="font-weight:700">SALDO A COBRAR</span><span class="profit-val tk-b">${m(saldo)}</span></div>
  `;
    const sel = document.getElementById('ent-equipo');
    const cand = contextoApp.stockItems.filter(s => s.status === 'en_stock');
    sel.innerHTML = '<option value="">— sin vincular (item manual, sin costo) —</option>' + cand.map(s => `<option value="${esc(s.id)}">${esc([s.nombre, s.color].filter(Boolean).join(' '))}${s.imei ? ' · ' + s.imei.slice(-6) : ''} (costo u$s ${s.valorUSD || 0})</option>`).join('');
    // preseleccionar si algún equipo matchea el producto
    const match = cand.find(s => (s.nombre || '').toLowerCase().includes((x.producto || '').toLowerCase().slice(0, 12)));
    if (match) sel.value = match.id;
    const ms = document.getElementById('ent-med-sel');
    ms.innerHTML = contextoApp.medios.map(mm => `<option>${esc(mm)}</option>`).join('');
    if (!ms.dataset.auto) {
      ms.dataset.auto = '1';
      ms.addEventListener('change', () => {
        const n = ms.value.toLowerCase();
        const mon = document.getElementById('ent-med-mon');
        if (/dolar|usd/.test(n)) mon.value = 'USD';else if (/peso|transfer|mercado|tarjeta|brubank/.test(n)) mon.value = 'ARS';
      });
    }
    document.getElementById('ent-med-mon').value = x.moneda || 'USD';
    document.getElementById('ent-med-val').value = '';
    renderEntMedios();
    document.getElementById('ent-modal').classList.add('open');
  };
  window.closeEnt = function () {
    document.getElementById('ent-modal').classList.remove('open');
    contextoApp.entId = null;
    contextoApp.entMedios = [];
  };
  window.entAddMedio = function () {
    const val = parseFloat(document.getElementById('ent-med-val').value);
    if (!val || val <= 0) {
      showToast('Ingresá un monto', true);
      return;
    }
    let moneda = document.getElementById('ent-med-mon').value;
    if (moneda === 'USD' && val >= 20000 && confirm(`⚠️ u$s ${val.toLocaleString('es-AR')} parece PESOS. ¿Cargar como ARS?`)) moneda = 'ARS';
    if (moneda === 'ARS' && val <= 2000 && confirm(`⚠️ $ ${val.toLocaleString('es-AR')} pesos — ¿no serán dólares?`)) moneda = 'USD';
    contextoApp.entMedios.push({
      medio: document.getElementById('ent-med-sel').value,
      valor: val,
      moneda
    });
    document.getElementById('ent-med-val').value = '';
    renderEntMedios();
  };
  window.entDelMedio = function (i) {
    contextoApp.entMedios.splice(i, 1);
    renderEntMedios();
  };
  window.entCompletar = function () {
    const t = entTotals();
    const moneda = document.getElementById('ent-med-mon').value;
    let resto = moneda === 'USD' ? Math.round((t.saldoUSD - t.pUSD) * 100) / 100 : Math.round(t.saldoARS - t.pARS);
    if (resto <= 0) {
      showToast('El saldo ya está cubierto ✓');
      return;
    }
    document.getElementById('ent-med-val').value = resto;
    document.getElementById('ent-med-val').focus();
  };
  window.entregarEncargue = async function (imprimir) {
    const x = contextoApp.encarguesItems.find(e => e.id === contextoApp.entId);
    if (!x) return;
    const saldo = (x.precio || 0) - (x.sena || 0);
    if (saldo > 0 && !contextoApp.entMedios.length) {
      showToast('Agregá el medio de cobro del saldo.', true);
      return;
    }
    const btn = document.getElementById('btn-ent');
    btn.disabled = true;
    setSyncDot('syncing');
    try {
      const eqId = document.getElementById('ent-equipo').value;
      const eq = eqId ? contextoApp.stockItems.find(s => s.id === eqId) : null;
      const tc = x.tc || parseFloat(contextoApp.cfg.tc) || null;
      const numVenta = contextoApp.ingresos.reduce((mx, v) => Math.max(mx, v.numVenta || 0), 0) + 1;
      const precio = x.precio || 0;
      const totalARS = x.moneda === 'ARS' ? precio : tc ? Math.round(precio * tc) : null;
      const totalUSD = x.moneda === 'USD' ? precio : tc ? Math.round(precio / tc * 100) / 100 : null;
      const item = eq ? {
        tipo: 'eq',
        refId: eq.id,
        nombre: [eq.nombre, eq.color].filter(Boolean).join(' '),
        qty: 1,
        precio,
        moneda: x.moneda,
        costo: eq.valorUSD || 0,
        imei: eq.imei || '',
        color: eq.color || '',
        gb: eq.gb || '',
        bateria: eq.bateria || null
      } : {
        tipo: 'manual',
        refId: null,
        nombre: x.producto,
        qty: 1,
        precio,
        moneda: x.moneda,
        costo: null,
        imei: ''
      };
      const mediosVenta = [];
      if (x.sena) mediosVenta.push({
        medio: `Seña (${x.fechaEncargue})`,
        valor: x.sena,
        moneda: x.moneda
      });
      mediosVenta.push(...contextoApp.entMedios);
      const venta = {
        fecha: contextoApp.today(),
        hora: new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        numVenta,
        nombre: `Encargue — ${x.producto}`,
        categoria: 'Venta producto',
        clienteId: x.clienteId || null,
        clienteNombre: x.cliente,
        imei: item.imei || '',
        items: [item],
        medios: mediosVenta,
        permuta: null,
        cortesias: [],
        tc,
        totalARS,
        totalUSD,
        gananciaARS: null,
        gananciaUSD: null,
        notas: `Encargue del ${x.fechaEncargue}${x.sena ? ` — seña ${x.moneda === 'ARS' ? contextoApp.fmtARS(x.sena) : 'u$s ' + x.sena} ya cobrada ese día` : ''}`,
        origen: 'pos',
        createdAt: {
          seconds: Date.now() / 1000
        }
      };
      await addDoc(contextoApp.ingresosCol, contextoApp.withUser({
        ...venta,
        createdAt: serverTimestamp()
      }));
      if (eq) await updateDoc(doc(contextoApp.db, 'stock', eq.id), {
        status: 'vendido',
        fechaVenta: contextoApp.today()
      });
      await updateDoc(doc(contextoApp.db, 'encargues', contextoApp.entId), {
        estado: 'entregado',
        numVenta,
        fechaEntrega: contextoApp.today()
      });
      showToast(`Factura #V-${numVenta} generada ✓ — encargue entregado`);
      if (imprimir) imprimirTicketVenta(venta);
      window.closeEnt();
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
  };

  // ── Cierre de caja ────────────────────────────────────
}
