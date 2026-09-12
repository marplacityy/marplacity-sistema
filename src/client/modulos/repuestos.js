/** modulos/repuestos: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { on } from '../../shared/seguridad.js';
import { showToast, esc } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { writeBatch, doc, serverTimestamp, updateDoc, addDoc, deleteDoc } from 'firebase/firestore';
import { workerHeaders, textoDeIA } from './reportes.js';
export
// modelos conocidos (de precios + inventario + stock) para autocompletar
function repModelosConocidos() {
  const set = new Set();
  contextoApp.preciosRepItems.forEach(p => p.modelo && set.add(p.modelo));
  contextoApp.repuestosItems.forEach(p => p.modelo && set.add(p.modelo));
  contextoApp.stockItems.forEach(s => s.nombre && set.add(s.nombre));
  return [...set].sort((a, b) => contextoApp.COLL.compare(a, b));
}
export function populateRepModelosDL() {
  const dl = document.getElementById('rp-modelos-dl');
  if (dl) dl.innerHTML = repModelosConocidos().map(m => `<option value="${esc(m)}">`).join('');
}

// precio de referencia de una pieza (modelo+tipo)
export function precioRef(modelo, tipo) {
  const p = contextoApp.preciosRepItems.find(x => x.modelo === modelo && x.tipo === tipo);
  return p ? p.valor || 0 : null;
}

// grid de piezas en el form de carga suelta
export function initRepPiezasGrid() {
  const grid = document.getElementById('rp-piezas-grid');
  if (!grid || grid.dataset.init) return;
  grid.dataset.init = '1';
  grid.innerHTML = Object.entries(contextoApp.RP_TIPOS).map(([k, v]) => `
    <div style="display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 8px;">
      <span style="font-size:12px;flex:1;">${v.icon} ${v.n.split(' ')[0]}</span>
      <input type="number" id="rp-qty-${k}" min="0" placeholder="0" style="width:44px;padding:4px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);">
    </div>`).join('');
}
export
// Orden de modelos: más viejo → más nuevo
function rankModeloRep(nombre) {
  const n = (nombre || '').toLowerCase();
  const gen = (n.match(/iphone\s*(\d+)/) || [])[1];
  if (!gen) return {
    gen: 999,
    variante: 9
  };
  let variante = 2;
  if (/pro\s*max/.test(n)) variante = 5;else if (/pro/.test(n)) variante = 4;else if (/plus/.test(n)) variante = 3;else if (/mini/.test(n)) variante = 1;else if (/\d+\s*e\b/.test(n)) variante = 0;
  return {
    gen: parseInt(gen),
    variante
  };
}
export function cmpModeloRep(a, b) {
  const ra = rankModeloRep(a),
    rb = rankModeloRep(b);
  return ra.gen - rb.gen || ra.variante - rb.variante || contextoApp.COLL.compare(a, b);
}
// Orden fijo de piezas dentro de cada modelo
export function renderRepInv() {
  try {
    const fTipo = document.getElementById('rp-fl-tipo').value;
    const fBus = (document.getElementById('rp-fl-buscar').value || '').toLowerCase().trim();
    const todas = contextoApp.repuestosItems.filter(p => (p.qty || 0) > 0);

    // métricas sobre TODA la caja
    const valorTotal = todas.reduce((s, p) => s + (p.valorRef || 0) * (p.qty || 0), 0);
    const sinPrecio = todas.filter(p => p.valorRef == null).length;
    const totalPiezas = todas.reduce((s, p) => s + (p.qty || 0), 0);
    document.getElementById('rp-metrics').innerHTML = `
    <div class="metric"><div class="m-label">Piezas en stock</div><div class="m-val">${totalPiezas}</div></div>
    <div class="metric"><div class="m-label">Valor de la caja</div><div class="m-val" style="color:#237A4B">u$s ${Math.round(valorTotal)}</div><div class="m-sub">a precio de reposición</div></div>
    ${sinPrecio ? `<div class="metric" style="cursor:pointer;" ${on('click', 'irATabPrecios')}><div class="m-label">Sin precio cargado</div><div class="m-val" style="color:#854F0B">${sinPrecio}</div><div class="m-sub">click para cargar</div></div>` : ''}
  `;

    // filtros
    let items = todas;
    if (fTipo) items = items.filter(p => p.tipo === fTipo);
    if (fBus) items = items.filter(p => {
      const txt = ((p.modelo || '') + ' ' + (p.color || '') + ' ' + (contextoApp.RP_TIPOS[p.tipo] ? contextoApp.RP_TIPOS[p.tipo].n : '') + ' ' + (p.notas || '')).toLowerCase();
      return fBus.split(/\s+/).every(t => txt.includes(t));
    });

    // agrupar por modelo y ordenar
    const porModelo = {};
    items.forEach(p => {
      (porModelo[p.modelo] = porModelo[p.modelo] || []).push(p);
    });
    const modelos = Object.keys(porModelo).sort(cmpModeloRep);
    let filas = '';
    let subtotal = 0,
      cantFiltrada = 0;
    modelos.forEach(mod => {
      const piezas = porModelo[mod].sort((a, b) => contextoApp.RP_ORDEN.indexOf(a.tipo) - contextoApp.RP_ORDEN.indexOf(b.tipo) || contextoApp.COLL.compare(a.color || '', b.color || ''));
      const valMod = piezas.reduce((s, p) => s + (p.valorRef || 0) * (p.qty || 0), 0);
      const cantMod = piezas.reduce((s, p) => s + (p.qty || 0), 0);
      subtotal += valMod;
      cantFiltrada += cantMod;
      filas += `<tr class="rp-modelo-row">
      <td>${esc(mod)}</td>
      <td class="rp-num">${valMod ? 'u$s ' + Math.round(valMod) : ''}</td>
      <td class="rp-cant">${cantMod}</td>
      <td></td>
    </tr>`;
      piezas.forEach(p => {
        const t = contextoApp.RP_TIPOS[p.tipo] || contextoApp.RP_TIPOS.otro;
        const detalle = t.n + (p.color ? ` ${p.color}` : '');
        const val = p.valorRef != null ? 'u$s ' + p.valorRef : '<span class="rp-sinprecio">sin precio</span>';
        filas += `<tr>
        <td class="rp-pieza-txt">${t.icon} ${esc(detalle)}${p.notas && p.notas !== 'Carga masiva' && p.notas !== 'De equipo entero desarmado' ? `<div style="font-size:11px;color:var(--text3);">${esc(p.notas)}</div>` : ''}</td>
        <td class="rp-num rp-precio-cell" id="rpc-${p.id}" ${on('click', 'editarPrecioInline', p.id)} title="Click para poner el precio">${val}</td>
        <td class="rp-cant">${p.qty}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="tkh-open" ${on('click', 'usarPieza', p.id)} title="Usé una (baja 1)">−1</button>
          <button class="ei-btn del" ${on('click', 'eliminarPieza', p.id)} title="Eliminar">×</button>
        </td>
      </tr>`;
      });
    });
    document.getElementById('rp-inv-body').innerHTML = filas || `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:2rem;">${todas.length ? 'Sin resultados para ese filtro.' : 'Caja vacía. Cargá piezas desde "➕ Cargar piezas".'}</td></tr>`;
    document.getElementById('rp-inv-foot').innerHTML = filas ? `<tr><td>TOTAL · ${modelos.length} modelo${modelos.length === 1 ? '' : 's'}</td><td class="rp-num" style="color:#237A4B;">u$s ${Math.round(subtotal)}</td><td class="rp-cant">${cantFiltrada}</td><td></td></tr>` : '';
  } catch (e) {
    console.error('renderRepInv', e);
    document.getElementById('rp-inv-body').innerHTML = '<tr><td colspan="4" style="padding:1rem;">Error: ' + e.message + '</td></tr>';
  }
}

// Editar precio de referencia haciendo click en la celda
export
// Guarda/actualiza el precio de referencia y revalúa todas las piezas de ese modelo+tipo
async function setPrecioRef(modelo, tipo, valor) {
  setSyncDot('syncing');
  try {
    const existe = contextoApp.preciosRepItems.find(x => x.modelo === modelo && x.tipo === tipo);
    if (existe) await updateDoc(doc(contextoApp.db, 'precios_repuestos', existe.id), {
      valor
    });else await addDoc(contextoApp.preciosRepCol, contextoApp.withUser({
      modelo,
      tipo,
      valor,
      createdAt: serverTimestamp()
    }));
    const afectadas = contextoApp.repuestosItems.filter(p => p.modelo === modelo && p.tipo === tipo);
    if (afectadas.length) {
      for (let i = 0; i < afectadas.length; i += 400) {
        const batch = writeBatch(contextoApp.db);
        afectadas.slice(i, i + 400).forEach(p => batch.update(doc(contextoApp.db, 'repuestos', p.id), {
          valorRef: valor
        }));
        await batch.commit();
      }
    }
    showToast(`${contextoApp.RP_TIPOS[tipo].n} ${modelo} = u$s ${valor}` + (afectadas.length > 1 ? ` · ${afectadas.length} líneas actualizadas` : ''));
    setSyncDot('ok');
  } catch (e) {
    console.error(e);
    showToast('Error: ' + e.message, true);
    setSyncDot('error');
  }
}
export function renderPreciosRef() {
  try {
    populateRepModelosDL();
    const items = [...contextoApp.preciosRepItems].sort((a, b) => contextoApp.COLL.compare(a.modelo, b.modelo) || Object.keys(contextoApp.RP_TIPOS).indexOf(a.tipo) - Object.keys(contextoApp.RP_TIPOS).indexOf(b.tipo));
    const porModelo = {};
    items.forEach(p => {
      (porModelo[p.modelo] = porModelo[p.modelo] || []).push(p);
    });
    const modelos = Object.keys(porModelo).sort((a, b) => contextoApp.COLL.compare(a, b));
    document.getElementById('rp-precios-list').innerHTML = modelos.length ? modelos.map(mod => `
    <div class="card" style="margin-bottom:8px;">
      <div style="font-weight:600;margin-bottom:6px;">${esc(mod)}</div>
      ${porModelo[mod].map(p => `
        <div class="home-list-item" style="cursor:default;">
          <div>${contextoApp.RP_TIPOS[p.tipo].icon} ${contextoApp.RP_TIPOS[p.tipo].n}</div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-family:'DM Mono',monospace;font-weight:600;">u$s ${p.valor}</span>
            <button class="ei-btn del" ${on('click', 'eliminarPrecioRef', p.id)}>×</button>
          </div>
        </div>`).join('')}
    </div>`).join('') : '<div class="empty">Sin precios cargados. Cargá los valores de reposición arriba.</div>';
  } catch (e) {
    console.error('renderPreciosRef', e);
    document.getElementById('rp-precios-list').innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
  }
}
export function inicializarRepuestos() {
  // ── Repuestos (OEM pull) ──────────────────────────────
  contextoApp.RP_TIPOS = {
    modulo: {
      n: 'Módulo (pantalla)',
      icon: '📱'
    },
    chasis: {
      n: 'Chasis',
      icon: '🔲'
    },
    tapa: {
      n: 'Tapa',
      icon: '🪟'
    },
    camara: {
      n: 'Cámara trasera',
      icon: '📷'
    },
    bateria: {
      n: 'Batería',
      icon: '🔋'
    },
    flex_carga: {
      n: 'Flex de carga',
      icon: '🔌'
    },
    otro: {
      n: 'Otro',
      icon: '🧩'
    }
  };
  window.irATabPrecios = () => window.setRepuestosTab('precios', document.getElementById('rp-tab-precios'));
  window.setRepuestosTab = function (tab, btn) {
    try {
      document.querySelectorAll('#page-repuestos .tab-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      ['inv', 'add', 'precios'].forEach(t => {
        const el = document.getElementById('rp-sec-' + t);
        if (el) el.style.display = t === tab ? 'block' : 'none';
      });
      if (tab === 'inv') renderRepInv();
      if (tab === 'precios') renderPreciosRef();
      if (tab === 'add') {
        initRepPiezasGrid();
        populateRepModelosDL();
      }
    } catch (e) {
      console.error('setRepTab', e);
      showToast('Error: ' + e.message, true);
    }
  };
  window.guardarPiezas = async function () {
    const modelo = document.getElementById('rp-modelo').value.trim();
    if (!modelo) {
      showToast('Poné el modelo.', true);
      return;
    }
    const color = document.getElementById('rp-color').value.trim();
    const notas = document.getElementById('rp-notas').value.trim();
    const aGuardar = [];
    Object.keys(contextoApp.RP_TIPOS).forEach(tipo => {
      const qty = parseInt(document.getElementById('rp-qty-' + tipo).value) || 0;
      if (qty > 0) aGuardar.push({
        tipo,
        qty
      });
    });
    if (!aGuardar.length) {
      showToast('Poné cantidad en al menos una pieza.', true);
      return;
    }
    const btn = document.getElementById('btn-rp-guardar');
    btn.disabled = true;
    setSyncDot('syncing');
    try {
      const batch = writeBatch(contextoApp.db);
      aGuardar.forEach(({
        tipo,
        qty
      }) => {
        const ref = doc(contextoApp.repuestosCol);
        batch.set(ref, contextoApp.withUser({
          modelo,
          color,
          tipo,
          qty,
          valorRef: precioRef(modelo, tipo),
          notas,
          fechaAlta: contextoApp.today(),
          createdAt: serverTimestamp()
        }));
      });
      await batch.commit();
      document.getElementById('rp-modelo').value = '';
      document.getElementById('rp-color').value = '';
      document.getElementById('rp-notas').value = '';
      Object.keys(contextoApp.RP_TIPOS).forEach(t => document.getElementById('rp-qty-' + t).value = '');
      const sinPrecio = aGuardar.filter(({
        tipo
      }) => precioRef(modelo, tipo) == null);
      showToast('Piezas agregadas ✓' + (sinPrecio.length ? ` — ${sinPrecio.length} sin precio de referencia (cargalo en la pestaña Precios)` : ''));
    } catch (e) {
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
  };
  window.llenarEquipoEntero = function () {
    // Llena el grid con 1 en las piezas principales de un equipo entero
    ['modulo', 'chasis', 'camara', 'bateria', 'flex_carga'].forEach(t => {
      const el = document.getElementById('rp-qty-' + t);
      if (el) el.value = 1;
    });
    showToast('Piezas del equipo cargadas — sacá las que no tengas y agregá tapa si corresponde');
  };
  contextoApp.RP_ORDEN = ['modulo', 'chasis', 'tapa', 'camara', 'bateria', 'flex_carga', 'otro'];
  window.editarPrecioInline = function (pid) {
    const p = contextoApp.repuestosItems.find(x => x.id === pid);
    if (!p) return;
    const td = document.getElementById('rpc-' + pid);
    if (!td || td.dataset.editing) return;
    td.dataset.editing = '1';
    const actual = p.valorRef != null ? p.valorRef : '';
    td.innerHTML = `<input type="number" class="rp-precio-input" id="rpi-${pid}" value="${esc(actual)}" step="0.01" min="0" placeholder="0">`;
    const inp = document.getElementById('rpi-' + pid);
    inp.focus();
    inp.select();
    let cerrado = false;
    const guardar = async guardarValor => {
      if (cerrado) return;
      cerrado = true;
      const v = parseFloat(inp.value);
      delete td.dataset.editing;
      if (!guardarValor || isNaN(v) || v < 0) {
        renderRepInv();
        return;
      }
      await setPrecioRef(p.modelo, p.tipo, v);
    };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        guardar(true);
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        guardar(false);
      }
    });
    inp.addEventListener('blur', () => guardar(true));
  };
  window.vaciarCaja = async function () {
    const total = contextoApp.repuestosItems.length;
    if (!total) {
      showToast('La caja ya está vacía.');
      return;
    }
    if (!confirm(`⚠️ Esto borra las ${total} líneas de piezas cargadas.\n\nLos PRECIOS de referencia NO se borran.\n\n¿Seguro?`)) return;
    if (!confirm('Última confirmación: se borra todo el inventario de repuestos. ¿Continuar?')) return;
    setSyncDot('syncing');
    try {
      const ids = contextoApp.repuestosItems.map(p => p.id);
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(contextoApp.db);
        ids.slice(i, i + 400).forEach(id => batch.delete(doc(contextoApp.db, 'repuestos', id)));
        await batch.commit();
      }
      showToast(`Caja vaciada ✓ — ${ids.length} líneas borradas`);
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
  };
  window.usarPieza = async function (id) {
    const p = contextoApp.repuestosItems.find(x => x.id === id);
    if (!p) return;
    if ((p.qty || 0) <= 0) return;
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'repuestos', id), {
        qty: p.qty - 1
      });
      showToast(`Usaste 1× ${contextoApp.RP_TIPOS[p.tipo].n} de ${p.modelo}`);
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.eliminarPieza = async function (id) {
    const p = contextoApp.repuestosItems.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`¿Eliminar ${contextoApp.RP_TIPOS[p.tipo].n} de ${p.modelo} (×${p.qty})?`)) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'repuestos', id));
      showToast('Pieza eliminada');
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };

  // ── Precios de referencia ──
  // Extrae precios de una página pegada (MobileSentrix u otra lista)
  window.importarPreciosIA = async function () {
    const texto = document.getElementById('rpp-bulk-text').value.trim();
    if (!texto) {
      showToast('Pegá el contenido primero.', true);
      return;
    }
    const modeloHint = document.getElementById('rpp-bulk-modelo').value.trim();
    const calidad = document.getElementById('rpp-bulk-calidad').value;
    const btn = document.getElementById('btn-rpp-bulk');
    const status = document.getElementById('rpp-bulk-status');
    btn.disabled = true;
    status.textContent = '🤖 Leyendo la página y extrayendo precios...';
    try {
      const calidadTxt = calidad === 'oem_pull' ? 'Priorizá SIEMPRE la variante "OEM Pull", "Pull", "Original Pulled", "Genuine Used" o equivalente (pieza original sacada de equipo). Si no existe esa calidad para una pieza, usá la de mayor calidad original disponible.' : calidad === 'premium' ? 'Priorizá la variante Premium / Aftermarket de alta calidad.' : 'Usá el precio MÁS BARATO disponible de cada pieza.';
      const resp = await fetch(contextoApp.WORKER_URL, {
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
            content: `Sos experto en repuestos de celulares. Te paso el texto crudo copiado de una página de un proveedor de repuestos (puede venir con menús, basura, precios en varias calidades). Extraé los precios de las piezas.

${modeloHint ? `Todos los productos corresponden al modelo: "${modeloHint}". Usá ese modelo exacto en cada objeto.` : 'Deducí a qué modelo de iPhone corresponde cada producto por su nombre.'}

${calidadTxt}

Devolvé SOLO un JSON array válido, sin texto ni markdown ni backticks. Cada objeto:
- modelo: nombre normalizado exacto, ej "iPhone 14 Pro", "iPhone 13 mini", "iPhone 16 Pro", "iPhone 16E" (siempre con "iPhone " adelante)
- tipo: UNO EXACTO de estos 7 valores. Usá este diccionario de equivalencias (el proveedor escribe en inglés):
  * "modulo" = Screen, Display, LCD Assembly, OLED Assembly, Screen Assembly, Digitizer Assembly, LCD with Frame, Display Assembly
  * "chasis" = HOUSING (esta es la palabra clave), Back Housing, Rear Housing, Housing Assembly, Housing with Small Parts, Mid Frame, Frame Assembly, Chassis, Back Housing with Small Parts. OJO: "housing" SIEMPRE es chasis, nunca tapa.
  * "tapa" = Back Glass, Back Cover Glass, Rear Glass, Back Glass Cover, Battery Cover (SOLO el vidrio/tapa trasera suelta, sin marco ni small parts)
  * "camara" = Rear Camera, Back Camera, Main Camera, Rear Camera Module (NO la frontal/front/selfie: esa es "otro")
  * "bateria" = Battery, Battery Cell, Battery with Adhesive
  * "flex_carga" = Charging Port, Charging Port Flex, Charging Flex Cable, Dock Connector, Charging Dock Flex, Lightning Port, USB-C Port Flex
  * "otro" = cualquier otra pieza (front camera, earpiece, speaker, taptic, wifi flex, power flex, volume flex, etc.)
  Diferencia clave chasis vs tapa: si dice HOUSING o FRAME → "chasis". Si dice BACK GLASS solo → "tapa"
- valor: número en USD, sin símbolo ni comas (ej 89.99 → 89.99)
- calidad: la etiqueta de calidad que corresponde a ese precio (ej "OEM Pull", "Premium"), o null

Reglas:
- UN objeto por combinación modelo+tipo. Si hay varias calidades del mismo tipo, elegí UNA según la preferencia indicada arriba.
- Ignorá productos que no sean esas 6 piezas (herramientas, adhesivos, kits, accesorios).
- Ignorá precios de envío, totales de carrito, impuestos.
- Si no encontrás ninguna pieza válida, devolvé [].

Texto:
${texto}`
          }]
        })
      });
      if (!resp.ok) throw new Error('El servidor respondió ' + resp.status);
      const data = await resp.json();
      const txt = textoDeIA(data).replace(/```json|```/g, '').trim();
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr) || !arr.length) throw new Error('No se detectaron precios de piezas en ese texto');

      // guardar cada precio (crea o actualiza) y revaluar piezas
      let nuevos = 0,
        actualizados = 0,
        revaluadas = 0;
      for (const it of arr) {
        if (!it.modelo || !it.tipo || it.valor == null) continue;
        const tipo = contextoApp.RP_TIPOS[it.tipo] ? it.tipo : 'otro';
        const modelo = String(it.modelo).trim();
        const valor = Math.round(parseFloat(it.valor) * 100) / 100;
        if (!(valor > 0)) continue;
        const existe = contextoApp.preciosRepItems.find(x => x.modelo === modelo && x.tipo === tipo);
        if (existe) {
          await updateDoc(doc(contextoApp.db, 'precios_repuestos', existe.id), {
            valor
          });
          actualizados++;
        } else {
          await addDoc(contextoApp.preciosRepCol, contextoApp.withUser({
            modelo,
            tipo,
            valor,
            createdAt: serverTimestamp()
          }));
          nuevos++;
        }
        const afectadas = contextoApp.repuestosItems.filter(p => p.modelo === modelo && p.tipo === tipo);
        if (afectadas.length) {
          const batch = writeBatch(contextoApp.db);
          afectadas.forEach(p => batch.update(doc(contextoApp.db, 'repuestos', p.id), {
            valorRef: valor
          }));
          await batch.commit();
          revaluadas += afectadas.length;
        }
      }
      document.getElementById('rpp-bulk-text').value = '';
      status.innerHTML = `✅ ${nuevos} precios nuevos · ${actualizados} actualizados${revaluadas ? ` · ${revaluadas} piezas de tu caja revaluadas` : ''}. Mirá el valor total en "📦 Mi caja".`;
      showToast(`${nuevos + actualizados} precios cargados ✓`);
    } catch (e) {
      console.error(e);
      status.innerHTML = '⚠️ ' + e.message;
      showToast('Error: ' + e.message, true);
    }
    btn.disabled = false;
  };
  window.guardarPrecioRef = async function () {
    const modelo = document.getElementById('rpp-modelo').value.trim();
    const tipo = document.getElementById('rpp-tipo').value;
    const valor = parseFloat(document.getElementById('rpp-valor').value) || 0;
    if (!modelo || valor <= 0) {
      showToast('Poné modelo y valor.', true);
      return;
    }
    await setPrecioRef(modelo, tipo, valor);
    document.getElementById('rpp-valor').value = '';
    return;
  };
  window.eliminarPrecioRef = async function (id) {
    const p = contextoApp.preciosRepItems.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`¿Borrar el precio de ${contextoApp.RP_TIPOS[p.tipo].n} ${p.modelo}?`)) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'precios_repuestos', id));
      showToast('Precio borrado');
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };

  // ── Carga masiva de una caja con IA ──
  window.cargarCajaIA = async function () {
    const texto = document.getElementById('rp-bulk-text').value.trim();
    if (!texto) {
      showToast('Pegá la lista primero.', true);
      return;
    }
    const btn = document.getElementById('btn-rp-bulk');
    const status = document.getElementById('rp-bulk-status');
    btn.disabled = true;
    status.textContent = '🤖 Interpretando la lista...';
    try {
      const resp = await fetch(contextoApp.WORKER_URL, {
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
            content: `Sos experto en repuestos de celulares. Te paso una lista de piezas sueltas y equipos donantes que hay en una caja. Devolvé SOLO un JSON array válido, sin texto ni markdown ni backticks.

Cada objeto = una línea de pieza con: modelo (ej "iPhone 14 Pro"), color (color/variante si aparece, ej "purple eSIM", "negro"; null si no), tipo (uno EXACTO de: "modulo","chasis","tapa","camara","bateria","flex_carga","otro"), qty (número, default 1).

Reglas de interpretación:
- "Módulo" / "pantalla" / "display" / "screen" / "LCD" / "OLED" → tipo "modulo"
- "Chasis" / "housing" / "frame" / "carcasa" (con o sin small parts) → "chasis"
- "Tapa" / "back glass" / "vidrio trasero" / "tapa trasera" → "tapa"
- "Cámara" / "CAM" / "rear camera" (trasera) → "camara"
- "Batería" / "bat" / "battery" → "bateria"
- "Flex de carga" / "flex carga" / "pin de carga" / "charging port" / "dock" → "flex_carga"
- "x2", "x3" al final = qty. Sin número = qty 1.
- Si una línea dice "todo menos módulo" para un modelo: generá chasis, tapa, camara, bateria, flex_carga (5 piezas, SIN modulo), qty 1 c/u, con ese color.
- Si dice "todo de X" o "todo" (equipo entero): generá modulo, chasis, camara, bateria, flex_carga (5 piezas; agregá tapa solo si es un modelo con tapa desmontable como 15/16). qty 1.
- "solo chasis" → solo esa pieza.
- Si un color trae dos variantes ("negro / blanco", "purple x2 white") generá líneas separadas por color con su qty.
- Ignorá líneas vacías o que no sean piezas.
- Normalizá los nombres de modelo SIEMPRE así: "iPhone 11", "iPhone 11 Pro", "iPhone 12 Pro", "iPhone 13 mini", "iPhone 13", "iPhone 13 Pro", "iPhone 14", "iPhone 14 Plus", "iPhone 14 Pro", "iPhone 14 Pro Max", "iPhone 15", "iPhone 15 Pro", "iPhone 15 Pro Max", "iPhone 16E", "iPhone 16", "iPhone 16 Pro". Respetá esa forma exacta (con "iPhone" así escrito) para que el sistema agrupe bien.

Lista:
${texto}`
          }]
        })
      });
      if (!resp.ok) throw new Error('El servidor respondió ' + resp.status);
      const data = await resp.json();
      const txt = textoDeIA(data).replace(/```json|```/g, '').trim();
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr) || !arr.length) throw new Error('No se detectaron piezas');

      // guardar en batches
      let guardadas = 0;
      for (let i = 0; i < arr.length; i += 400) {
        const batch = writeBatch(contextoApp.db);
        arr.slice(i, i + 400).forEach(p => {
          if (!p.modelo || !p.tipo) return;
          const tipo = contextoApp.RP_TIPOS[p.tipo] ? p.tipo : 'otro';
          const ref = doc(contextoApp.repuestosCol);
          batch.set(ref, contextoApp.withUser({
            modelo: String(p.modelo).trim(),
            color: p.color ? String(p.color).trim() : '',
            tipo,
            qty: parseInt(p.qty) || 1,
            valorRef: precioRef(String(p.modelo).trim(), tipo),
            notas: 'Carga masiva',
            fechaAlta: contextoApp.today(),
            createdAt: serverTimestamp()
          }));
          guardadas++;
        });
        await batch.commit();
      }
      document.getElementById('rp-bulk-text').value = '';
      status.innerHTML = `✅ ${guardadas} líneas de piezas cargadas. Revisalas en "📦 Mi caja". Cargá los precios de referencia para valuarlas.`;
      showToast(`${guardadas} piezas cargadas ✓`);
    } catch (e) {
      console.error(e);
      status.innerHTML = '⚠️ ' + e.message + ' — probá de nuevo o cargá manual.';
      showToast('Error: ' + e.message, true);
    }
    btn.disabled = false;
  };

  // ── Encargues ─────────────────────────────────────────
}
