/**
 * modulos/importar-lista: "Importar nueva lista" de la pantalla Catálogo web.
 *
 * Es el importador de Ecommodo puesto sobre lo que el sistema ya tenía: se pega una
 * lista de precios, se interpreta (con la IA y, si no responde, con el lector de
 * Ecommodo), se revisa en una vista previa editable y al confirmar:
 *
 *   1. la lista queda guardada como la de cualquier proveedor (`listas_precios`), así
 *      que también la ven la pantalla Listas de precios y el bot;
 *   2. los productos se mandan a la tienda, cada uno en su categoría;
 *   3. se buscan las fotos en Amazon (Worker tienda, `/fotos`);
 *   4. la IA escribe la descripción de cada uno.
 *
 * Después todo se edita como siempre desde la ficha del producto. Nada se publica solo:
 * publicar sigue siendo el botón de arriba.
 */
import { on } from '../../shared/seguridad.js';
import { slugFoto, categoriaDe } from '../../shared/catalogo.js';
import { contextoApp } from '../core/estado.js';
import { esc, showToast, requiereDuenoDelLocal } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { workerHeaders } from './reportes.js';
import { proveedores, kbUltimaLista, interpretarTextoLista, conMargenDeCosto, fusionarListaKb } from './conocimiento.js';
import { catalogoCandidatos, renderCatalogo, archivosDeFotos, guardarFotos } from './catalogo.js';

const idDe = nombre => String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'lista';
const el = id => document.getElementById(id);
const espera = ms => new Promise(r => setTimeout(r, ms));

// Lo interpretado, mientras se revisa: [{producto, gb, color, precioPublico, condicion, categoria}]
let ITEMS = [];
let TRABAJANDO = false;

/** El producto de la tienda que va a salir de una fila, para saber su id y su categoría. */
const comoProducto = (it, moneda) => contextoApp.pedidoPublico(contextoApp.itemKbLimpio(it), { moneda });

function paso(n) {
  for (const k of [1, 2, 3]) el('imp-paso-' + k).style.display = k === n ? '' : 'none';
}

