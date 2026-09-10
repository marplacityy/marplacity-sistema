import { SYSTEM_PROMPT } from '../../../server/services/ig-bot/prompt.js';
/** modulos/conocimiento: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { showToast, esc, escJs } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { setDoc, serverTimestamp, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { workerHeaders, textoDeIA } from './reportes.js';

export
// ── Datos del local ──
// Vuelca el doc a los textareas. No pisa el campo que se está editando: el
// snapshot vuelve también después de guardar y movería el cursor.
function pintarConocimiento() {
  // El mensaje del canal vive en otro doc (config/mensajes), no en el de conocimiento:
  // el bot lo lee aparte porque lo manda textual.
  const canal = document.getElementById('kb-canal');
  if (canal && canal !== document.activeElement) {
    const v = contextoApp.mensajesFijos.invitacionCanal || '';
    if (canal.value !== v) canal.value = v;
  }
  contextoApp.KB_CAMPOS.forEach(k => {
    const el = document.getElementById('kb-' + k);
    if (!el || el === document.activeElement) return;
    const v = contextoApp.conoc[k] || '';
    if (el.value !== v) el.value = v;
  });
}

// El mensaje del canal se guarda aparte porque va a otro doc. Antes solo se podía
// cambiar corriendo cargar-mensajes.mjs con la contraseña en la línea de comandos, que
// es exactamente cómo se termina filtrando una credencial.
export
// El original se lee del propio repo publicado, así que siempre es el que está
// desplegado de verdad, sin tener que duplicar el texto acá adentro.
async function promptDeFabrica() {
  return SYSTEM_PROMPT;
}
export function pintarPromptBot() {
  const el = document.getElementById('kb-prompt');
  if (!el) return;
  const est = document.getElementById('kb-prompt-estado');
  const propio = (contextoApp.promptBot.texto || '').trim();
  if (propio) {
    const f = contextoApp.promptBot.updatedAt?.toDate ? contextoApp.promptBot.updatedAt.toDate().toLocaleString('es-AR') : null;
    est.innerHTML = `<div class="proveedor-alerta alerta-atencion">✏️ El bot está usando <b>esta versión, escrita por vos</b>${f ? ' el ' + esc(f) : ''}. El original del código quedó de respaldo.</div>`;
    if (el !== document.activeElement && el.value !== propio) el.value = propio;
    window.kbPromptContar();
    return;
  }
  est.innerHTML = `<div class="proveedor-alerta">📦 El bot está usando el <b>original de fábrica</b>. Lo que ves abajo es ese texto: si lo cambiás y guardás, pasa a usar el tuyo.</div>`;
  if (el === document.activeElement) return;
  promptDeFabrica().then(t => {
    if (!(contextoApp.promptBot.texto || '').trim() && el !== document.activeElement) {
      el.value = t;
      window.kbPromptContar();
    }
  }).catch(e => {
    est.innerHTML += `<div style="font-size:12px;color:var(--neg);margin-top:6px;">No pude leer el original: ${esc(e.message)}</div>`;
  });
}
export
// ── Listas de precios ──
// listasItems viene ordenado por fecha desc, así que la primera de cada origen
// es la vigente. Las anteriores quedan como historial.
function kbUltimaLista(origen) {
  return contextoApp.listasItems.find(l => l.origen === origen) || null;
}
export function kbFecha(iso) {
  const p = String(iso || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso || '—';
}
export function fmtPrecioKb(n, moneda) {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  return moneda === 'ARS' ? contextoApp.fmtARS(Number(n)) : contextoApp.fmtUSD(Number(n));
}
export function renderKbEstado(origen) {
  const box = document.getElementById('kb-' + origen + '-estado');
  if (!box) return;
  const l = kbUltimaLista(origen);
  if (!l) {
    box.innerHTML = `<div class="card" style="background:#FDF6EC;border-color:#F2C48D;">
      <div style="font-size:14px;color:#854F0B;font-weight:600;">Todavía no cargaste ninguna lista de ${esc(contextoApp.KB_ORIGENES[origen])}.</div>
      <div style="font-size:13px;color:#854F0B;margin-top:4px;">Pegala abajo y dale a "Interpretar con IA".</div>
    </div>`;
    return;
  }
  // Sólo la de MDP vence: es la lista del día. La de CABA se actualiza a demanda.
  const vieja = origen === 'mdp' && l.fecha !== contextoApp.today();
  const n = (l.items || []).length;
  box.innerHTML = `<div class="card" style="${vieja ? 'background:#FDF6EC;border-color:#F2C48D;' : ''}">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);font-weight:600;margin-bottom:4px;">Última lista cargada</div>
    <div style="font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1.1;">${esc(kbFecha(l.fecha))}${l.fecha === contextoApp.today() ? ' <span style="font-size:12px;font-weight:500;vertical-align:middle;background:var(--inc-bg);color:var(--inc);border-radius:100px;padding:3px 10px;">hoy</span>' : ''}</div>
    <div style="font-size:13px;color:var(--text2);margin-top:4px;">${n} producto${n === 1 ? '' : 's'} · precios al público en ${esc(l.moneda || 'USD')}${origen === 'caba' ? ' · no vence: actualizala cuando quieras' : ''}</div>
    ${vieja ? `<div style="margin-top:12px;font-size:15px;font-weight:600;color:#854F0B;">⚠️ Lista desactualizada — es del ${esc(kbFecha(l.fecha))}. Pedí la de hoy y cargala.</div>` : ''}
    ${anterioresKb(origen, l)}
  </div>`;
}

/**
 * Las versiones anteriores de la lista, con un botón para volver a cualquiera.
 *
 * Cada guardado deja un documento nuevo con la lista completa, así que nada se pierde
 * nunca: lo que cambia es cuál se considera "la actual". Esto lo hace visible y
 * reversible — hasta ahora, cargar un producto suelto dejaba la lista anterior fuera de
 * la vista y del alcance del bot, sin forma de volver desde la pantalla.
 */
