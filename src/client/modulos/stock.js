/** modulos/stock: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { updateDoc, doc, addDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { setSyncDot } from '../core/datos.js';
import { showToast, esc } from '../core/interfaz.js';
import { workerHeaders, textoDeIA } from './reportes.js';
import { populateProveedoresDL } from './consignacion.js';

export
// ── Stock permutas ────────────────────────────────────

async function handleStockFromIngreso(inc) {
  try {
    // 1. Permuta → add to stock
    if (inc.permuta && (inc.permuta.descripcion || inc.permuta.imei)) {
      const imei = (inc.permuta.imei || '').trim();
      // Use local stockItems to check for existing — already loaded at this point
      let existingId = null;
      if (imei && contextoApp.stockItems.length > 0) {
        const ex = contextoApp.stockItems.find(s => (s.imei || '').trim() === imei);
        if (ex) existingId = ex.id;
      }
      const entry = {
        nombre: inc.permuta.descripcion || '',
        imei: imei,
        valorUSD: inc.permuta.moneda === 'USD' ? inc.permuta.valor || 0 : inc.tc ? Math.round((inc.permuta.valor || 0) / inc.tc * 100) / 100 : null,
        valorARS: inc.permuta.moneda === 'ARS' ? inc.permuta.valor || 0 : inc.tc ? Math.round((inc.permuta.valor || 0) * inc.tc) : null,
        moneda: inc.permuta.moneda || 'USD',
        valorOriginal: inc.permuta.valor || 0,
        fechaEntrada: inc.fecha || contextoApp.today(),
        origenIngreso: inc.nombre || '',
        status: 'en_stock',
        fechaVenta: null,
        ingresoVentaNombre: null
      };
      if (existingId) {
        await updateDoc(doc(contextoApp.db, 'stock', existingId), entry);
      } else {
        await addDoc(contextoApp.stockCol, contextoApp.withUser(entry));
      }
    }

    // 2. IMEI on the sale → mark matching stock item as vendido
    const imeiVenta = (inc.imei || '').trim();
    if (imeiVenta && contextoApp.stockItems.length > 0) {
      const match = contextoApp.stockItems.find(s => (s.imei || '').trim() === imeiVenta && s.status === 'en_stock');
      if (match) {
        await updateDoc(doc(contextoApp.db, 'stock', match.id), {
          status: 'vendido',
          fechaVenta: inc.fecha || contextoApp.today(),
          ingresoVentaNombre: inc.nombre || ''
        });
      }
    }
    setSyncDot('ok');
  } catch (e) {
    console.warn('Stock update error:', e);
    setSyncDot('ok'); // don't leave it spinning
  }
}

// ── 3uTools Verification Report Parser ──────────────────
export function parse3uReport(text) {
  // Helper: get first value after label, stop at tab or newline
  const get = label => {
    const re = new RegExp(label + '[\\t\\s]+([^\\t\\n\\r]+)', 'i');
    const m = text.match(re);
    if (!m) return null;
    // The verification report has "Label  ExValue  ReadValue  Result"
    // We want only the first value (ex-factory), so split by 2+ spaces or tab
    const parts = m[1].split(/\t|  +/);
    return parts[0].trim() || null;
  };

  // Model name — first value only
  const modelName = get('Model Name');

  // Color — extract Rear color only from "Front X，Rear Y" format
  let color = null;
  const colorRaw = get('Device Color');
  if (colorRaw) {
    const rearMatch = colorRaw.match(/Rear\s+(.+?)(?:，|,|$)/i);
    if (rearMatch) color = rearMatch[1].trim();else color = colorRaw.replace(/Front\s+[^，,]+[，,]?\s*/i, '').trim() || colorRaw.trim();
  }

  // Capacity — first value
  const capacity = get('Capacity');

  // IMEI — try Verification Report format first (IMEI field in table)
  let imei = null;
  // Raw device dump format
  const imeiRaw = text.match(/InternationalMobileEquipmentIdentity\s+(\d{15})/);
  if (imeiRaw) imei = imeiRaw[1];
  // Verification report doesn't always show IMEI — it's in the raw dump
  // Try any 15-digit number labeled IMEI
  if (!imei) {
    const m2 = text.match(/\bIMEI[1]?\s*[:\|]?\s*(\d{15})/i);
    if (m2) imei = m2[1];
  }

  // Serial Number — in verification report it appears as "Serial Number  VALUE  VALUE  Normal"
  let serial = null;
  const snMatch = text.match(/Serial Number[	 ]+([A-Z0-9]{8,12})/i);
  if (snMatch) serial = snMatch[1];
  if (!serial) {
    const m2 = text.match(/SerialNumber\s+([A-Z0-9]{8,12})/i);
    if (m2) serial = m2[1];
  }

  // Region
  const region = get('Sales Region') || get('RegionInfo');

  // Battery
  let bateria = null;
  const batMatch = text.match(/Battery Life[	 ]+(\d+)%/i);
  if (batMatch) bateria = batMatch[1];

  // Cycles
  let ciclos = null;
  const cycMatch = text.match(/Charge Cycles[	 ]+(\d+)/i);
  if (cycMatch) ciclos = cycMatch[1];

  // iOS version — just the number before parenthesis
  let ios = null;
  const iosMatch = text.match(/iOS Version[	 ]+([\d.]+)/i);
  if (iosMatch) ios = iosMatch[1];
  if (!ios) {
    const m2 = text.match(/HumanReadableProductVersionString\s+([\d.]+)/);
    if (m2) ios = m2[1];
  }

  // Jailbreak
  const jb = get('Jailbreak');
  return {
    modelName,
    color,
    capacity,
    imei,
    serial,
    region,
    bateria,
    ciclos,
    ios,
    jb
  };
}
export function fill3uForm(prefix, d) {
  // producto = model name only; capacity goes to GB field
  const desc = d.modelName || '';
  if (prefix === 'cp') {
    if (desc) document.getElementById('cp-producto').value = desc;
    if (d.color) document.getElementById('cp-color').value = d.color;
    if (d.capacity) document.getElementById('cp-gb').value = d.capacity;
    if (d.imei) document.getElementById('cp-imei').value = d.imei;
    if (d.bateria) document.getElementById('cp-bateria').value = d.bateria;
    if (d.ciclos) document.getElementById('cp-ciclos').value = d.ciclos;
    // estado: if has battery info it was connected = usado; otherwise leave as is
    if (d.bateria) document.getElementById('cp-estado').value = 'Usado';
    const notas = [d.region ? 'Region: ' + d.region : null, d.ios ? 'iOS ' + d.ios : null, d.jb && d.jb !== 'No' ? '⚠️ Jailbreak' : null, d.serial ? 'SN: ' + d.serial : null].filter(Boolean).join(' · ');
    if (notas) document.getElementById('cp-notas').value = notas;
  } else if (prefix === 'st') {
    if (desc) document.getElementById('st-nombre').value = desc + (d.capacity ? ' ' + d.capacity : '');
    if (d.color) document.getElementById('st-color').value = d.color;
    if (d.capacity) document.getElementById('st-gb').value = d.capacity;
    if (d.imei) document.getElementById('st-imei').value = d.imei;
    if (d.bateria) document.getElementById('st-bateria').value = d.bateria;
    if (d.ciclos) document.getElementById('st-ciclos').value = d.ciclos;
    if (d.bateria) document.getElementById('st-estado-prod').value = 'Usado';
    const notas2 = [d.region ? 'Region: ' + d.region : null, d.ios ? 'iOS ' + d.ios : null, d.jb && d.jb !== 'No' ? '⚠️ Jailbreak' : null].filter(Boolean).join(' · ');
    if (notas2) document.getElementById('st-notas').value = notas2;
  }
}
export function renderStock() {
  const fEstado = document.getElementById('st-fl-estado').value;
  const fBus = (document.getElementById('st-fl-buscar').value || '').toLowerCase().trim();
  let items = contextoApp.stockItems.filter(s => {
    if (fEstado === 'refurb') {
      if (!(s.refurb && s.status === 'en_stock')) return false;
    } else if (fEstado && s.status !== fEstado) return false;
    if (fBus && !((s.nombre || '').toLowerCase().includes(fBus) || (s.imei || '').toLowerCase().includes(fBus))) return false;
    return true;
  });
  const enStock = contextoApp.stockItems.filter(s => s.status === 'en_stock');
  const totalParadoUSD = enStock.reduce((sum, s) => sum + (s.valorUSD || 0), 0);
  const totalParadoARS = enStock.reduce((sum, s) => sum + (s.valorARS || 0), 0);
  const enRefurb = contextoApp.stockItems.filter(s => s.refurb && s.status === 'en_stock');
  const refurbUSD = enRefurb.reduce((s, x) => s + (x.valorUSD || 0), 0);
  document.getElementById('stock-metrics').innerHTML = `
    ${enRefurb.length ? `<div class="metric" style="cursor:pointer;" onclick="document.getElementById('st-fl-estado').value='refurb';renderStock();" title="Ver solo los equipos a reparar"><div class="m-label">🔨 En refurbishment</div><div class="m-val" style="color:#B45309">${enRefurb.length}</div><div class="m-sub">u$s ${Math.round(refurbUSD)} parados · ver</div></div>` : ''}
    <div class="metric"><div class="m-label">En stock</div><div class="m-val">${enStock.length}</div><div class="m-sub">items</div></div>
    <div class="metric"><div class="m-label">Capital parado USD</div><div class="m-val" style="color:var(--neg)">${contextoApp.fmtUSD(totalParadoUSD)}</div><div class="m-sub">${totalParadoARS > 0 ? contextoApp.fmtARS(totalParadoARS) : ''}</div></div>
    <div class="metric"><div class="m-label">Vendidos</div><div class="m-val">${contextoApp.stockItems.filter(s => s.status === 'vendido').length}</div><div class="m-sub">total histórico</div></div>
  `;
  if (!items.length) {
    document.getElementById('stock-list-body').innerHTML = '<div class="empty">Sin items en este filtro.<br>Se cargan automáticamente cuando registrás un ingreso con permuta.</div>';
    return;
  }

  // Tope de filas (las métricas de arriba siguen sobre todo el filtro)
  const _totS = items.length;
  if (_totS > 100) items = items.slice(0, 100);
  document.getElementById('stock-list-body').innerHTML = (_totS > 100 ? `<div class="empty" style="padding:.5rem;">Mostrando 100 de ${_totS} — refiná los filtros para ver el resto.</div>` : '') + items.map(s => {
    const vendido = s.status === 'vendido';
    const badge = vendido ? '<span class="stock-badge-vend">Vendido</span>' : '<span class="stock-badge-en">● En stock</span>';
    const tipoBadge = s.tipo === 'propio' ? '<span class="consig-tipo tipo-propio">💰 Propio</span>' : '<span class="consig-tipo tipo-permuta">💱 Permuta</span>';
    const fechaVentaStr = vendido && s.fechaVenta ? ` · Vendido ${s.fechaVenta}${s.ingresoVentaNombre ? ' → ' + esc(s.ingresoVentaNombre) : ''}` : '';
    return `<div class="stock-item">
      <div class="stock-dot${vendido ? ' vendido' : ''}"></div>
      <div class="stock-info">
        <div class="stock-nombre">${esc([s.nombre || 'Sin descripción', s.color].filter(Boolean).join(' '))}${s.refurb ? ' <span class="stock-badge-gb" style="background:#FEF3E7;color:#B45309;border-color:#F2C48D;">🔨 En refurb</span>' : ''}</div>
        <div class="stock-meta">
          <span>Entró ${s.fechaEntrada || ''}</span>
          ${badge}
          ${s.gb ? `<span class="stock-badge-gb">${esc(s.gb)}</span>` : ''}
          ${tipoBadge}
          ${s.imei ? `<span style="font-family:'DM Mono',monospace;font-size:10px;">IMEI ${esc(s.imei)}</span>` : ''}
          ${s.origenIngreso ? `<span>via ${esc(s.origenIngreso)}</span>` : ''}
          ${s.bateria ? `<span>🔋 ${esc(s.bateria)}%</span>` : ''}
          ${s.ciclos ? `<span>${esc(s.ciclos)} ciclos</span>` : ''}
          ${fechaVentaStr ? `<span>${fechaVentaStr}</span>` : ''}
        </div>
      </div>
      <div class="stock-val">
        ${s.valorUSD != null ? `<div class="stock-usd" style="${vendido ? 'color:var(--text3)' : ''}">${contextoApp.fmtUSD(s.valorUSD)}</div>` : ''}
        ${s.valorARS != null ? `<div class="stock-sub">${contextoApp.fmtARS(s.valorARS)}</div>` : ''}
      </div>
      <div class="ei-actions">
        <button class="ei-btn" onclick="labelEquipo('${s.id}')" title="Imprimir etiqueta 62x100mm">🏷</button>
        ${s.status === 'en_stock' && !s.refurb ? `<button class="ei-btn" onclick="mandarARefurb('${s.id}')" title="Mandar a refurbishment (reparación interna)">🔨</button>` : ''}
        <button class="ei-btn" onclick="editarStock('${s.id}')" title="Editar">✎</button>
        <button class="ei-btn del" onclick="eliminarStock('${s.id}')" title="Eliminar">×</button>
      </div>
    </div>`;
  }).join('');
}