function pintarVistaPrevia() {
  const cats = contextoApp.todasLasCategorias();
  el('imp-cuenta').textContent = `${ITEMS.length} producto${ITEMS.length === 1 ? '' : 's'}`;
  el('btn-imp-confirmar').textContent = `Importar ${ITEMS.length} producto${ITEMS.length === 1 ? '' : 's'}`;
  el('btn-imp-confirmar').disabled = !ITEMS.length;
  el('imp-filas').innerHTML = ITEMS.map((it, i) => `<tr>
      <td><input type="text" value="${esc(it.producto || '')}" aria-label="Producto" ${on('change', 'impCampo', i, 'producto', '$value')}></td>
      <td><input type="text" value="${esc(it.gb || '')}" aria-label="Capacidad" ${on('change', 'impCampo', i, 'gb', '$value')}></td>
      <td><input type="text" value="${esc(it.color || '')}" aria-label="Color" ${on('change', 'impCampo', i, 'color', '$value')}></td>
      <td><select aria-label="Condición" ${on('change', 'impCampo', i, 'condicion', '$value')}>
        ${[['', '—'], ['nuevo', 'Nuevo'], ['usado', 'Usado']].map(([v, t]) => `<option value="${v}"${(it.condicion || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><select aria-label="Categoría" ${on('change', 'impCampo', i, 'categoria', '$value')}>
        ${cats.map(c => `<option${c === it.categoria ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
      <td><input type="number" class="precio" min="0" step="1" value="${it.precioPublico ?? ''}" aria-label="Precio" ${on('change', 'impCampo', i, 'precioPublico', '$value')}></td>
      <td><button type="button" class="imp-quitar" title="Quitar de la lista" ${on('click', 'impQuitar', i)}>✕</button></td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:var(--text3);padding:16px;">No quedó ningún producto.</td></tr>';
}

/** Una línea del progreso del paso 3. `estado`: 'ok', 'mal', 'espera' o vacío (en curso). */
function avance(id, texto, estado = '') {
  let fila = el('imp-av-' + id);
  if (!fila) {
    fila = document.createElement('div');
    fila.id = 'imp-av-' + id;
    el('imp-avance').appendChild(fila);
  }
  fila.className = 'imp-av ' + estado;
  fila.textContent = (estado === 'ok' ? '✓ ' : estado === 'mal' ? '✕ ' : estado === 'espera' ? '· ' : '⏳ ') + texto;
}

/** Espera a que el listener traiga la lista recién guardada: los productos salen de ahí. */
async function esperarLista(origen, cantidad) {
  for (let i = 0; i < 40; i++) {
    const l = kbUltimaLista(origen);
    if (contextoApp.KB_ORIGENES?.[origen] && l && Array.isArray(l.items) && l.items.length >= cantidad) return true;
    await espera(150);
  }
  return false;
}

/** Busca las fotos de los productos que no tienen. Una búsqueda por modelo y color. */
async function buscarFotos(productos) {
  const vistos = new Set(), lista = [];
  for (const p of productos) {
    if (p.fotos.length) continue;
    const k = slugFoto(p.nombre) + (p.color ? '-' + slugFoto(p.color) : '');
    if (vistos.has(k)) continue;
    vistos.add(k);
    lista.push(p);
  }
  if (!lista.length) { avance('fotos', 'Todos los productos ya tenían foto', 'ok'); return; }
  let con = 0, sin = 0, error = '';
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i];
    avance('fotos', `Buscando fotos en Amazon: ${i + 1} de ${lista.length} · ${p.nombre}${p.color ? ' ' + p.color : ''}`);
    try {
      const r = await fetch(contextoApp.TIENDA_URL + '/fotos', {
        method: 'POST',
        headers: await workerHeaders(),
        body: JSON.stringify({ nombre: p.nombre, gb: p.gb, color: p.color, tipo: p.tipo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `el Worker respondió ${r.status}`);
      if (d.subidos?.length) con++; else sin++;
    } catch (e) {
      error = e.message;
      sin++;
      // Sin permiso o sin servicio no tiene sentido seguir probando uno por uno.
      if (/no autorizado|401|403|Failed to fetch|NetworkError/i.test(e.message)) { sin += lista.length - i - 1; break; }
    }
  }
  // El mapa de fotos se vuelve a leer de la carpeta: ahí están las recién subidas.
  if (con) await guardarFotos(await archivosDeFotos()).catch(e => console.warn('fotos sin sincronizar:', e.message));
  avance('fotos', `Fotos: ${con} producto${con === 1 ? '' : 's'} con foto${sin ? `, ${sin} sin resultado (se pueden subir o buscar desde la ficha)` : ''}${error && !con ? ` — ${error}` : ''}`, con ? 'ok' : 'mal');
}

/** La IA escribe la descripción de los que no tienen. Se guardan todas juntas. */
async function escribirDescripciones(productos) {
  const lista = productos.filter(p => !p.descripcion);
  if (!lista.length) { avance('desc', 'Todos ya tenían descripción', 'ok'); return; }
  const notas = { ...(contextoApp.cfg.catalogoNotas || {}) };
  let conIA = 0;
  for (let i = 0; i < lista.length; i++) {
    avance('desc', `Escribiendo descripciones: ${i + 1} de ${lista.length} · ${lista[i].nombre}`);
    const d = await contextoApp.describirConIA(lista[i]);
    notas[lista[i].id] = d.texto;
    if (d.conIA) conIA++;
  }
  contextoApp.cfg.catalogoNotas = notas;
  await setDoc(contextoApp.cfgDoc, contextoApp.withUser({ catalogoNotas: notas }), { merge: true });
  avance('desc', conIA === lista.length ? `Descripciones: ${lista.length} escritas con IA`
    : `Descripciones: ${lista.length} escritas (${lista.length - conIA} sin la IA, que no respondió: quedó el texto base)`, 'ok');
}

export function inicializarImportarLista() {
  window.abrirImportarLista = function () {
    if (!requiereDuenoDelLocal()) return;
    ITEMS = [];
    el('imp-nombre').value = '';
    el('imp-texto').value = '';
    el('imp-proveedores').innerHTML = proveedores().map(p => `<option value="${esc(p.nombre)}">`).join('');
    el('imp-avance').innerHTML = '';
    el('imp-aviso').textContent = '';
    paso(1);
    el('importar-lista-modal').classList.add('open');
    el('imp-nombre').focus();
  };

  window.cerrarImportarLista = function () {
    if (TRABAJANDO && !confirm('La importación está en curso. Si cerrás, sigue en segundo plano pero no vas a ver el avance. ¿Cerrar igual?')) return;
    el('importar-lista-modal').classList.remove('open');
  };

  /** Al elegir un proveedor que ya existe, el tipo de precio es el suyo. */
  window.impNombreCambio = function () {
    const p = proveedores().find(x => x.nombre.toLowerCase() === el('imp-nombre').value.trim().toLowerCase());
    if (p) el('imp-tipo').value = p.tipo;
    el('imp-tipo').disabled = !!p;
  };

  window.impInterpretar = async function () {
    const nombre = el('imp-nombre').value.trim();
    const texto = el('imp-texto').value.trim();
    if (!nombre) { showToast('Decime de qué proveedor es la lista', true); el('imp-nombre').focus(); return; }
    if (!texto) { showToast('Pegá la lista primero', true); el('imp-texto').focus(); return; }
    const btn = el('btn-imp-interpretar');
    btn.disabled = true; btn.textContent = '⏳ Interpretando…';
    try {
      const esCosto = el('imp-tipo').value === 'costo';
      const moneda = el('imp-moneda').value;
      const leida = await interpretarTextoLista(texto, esCosto);
      let items = leida.items;
      if (esCosto) items = conMargenDeCosto(items);
      ITEMS = items.map(it => ({ ...it, categoria: categoriaDe(comoProducto(it, moneda)) }));
      if (!ITEMS.length) { showToast('No reconocí ningún producto con precio en esa lista', true); return; }
      el('imp-aviso').textContent = leida.conIA ? (esCosto ? 'Los precios ya tienen tu margen sumado.' : '')
        : 'La IA no respondió: la leyó el lector automático de Ecommodo. Revisá modelos y colores antes de importar.';
      pintarVistaPrevia();
      paso(2);
    } catch (e) {
      console.error(e);
      showToast('No se pudo interpretar la lista: ' + e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = '✨ Interpretar con IA';
    }
  };

  window.impCampo = function (i, campo, valor) {
    if (!ITEMS[i]) return;
    ITEMS[i][campo] = campo === 'precioPublico' ? (valor === '' ? null : Number(valor)) : String(valor).trim();
    // Cambiar el nombre o la condición puede cambiar la categoría sugerida.
    if (campo === 'producto' || campo === 'condicion') { ITEMS[i].categoria = categoriaDe(comoProducto(ITEMS[i], el('imp-moneda').value)); pintarVistaPrevia(); }
  };
  window.impQuitar = function (i) { ITEMS.splice(i, 1); pintarVistaPrevia(); };
  window.impVolver = () => paso(1);

  window.impConfirmar = async function () {
    if (!requiereDuenoDelLocal() || TRABAJANDO) return;
    const filas = ITEMS.filter(it => it.producto && Number(it.precioPublico) > 0);
    if (!filas.length) { showToast('No hay productos con nombre y precio para importar', true); return; }
    // En Fuentes ya se muestra como "Lista <proveedor>": se evita el "Lista Lista Valen".
    const nombre = el('imp-nombre').value.trim().replace(/^lista\s+/i, '').trim() || el('imp-nombre').value.trim();
    const moneda = el('imp-moneda').value;
    const quiere = { tienda: el('imp-op-tienda').checked, fotos: el('imp-op-fotos').checked, desc: el('imp-op-desc').checked };

    TRABAJANDO = true;
    el('imp-avance').innerHTML = '';
    el('btn-imp-listo').style.display = 'none';
    paso(3);
    setSyncDot('syncing');
    let origen = '';
    try {
      // 1. El proveedor: el que ya existe con ese nombre, o uno nuevo.
      avance('lista', 'Guardando la lista…');
      const ps = proveedores();
      let prov = ps.find(p => p.nombre.toLowerCase() === nombre.toLowerCase());
      if (!prov) {
        let id = idDe(nombre);
        while (ps.some(p => p.id === id)) id += '-2';
        prov = { id, nombre, tipo: el('imp-tipo').value === 'costo' ? 'costo' : 'publico', vence: false };
        await setDoc(contextoApp.conocDoc, contextoApp.withUser({ proveedores: [...ps, prov], updatedAt: serverTimestamp() }), { merge: true });
      }
      origen = prov.id;

      // 2. La lista: se suma a la que ese proveedor ya tuviera (mismo producto, precio nuevo).
      const nuevos = filas.map(contextoApp.itemKbLimpio);
      const previa = kbUltimaLista(origen);
      const fusion = fusionarListaKb(previa && Array.isArray(previa.items) ? previa.items : [], nuevos);
      await addDoc(contextoApp.listasCol, contextoApp.withUser({
        origen, proveedor: prov.nombre, tipo: prov.tipo, fecha: contextoApp.today(), moneda, items: fusion.items, createdAt: serverTimestamp(),
      }));
      await esperarLista(origen, fusion.items.length);
      avance('lista', `Lista "${prov.nombre}" guardada: ${fusion.agregados} nuevo${fusion.agregados === 1 ? '' : 's'}, ${fusion.actualizados} actualizado${fusion.actualizados === 1 ? '' : 's'}`, 'ok');

      // 3. A la tienda, cada uno en la categoría elegida en la vista previa.
      const idDeFila = new Map(filas.map(it => [comoProducto(it, moneda).id, it]));
      const ids = [...idDeFila.keys()];
      const ajustes = { ...(contextoApp.cfg.catalogoAjustes || {}) };
      for (const [id, it] of idDeFila) {
        if (it.categoria && it.categoria !== categoriaDe(comoProducto(it, moneda))) ajustes[id] = { ...(ajustes[id] || {}), categoria: it.categoria };
      }
      const cambios = { catalogoAjustes: ajustes };
      if (quiere.tienda) cambios.catalogoIncluidos = [...new Set([...(contextoApp.cfg.catalogoIncluidos || []), ...ids])];
      Object.assign(contextoApp.cfg, cambios);
      await setDoc(contextoApp.cfgDoc, contextoApp.withUser(cambios), { merge: true });
      avance('tienda', quiere.tienda ? `${ids.length} producto${ids.length === 1 ? '' : 's'} mandado${ids.length === 1 ? '' : 's'} a la tienda, cada uno en su categoría` : 'Quedaron en Fuentes, sin mandar a la tienda', 'ok');

      const productos = () => catalogoCandidatos().filter(p => idDeFila.has(p.id));
      if (quiere.fotos) await buscarFotos(productos()); else avance('fotos', 'Fotos: no se buscaron', 'espera');
      if (quiere.desc) await escribirDescripciones(productos()); else avance('desc', 'Descripciones: no se escribieron', 'espera');

      avance('fin', quiere.tienda ? 'Listo. Revisá los productos y tocá "Publicar" para que salgan en la tienda.' : 'Listo. Elegí cuáles mandar a la tienda desde Fuentes.', 'ok');
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      avance('fin', 'Se cortó: ' + e.message, 'mal');
      setSyncDot('error');
    }
    TRABAJANDO = false;
    // Al cerrar se ve la fuente recién importada.
    if (origen && contextoApp.KB_ORIGENES?.[origen]) contextoApp.catFuente = 'Lista ' + contextoApp.KB_ORIGENES[origen];
    renderCatalogo();
    el('btn-imp-listo').style.display = '';
  };
}