export function anterioresKb(origen, actual) {
  const otras = contextoApp.listasItems.filter(l => l.origen === origen && l.id !== actual.id).slice(0, 5);
  if (!otras.length) return '';
  return `<details style="margin-top:12px;">
    <summary style="font-size:12px;color:var(--text3);cursor:pointer;">Versiones anteriores (${otras.length})</summary>
    <div style="margin-top:8px;">${otras.map(o => {
    const n = (o.items || []).length;
    return `<div class="pago-item">
        <div class="pago-info">
          <div style="font-size:13px;">${esc(kbFecha(o.fecha))}</div>
          <div class="pago-fecha">${n} producto${n === 1 ? '' : 's'}</div>
        </div>
        <button class="btn-pagar-outline" onclick="restaurarListaKb('${escJs(origen)}','${escJs(o.id)}')">Volver a esta</button>
      </div>`;
  }).join('')}</div>
  </details>`;
}

// Restaurar no borra nada: guarda esa versión como la nueva actual, así que la de hoy
// también queda en el historial por si te arrepentís.
export
// Lo que se está mostrando: la copia en edición si hay, lo guardado si no.
function kbItemsVista(origen) {
  if (contextoApp.kbEdicion[origen]) return contextoApp.kbEdicion[origen];
  const l = kbUltimaLista(origen);
  return l && Array.isArray(l.items) ? l.items : [];
}

// Antes de tocar nada se clona, para no mutar el array que vino del snapshot.
export function kbEmpezarEdicion(origen) {
  if (!contextoApp.kbEdicion[origen]) contextoApp.kbEdicion[origen] = kbItemsVista(origen).map(it => ({
    ...it
  }));
  return contextoApp.kbEdicion[origen];
}
export function renderConocimiento() {
  window.renderKbLista('mdp');
  window.renderKbLista('caba');
}
export function renderKbPreview(origen) {
  const moneda = document.getElementById('kb-' + origen + '-moneda').value;
  document.getElementById('kb-' + origen + '-preview-items').innerHTML = contextoApp.kbParseada[origen].map((it, i) => `<div class="stock-item" style="align-items:center;">
    <div class="stock-info">
      <div class="stock-nombre">${esc(it.producto || '')}</div>
      <div class="stock-meta" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">${[it.gb, it.color].filter(Boolean).map(ch => `<span style="font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:100px;padding:1px 7px;">${esc(ch)}</span>`).join('')}${contextoApp.badgeCondicion(it.condicion)}</div>
    </div>
    <div class="stock-val"><div class="stock-usd">${fmtPrecioKb(it.precioPublico, moneda)}</div></div>
    <button class="ei-btn del" onclick="quitarDeKbPreview('${escJs(origen)}',${i})" title="Quitar">×</button>
  </div>`).join('');
  if (!contextoApp.kbParseada[origen].length) document.getElementById('kb-' + origen + '-preview').style.display = 'none';
}
export
/**
 * Suma los productos nuevos a los que ya estaban.
 *
 * Los que ya existían conservan su lugar y se les actualiza el precio; los nuevos van
 * ARRIBA, que es donde se los busca después de cargarlos. Antes cada guardado creaba una
 * lista con SOLO lo pegado, así que sumar un producto borraba de la vista los cientos
 * anteriores — y el bot, que mira la lista más reciente, dejaba de conocerlos.
 */
function fusionarListaKb(previos, nuevos) {
  const porClave = new Map(nuevos.map(it => [contextoApp.claveItemKb(it), it]));
  const pisados = new Set();
  const actualizados = previos.map(it => {
    const k = contextoApp.claveItemKb(it);
    const nuevo = porClave.get(k);
    if (!nuevo) return it;
    pisados.add(k);
    return nuevo;
  });
  const agregados = nuevos.filter(it => !pisados.has(contextoApp.claveItemKb(it)));
  return {
    items: [...agregados, ...actualizados],
    agregados: agregados.length,
    actualizados: pisados.size
  };
}

