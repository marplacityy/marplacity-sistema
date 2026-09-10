/** modulos/clientes: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { setSyncDot, applySnap, deb, snapErr } from '../core/datos.js';
import { onSnapshot, updateDoc, doc, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { esc, showToast } from '../core/interfaz.js';

export
// ── Clientes ──────────────────────────────────────────

// Autocompletado dinámico: puebla el datalist solo con matches (máx 20)
// — un datalist con 7.000 opciones congela el navegador
function populateClientesDL() {/* ya no se pre-carga: ver fillClienteDL */}

// La lista completa de clientes se suscribe recién al entrar a la pantalla Clientes,
// una sola vez por sesión. El resto del sistema busca en Firestore lo que necesita.
export
// promesa que resuelve con el primer snapshot
function cargarClientes() {
  if (contextoApp.clientesListos) return contextoApp.clientesListos;
  setSyncDot('syncing');
  contextoApp.clientesListos = new Promise(res => {
    onSnapshot(contextoApp.myQ(contextoApp.clientesCol), snap => {
      const _c = applySnap('clientes', snap);
      if (_c) {
        contextoApp.clientesItems = _c;
        contextoApp.clientesItems.sort((a, b) => contextoApp.COLL.compare(a.nombre || '', b.nombre || ''));
      }
      if (contextoApp.currentPage === 'clientes') deb('cl', renderClientes);
      setSyncDot('ok');
      res();
    }, e => {
      snapErr(e);
      res();
    });
  });
  return contextoApp.clientesListos;
}

/**
 * Los clientes que coinciden con `q`. Si la lista todavía no está cargada, se carga
 * (una sola vez por sesión) y se espera a que llegue: es lo que evita crear un cliente
 * duplicado al vender porque "no se encontró" uno que sí existía.
 */
export async function buscarClientes(q) {
  q = (q || '').toLowerCase().trim();
  if (q.length < 2) return [];
  await cargarClientes();
  return contextoApp.clientesItems.filter(x => (x.nombre || '').toLowerCase().includes(q)).slice(0, 20);
}
export async function fillClienteDL(dlId, q) {
  const dl = document.getElementById(dlId);
  if (!dl) return;
  q = (q || '').toLowerCase().trim();
  if (q.length < 2) {
    dl.innerHTML = '';
    return;
  }
  const matches = await buscarClientes(q);
  dl.innerHTML = matches.map(x => `<option value="${esc(x.nombre)}">`).join('');
}
export function attachClienteAC(inputId, dlId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener('input', () => fillClienteDL(dlId, el.value));
}

/** El cliente con ese nombre exacto, buscando en Firestore si la lista no está cargada. */
export async function clientePorNombre(nombre) {
  nombre = (nombre || '').trim().toLowerCase();
  if (!nombre) return null;
  return (await buscarClientes(nombre)).find(x => (x.nombre || '').toLowerCase() === nombre) || null;
}
export
// Busca o crea cliente. Devuelve {id, nombre} o null (consumidor final)
async function resolverCliente(nombre, tel) {
  nombre = (nombre || '').trim();
  if (!nombre) return null;
  const existente = await clientePorNombre(nombre);
  if (existente) {
    // actualizar tel si vino uno nuevo y no tenía
    if (tel && !existente.tel) {
      updateDoc(doc(contextoApp.db, 'clientes', existente.id), {
        tel
      }).catch(() => {});
    }
    return {
      id: existente.id,
      nombre: existente.nombre
    };
  }
  const ref = await addDoc(contextoApp.clientesCol, contextoApp.withUser({
    nombre,
    tel: tel || '',
    notas: '',
    createdAt: serverTimestamp()
  }));
  return {
    id: ref.id,
    nombre
  };
}
export function opsDeCliente(cl) {
  const nom = (cl.nombre || '').toLowerCase();
  const ventas = contextoApp.ingresos.filter(v => v.clienteId === cl.id || (v.clienteNombre || '').toLowerCase() === nom);
  const repas = contextoApp.reps.filter(r => r.clienteId === cl.id || (r.cliente || '').toLowerCase() === nom);
  return {
    ventas,
    repas
  };
}

