/**
 * modulos/listas: las listas de precios de los proveedores.
 *
 * Antes vivían como tres pestañas fijas (Mar del Plata, CABA, Proveedor) dentro de Base
 * de conocimiento. Ahora son una pantalla propia con un proveedor por pestaña, y se
 * pueden agregar los que hagan falta: cada uno alimenta la tienda web (una fuente en
 * Catálogo web) y al bot de Instagram.
 *
 * La lista de proveedores se guarda en el doc conocimiento/{uid} (`proveedores`) porque
 * el bot ya lee ese doc: así sabe qué listas pedir sin tocar reglas ni índices. Las
 * listas en sí siguen en `listas_precios`, un doc por versión, con `origen` = id del
 * proveedor. La lógica de interpretar, editar, guardar y restaurar está en
 * conocimiento.js, parametrizada por `origen`; acá se arma la pantalla.
 */
import { on } from '../../shared/seguridad.js';
import { contextoApp } from '../core/estado.js';
import { esc, showToast, requiereDuenoDelLocal } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { setDoc, serverTimestamp } from 'firebase/firestore';
import { proveedores, kbUltimaLista, pintarTramosProv } from './conocimiento.js';

const idDe = nombre => String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'proveedor';

/** La pestaña de un proveedor: lo mismo que tenían las tres de antes, con sus ids por proveedor. */
function seccionHTML(p) {
  const id = esc(p.id);
  const costo = p.tipo === 'costo';
  return `<div id="listas-sec-${id}" style="display:none;">
    <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <div class="card-title" style="margin:0;">${esc(p.nombre)}</div>
        <div style="font-size:12.5px;color:var(--text2);margin-top:2px;">${costo ? 'Los precios de esta lista son tu <b>costo</b>: se les suma tu margen al pegarla.' : 'Los precios de esta lista ya son el <b>precio final al público</b>.'}${p.vence ? ' Es la lista del día: vence a la medianoche.' : ''}</div>
      </div>
      <button class="btn-secondary" style="width:auto;" ${on('click', 'editarProveedor', p.id)}>✏️ Editar</button>
      <button class="btn-secondary" style="width:auto;color:var(--neg);border-color:var(--neg);" ${on('click', 'borrarProveedor', p.id)}>Quitar proveedor</button>
    </div>
    <div id="kb-${id}-estado"></div>
    ${costo ? `
    <div class="card">
      <div class="card-title">Tu margen sobre el costo</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">Cuánto le sumás al costo según cuánto te cueste. Se aplica al pegar la lista, así que lo que se guarda —y lo que ven la tienda y el bot— ya es el precio final al cliente. Es el mismo margen para todos los proveedores de costo.</p>
      <div style="overflow-x:auto;"><table class="tkh-table">
        <thead><tr><th>Si el costo es…</th><th style="width:150px;text-align:right;">le sumo (u$s)</th><th style="width:40px;"></th></tr></thead>
        <tbody id="kb-${id}-tramos"></tbody>
      </table></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn-secondary" data-click="agregarTramoProv">＋ Agregar escalón</button>
        <button class="btn-save" style="width:auto;padding:9px 16px;" data-click="guardarTramosProv">Guardar el margen</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Pegar la lista</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">Abrí la lista del proveedor, tocá dentro de la tabla y hacé <b>Ctrl+A</b> (o <b>Cmd+A</b>): copia todo lo visible. Volvé acá y pegá con <b>Ctrl+V</b>. No hace falta que borres nada ni que la ordenes.</p>
      <p style="font-size:12px;color:var(--text3);margin-bottom:12px;">Los productos <b>sin stock</b> se descartan solos: no se puede ofrecer lo que el proveedor no tiene.</p>
      <div class="field"><textarea id="kb-${id}-texto" style="height:200px;font-family:'DM Mono',monospace;font-size:12.5px;" placeholder="Pegá acá con Ctrl+V…" ${on('input', 'procesarListaProv', p.id)}></textarea></div>
      <div class="field" style="max-width:220px;display:none;"><select id="kb-${id}-moneda"><option value="USD">USD u$s</option></select></div>
      <div id="kb-${id}-resumen"></div>
    </div>
    <div id="kb-${id}-preview" style="display:none;">
      <div class="card">
        <div class="card-title">Vista previa — confirmá antes de guardar</div>
        <div id="kb-${id}-preview-items"></div>
        <div style="display:flex;gap:8px;margin-top:1rem;">
          <button class="btn-secondary" ${on('click', 'cancelarListaKb', p.id)}>Cancelar</button>
          <button class="btn-save" id="btn-kb-${id}-guardar" style="width:auto;padding:11px 18px;" ${on('click', 'guardarListaKb', p.id, 'reemplazar')}>Reemplazar la lista de ${esc(p.nombre)}</button>
        </div>
      </div>
    </div>` : `
    <div class="card">
      <div class="card-title">Cargar lista de ${esc(p.nombre)}</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">Pegá la lista tal como te llega por WhatsApp — la IA la interpreta y te muestra una vista previa para confirmar antes de guardar. <b>Los precios se guardan tal cual: ya son el precio final al público.</b></p>
      <div class="field"><label>Lista pegada</label><textarea id="kb-${id}-texto" style="height:180px;font-family:'DM Mono',monospace;font-size:13px;" placeholder="Pegá la lista acá en cualquier formato..."></textarea></div>
      <div class="field" style="max-width:220px;"><label>Moneda de los precios</label>
        <select id="kb-${id}-moneda"><option value="USD">USD u$s</option><option value="ARS">ARS $</option></select></div>
      <button class="btn-save" id="btn-kb-${id}-interpretar" ${on('click', 'interpretarListaKb', p.id)}>✨ Interpretar con IA</button>
    </div>
    <div id="kb-${id}-preview" style="display:none;">
      <div class="card">
        <div class="card-title">Vista previa — confirmá antes de guardar</div>
        <div id="kb-${id}-preview-items"></div>
        <div style="display:flex;gap:8px;margin-top:1rem;flex-wrap:wrap;">
          <button class="btn-secondary" ${on('click', 'cancelarListaKb', p.id)}>Cancelar</button>
          <button class="btn-save" id="btn-kb-${id}-guardar" style="width:auto;padding:11px 18px;" ${on('click', 'guardarListaKb', p.id, 'agregar')}>＋ Agregar a la lista</button>
          <button class="btn-pagar-outline" id="btn-kb-${id}-reemplazar" ${on('click', 'guardarListaKb', p.id, 'reemplazar')}>Reemplazar toda la lista</button>
        </div>
      </div>
    </div>`}
    <div class="filters-bar" style="margin:12px 0;">
      <input type="text" id="kb-${id}-buscar" placeholder="🔎 Buscar producto, GB, color..." ${on('input', 'renderKbListaDeb', p.id)} style="flex:2;">
      <button class="btn-secondary" style="white-space:nowrap;color:var(--neg);border-color:var(--neg);" ${on('click', 'borrarListaKb', p.id)} title="Borrar la lista mostrada">🗑 Borrar lista</button>
    </div>
    <div id="kb-${id}-cambios"></div>
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="overflow-x:auto;">
        <table class="rp-table">
          <thead><tr><th>Producto</th><th style="width:90px;">GB</th><th style="width:150px;">Color</th><th style="text-align:right;width:130px;">Precio público</th><th style="width:40px;"></th></tr></thead>
          <tbody id="kb-${id}-body"></tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/** Arma (o rearma, si cambiaron los proveedores) las pestañas y muestra la activa. */
export function renderListas() {
  const tabs = document.getElementById('listas-tabs');
  if (!tabs) return;
  const ps = proveedores();
  if (!ps.some(p => p.id === contextoApp.listasTab)) contextoApp.listasTab = ps[0]?.id || '';
  // Las secciones se rearman solo si cambió algo de los proveedores: así lo pegado y no
  // guardado no se pierde con cada snapshot.
  const firma = ps.map(p => `${p.id}:${p.nombre}:${p.tipo}:${p.vence ? 1 : 0}`).join('|');
  if (contextoApp.listasFirma !== firma) {
    contextoApp.listasFirma = firma;
    document.getElementById('listas-secciones').innerHTML = ps.map(seccionHTML).join('');
  }
  tabs.innerHTML = ps.map(p => {
    const l = kbUltimaLista(p.id);
    const n = l && Array.isArray(l.items) ? l.items.length : 0;
    return `<button class="tab-btn${p.id === contextoApp.listasTab ? ' active' : ''}" ${on('click', 'setListasTab', p.id)}>${p.tipo === 'costo' ? '🏭' : '📋'} ${esc(p.nombre)}${n ? ` <span style="opacity:.6;font-weight:400;">· ${n}</span>` : ''}</button>`;
  }).join('') + `<button class="tab-btn" ${on('click', 'nuevoProveedor')}>＋ Proveedor</button>`;
  ps.forEach(p => {
    const s = document.getElementById('listas-sec-' + p.id);
    if (s) s.style.display = p.id === contextoApp.listasTab ? '' : 'none';
  });
  const activo = ps.find(p => p.id === contextoApp.listasTab);
  if (!activo) return;
  if (activo.tipo === 'costo') pintarTramosProv(activo.id);
  window.renderKbLista(activo.id);
}

export function inicializarListas() {
  contextoApp.listasTab = '';
  contextoApp.listasFirma = '';

  window.setListasTab = id => { contextoApp.listasTab = id; renderListas(); };

  /** Guarda la lista de proveedores en el doc de conocimiento: el bot la lee de ahí. */
  async function guardarProveedores(lista) {
    if (!requiereDuenoDelLocal()) return false;
    setSyncDot('syncing');
    try {
      await setDoc(contextoApp.conocDoc, contextoApp.withUser({ proveedores: lista, updatedAt: serverTimestamp() }), { merge: true });
      return true;
    } catch (e) {
      showToast('No se pudo guardar: ' + e.message, true);
      setSyncDot('error');
      return false;
    }
  }

  window.nuevoProveedor = async function () {
    const nombre = String(prompt('Nombre del proveedor (por ejemplo "Cava" o "Lista CABA"):') || '').trim();
    if (!nombre) return;
    const ps = proveedores();
    if (ps.some(p => p.nombre.toLowerCase() === nombre.toLowerCase())) { showToast('Ya hay un proveedor con ese nombre', true); return; }
    const costo = confirm(`¿Los precios de "${nombre}" son tu COSTO?\n\nAceptar: son costo, se les suma tu margen al pegar la lista.\nCancelar: ya son el precio final al público.`);
    let id = idDe(nombre);
    while (ps.some(p => p.id === id)) id += '-2';
    const nuevo = { id, nombre, tipo: costo ? 'costo' : 'publico', vence: false };
    if (await guardarProveedores([...ps, nuevo])) {
      contextoApp.listasTab = id;
      showToast(`Proveedor "${nombre}" creado ✓ — pegá su lista`);
      renderListas();
    }
  };

  window.editarProveedor = async function (id) {
    const ps = proveedores();
    const p = ps.find(x => x.id === id);
    if (!p) return;
    const nombre = String(prompt('Nombre del proveedor:', p.nombre) || '').trim();
    if (!nombre) return;
    const costo = confirm(`¿Los precios de "${nombre}" son tu COSTO?\n\nAceptar: costo (se suma el margen al pegar).\nCancelar: precio final al público.\n\nAhora: ${p.tipo === 'costo' ? 'costo' : 'precio final'}.`);
    const vence = confirm(`¿Es una lista del día, que vence a la medianoche?\n\nAceptar: sí, avisar cuando sea de otro día.\nCancelar: no vence, se actualiza cuando quieras.\n\nAhora: ${p.vence ? 'vence' : 'no vence'}.`);
    const lista = ps.map(x => x.id === id ? { ...x, nombre, tipo: costo ? 'costo' : 'publico', vence } : x);
    if (await guardarProveedores(lista)) { showToast('Proveedor actualizado ✓'); renderListas(); }
  };

  window.borrarProveedor = async function (id) {
    const ps = proveedores();
    const p = ps.find(x => x.id === id);
    if (!p) return;
    if (ps.length === 1) { showToast('Tiene que quedar al menos un proveedor', true); return; }
    const l = kbUltimaLista(id);
    if (!confirm(`¿Quitar el proveedor "${p.nombre}"?\n\nDesaparece de esta pantalla, de la tienda y del bot. ${l ? 'Sus listas guardadas no se borran: si lo volvés a crear con el mismo nombre, reaparecen.' : ''}`)) return;
    if (await guardarProveedores(ps.filter(x => x.id !== id))) { showToast(`Proveedor "${p.nombre}" quitado`); renderListas(); }
  };
}
