/**
 * modulos/duplicados: "Buscar duplicados" de la pantalla Catálogo web.
 *
 * Con varios proveedores, el mismo producto llega repetido: uno por cada lista que lo
 * trae, cada uno con su precio. Acá se juntan en uno solo:
 *
 *   - el precio de la tienda sale de todas las listas (por defecto, el promedio entre la
 *     más alta y la más baja) y se recalcula solo cada vez que cambia una lista;
 *   - los repetidos salen de la tienda y queda uno;
 *   - el producto recuerda qué listas lo tienen: la fuente pasa a ser la más barata, que
 *     es a la que hay que pedírselo cuando se venda (se ve en la columna Fuente, en la
 *     ficha y en Pedidos).
 *
 * Qué renglones son el mismo producto lo propone `shared/duplicados.js`; acá se muestra
 * para revisar y nada se junta sin confirmar. Lo unificado vive en
 * `cfg.catalogoUnificados[idPrincipal] = { ids, regla, nombre, gb, color, condicion }` y
 * se deshace desde la ficha del producto ("Separar").
 */
import { on } from '../../shared/seguridad.js';
import { REGLAS_PRECIO, DISPERSION_SOSPECHOSA, precioUnificado, ofertaMasBarata, ofertaMejorEscrita, unificarGrupos } from '../../shared/duplicados.js';
import { contextoApp } from '../core/estado.js';
import { esc, showToast, requiereDuenoDelLocal } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { updateDoc } from 'firebase/firestore';
import { duplicadosPendientes, catalogoCandidatos, renderCatalogo } from './catalogo.js';

const el = id => document.getElementById(id);
const plural = (n, uno, muchos) => `${n} ${n === 1 ? uno : muchos}`;
const comoEscrito = o => [o.producto, o.gb, o.color].filter(Boolean).join(' · ');

// Los grupos encontrados, mientras se revisan: cada uno con `marcado` (se unifica) y
// `queda` (la oferta cuyo nombre va a llevar el producto).
let GRUPOS = [];
let REGLA = 'promedio';
let TRABAJANDO = false;

function notaDe(g) {
  const notas = [];
  if (g.difieren.length && g.tipo !== 'seguro') notas.push(`una lista aclara ${g.difieren.join(' + ')} y la otra no: fijate que sea el mismo`);
  if (g.dispersion > DISPERSION_SOSPECHOSA) notas.push(`los precios están lejos (${Math.round(g.dispersion * 100)}% de diferencia)`);
  return notas.join(' · ');
}

function grupoHTML(g, i) {
  const elegido = g.ofertas[g.queda];
  const barata = ofertaMasBarata(g.ofertas);
  const precio = precioUnificado(g.ofertas.map(o => o.precioUSD), REGLA);
  const nota = notaDe(g);
  return `<div class="dup-grupo${g.marcado ? ' on' : ''}">
    <div class="dup-cab">
      <label><input type="checkbox" ${g.marcado ? 'checked' : ''} ${on('change', 'dupMarcar', i, '$checked')}> <b>${esc(comoEscrito(elegido))}</b></label>
      <span class="dup-queda">queda a <b>${contextoApp.fmtUSD(precio)}</b></span>
    </div>
    ${nota ? `<div class="dup-nota">⚠ ${esc(nota)}</div>` : ''}
    <div class="dup-ofertas">${g.ofertas.map((o, j) => `
      <label class="dup-of${o === barata ? ' mejor' : ''}">
        <input type="radio" name="dup-queda-${i}" ${j === g.queda ? 'checked' : ''} title="Que el producto quede con este nombre" ${on('change', 'dupQueda', i, j)}>
        <span class="prov">${esc(o.proveedor)}</span>
        <span class="como">${esc(comoEscrito(o))}</span>
        <span class="precio">${o.precioUSD ? contextoApp.fmtUSD(o.precioUSD) : '—'}</span>
        ${o === barata ? '<span class="cat-pill on">el más barato</span>' : '<span></span>'}
      </label>`).join('')}</div>
  </div>`;
}

/** Los que ya están unificados, con sus listas de hoy: para verlos y poder separarlos. */
function unificadosHTML() {
  const lista = catalogoCandidatos().filter(p => p._unificado);
  if (!lista.length) return '';
  return `<details class="dup-hechos">
    <summary>${plural(lista.length, 'producto ya unificado', 'productos ya unificados')}</summary>
    ${lista.map(p => `<div class="dup-hecho">
      <span class="nombre"><b>${esc([p.nombre, p.gb, p.color].filter(Boolean).join(' · '))}</b> · ${contextoApp.fmtUSD(p.precioUSD)}</span>
      <span class="de">${esc((p._ofertas || []).map(o => `${o.proveedor} ${contextoApp.fmtUSD(o.precioUSD)}`).join(' · '))}</span>
      <button class="btn-secondary" ${on('click', 'dupSeparar', p.id)}>Separar</button>
    </div>`).join('')}
  </details>`;
}

