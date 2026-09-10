/** modulos/costos: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { updateDoc, doc } from 'firebase/firestore';
import { esc, showToast } from '../core/interfaz.js';
import { cmpModeloRep } from './repuestos.js';
import { setSyncDot } from '../core/datos.js';

export
// form de alta: {refId, nombre, qty, costo, moneda}

// ── Repuestos para reparaciones: dos orígenes ──
// 'inv' = colección `inventario` (genérico: {nombre, qty, costo, moneda})
// 'rep' = colección `repuestos`  (caja de piezas: {modelo, tipo, color, qty, valorRef} — siempre USD)
// Las líneas viejas no tienen `origen`; se asumen 'inv' para no romper tickets existentes.
function origenRep(x) {
  return x && x.origen === 'rep' ? 'rep' : 'inv';
}
export function colRep(origen) {
  return origen === 'rep' ? 'repuestos' : 'inventario';
}
export function nombrePiezaRep(p) {
  const t = contextoApp.RP_TIPOS[p.tipo] || contextoApp.RP_TIPOS.otro;
  return `${p.modelo || '—'} · ${t.n}${p.color ? ' ' + p.color : ''}`;
}
export function itemRepuesto(origen, id) {
  return (origen === 'rep' ? contextoApp.repuestosItems : contextoApp.invItems).find(x => x.id === id) || null;
}
// value del <select>: "inv:<id>" / "rep:<id>" (sin prefijo = inventario, por compatibilidad)
export function parseRepSel(v) {
  if (!v) return null;
  const i = v.indexOf(':');
  return i < 0 ? {
    origen: 'inv',
    id: v
  } : {
    origen: v.slice(0, i),
    id: v.slice(i + 1)
  };
}
// Línea de repuesto normalizada, con el costo de la fuente que corresponda
export function lineaRepuesto(origen, p, qty) {
  return origen === 'rep' ? {
    refId: p.id,
    origen: 'rep',
    nombre: nombrePiezaRep(p),
    qty,
    costo: p.valorRef || 0,
    moneda: 'USD'
  } : {
    refId: p.id,
    origen: 'inv',
    nombre: p.nombre,
    qty,
    costo: p.costo || 0,
    moneda: p.moneda || 'ARS'
  };
}
// Suma delta al stock de la pieza en SU colección (delta negativo descuenta)
export async function ajustarStockRepuesto(origen, id, delta) {
  const p = itemRepuesto(origen, id);
  if (!p) return;
  await updateDoc(doc(contextoApp.db, colRep(origen), id), {
    qty: Math.max(0, (p.qty || 0) + delta)
  });
}
export function repuestoOptions() {
  const inv = contextoApp.invItems.filter(p => (p.qty || 0) > 0).map(p => `<option value="inv:${p.id}">${esc(p.nombre)} (${p.qty} disp. · ${p.moneda === 'ARS' ? contextoApp.fmtARS(p.costo || 0) : 'u$s ' + (p.costo || 0)})</option>`).join('');
  const rep = contextoApp.repuestosItems.filter(p => (p.qty || 0) > 0).sort((a, b) => cmpModeloRep(a.modelo || '', b.modelo || '') || contextoApp.RP_ORDEN.indexOf(a.tipo) - contextoApp.RP_ORDEN.indexOf(b.tipo) || contextoApp.COLL.compare(a.color || '', b.color || '')).map(p => `<option value="rep:${p.id}">${esc(nombrePiezaRep(p))} (${p.qty} disp. · ${p.valorRef != null ? 'u$s ' + p.valorRef : 'sin precio'})</option>`).join('');
  return '<option value="">— elegir repuesto —</option>' + (inv ? `<optgroup label="📦 Inventario">${inv}</optgroup>` : '') + (rep ? `<optgroup label="🧩 Repuestos — caja de piezas">${rep}</optgroup>` : '');
}
export function populateRepuestoSelects() {
  ['r-rep-sel', 'rm-rep-sel'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = repuestoOptions();
    el.value = prev;
  });
}
export function renderRepuestosTags() {
  document.getElementById('r-repuestos-tags').innerHTML = contextoApp.repRepuestos.map((r, i) => `<div class="medio-tag"><span>${r.libre ? '' : origenRep(r) === 'rep' ? '🧩 ' : '📦 '}${r.qty}x ${esc(r.nombre)}${r.libre ? ' · u$s ' + (r.costo || 0) + ' 🛒' : ''}</span><button onclick="delRepuesto(${i})">×</button></div>`).join('');
}
export function costoMap(tipo) {
  const cch = contextoApp._costoCache[tipo];
  const src = tipo === 'eq' ? contextoApp.stockItems : tipo === 'consig' ? contextoApp.consigItems : contextoApp.invItems;
  if (cch.src !== src) {
    cch.src = src;
    cch.map = new Map(src.map(x => [x.id, x]));
  }
  return cch.map;
}
export function gananciaVentaUSD(v) {
  if (!v.items || !v.items.length) {
    // ingreso manual: usar la ganancia congelada
    return v.gananciaUSD ?? (v.gananciaARS != null && v.tc ? v.gananciaARS / v.tc : null);
  }
  const tc = v.tc || parseFloat(contextoApp.cfg.tc) || null;
  const aUSD = (val, mon) => mon === 'USD' ? val : tc ? val / tc : null;
  let gan = 0,
    hayCosto = false;
  for (const ci of v.items) {
    if (ci.tipo === 'rep' || ci.tipo === 'imp') continue; // reps se computan por su lado; importados sin costo
    // costo ACTUAL del producto (fallback: el congelado en la venta)
    let costoU = null;
    if (ci.tipo === 'eq') {
      const s = costoMap('eq').get(ci.refId);
      if (s) costoU = s.valorUSD || 0;
    } else if (ci.tipo === 'consig') {
      const x = costoMap('consig').get(ci.refId);
      if (x) costoU = x.precioUSD || 0;
    } else if (ci.tipo === 'inv') {
      const p = costoMap('inv').get(ci.refId);
      if (p && p.costo != null) {
        // costo vigente a la fecha de esta venta (historial de reposiciones)
        let cCosto = p.costo,
          cMon = p.moneda || ci.moneda || 'USD';
        if (p.costoHist && p.costoHist.length && v.fecha) {
          const vig = [...p.costoHist].filter(h => h.desde <= v.fecha).sort((a, b) => b.desde.localeCompare(a.desde))[0];
          if (vig) {
            cCosto = vig.costo;
            cMon = vig.moneda || cMon;
          }
        }
        costoU = aUSD(cCosto, cMon);
      }
    }
    if (costoU == null) costoU = ci.costo != null ? aUSD(ci.costo, ci.moneda || 'USD') : null;
    if (costoU == null || costoU === 0 && !ci.costo) {
      // sin costo conocido: solo suma precio como ganancia si había costo congelado 0 explícito
      if (ci.costo == null) continue;
    }
    hayCosto = true;
    const precioU = aUSD(ci.precio || 0, ci.moneda || 'ARS');
    if (precioU == null) continue;
    gan += (precioU - (costoU || 0)) * (ci.qty || 1);
  }
  (v.cortesias || []).forEach(co => {
    hayCosto = true;
    gan -= co.costoUSD || 0;
  });
  return hayCosto ? gan : null;
}
export function costoRepuestosUSD(r) {
  const tc = r.tc || parseFloat(contextoApp.cfg.tc) || null;
  return (r.repuestos || []).reduce((s, x) => {
    const cst = (x.costo || 0) * (x.qty || 1);
    return s + (x.moneda === 'USD' ? cst : tc ? cst / tc : 0);
  }, 0);
}

// ── agregar repuesto desde el modal de detalle ──
export function inicializarCostos() {
  // ── Repuestos en reparaciones ─────────────────────────
  contextoApp.repRepuestos = [];
  window.addRepuesto = function () {
    const sel = document.getElementById('r-rep-sel');
    const qty = parseInt(document.getElementById('r-rep-qty').value) || 1;
    const s = parseRepSel(sel.value);
    if (!s) {
      showToast('Elegí un repuesto.', true);
      return;
    }
    const p = itemRepuesto(s.origen, s.id);
    if (!p) return;
    const mismo = r => r.refId === p.id && origenRep(r) === s.origen;
    const yaUsado = contextoApp.repRepuestos.filter(mismo).reduce((acc, r) => acc + r.qty, 0);
    if (yaUsado + qty > (p.qty || 0)) {
      showToast('No hay stock suficiente.', true);
      return;
    }
    const ex = contextoApp.repRepuestos.find(mismo);
    if (ex) ex.qty += qty;else contextoApp.repRepuestos.push(lineaRepuesto(s.origen, p, qty));
    document.getElementById('r-rep-qty').value = 1;
    sel.value = '';
    renderRepuestosTags();
  };
  window.addRepuestoLibre = function () {
    const nombre = document.getElementById('r-rep-libre-nombre').value.trim();
    const costo = parseFloat(document.getElementById('r-rep-libre-costo').value) || 0;
    if (!nombre) {
      showToast('Poné el nombre del repuesto.', true);
      return;
    }
    contextoApp.repRepuestos.push({
      refId: null,
      nombre,
      qty: 1,
      costo,
      moneda: 'USD',
      libre: true
    });
    document.getElementById('r-rep-libre-nombre').value = '';
    document.getElementById('r-rep-libre-costo').value = '';
    renderRepuestosTags();
  };
  window.addRepuestoLibreModal = async function () {
    if (!contextoApp.repEditId) return;
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) return;
    const nombre = document.getElementById('rm-rep-libre-nombre').value.trim();
    const costo = parseFloat(document.getElementById('rm-rep-libre-costo').value) || 0;
    if (!nombre) {
      showToast('Poné el nombre del repuesto.', true);
      return;
    }
    const repuestos = [...(r.repuestos || []), {
      refId: null,
      nombre,
      qty: 1,
      costo,
      moneda: 'USD',
      libre: true
    }];
    const hist = [...(r.historial || []), {
      fecha: contextoApp.today(),
      texto: `Repuesto (comprado aparte): ${nombre} — u$s ${costo}`
    }];
    document.getElementById('rm-rep-libre-nombre').value = '';
    document.getElementById('rm-rep-libre-costo').value = '';
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'reparaciones', contextoApp.repEditId), {
        repuestos,
        historial: hist
      });
      setTimeout(() => window.abrirRep(contextoApp.repEditId), 300);
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.delRepuesto = function (i) {
    contextoApp.repRepuestos.splice(i, 1);
    renderRepuestosTags();
  };

  // costo total de repuestos de una rep, en USD (usa tc del ticket)
  // Ganancia recalculada EN VIVO con los costos actuales de los productos.
  // Si corregís el costo de un equipo/consignación/inventario, los reportes se actualizan solos.
  // Lookups memoizados: se reconstruyen solo cuando cambia el array fuente
  contextoApp._costoCache = {
    eq: {
      src: null,
      map: null
    },
    consig: {
      src: null,
      map: null
    },
    inv: {
      src: null,
      map: null
    }
  };
  window.addRepuestoModal = async function () {
    if (!contextoApp.repEditId) return;
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) return;
    const sel = document.getElementById('rm-rep-sel');
    const qty = parseInt(document.getElementById('rm-rep-qty').value) || 1;
    const s = parseRepSel(sel.value);
    if (!s) {
      showToast('Elegí un repuesto.', true);
      return;
    }
    const p = itemRepuesto(s.origen, s.id);
    if (!p) return;
    if (qty > (p.qty || 0)) {
      showToast('No hay stock suficiente.', true);
      return;
    }
    const repuestos = [...(r.repuestos || [])];
    const linea = lineaRepuesto(s.origen, p, qty);
    const ex = repuestos.find(x => x.refId === p.id && origenRep(x) === s.origen);
    if (ex) ex.qty += qty;else repuestos.push(linea);
    const hist = [...(r.historial || []), {
      fecha: contextoApp.today(),
      texto: `Repuesto agregado: ${qty}x ${linea.nombre}`
    }];
    setSyncDot('syncing');
    try {
      // si ya se había descontado stock (estado reparado), descontar este también ahora
      if (r.stockDescontado) {
        await ajustarStockRepuesto(s.origen, p.id, -qty);
      }
      await updateDoc(doc(contextoApp.db, 'reparaciones', contextoApp.repEditId), {
        repuestos,
        historial: hist
      });
      setTimeout(() => window.abrirRep(contextoApp.repEditId), 300);
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.quitarRepuestoModal = async function (idx) {
    if (!contextoApp.repEditId) return;
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) return;
    const repuestos = [...(r.repuestos || [])];
    const quitado = repuestos.splice(idx, 1)[0];
    if (!quitado) return;
    const hist = [...(r.historial || []), {
      fecha: contextoApp.today(),
      texto: `Repuesto quitado: ${quitado.qty}x ${quitado.nombre}`
    }];
    setSyncDot('syncing');
    try {
      // si ya estaba descontado, devolver el stock a su colección de origen
      if (r.stockDescontado && !quitado.libre && quitado.refId) {
        await ajustarStockRepuesto(origenRep(quitado), quitado.refId, +quitado.qty);
      }
      await updateDoc(doc(contextoApp.db, 'reparaciones', contextoApp.repEditId), {
        repuestos,
        historial: hist
      });
      setTimeout(() => window.abrirRep(contextoApp.repEditId), 300);
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };

  // ── WhatsApp ──────────────────────────────────────────
  // Si un template guardado tiene caracteres corruptos (�), usar el default sano
}