// Índice para el listado de clientes: una sola pasada por ingresos y reparaciones,
// en vez de escanear ambos arrays por cada cliente que se renderiza.
export function indiceOpsClientes() {
  const porId = new Map(),
    porNombre = new Map();
  const push = (m, k, campo, v) => {
    if (!k) return;
    let o = m.get(k);
    if (!o) {
      o = {
        ventas: [],
        repas: []
      };
      m.set(k, o);
    }
    o[campo].push(v);
  };
  contextoApp.ingresos.forEach(v => {
    push(porId, v.clienteId, 'ventas', v);
    push(porNombre, (v.clienteNombre || '').toLowerCase(), 'ventas', v);
  });
  contextoApp.reps.forEach(r => {
    push(porId, r.clienteId, 'repas', r);
    push(porNombre, (r.cliente || '').toLowerCase(), 'repas', r);
  });
  return {
    porId,
    porNombre
  };
}
// Mismo resultado que opsDeCliente() pero en O(1). Deduplica porque un documento
// puede matchear por id y por nombre a la vez.
export function opsDeClienteIdx(cl, idx) {
  const a = idx.porId.get(cl.id) || {
    ventas: [],
    repas: []
  };
  const b = idx.porNombre.get((cl.nombre || '').toLowerCase()) || {
    ventas: [],
    repas: []
  };
  const unir = (x, y) => {
    if (!y.length) return x;
    if (!x.length) return y;
    const vistos = new Set(x.map(d => d.id));
    return x.concat(y.filter(d => !vistos.has(d.id)));
  };
  return {
    ventas: unir(a.ventas, b.ventas),
    repas: unir(a.repas, b.repas)
  };
}
export function renderClientes() {
  const fBus = (document.getElementById('cl-buscar').value || '').toLowerCase().trim();
  let items = contextoApp.clientesItems.filter(x => {
    if (fBus && !((x.nombre || '') + ' ' + (x.tel || '')).toLowerCase().includes(fBus)) return false;
    return true;
  });
  document.getElementById('cl-metrics').innerHTML = `
    <div class="metric"><div class="m-label">Clientes</div><div class="m-val">${contextoApp.clientesItems.length}</div></div>
  `;
  const _totC = items.length;
  if (_totC > 100) items = items.slice(0, 100);
  if (!items.length) {
    document.getElementById('cl-list').innerHTML = '<div class="empty" style="grid-column:1/-1;">Sin clientes. Se crean solos al vender o recibir una reparación con nombre.</div>';
    return;
  }
  const _idxOps = indiceOpsClientes();
  document.getElementById('cl-list').innerHTML = (_totC > 100 ? `<div class="empty" style="grid-column:1/-1;padding:.5rem;">Mostrando 100 de ${_totC} — usá el buscador.</div>` : '') + items.map(cl => {
    const {
      ventas,
      repas
    } = opsDeClienteIdx(cl, _idxOps);
    const gastoUSD = ventas.reduce((s, v) => s + (v.totalUSD || 0), 0);
    const gastoARS = ventas.reduce((s, v) => s + (v.totalARS || 0), 0);
    const gastoStr = gastoUSD > 0.01 ? contextoApp.fmtUSD(Math.round(gastoUSD * 100) / 100) : gastoARS > 0 ? contextoApp.fmtARS(gastoARS) : '—';
    return `<div class="rep-card" onclick="abrirCliente('${cl.id}')">
      <div class="rep-cliente">${esc(cl.nombre)}</div>
      ${cl.tel ? `<div class="rep-equipo">${esc(cl.tel)}</div>` : ''}
      <div class="rep-meta">
        <span>${ventas.length} compra${ventas.length !== 1 ? 's' : ''}</span>
        <span>${repas.length} reparación${repas.length !== 1 ? 'es' : ''}</span>
      </div>
      <div class="rep-precio">${gastoStr}</div>
    </div>`;
  }).join('');
}
export function inicializarClientes() {
  contextoApp.clientesListos = null;
  window.autofillTelRep = async function () {
    const cl = await clientePorNombre(document.getElementById('r-cliente').value);
    if (cl && cl.tel && !document.getElementById('r-tel').value) document.getElementById('r-tel').value = cl.tel;
  };
  window.autofillTelCliente = async function (prefix) {
    const cl = await clientePorNombre(document.getElementById(prefix + '-cliente').value);
    if (cl && cl.tel) {
      const telEl = document.getElementById(prefix + '-cliente-tel') || document.getElementById(prefix === 'r' ? 'r-tel' : null);
      if (telEl && !telEl.value) telEl.value = cl.tel;
    }
  };
  contextoApp.clEditId = null;
  window.abrirCliente = function (id) {
    const cl = contextoApp.clientesItems.find(x => x.id === id);
    if (!cl) return;
    contextoApp.clEditId = id;
    document.getElementById('cl-modal-title').textContent = cl.nombre;
    document.getElementById('clm-nombre').value = cl.nombre || '';
    document.getElementById('clm-tel').value = cl.tel || '';
    document.getElementById('clm-notas').value = cl.notas || '';
    const {
      ventas,
      repas
    } = opsDeCliente(cl);
    const ops = [...ventas.map(v => ({
      fecha: v.fecha,
      tipo: '🛒 Compra',
      desc: v.nombre,
      monto: v.totalUSD ? 'u$s ' + v.totalUSD : v.totalARS ? contextoApp.fmtARS(v.totalARS) : ''
    })), ...repas.map(r => ({
      fecha: r.fecha,
      tipo: '🔧 Reparación #' + r.num,
      desc: (r.equipo || '') + ' — ' + (r.trabajo || ''),
      monto: r.precio ? r.moneda === 'ARS' ? contextoApp.fmtARS(r.precio) : 'u$s ' + r.precio : ''
    }))].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    document.getElementById('cl-historial').innerHTML = ops.length ? ops.map(o => `<div class="pago-item">
        <div class="pago-info">
          <div style="font-size:13px;font-weight:500;">${o.tipo} · ${esc(o.desc)}</div>
          <div class="pago-fecha">${o.fecha || ''}</div>
        </div>
        <div class="pago-monto">${o.monto}</div>
      </div>`).join('') : '<div class="empty" style="padding:1rem 0;">Sin operaciones registradas.</div>';
    document.getElementById('cl-modal').classList.add('open');
  };
  window.closeClModal = function () {
    document.getElementById('cl-modal').classList.remove('open');
    contextoApp.clEditId = null;
  };
  window.saveCliente = async function () {
    if (!contextoApp.clEditId) return;
    const nombre = document.getElementById('clm-nombre').value.trim();
    if (!nombre) {
      showToast('El nombre no puede quedar vacío.', true);
      return;
    }
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'clientes', contextoApp.clEditId), {
        nombre,
        tel: document.getElementById('clm-tel').value.trim(),
        notas: document.getElementById('clm-notas').value.trim()
      });
      showToast('Cliente actualizado ✓');
      window.closeClModal();
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };
  window.eliminarCliente = async function () {
    if (!contextoApp.clEditId) return;
    if (!confirm('¿Eliminar este cliente? Sus ventas y reparaciones NO se borran.')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'clientes', contextoApp.clEditId));
      window.closeClModal();
      showToast('Cliente eliminado');
    } catch (e) {
      showToast('Error', true);
      setSyncDot('error');
    }
  };

  // ── POS ───────────────────────────────────────────────
}