function pintar() {
  const seguros = GRUPOS.filter(g => g.tipo === 'seguro'), parecidos = GRUPOS.filter(g => g.tipo !== 'seguro');
  const marcados = GRUPOS.filter(g => g.marcado);
  const sobran = marcados.reduce((a, g) => a + g.ids.length - 1, 0);
  el('dup-regla').innerHTML = Object.entries(REGLAS_PRECIO).map(([k, t]) => `<option value="${k}"${k === REGLA ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const yaUnificados = Object.keys(contextoApp.cfg.catalogoUnificados || {}).length;
  el('dup-regla-todos-fila').style.display = yaUnificados ? '' : 'none';
  el('dup-regla-todos-n').textContent = yaUnificados;
  el('dup-ayuda').textContent = GRUPOS.length
    ? `Encontré ${plural(GRUPOS.length, 'producto repetido', 'productos repetidos')} entre tus listas. De cada uno queda uno solo en la tienda, al precio que elijas abajo; la fuente pasa a ser la lista más barata, que es a la que se lo pedís cuando se venda. El punto marca con qué nombre queda.`
    : 'No hay productos repetidos entre tus listas: cada uno está en una sola, o ya los unificaste.';
  const seccion = (titulo, lista, ayuda) => !lista.length ? '' : `
    <div class="dup-seccion"><b>${esc(titulo)}</b> <span>${esc(ayuda)}</span></div>
    ${lista.map(g => grupoHTML(g, GRUPOS.indexOf(g))).join('')}`;
  el('dup-grupos').innerHTML = seccion(`Iguales (${seguros.length})`, seguros, 'mismo modelo, capacidad y color')
    + seccion(`Parecidos (${parecidos.length})`, parecidos, 'revisalos y marcá los que sean el mismo producto')
    + unificadosHTML();
  const btn = el('btn-dup-unificar');
  btn.disabled = !marcados.length || TRABAJANDO;
  btn.textContent = marcados.length ? `Unificar ${plural(marcados.length, 'producto', 'productos')}${sobran ? ` · se ${sobran === 1 ? 'va 1 repetido' : `van ${sobran} repetidos`}` : ''}` : 'Unificar';
}

function buscar() {
  GRUPOS = duplicadosPendientes().map(g => ({ ...g, marcado: g.tipo === 'seguro', queda: Math.max(0, g.ofertas.indexOf(ofertaMejorEscrita(g.ofertas))) }))
    .sort((a, b) => (a.tipo === 'seguro' ? 0 : 1) - (b.tipo === 'seguro' ? 0 : 1) || comoEscrito(a.ofertas[a.queda]).localeCompare(comoEscrito(b.ofertas[b.queda]), 'es', { numeric: true }));
}

export function inicializarDuplicados() {
  window.abrirDuplicados = function () {
    if (!requiereDuenoDelLocal()) return;
    REGLA = REGLAS_PRECIO[contextoApp.cfg.catalogoReglaPrecio] ? contextoApp.cfg.catalogoReglaPrecio : 'promedio';
    el('dup-regla-todos').checked = false;
    el('dup-revisar').style.display = '';
    el('dup-listo').style.display = 'none';
    buscar();
    pintar();
    el('duplicados-modal').classList.add('open');
  };
  window.cerrarDuplicados = () => el('duplicados-modal').classList.remove('open');

  window.dupMarcar = (i, marcado) => { if (GRUPOS[i]) { GRUPOS[i].marcado = !!marcado; pintar(); } };
  window.dupQueda = (i, j) => { if (GRUPOS[i]?.ofertas[j]) { GRUPOS[i].queda = j; pintar(); } };
  window.dupRegla = regla => { if (REGLAS_PRECIO[regla]) { REGLA = regla; pintar(); } };
  window.dupSeparar = async id => { await window.separarUnificado(id); buscar(); pintar(); };

  window.unificarDuplicados = async function () {
    if (!requiereDuenoDelLocal() || TRABAJANDO) return;
    const marcados = GRUPOS.filter(g => g.marcado);
    if (!marcados.length) return;
    const cambios = unificarGrupos(contextoApp.cfg, marcados, REGLA);
    // La regla elegida también para los que ya estaban, si se pidió.
    if (el('dup-regla-todos').checked) for (const id in cambios.catalogoUnificados) cambios.catalogoUnificados[id] = { ...cambios.catalogoUnificados[id], regla: REGLA };
    TRABAJANDO = true;
    pintar();
    setSyncDot('syncing');
    try {
      // updateDoc reemplaza cada mapa entero: con setDoc y merge, lo que se saca volvería.
      await updateDoc(contextoApp.cfgDoc, cambios);
      Object.assign(contextoApp.cfg, cambios);
      const sobran = marcados.reduce((a, g) => a + g.ids.length - 1, 0);
      el('dup-resultado').textContent = `${plural(marcados.length, 'producto unificado', 'productos unificados')}${sobran ? `, ${plural(sobran, 'repetido menos', 'repetidos menos')}` : ''}. El precio quedó en "${REGLAS_PRECIO[REGLA].toLowerCase()}" y la fuente de cada uno es la lista más barata.`;
      el('dup-revisar').style.display = 'none';
      el('dup-listo').style.display = '';
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      showToast('No se pudo unificar: ' + e.message, true);
      setSyncDot('error');
    }
    TRABAJANDO = false;
    renderCatalogo();
    if (el('dup-listo').style.display === 'none') pintar();
  };

  window.dupPublicar = async function () {
    window.cerrarDuplicados();
    await window.publicarCatalogo();
  };
}