// ── Stock edit ──
export function inicializarStock() {
  window.import3uTools = function (prefix) {
    const fileInput = document.getElementById(prefix + '-3u-file');
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const text = e.target.result;
      const parsed = parse3uReport(text);
      fill3uForm(prefix, parsed);
      // Show success msg
      const ok = document.getElementById(prefix + '-import-ok');
      if (ok) {
        ok.style.display = 'block';
        setTimeout(() => ok.style.display = 'none', 3000);
      }
      fileInput.value = ''; // reset so same file can be re-imported
    };
    reader.readAsText(file);
  };
  window.guardarStock = async function () {
    const nombre = document.getElementById('st-nombre').value.trim();
    if (!nombre) {
      showToast('Completá la descripción.', true);
      return;
    }
    const valor = parseFloat(document.getElementById('st-valor').value) || 0;
    const moneda = document.getElementById('st-moneda').value;
    const tc = parseFloat(document.getElementById('st-tc').value) || null;
    const valorUSD = moneda === 'USD' ? valor : tc ? Math.round(valor / tc * 100) / 100 : null;
    const valorARS = moneda === 'ARS' ? valor : tc ? Math.round(valor * tc) : null;
    const entry = {
      nombre,
      imei: document.getElementById('st-imei').value.trim(),
      valorUSD,
      valorARS,
      moneda,
      valorOriginal: valor,
      fechaEntrada: document.getElementById('st-fecha').value || contextoApp.today(),
      origenIngreso: document.getElementById('st-origen').value.trim(),
      tipo: document.getElementById('st-tipo').value,
      bateria: document.getElementById('st-bateria').value || null,
      ciclos: document.getElementById('st-ciclos').value || null,
      color: document.getElementById('st-color').value.trim(),
      gb: document.getElementById('st-gb').value.trim(),
      estadoProducto: document.getElementById('st-estado-prod').value.trim(),
      precioVentaUSD: parseFloat(document.getElementById('st-precio-venta').value) || null,
      fmi: document.getElementById('st-fmi').value || null,
      blacklist: document.getElementById('st-blacklist').value || null,
      cosmetica: document.getElementById('st-cosmetica').value.trim() || null,
      notas: document.getElementById('st-notas').value.trim(),
      status: 'en_stock',
      fechaVenta: null,
      ingresoVentaNombre: null
    };
    const btn = document.getElementById('btn-st-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.stockCol, contextoApp.withUser(entry));
      showToast('Item agregado al stock ✓');
      document.getElementById('st-nombre').value = '';
      document.getElementById('st-imei').value = '';
      document.getElementById('st-valor').value = '';
      document.getElementById('st-tc').value = '';
      document.getElementById('st-origen').value = '';
      document.getElementById('st-precio-venta').value = '';
      document.getElementById('st-cosmetica').value = '';
      document.getElementById('st-fmi').value = '';
      document.getElementById('st-blacklist').value = '';
      ['st-color', 'st-gb', 'st-estado-prod', 'st-notas', 'st-bateria', 'st-ciclos'].forEach(i => document.getElementById(i).value = '');
      document.getElementById('st-fecha').value = contextoApp.today();
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Agregar al stock';
  };
  contextoApp.stockEditingId = null;
  window.editarStock = function (id) {
    const s = contextoApp.stockItems.find(x => x.id === id);
    if (!s) return;
    contextoApp.stockEditingId = id;
    document.getElementById('sm-nombre').value = s.nombre || '';
    document.getElementById('sm-imei').value = s.imei || '';
    document.getElementById('sm-valor').value = s.valorOriginal || s.valorUSD || '';
    document.getElementById('sm-moneda').value = s.moneda || 'USD';
    document.getElementById('sm-tc').value = s.tc || '';
    document.getElementById('sm-fecha').value = s.fechaEntrada || contextoApp.today();
    document.getElementById('sm-status').value = s.status || 'en_stock';
    document.getElementById('sm-fecha-venta').value = s.fechaVenta || '';
    document.getElementById('sm-origen').value = s.origenIngreso || '';
    document.getElementById('sm-color').value = s.color || '';
    document.getElementById('sm-gb').value = s.gb || '';
    document.getElementById('sm-bateria').value = s.bateria || '';
    document.getElementById('sm-ciclos').value = s.ciclos || '';
    document.getElementById('sm-estado-prod').value = s.estadoProducto || '';
    document.getElementById('sm-notas').value = s.notas || '';
    document.getElementById('sm-fmi').value = s.fmi || '';
    document.getElementById('sm-blacklist').value = s.blacklist || '';
    document.getElementById('sm-cosmetica').value = s.cosmetica || '';
    document.getElementById('sm-precio-venta').value = s.precioVentaUSD || '';
    document.getElementById('sm-tipo').value = s.tipo || 'permuta';
    document.getElementById('sm-tipo-wrap').style.display = 'block';
    document.getElementById('sm-venta-wrap').style.display = s.status === 'vendido' ? 'block' : 'none';
    document.getElementById('stock-edit-modal').classList.add('open');
  };
  window.closeStockModal = function () {
    document.getElementById('stock-edit-modal').classList.remove('open');
    contextoApp.stockEditingId = null;
  };
  document.getElementById('sm-status').addEventListener('change', function () {
    document.getElementById('sm-venta-wrap').style.display = this.value === 'vendido' ? 'block' : 'none';
  });
  window.saveStockModal = async function () {
    if (!contextoApp.stockEditingId) return;
    const nombre = document.getElementById('sm-nombre').value.trim();
    if (!nombre) {
      showToast('Completá la descripción.', true);
      return;
    }
    const valor = parseFloat(document.getElementById('sm-valor').value) || 0;
    const moneda = document.getElementById('sm-moneda').value;
    const tc = parseFloat(document.getElementById('sm-tc').value) || null;
    const valorUSD = moneda === 'USD' ? valor : tc ? Math.round(valor / tc * 100) / 100 : null;
    const valorARS = moneda === 'ARS' ? valor : tc ? Math.round(valor * tc) : null;
    const status = document.getElementById('sm-status').value;
    const data = {
      nombre,
      imei: document.getElementById('sm-imei').value.trim(),
      valorUSD,
      valorARS,
      moneda,
      valorOriginal: valor,
      tc,
      fechaEntrada: document.getElementById('sm-fecha').value || contextoApp.today(),
      origenIngreso: document.getElementById('sm-origen').value.trim(),
      color: document.getElementById('sm-color').value.trim(),
      gb: document.getElementById('sm-gb').value.trim(),
      bateria: document.getElementById('sm-bateria').value || null,
      ciclos: document.getElementById('sm-ciclos').value || null,
      estadoProducto: document.getElementById('sm-estado-prod').value.trim(),
      notas: document.getElementById('sm-notas').value.trim(),
      fmi: document.getElementById('sm-fmi').value || null,
      blacklist: document.getElementById('sm-blacklist').value || null,
      cosmetica: document.getElementById('sm-cosmetica').value.trim() || null,
      precioVentaUSD: parseFloat(document.getElementById('sm-precio-venta').value) || null,
      tipo: document.getElementById('sm-tipo').value,
      status,
      fechaVenta: status === 'vendido' ? document.getElementById('sm-fecha-venta').value || null : null,
      ingresoVentaNombre: status === 'vendido' ? contextoApp.stockItems.find(x => x.id === contextoApp.stockEditingId)?.ingresoVentaNombre || null : null
    };
    const btn = document.getElementById('stock-modal-save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'stock', contextoApp.stockEditingId), data);
      showToast('Item actualizado ✓');
      window.closeStockModal();
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  };
  document.getElementById('stock-edit-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeStockModal();
  });
  window.eliminarStock = async function (id) {
    if (!confirm('¿Eliminar este item del stock?')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'stock', id));
    } catch (e) {
      showToast('Error al eliminar', true);
      setSyncDot('error');
    }
  };

  // ── Importar lista con IA ────────────────────────────────
  contextoApp.listaParseada = [];
  window.interpretarLista = async function () {
    const texto = document.getElementById('lista-texto').value.trim();
    const proveedor = document.getElementById('lista-proveedor').value.trim();
    if (!texto) {
      showToast('Pegá una lista primero.', true);
      return;
    }
    const btn = document.getElementById('btn-lista-interpretar');
    btn.disabled = true;
    btn.textContent = '⏳ Interpretando...';
    try {
      const response = await fetch(contextoApp.WORKER_URL, {
        method: 'POST',
        headers: await workerHeaders(),
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 8000,
          output_config: {
            effort: 'low'
          },
          messages: [{
            role: 'user',
            content: `Sos un experto en listas de productos de celulares. Analizá esta lista y extraé TODA la información de cada equipo, sin importar el formato (puede venir desordenado, con emojis, abreviado, en varias líneas por item). Devolvé SOLO un JSON array válido, sin texto adicional, sin markdown, sin backticks.

Cada objeto puede tener estos campos (poné null en los que no aparezcan, NO inventes):
- producto: nombre del modelo, ej "iPhone 17 Pro" (obligatorio)
- color: color si está, ej "Desert Titanium", "Negro", "Blue"
- gb: capacidad, ej "256GB", "1TB"
- bateria: SOLO el número de salud de batería, ej "Batería 92%" o "bat 92" o "🔋92%" → 92 (número sin %)
- ciclos: número de ciclos de carga si aparece, ej "415 ciclos" → 415
- imei: IMEI o número de serie si aparece (15 dígitos), como string
- estadoProducto: si menciona estado, ej "Nuevo", "Usado", "Impecable"
- cantidad: número, default 1
- precio: número sin símbolos ni separadores de miles, null si no hay
- itemId: ID o código interno si hay
- notas: cualquier otro dato relevante (ej "sin caja", "liberado")

Interpretá con inteligencia: "92%" cerca de batería o un 🔋 es batería; 15 dígitos es IMEI; "(415 ciclos)" son ciclos. Si un item tiene Cant > 1, expandilo en objetos individuales.

Lista:
${texto}`
          }]
        })
      });
      const data = await response.json();
      console.log('API response:', JSON.stringify(data).slice(0, 500));
      const raw = textoDeIA(data).replace(/```json|```/g, '').trim();
      contextoApp.listaParseada = JSON.parse(raw);

      // Render preview
      const moneda = document.getElementById('lista-moneda').value;
      const tc = parseFloat(document.getElementById('lista-tc').value) || null;
      document.getElementById('lista-preview-items').innerHTML = contextoApp.listaParseada.map((item, i) => {
        const precioStr = item.precio ? moneda === 'USD' ? 'u$s ' + item.precio : '$ ' + Number(item.precio).toLocaleString('es-AR') : '—';
        return `<div class="stock-item" style="align-items:center;">
        <div class="stock-info">
          <div class="stock-nombre">${esc(item.producto || '')} ${esc(item.gb || '')} ${esc(item.color || '')}</div>
          <div class="stock-meta" style="display:flex;flex-wrap:wrap;gap:2px;align-items:center;">
            ${item.itemId ? `<span style="font-family:'DM Mono',monospace;font-size:11px;">#${esc(item.itemId)}</span>` : ''}${(() => {
          const b = [item.bateria != null ? `🔋 ${item.bateria}%` : '', item.ciclos != null ? `${item.ciclos} ciclos` : '', item.imei ? `IMEI ${String(item.imei).slice(-6)}` : '', item.estadoProducto ? esc(item.estadoProducto) : '', item.notas ? esc(item.notas) : ''].filter(Boolean);
          return b.map(ch => `<span style="font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:100px;padding:1px 7px;margin-left:4px;">${ch}</span>`).join('');
        })()}
            ${proveedor ? `<span style="font-size:11px;color:var(--text3);">${esc(proveedor)}</span>` : ''}
          </div>
        </div>
        <div class="stock-val"><div class="stock-usd">${precioStr}</div></div>
        <button class="ei-btn del" onclick="quitarDePreview(${i})" title="Quitar">×</button>
      </div>`;
      }).join('');
      document.getElementById('lista-preview').style.display = 'block';
      showToast(`${contextoApp.listaParseada.length} productos interpretados ✓`);
    } catch (e) {
      console.error(e);
      showToast('Error al interpretar. Revisá la lista.', true);
    }
    btn.disabled = false;
    btn.textContent = '✨ Interpretar con IA';
  };
  window.quitarDePreview = function (i) {
    contextoApp.listaParseada.splice(i, 1);
    // Re-render
    document.getElementById('lista-preview-items').innerHTML = contextoApp.listaParseada.map((item, i) => {
      const moneda = document.getElementById('lista-moneda').value;
      const precioStr = item.precio ? moneda === 'USD' ? 'u$s ' + item.precio : '$ ' + Number(item.precio).toLocaleString('es-AR') : '—';
      return `<div class="stock-item" style="align-items:center;">
      <div class="stock-info">
        <div class="stock-nombre">${esc(item.producto || '')} ${esc(item.gb || '')} ${esc(item.color || '')}</div>
        <div class="stock-meta" style="display:flex;flex-wrap:wrap;gap:2px;align-items:center;">${item.itemId ? `<span style="font-family:'DM Mono',monospace;font-size:11px;">#${esc(item.itemId)}</span>` : ''}${(() => {
        const b = [item.bateria != null ? `🔋 ${item.bateria}%` : '', item.ciclos != null ? `${item.ciclos} ciclos` : '', item.imei ? `IMEI ${String(item.imei).slice(-6)}` : '', item.estadoProducto ? esc(item.estadoProducto) : '', item.notas ? esc(item.notas) : ''].filter(Boolean);
        return b.map(ch => `<span style="font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:100px;padding:1px 7px;margin-left:4px;">${ch}</span>`).join('');
      })()}</div>
      </div>
      <div class="stock-val"><div class="stock-usd">${precioStr}</div></div>
      <button class="ei-btn del" onclick="quitarDePreview(${i})">×</button>
    </div>`;
    }).join('');
    if (!contextoApp.listaParseada.length) document.getElementById('lista-preview').style.display = 'none';
  };
  window.cancelarLista = function () {
    contextoApp.listaParseada = [];
    document.getElementById('lista-preview').style.display = 'none';
  };
  window.guardarLista = async function () {
    if (!contextoApp.listaParseada.length) return;
    const proveedor = document.getElementById('lista-proveedor').value.trim();
    const moneda = document.getElementById('lista-moneda').value;
    const tc = parseFloat(document.getElementById('lista-tc').value) || null;
    const btn = document.getElementById('btn-lista-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      const batch = writeBatch(contextoApp.db);
      contextoApp.listaParseada.forEach(item => {
        const precio = item.precio ? parseFloat(item.precio) : null;
        const precioUSD = precio ? moneda === 'USD' ? precio : tc ? Math.round(precio / tc * 100) / 100 : null : null;
        const precioARS = precio ? moneda === 'ARS' ? precio : tc ? Math.round(precio * tc) : null : null;
        const ref = doc(contextoApp.consigCol);
        batch.set(ref, contextoApp.withUser({
          proveedor: proveedor || item.proveedor || '',
          producto: item.producto || '',
          color: item.color || '',
          gb: item.gb || '',
          estadoProducto: item.estadoProducto || 'Nuevo',
          imei: item.imei ? String(item.imei) : '',
          itemId: item.itemId ? String(item.itemId) : '',
          fechaEntrada: contextoApp.today(),
          precio: precio,
          moneda,
          tc,
          precioUSD,
          precioARS,
          bateria: item.bateria != null ? Number(item.bateria) : null,
          ciclos: item.ciclos != null ? Number(item.ciclos) : null,
          notas: item.notas || '',
          status: 'en_stock',
          fechaVenta: null,
          createdAt: serverTimestamp()
        }));
      });
      await batch.commit();
      showToast(`${contextoApp.listaParseada.length} productos guardados ✓`);
      contextoApp.listaParseada = [];
      document.getElementById('lista-texto').value = '';
      document.getElementById('lista-preview').style.display = 'none';
      populateProveedoresDL();
    } catch (e) {
      showToast('Error al guardar.', true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar todos';
  };

  // ── Consignación ──────────────────────────────────────
}