// La condición es lo único que el bot no puede deducir: en la lista de Mar del Plata
// conviven equipos nuevos y usados. Si la lista no la aclara queda vacía, y el bot
// escala en vez de arriesgar — decirle "usado" a alguien que mira un equipo sellado
// (o al revés) es de las peores cosas que puede contestar.
export /** El precio final de un costo, según el escalón que le toque. */
function conMargenProv(costo, tramos) {
  for (const t of tramos) {
    if (t.hasta == null || costo <= Number(t.hasta)) return {
      suma: Number(t.suma) || 0,
      precio: costo + (Number(t.suma) || 0)
    };
  }
  return {
    suma: 0,
    precio: costo
  };
}
export function pintarTramosProv() {
  const tb = document.getElementById('kb-prov-tramos');
  if (!tb) return;
  const t = contextoApp.tramosProv();
  tb.innerHTML = t.map((x, i) => `
    <tr>
      <td>${x.hasta == null ? 'de ahí en adelante' : `hasta <input type="number" value="${x.hasta}" step="1" min="0" oninput="setTramoProv(${i},'hasta',this.value)"
             style="width:110px;padding:5px 7px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-family:'DM Mono',monospace;font-size:13px;color:var(--text);"> u$s de costo`}</td>
      <td style="text-align:right;"><input type="number" value="${x.suma}" step="1" min="0" oninput="setTramoProv(${i},'suma',this.value)"
            style="width:90px;text-align:right;padding:5px 7px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-family:'DM Mono',monospace;font-size:13px;color:var(--text);"></td>
      <td>${t.length > 1 && x.hasta != null ? `<button class="ei-btn del" onclick="quitarTramoProv(${i})" title="Quitar">×</button>` : ''}</td>
    </tr>`).join('');
}
export function inicializarConocimiento() {
  // ── Base de conocimiento (bot de Instagram) ──────────────
  // Dos cosas viven acá: el doc conocimiento/{uid} con los datos del local en texto
  // libre (lo que el bot contesta tal cual), y la colección listas_precios, un doc
  // por lista cargada. OJO: el precio de esas listas YA ES el precio final al
  // público — no se le aplica margen en ningún punto del flujo.
  contextoApp.KB_CAMPOS = ['tono', 'entrenamiento', 'horarios', 'direccion', 'mediosPago', 'garantia', 'politicaSena', 'comoLlegar', 'notasExtra'];
  contextoApp.KB_ORIGENES = {
    mdp: 'Mar del Plata',
    caba: 'CABA',
    prov: 'Proveedor'
  };
  contextoApp.kbParseada = {
    mdp: [],
    caba: [],
    prov: []
  };
  window.setKbTab = function (tab, btn) {
    try {
      document.querySelectorAll('#page-conocimiento .tab-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      ['datos', 'mdp', 'caba', 'prov', 'prompt'].forEach(t => {
        const el = document.getElementById('kb-sec-' + t);
        if (el) el.style.display = t === tab ? 'block' : 'none';
      });
      if (tab === 'datos') pintarConocimiento();else if (tab === 'prompt') pintarPromptBot();else if (tab === 'prov') {
        pintarTramosProv();
        window.renderKbLista('prov');
      } else window.renderKbLista(tab);
    } catch (e) {
      console.error('setKbTab', e);
      showToast('Error: ' + e.message, true);
    }
  };
  window.guardarCanal = async function () {
    const btn = document.getElementById('btn-kb-guardar-canal');
    const texto = (document.getElementById('kb-canal').value || '').trim();
    if (/https?:\/\/|ig\.me/i.test(texto) && !confirm('Ese texto tiene un link.\n\nInstagram rechaza los mensajes con enlaces de invitación: no le va a llegar al cliente y encima va a cortar la respuesta a la mitad.\n\n¿Guardar igual?')) return;
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await setDoc(contextoApp.mensajesDoc, contextoApp.withUser({
        invitacionCanal: texto,
        updatedAt: serverTimestamp()
      }), {
        merge: true
      });
      showToast('Guardado ✓ — el bot lo usa desde el próximo mensaje');
    } catch (e) {
      console.error(e);
      showToast('Error al guardar: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar';
  };

  // ── Prompt del bot ──
  // Las reglas del bot vivían solo en workers/ig-bot/prompt.js, así que desde el local no
  // había forma de leerlas ni de cambiar una coma sin un deploy. Ahora el Worker las lee
  // de config/prompt en cada mensaje y este editor escribe ese doc. El archivo del repo
  // queda de respaldo: es lo que se manda mientras no haya una versión guardada acá.
  contextoApp.promptFabricaCache = null;
  window.kbPromptContar = function () {
    const el = document.getElementById('kb-prompt');
    if (!el) return;
    const t = el.value || '';
    document.getElementById('kb-prompt-contador').textContent = t.split('\n').length + ' líneas · ' + t.length.toLocaleString('es-AR') + ' caracteres';
  };
  window.verPromptOriginal = async function () {
    try {
      const t = await promptDeFabrica();
      const el = document.getElementById('kb-prompt');
      if ((el.value || '').trim() && el.value.trim() !== t.trim() && !confirm('Esto reemplaza lo que tenés escrito en pantalla por el texto original.\n\nNo guarda nada todavía: si no tocás Guardar, el bot sigue como está.')) return;
      el.value = t;
      window.kbPromptContar();
      showToast('Este es el original — todavía no se guardó');
    } catch (e) {
      showToast('No pude leer el original: ' + e.message, true);
    }
  };
  window.guardarPromptBot = async function () {
    const btn = document.getElementById('btn-kb-guardar-prompt');
    const texto = (document.getElementById('kb-prompt').value || '').trim();
    if (!texto) {
      showToast('Está vacío. Si querés volver al original, usá el botón.', true);
      return;
    }
    // El formato de salida es lo único que no es opinable: sin eso el Worker no puede
    // leer la respuesta y el cliente no recibe nada.
    if (!/FORMATO DE SALIDA/i.test(texto) && !confirm('Al texto le falta la sección FORMATO DE SALIDA.\n\nSin eso el bot puede contestar algo que el sistema no sabe leer, y el cliente no recibe nada.\n\n¿Guardar igual?')) return;
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      await setDoc(contextoApp.promptDoc, contextoApp.withUser({
        texto,
        updatedAt: serverTimestamp()
      }), {
        merge: true
      });
      showToast('Guardado ✓ — el bot lo usa desde el próximo mensaje');
    } catch (e) {
      console.error(e);
      showToast('Error al guardar: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Guardar';
  };

  // Vaciar el campo alcanza: el Worker, cuando lo encuentra vacío, cae al prompt.js del
  // repo. Así se vuelve atrás sin tener que reescribir el original a mano.
  window.volverAlPromptOriginal = async function () {
    if (!(contextoApp.promptBot.texto || '').trim()) {
      showToast('Ya está usando el original.');
      return;
    }
    if (!confirm('El bot vuelve a usar el prompt original del código y se descarta tu versión.\n\n¿Seguro?')) return;
    setSyncDot('syncing');
    try {
      await setDoc(contextoApp.promptDoc, contextoApp.withUser({
        texto: '',
        updatedAt: serverTimestamp()
      }), {
        merge: true
      });
      contextoApp.promptFabricaCache = null;
      const el = document.getElementById('kb-prompt');
      if (el) el.value = '';
      showToast('Listo — el bot vuelve al original ✓');
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
  };

  // Guarda TODO el conocimiento, lo llame el botón del tono o el de los datos: los dos
  // escriben el mismo doc y los campos se leen de la misma lista.
  window.guardarConocimiento = async function () {
    const btns = ['btn-kb-guardar-tono', 'btn-kb-guardar-entrenamiento', 'btn-kb-guardar-datos'].map(id => document.getElementById(id)).filter(Boolean);
    btns.forEach(b => {
      b.disabled = true;
      b.textContent = 'Guardando...';
    });
    setSyncDot('syncing');
    try {
      const data = {};
      contextoApp.KB_CAMPOS.forEach(k => {
        const el = document.getElementById('kb-' + k);
        if (el) data[k] = (el.value || '').trim();
      });
      await setDoc(contextoApp.conocDoc, contextoApp.withUser({
        ...data,
        updatedAt: serverTimestamp()
      }), {
        merge: true
      });
      showToast('Guardado ✓ — el bot lo usa desde el próximo mensaje');
    } catch (e) {
      console.error(e);
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
    btns.forEach(b => {
      b.disabled = false;
      b.textContent = 'Guardar';
    });
  };
  window.restaurarListaKb = async function (origen, id) {
    const vieja = contextoApp.listasItems.find(l => l.id === id);
    if (!vieja) return;
    const actual = kbUltimaLista(origen);
    const n = (vieja.items || []).length,
      nActual = (actual && actual.items || []).length;
    if (!confirm(`¿Volver a la lista del ${kbFecha(vieja.fecha)}?\n\nLa lista de ${contextoApp.KB_ORIGENES[origen]} va a quedar con esos ${n} producto${n === 1 ? '' : 's'}, en lugar de los ${nActual} de ahora.\n\nNo se borra nada: la actual queda guardada en el historial.`)) return;
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.listasCol, contextoApp.withUser({
        origen,
        fecha: contextoApp.today(),
        moneda: vieja.moneda || 'USD',
        items: vieja.items || [],
        createdAt: serverTimestamp()
      }));
      showToast(`Restaurada la lista del ${kbFecha(vieja.fecha)} — ${n} producto${n === 1 ? '' : 's'} ✓`);
    } catch (e) {
      console.error(e);
      showToast('No se pudo restaurar: ' + e.message, true);
      setSyncDot('error');
    }
  };

  // Los cambios que se están haciendo a mano sobre la lista, antes de guardarlos. null =
  // no se tocó nada y se muestra lo que hay en Firestore. En cuanto se edita un precio o
  // se borra un ítem, se trabaja sobre esta copia hasta que se guarde o se cancele: así
  // se pueden hacer diez cambios y que sea UN guardado, no diez versiones de la lista.
  contextoApp.kbEdicion = {
    mdp: null,
    caba: null,
    prov: null
  };
  window.editarPrecioKb = function (origen, i, valor) {
    const items = kbEmpezarEdicion(origen);
    if (!items[i]) return;
    const n = Number(String(valor).replace(',', '.'));
    items[i].precioPublico = valor === '' || isNaN(n) ? null : n;
    window.renderKbLista(origen);
  };
  window.borrarItemKb = function (origen, i) {
    const items = kbEmpezarEdicion(origen);
    const it = items[i];
    if (!it) return;
    if (!confirm(`¿Sacar "${it.producto || ''}" de la lista?\n\nSe va a aplicar cuando guardes los cambios.`)) return;
    items.splice(i, 1);
    window.renderKbLista(origen);
  };
  window.cancelarEdicionKb = function (origen) {
    contextoApp.kbEdicion[origen] = null;
    window.renderKbLista(origen);
  };

  // Guarda la lista editada como una versión nueva. Igual que cargar productos: no pisa
  // nada, la anterior queda en el historial y se puede volver.
  window.guardarEdicionKb = async function (origen) {
    const items = contextoApp.kbEdicion[origen];
    if (!items) return;
    const l = kbUltimaLista(origen);
    const btn = document.getElementById('btn-kb-' + origen + '-guardar-edicion');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Guardando...';
    }
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.listasCol, contextoApp.withUser({
        origen,
        fecha: contextoApp.today(),
        moneda: l && l.moneda || 'USD',
        items: items.map(contextoApp.itemKbLimpio),
        createdAt: serverTimestamp()
      }));
      contextoApp.kbEdicion[origen] = null;
      showToast(`Lista de ${contextoApp.KB_ORIGENES[origen]} actualizada ✓`);
    } catch (e) {
      console.error(e);
      showToast('No se pudo guardar: ' + e.message, true);
      setSyncDot('error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✓ Guardar cambios';
      }
    }
  };
  window.renderKbLista = function (origen) {
    renderKbEstado(origen);
    const tb = document.getElementById('kb-' + origen + '-body');
    if (!tb) return;
    const l = kbUltimaLista(origen);
    const moneda = l && l.moneda || 'USD';
    const base = kbItemsVista(origen);

    // El buscador filtra la vista, pero los handlers necesitan la posición REAL en la
    // lista: sin esto, editar un precio con el buscador activo tocaría otro producto.
    const q = (document.getElementById('kb-' + origen + '-buscar').value || '').trim().toLowerCase();
    let filas = base.map((it, i) => ({
      it,
      i
    }));
    if (q) filas = filas.filter(({
      it
    }) => `${it.producto || ''} ${it.gb || ''} ${it.color || ''} ${it.condicion || ''}`.toLowerCase().includes(q));

    // Aviso de cambios sin guardar
    const cambios = document.getElementById('kb-' + origen + '-cambios');
    if (cambios) {
      const editando = !!contextoApp.kbEdicion[origen];
      const antes = l && Array.isArray(l.items) ? l.items.length : 0;
      const ahora = base.length;
      cambios.innerHTML = !editando ? '' : `
      <div class="card" style="margin-bottom:10px;background:#FEF9E7;border-color:#FAC775;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="font-size:13px;color:#854F0B;">
            <b>Cambios sin guardar.</b> ${ahora === antes ? 'Editaste precios.' : `La lista pasa de ${antes} a ${ahora} producto${ahora === 1 ? '' : 's'}.`} Nada se aplica hasta que guardes.
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-pagar-outline" onclick="cancelarEdicionKb('${escJs(origen)}')">Descartar</button>
            <button class="btn-save" id="btn-kb-${escJs(origen)}-guardar-edicion" style="width:auto;padding:9px 16px;" onclick="guardarEdicionKb('${escJs(origen)}')">✓ Guardar cambios</button>
          </div>
        </div>
      </div>`;
    }
    if (!filas.length) {
      const msg = !l && !contextoApp.kbEdicion[origen] ? 'Todavía no cargaste ninguna lista.' : q ? 'Ningún producto coincide con la búsqueda.' : 'La lista está vacía.';
      tb.innerHTML = `<tr><td colspan="5"><div class="empty">${msg}</div></td></tr>`;
      return;
    }
    const simbolo = moneda === 'ARS' ? '$' : 'u$s';
    tb.innerHTML = filas.map(({
      it,
      i
    }) => `<tr>
    <td>${esc(it.producto || '')}${contextoApp.badgeCondicion(it.condicion)}</td>
    <td>${esc(it.gb || '')}</td>
    <td>${esc(it.color || '')}</td>
    <td style="text-align:right;white-space:nowrap;">
      <span style="font-size:11px;color:var(--text3);">${simbolo}</span>
      <input type="number" step="0.01" min="0" value="${it.precioPublico != null ? esc(String(it.precioPublico)) : ''}" placeholder="—"
             onchange="editarPrecioKb('${escJs(origen)}', ${i}, this.value)"
             style="width:88px;text-align:right;font-weight:600;font-family:'DM Mono',monospace;padding:5px 7px;">
    </td>
    <td style="text-align:center;">
      <a onclick="borrarItemKb('${escJs(origen)}', ${i})" title="Sacar de la lista" style="cursor:pointer;color:var(--text3);font-weight:700;">✕</a>
    </td>
  </tr>`).join('');
  };
  window.interpretarListaKb = async function (origen) {
    const texto = (document.getElementById('kb-' + origen + '-texto').value || '').trim();
    if (!texto) {
      showToast('Pegá una lista primero.', true);
      return;
    }
    const btn = document.getElementById('btn-kb-' + origen + '-interpretar');
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
            content: `Sos un experto en listas de precios de celulares. Analizá esta lista de precios AL PÚBLICO y extraé cada producto, sin importar el formato (puede venir desordenada, con emojis, abreviada, con varias líneas por item). Devolvé SOLO un JSON array válido, sin texto adicional, sin markdown, sin backticks.

Cada objeto tiene exactamente estos campos (poné null en los que no aparezcan, NO inventes):
- producto: nombre del modelo, ej "iPhone 17 Pro" (obligatorio)
- gb: capacidad, ej "256GB", "1TB"
- color: color si está, ej "Desert Titanium", "Negro"
- precioPublico: número sin símbolos ni separadores de miles
- condicion: "nuevo" o "usado", SOLO si la lista lo aclara para ese producto (con esas palabras, con "sellado", "0km", "impecable", una batería, ciclos, o un encabezado que separe una sección de otra). Si no lo dice, va null. NO lo deduzcas del precio ni del modelo.

IMPORTANTE: el precio que figura en la lista YA ES el precio final al público. Copialo tal cual: no le apliques ningún margen, recargo, descuento ni redondeo.

Si una línea repite un mismo modelo con varias capacidades o colores y sus precios, generá un objeto por cada combinación. Ignorá encabezados, saludos, avisos y todo lo que no sea un producto con precio.

Lista:
${texto}`
          }]
        })
      });
      const data = await response.json();
      const raw = textoDeIA(data).replace(/```json|```/g, '').trim();
      const arr = JSON.parse(raw);
      contextoApp.kbParseada[origen] = (Array.isArray(arr) ? arr : []).filter(x => x && x.producto);
      if (!contextoApp.kbParseada[origen].length) {
        showToast('No se reconoció ningún producto.', true);
      } else {
        renderKbPreview(origen);
        document.getElementById('kb-' + origen + '-preview').style.display = 'block';
        showToast(`${contextoApp.kbParseada[origen].length} productos interpretados ✓`);
      }
    } catch (e) {
      console.error(e);
      showToast('Error al interpretar. Revisá la lista.', true);
    }
    btn.disabled = false;
    btn.textContent = '✨ Interpretar con IA';
  };

  // El cartelito de nuevo/usado. Vacío no dibuja nada: la mayoría de las listas no lo
  // aclaran, y un "—" en cada fila sería ruido.
  contextoApp.badgeCondicion = c => !c ? '' : `<span class="consig-tipo ${c === 'nuevo' ? 'tipo-permuta' : 'tipo-consig'}" style="margin-left:6px;">${c === 'nuevo' ? 'nuevo' : 'usado'}</span>`;
  window.quitarDeKbPreview = function (origen, i) {
    contextoApp.kbParseada[origen].splice(i, 1);
    renderKbPreview(origen);
  };
  window.cancelarListaKb = function (origen) {
    contextoApp.kbParseada[origen] = [];
    document.getElementById('kb-' + origen + '-preview').style.display = 'none';
  };

  // Dos productos son el mismo si coinciden modelo, capacidad, color Y CONDICIÓN. Sin
  // normalizar, "iPhone 15  Pro" y "iphone 15 pro" entrarían como dos productos distintos
  // y la lista se llenaría de duplicados a cada actualización.
  //
  // La condición entra en la clave porque el mismo modelo nuevo y usado son dos productos
  // con dos precios: sin ella, cargar el usado le pisaba el precio al nuevo.
  contextoApp.claveItemKb = it => `${it.producto || ''}|${it.gb || ''}|${it.color || ''}|${it.condicion || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  contextoApp.condicionKb = v => {
    const t = String(v || '').toLowerCase();
    if (/nuev|sellad|0 ?km/.test(t)) return 'nuevo';
    if (/usad|impecab|refurb|reacond/.test(t)) return 'usado';
    return '';
  }; // ══ Lista del proveedor ══════════════════════════════════════
  //
  // El proveedor publica su stock en una app web que NO deja consultarla desde afuera: la
  // página se arma sola en el navegador y no hay URL que devuelva los datos. Lo que sí
  // tiene es un "Ctrl+A copia todo", y copia en formato tabla. Así que el camino es pegar.
  //
  // Dos cosas que este flujo hace y el de las otras listas no:
  //   - los precios del proveedor son COSTO, y hay que sumarles el margen antes de que
  //     nadie los vea. Un descuido acá se traduce en vender al costo;
  //   - la lista trae disponibilidad, y lo que no tiene stock se descarta: el bot no puede
  //     ofrecer lo que el proveedor no tiene.
  contextoApp.TRAMOS_POR_DEFECTO = [{
    hasta: 200,
    suma: 45
  }, {
    hasta: 500,
    suma: 65
  }, {
    hasta: null,
    suma: 115
  }];
  contextoApp.tramosProv = () => Array.isArray(contextoApp.cfg.margenProveedor) && contextoApp.cfg.margenProveedor.length ? contextoApp.cfg.margenProveedor : contextoApp.TRAMOS_POR_DEFECTO;
  contextoApp.tramosEditando = null;
  window.setTramoProv = function (i, campo, valor) {
    contextoApp.tramosEditando = contextoApp.tramosEditando || JSON.parse(JSON.stringify(contextoApp.tramosProv()));
    contextoApp.tramosEditando[i][campo] = valor === '' ? null : Number(valor);
    window.procesarListaProv(); // el precio final cambia en vivo
  };
  window.agregarTramoProv = function () {
    contextoApp.tramosEditando = contextoApp.tramosEditando || JSON.parse(JSON.stringify(contextoApp.tramosProv()));
    contextoApp.tramosEditando.splice(contextoApp.tramosEditando.length - 1, 0, {
      hasta: 300,
      suma: 55
    });
    contextoApp.cfg.margenProveedor = contextoApp.tramosEditando;
    pintarTramosProv();
  };
  window.quitarTramoProv = function (i) {
    contextoApp.tramosEditando = contextoApp.tramosEditando || JSON.parse(JSON.stringify(contextoApp.tramosProv()));
    contextoApp.tramosEditando.splice(i, 1);
    contextoApp.cfg.margenProveedor = contextoApp.tramosEditando;
    pintarTramosProv();
    window.procesarListaProv();
  };
  window.guardarTramosProv = async function () {
    const t = (contextoApp.tramosEditando || contextoApp.tramosProv()).map(x => ({
      hasta: x.hasta == null ? null : Number(x.hasta),
      suma: Number(x.suma) || 0
    })).sort((a, b) => (a.hasta == null ? Infinity : a.hasta) - (b.hasta == null ? Infinity : b.hasta));
    setSyncDot('syncing');
    try {
      contextoApp.cfg.margenProveedor = t;
      contextoApp.tramosEditando = null;
      await setDoc(contextoApp.cfgDoc, contextoApp.withUser({
        margenProveedor: t
      }), {
        merge: true
      });
      showToast('Margen guardado ✓');
      pintarTramosProv();
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
  };
  contextoApp.precioProv = txt => {
    const s = String(txt || '').replace(/US\$|u\$s|usd|\$/gi, '').trim();
    if (!s) return null;
    const n = parseFloat(s.replace(/\./g, '').replace(',', '.')); // es-AR: el punto es de miles
    return Number.isFinite(n) ? n : null;
  };
  contextoApp.hayStockProv = t => {
    const v = String(t || '').trim();
    return !!v && !/^(no|sin|0|agotado)\b/i.test(v);
  };
  /**
   * Lee lo pegado. La app del proveedor copia cinco columnas separadas por tabulación
   * —categoría, código, producto, precio, stock— y la celda de categoría viene VACÍA salvo
   * en la primera fila de cada grupo, así que se arrastra la última que se vio.
   */
  window.procesarListaProv = function () {
    const texto = document.getElementById('kb-prov-texto').value || '';
    const tramos = contextoApp.tramosEditando || contextoApp.tramosProv();
    let categoria = '',
      descartadas = 0,
      sinStock = 0;
    const items = [];
    for (const linea of texto.split(/\r?\n/)) {
      if (!linea.trim()) continue;
      const c = linea.split('\t');
      if (c.length < 4) {
        descartadas++;
        continue;
      }
      if (c[0] && c[0].trim()) categoria = c[0].trim();
      const producto = (c[2] || '').trim();
      const costo = contextoApp.precioProv(c[3]);
      if (!producto || costo == null) {
        descartadas++;
        continue;
      }
      if (!contextoApp.hayStockProv(c[4])) {
        sinStock++;
        continue;
      }
      const m = conMargenProv(costo, tramos);
      const gb = (producto.match(/(\d+)\s?(GB|TB)\b/i) || [])[0] || '';
      items.push({
        producto: producto.replace(/\s*\d+\s?(GB|TB)\b/i, ' ').replace(/\s+/g, ' ').trim(),
        gb,
        color: '',
        condicion: '',
        precioPublico: Math.round(m.precio),
        _costo: costo,
        _suma: m.suma,
        _cat: categoria
      });
    }
    contextoApp.kbParseada.prov = items;
    const res = document.getElementById('kb-prov-resumen');
    if (!texto.trim()) {
      res.innerHTML = '';
      document.getElementById('kb-prov-preview').style.display = 'none';
      return;
    }

    // La red: si el margen es una parte desproporcionada del costo, algo barato se coló y
    // el precio va a quedar ridículo. Se muestra, no se bloquea.
    const raros = items.filter(i => i._costo > 0 && i._suma / i._costo > 0.6);
    res.innerHTML = `<div class="proveedor-alerta" style="margin-top:10px;">
      <b>${items.length}</b> producto${items.length === 1 ? '' : 's'} con stock, ya con tu margen aplicado.
      ${sinStock ? `<br>${sinStock} sin stock, descartado${sinStock === 1 ? '' : 's'}.` : ''}
      ${descartadas ? `<br>${descartadas} línea${descartadas === 1 ? '' : 's'} que no pude leer (encabezados o filas incompletas).` : ''}
    </div>
    ${raros.length ? `<div class="proveedor-alerta alerta-urgente" style="margin-top:8px;">
      ⚠️ <b>${raros.length} producto${raros.length === 1 ? '' : 's'} con margen desproporcionado</b> — el recargo es más de la mitad del costo. Revisalos antes de guardar:
      <ul style="margin:6px 0 0 18px;">${raros.slice(0, 6).map(i => `<li>${esc(i.producto)} ${esc(i.gb)}: costo u$s ${i._costo} + ${i._suma} = <b>u$s ${i.precioPublico}</b></li>`).join('')}</ul>
      ${raros.length > 6 ? `<div style="margin-top:4px;">…y ${raros.length - 6} más.</div>` : ''}
    </div>` : ''}`;
    const prev = document.getElementById('kb-prov-preview-items');
    prev.innerHTML = `<div style="overflow-x:auto;"><table class="tkh-table">
    <thead><tr><th>Categoría</th><th>Producto</th><th style="width:70px;">GB</th><th style="text-align:right;width:80px;">Costo</th><th style="text-align:right;width:80px;">Margen</th><th style="text-align:right;width:100px;">Al cliente</th></tr></thead>
    <tbody>${items.slice(0, 60).map(i => `<tr${i._suma / i._costo > 0.6 ? ' style="background:#FDECEA;"' : ''}>
      <td style="color:var(--text3);">${esc(i._cat)}</td><td>${esc(i.producto)}</td><td>${esc(i.gb)}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--text3);">u$s ${i._costo}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;">+${i._suma}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;">u$s ${i.precioPublico}</td></tr>`).join('')}</tbody></table></div>
    ${items.length > 60 ? `<div style="font-size:11.5px;color:var(--text3);margin-top:6px;">Mostrando 60 de ${items.length}. Se guardan todos.</div>` : ''}`;
    document.getElementById('kb-prov-preview').style.display = items.length ? 'block' : 'none';
  };
  contextoApp.itemKbLimpio = it => ({
    producto: String(it.producto || '').trim(),
    gb: it.gb != null ? String(it.gb).trim() : '',
    color: it.color != null ? String(it.color).trim() : '',
    condicion: contextoApp.condicionKb(it.condicion),
    // precioPublico va tal cual vino en la lista: ya es el precio final
    precioPublico: it.precioPublico != null && !isNaN(Number(it.precioPublico)) ? Number(it.precioPublico) : null
  });
  window.guardarListaKb = async function (origen, modo) {
    const nuevos = (contextoApp.kbParseada[origen] || []).map(contextoApp.itemKbLimpio);
    if (!nuevos.length) return;
    const previa = kbUltimaLista(origen);
    const previos = previa && Array.isArray(previa.items) ? previa.items : [];
    let items = nuevos,
      aviso = `${nuevos.length} producto${nuevos.length === 1 ? '' : 's'}`;
    if (modo === 'reemplazar') {
      if (previos.length && !confirm(`¿Reemplazar TODA la lista de ${contextoApp.KB_ORIGENES[origen]}?\n\nHoy tiene ${previos.length} producto${previos.length === 1 ? '' : 's'} y va a quedar solo con ${nuevos.length}.\n\nSi lo que querés es sumar productos sin perder los de antes, usá "Agregar a la lista".`)) return;
    } else {
      const f = fusionarListaKb(previos, nuevos);
      items = f.items;
      aviso = `${f.agregados} nuevo${f.agregados === 1 ? '' : 's'}, ${f.actualizados} actualizado${f.actualizados === 1 ? '' : 's'} · ${items.length} en total`;
    }
    const moneda = document.getElementById('kb-' + origen + '-moneda').value;
    const btns = [document.getElementById('btn-kb-' + origen + '-guardar'), document.getElementById('btn-kb-' + origen + '-reemplazar')].filter(Boolean);
    btns.forEach(b => {
      b.disabled = true;
    });
    const btn = btns[0];
    const txtOriginal = btn.textContent;
    btn.textContent = 'Guardando...';
    setSyncDot('syncing');
    try {
      // Cada guardado deja un documento nuevo con la lista COMPLETA: así queda el
      // historial de cómo estaba la lista cada día.
      //
      // OJO: eso significa que un mismo día hay VARIOS docs con la misma `fecha`, y cuál
      // es "la última" solo se resuelve mirando `createdAt`. Acá se desempata al ordenar
      // `listasItems`; el Worker tiene que hacer lo mismo en `ultimaLista()`, y por no
      // hacerlo le contestó a un cliente que no había AirPods teniéndolos cargados.
      await addDoc(contextoApp.listasCol, contextoApp.withUser({
        origen,
        fecha: contextoApp.today(),
        moneda,
        items,
        createdAt: serverTimestamp()
      }));
      contextoApp.kbParseada[origen] = [];
      document.getElementById('kb-' + origen + '-preview').style.display = 'none';
      document.getElementById('kb-' + origen + '-texto').value = '';
      showToast(`Lista de ${contextoApp.KB_ORIGENES[origen]}: ${aviso} ✓`);
    } catch (e) {
      console.error(e);
      showToast('Error al guardar la lista', true);
      setSyncDot('error');
    }
    btns.forEach(b => {
      b.disabled = false;
    });
    btn.textContent = txtOriginal;
  };
  window.borrarListaKb = async function (origen) {
    const l = kbUltimaLista(origen);
    if (!l) {
      showToast('No hay ninguna lista cargada.', true);
      return;
    }
    if (!confirm(`¿Borrar la lista de ${contextoApp.KB_ORIGENES[origen]} del ${kbFecha(l.fecha)} (${(l.items || []).length} productos)?`)) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'listas_precios', l.id));
      showToast('Lista borrada ✓');
    } catch (e) {
      console.error(e);
      showToast('Error al borrar', true);
      setSyncDot('error');
    }
  };

  // ── Arranque: espera el estado de auth ──
  // ── Funciones invocadas desde atributos del HTML ─────────────────────────────
  // Los onclick/onchange/oninput corren en scope GLOBAL y no ven nada declarado
  // dentro de este módulo. Estas se llamaban desde el HTML sin estar expuestas:
  // tiraban ReferenceError y el control quedaba muerto sin ningún síntoma visible.
  // Si agregás un handler inline que llame a una función del módulo, sumala acá.
  // ══ Factura electrónica de ARCA ══════════════════════════════
  //
  // El sistema NO habla con ARCA: habla con el Worker facturador, que es el único que
  // tiene el certificado. Acá solo se arma el pedido y se muestra el resultado.
}
