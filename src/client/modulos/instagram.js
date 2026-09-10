import { configuracion } from '../core/config-publica.js';
/** modulos/instagram: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, escJs, showToast, requiereDuenoDelLocal } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { setDoc, serverTimestamp, updateDoc, doc, getDocs, writeBatch } from 'firebase/firestore';
import { workerHeaders } from './reportes.js';

export
// Los timestamps llegan como Timestamp del SDK; si algún doc quedó con el string ISO
// que escribía el Worker viejo, también se banca. Devuelve ms, o 0 si no hay nada.
function msDe(v) {
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}
export function haceCuanto(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const hs = Math.floor(min / 60);
  if (hs < 24) return `hace ${hs} h`;
  const d = Math.floor(hs / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

// Lo que se está editando, por conversación. Sin esto, un snapshot que llegue mientras
// escribís te borra lo tipeado: el render reemplaza el innerHTML entero.
export function renderSwitchBot() {
  if (!contextoApp.puedeAdministrarLocal) {
    document.getElementById('bd-switch').innerHTML = '<div class="proveedor-alerta alerta-atencion">El bot de Instagram publicado pertenece a otra cuenta. Esta cuenta no puede administrarlo.</div>';
    return;
  }
  const modo = contextoApp.modoBotActual();
  const m = contextoApp.MODOS_BOT[modo];
  const borde = modo === 'todos' ? '' : modo === 'prueba' ? 'border-color:#FAC775;background:#FEF9E7;' : 'border-color:#F09595;background:#FDECEC;';
  const btn = (id, txt) => `<button class="${modo === id ? 'btn-save' : 'btn-pagar-outline'}" style="${modo === id ? 'width:auto;padding:9px 16px;' : ''}white-space:nowrap;" ${modo === id ? 'disabled' : `onclick="setModoBot('${id}')"`}>${txt}</button>`;

  // Las cuentas se agregan desde una conversación de la bandeja, que es donde sabemos
  // el id de Instagram: no es algo que se pueda tipear de memoria.
  const cuentas = contextoApp.botCfg.cuentasPrueba.length ? contextoApp.botCfg.cuentasPrueba.map(id => {
    const c = contextoApp.convsItems.find(x => String(x.igUserId) === id);
    return `<span class="consig-tipo tipo-propio" style="margin:2px 4px 2px 0;">${esc(c && c.igUsuario ? '@' + c.igUsuario : 'IG ' + id)} <a onclick="quitarCuentaPrueba('${escJs(id)}')" style="cursor:pointer;font-weight:700;">✕</a></span>`;
  }).join('') : '<span style="font-size:12px;color:var(--neg);">Ninguna cuenta autorizada todavía — el bot no le va a contestar a nadie. Agregá la tuya con el botón de una conversación de abajo.</span>';
  document.getElementById('bd-switch').innerHTML = `
    <div class="card" style="margin-bottom:12px;${borde}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:15px;">${m.emoji} ${m.titulo}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:3px;">${m.detalle}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${btn('apagado', '⏸ Apagado')}${btn('prueba', '🧪 Prueba')}${btn('todos', '▶ Todos')}
        </div>
      </div>
      ${modo === 'prueba' ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div style="font-size:12px;color:var(--text3);margin-bottom:5px;">Le contesta solo a:</div>${cuentas}
      </div>` : ''}
    </div>`;
}
export async function guardarCfgBot(campos, aviso) {
  setSyncDot('syncing');
  try {
    await setDoc(contextoApp.botDoc, contextoApp.withUser({
      ...campos,
      cambiadoPor: contextoApp.currentUser && contextoApp.currentUser.email || contextoApp.uid,
      cambiadoEn: serverTimestamp()
    }), {
      merge: true
    });
    showToast(aviso);
  } catch (e) {
    showToast('No se pudo cambiar: ' + e.message, true);
    setSyncDot('error');
  }
}

// ── El semáforo de cada chat ──────────────────────────────
//
// El interruptor de arriba es para el bot entero; este es para UNA conversación.
//
//   🟢  la contesta solo, como siempre
//   🔴  no contesta nada acá: la seguís vos desde Instagram
//
// Pausado no es apagado: sigue leyendo y anotando. Lo que entre te aparece en la bandeja
// con el motivo "lo estás llevando vos", y lo que le escribas desde la app de Instagram
// entra al historial de la charla. Eso último es lo que hace que prenderlo de nuevo no
// sea empezar de cero — el bot retoma con lo que dijiste vos ya leído.
export
// Solo el campo del semáforo, y quién lo tocó. El Worker también lo escribe, pero solo
// para pausar (cuando promete algo); `pausadoPor`/`pausadoEn` son del sistema nada más.
async function pausarChat(id, pausado, aviso) {
  setSyncDot('syncing');
  try {
    await updateDoc(doc(contextoApp.db, 'conversaciones', id), {
      botPausado: pausado,
      pausadoPor: contextoApp.currentUser && contextoApp.currentUser.email || contextoApp.uid,
      pausadoEn: serverTimestamp()
    });
    showToast(aviso);
    return true;
  } catch (e) {
    showToast('No se pudo cambiar: ' + e.message, true);
    setSyncDot('error');
    return false;
  }
}

// El bot lee la charla completa —lo que contestaste vos incluido— y responde el último
// mensaje del cliente. El DM lo manda el Worker: el token de Instagram no puede vivir
// en un HTML público, igual que en "Aprobar y mandar".
export async function retomarChat(x) {
  if (!x.igUserId) {
    showToast('Esta conversación no tiene guardado el usuario de Instagram.', true);
    return;
  }
  try {
    const r = await fetch(contextoApp.IG_WORKER_URL + '/reanudar', {
      method: 'POST',
      headers: await workerHeaders(),
      body: JSON.stringify({
        igUserId: x.igUserId
      })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast('El bot no pudo retomar: ' + (d.error || `el Worker respondió ${r.status}`), true);
      return;
    }
    showToast(d.pendiente === false ? 'No había nada sin contestar — el bot sigue cuando el cliente escriba' : d.enviados ? `El bot retomó — ${d.enviados} mensaje${d.enviados === 1 ? '' : 's'}` : 'El bot leyó la charla y no vio nada para contestar');
  } catch (e) {
    console.error('reanudar:', e);
    showToast('No se pudo hablar con el bot: ' + e.message, true);
  }
}

// El ida y vuelta de la conversación. El historial se empezó a guardar el 22/08/2026:
// las charlas anteriores a eso solo tienen el último mensaje, así que se muestra ese y
// se avisa. No se puede recuperar lo anterior — Instagram no lo devuelve.
export function renderChat(x) {
  const h = Array.isArray(x.historial) ? x.historial : [];
  if (!h.length) {
    return `<div class="bd-chat"><div class="bd-chat-vacio">${x.ultimoMensaje ? `«${esc(x.ultimoMensaje)}»<br><span style="font-size:11px;">La charla completa se guarda desde el próximo mensaje.</span>` : 'Sin mensajes guardados todavía.'}</div></div>`;
  }
  const hora = v => {
    const t = msDe(v);
    return t ? new Date(t).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }) : '';
  };
  // Tres orígenes: el cliente, el bot, y lo que contestaste vos a mano desde Instagram
  // (`juni`, lo anota el Worker cuando Meta le avisa del mensaje). Van separados a
  // propósito: para saber qué dijiste vos y qué dijo el bot cuando algo salió torcido.
  const clase = de => de === 'bot' ? 'bd-de-bot' : de === 'juni' ? 'bd-de-juni' : 'bd-de-cliente';
  return `<div class="bd-chat">${h.map(m => `
    <div class="bd-msg ${clase(m.de)}">${m.de === 'juni' ? '<div class="bd-quien">VOS, DESDE INSTAGRAM</div>' : ''}${esc(m.texto)}<div class="bd-hora">${hora(m.fecha)}</div></div>`).join('')}</div>`;
}

// ── El tablero ────────────────────────────────────────────
//
// Una conversación puede estar en varias pestañas a la vez, y está bien: son vistas de
// lo mismo, no estados excluyentes. Alguien que dijo que va a pasar Y pidió una foto
// tiene que aparecer en las dos, porque son dos cosas distintas que hacer con él.

// Cuánto historial se trae el tablero. Más atrás que esto ya no sirve ni para
// remarketing, y cada conversación es una lectura de Firestore en cada arranque.
export function renderBandeja() {
  renderSwitchBot();
  const ahora = Date.now();
  document.getElementById('bd-tabs').innerHTML = Object.entries(contextoApp.TABS_BD).map(([k, t]) => {
    const n = contextoApp.convsItems.filter(t.filtra).length;
    return `<button class="tab-btn ${k === contextoApp.bdTab ? 'active' : ''}" onclick="setBdTab('${k}')">${t.label}${n ? ` (${n})` : ''}</button>`;
  }).join('');
  const tab = contextoApp.TABS_BD[contextoApp.bdTab];
  const filas = contextoApp.convsItems.filter(tab.filtra).sort(tab.ordena);

  // Vaciar solo tiene sentido sobre lo que te está pidiendo atención.
  const pendientes = contextoApp.convsItems.filter(contextoApp.TABS_BD.atencion.filtra).length;
  document.getElementById('bd-acciones').innerHTML = contextoApp.bdTab === 'atencion' && pendientes ? `<div style="margin-bottom:10px;"><button class="btn-pagar-outline" onclick="vaciarBandeja()">✓ Ya contesté todo — vaciar</button></div>` : '';
  document.getElementById('bd-list').innerHTML = filas.map(x => {
    const t = msDe(x.ultimoMensajeCliente);
    // Sin fecha se trata como vencida: es el lado seguro, porque mandar fuera de las
    // 24 h es lo que pone en riesgo el acceso a la API.
    const vencida = !t || ahora - t >= contextoApp.META_24H;
    const abierta = contextoApp.bdAbiertas.has(x.id);
    const quien = x.igUsuario ? '@' + x.igUsuario : 'IG ' + (x.igUserId || '—');
    const borrador = contextoApp.bdBorradores[x.id] ?? (x.mensajes || []).join('\n');
    const pausado = x.botPausado === true;

    // El semáforo va en la fila cerrada también: de un vistazo tenés que poder ver qué
    // chats está llevando el bot y cuáles estás llevando vos.
    // Un chat puede estar en rojo porque lo pausaste vos o porque el bot prometió algo y
    // se calló solo. Son situaciones distintas —una la decidiste, la otra te la dejaron
    // en la mesa— así que el semáforo lo dice.
    const solo = pausado && !!x.motivoPausa;
    const semaforo = `<button class="bd-semaforo ${pausado ? 'sem-off' : 'sem-on'}"
      title="${pausado ? solo ? esc(x.motivoPausa) + '. Tocá para que el bot vuelva a contestar.' : 'El bot no contesta este chat. Tocá para que vuelva a contestar.' : 'El bot contesta este chat solo. Tocá para pausarlo y seguirlo vos.'}"
      onclick="event.stopPropagation(); toggleBotChat('${escJs(x.id)}')">${pausado ? solo ? '🔴 Te lo dejó' : '🔴 Pausado' : '🟢 Bot'}</button>`;
    const etiqueta = x.necesitaAtencion ? `<span class="est-badge ${vencida ? 'est-abandono' : 'est-recibido'}" style="font-size:9px;white-space:nowrap;">PRIORIDAD ${x.prioridad ?? '—'}</span>` : `<span class="consig-tipo ${x.estado === 'cerrado' ? 'tipo-permuta' : 'tipo-consig'}" style="white-space:nowrap;">${esc(contextoApp.ESTADOS_BOT[x.estado] || x.estado || '—')}</span>`;
    const bajada = x.necesitaAtencion ? esc(contextoApp.MOTIVOS_BOT[x.motivo] || x.motivo || 'Sin motivo') : esc(contextoApp.ESTADOS_BOT[x.estado] || x.estado || '');
    return `<div class="card" style="margin-bottom:8px;${vencida && x.necesitaAtencion ? 'border-color:#F09595;' : ''}">
      <div onclick="toggleConv('${escJs(x.id)}')" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;cursor:pointer;">
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:15px;">${abierta ? '▾' : '▸'} 💬 ${esc(quien)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">${bajada} · ${t ? haceCuanto(ahora - t) : 'sin fecha'}${x.ultimoProducto ? ' · ' + esc(x.ultimoProducto) : ''}</div>
          ${!abierta && x.resumen ? `<div style="font-size:12px;color:var(--text2);margin-top:4px;">${esc(x.resumen)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">${semaforo}${etiqueta}</div>
      </div>
      ${!abierta ? '' : `
      ${x.resumen ? `<div style="font-size:13px;color:var(--text2);margin-top:8px;">${esc(x.resumen)}</div>` : ''}
      ${renderChat(x)}
      ${pausado ? `<div class="proveedor-alerta alerta-atencion">🔴 <b>El bot está pausado en este chat</b> — contestale vos desde Instagram. Lo que le escribas se anota acá abajo, y cuando lo vuelvas a prender el bot retoma sabiendo todo lo que le dijiste.</div>` : ''}
      ${vencida ? `<div class="proveedor-alerta alerta-urgente">⏰ <b>Pasaron las 24 h</b> — Instagram ya no deja que el bot conteste. Escribile vos desde la app y después marcala como contestada.</div>` : ''}
      <div class="field" style="margin:10px 0 8px;">
        <label>${vencida ? 'Respuesta que había preparado el bot (no se puede mandar desde acá)' : 'Respuesta — editala si hace falta, una línea por mensaje'}</label>
        <textarea id="bd-txt-${x.id}" style="height:90px;" ${vencida ? 'disabled' : ''} oninput="bdBorrador('${escJs(x.id)}', this.value)">${esc(borrador)}</textarea>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${vencida ? '' : `<button class="btn-save" id="bd-btn-${x.id}" style="width:auto;padding:10px 18px;" onclick="aprobarBandeja('${escJs(x.id)}')">✓ Aprobar y mandar</button>`}
        ${x.necesitaAtencion ? `<button class="btn-pagar-outline" onclick="resolverBandeja('${escJs(x.id)}')">Ya le contesté yo</button>` : ''}
        ${contextoApp.modoBotActual() === 'prueba' && x.igUserId && !contextoApp.botCfg.cuentasPrueba.includes(String(x.igUserId)) ? `<button class="btn-pagar-outline" onclick="agregarCuentaPrueba('${escJs(x.igUserId)}')">🧪 Probar con esta cuenta</button>` : ''}
      </div>`}
    </div>`;
  }).join('') || `<div class="empty">${tab.vacio}</div>`;

  // Abajo de todo y solo si hay algo que borrar, para que no esté al alcance de la mano.
  document.getElementById('bd-peligro').innerHTML = contextoApp.convsItems.length ? `
    <div class="card danger-zone" style="margin-top:20px;">
      <div class="card-title" style="color:var(--neg)">Zona de peligro</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:1rem;">Borra <b>todas</b> las conversaciones de Instagram, con sus chats y su historial. No se puede deshacer y no se puede recuperar de Instagram: lo que se borra acá se perdió.<br><br>Es distinto de <i>vaciar</i>: vaciar solo saca de la bandeja lo que ya contestaste y deja las charlas guardadas.</p>
      <button class="btn-danger" onclick="borrarConversaciones()">Borrar todas las conversaciones</button>
    </div>` : '';

  // Cada chat abierto arranca abajo, en lo último que se dijo.
  document.querySelectorAll('#bd-list .bd-chat').forEach(c => {
    c.scrollTop = c.scrollHeight;
  });
}

// Borra las conversaciones de verdad, no las esconde. Mismo patrón que borrarTodo():
// confirmación, después la cuenta exacta, después una frase tipeada. Es el botón que
// dentro de tres meses puede llevarse puestas charlas de clientes reales, así que la
// fricción es a propósito.
//
// Se consulta la colección entera, no lo que muestra el tablero: el tablero se acota a
// 60 días y un botón que dice "todas" tiene que borrar todas.
export function inicializarInstagram() {
  // ── Bandeja del bot de Instagram ─────────────────────────
  //
  // Las conversaciones que el bot no pudo cerrar solo. El orden es el del trabajo: la
  // prioridad primero (1 = pidió una foto, 8 = el bot no supo qué contestar) y dentro de
  // cada nivel la más vieja arriba, que es la que hace más rato que está esperando.
  //
  // Nada sale de acá sin aprobar. El DM lo manda el Worker de ig-bot, no el navegador:
  // el token de Instagram no puede vivir en un HTML público.
  contextoApp.IG_WORKER_URL = configuracion.api.instagram;
  contextoApp.TIENDA_URL = configuracion.api.tienda; // el Worker que cobra y busca fotos
  // Ventana de Meta: pasadas 24 h desde el último mensaje del cliente, la API no deja
  // responder y hay que escribirle a mano desde Instagram. El mismo límite que respeta
  // el cron de seguimiento del Worker.
  contextoApp.META_24H = 24 * 60 * 60 * 1000; // La tabla de motivos de prompt-bot.md, en castellano de pantalla.
  contextoApp.MOTIVOS_BOT = {
    averiguar: 'Pidió algo que no está en las listas — prometió averiguar',
    pidio_foto: 'Pidió una foto',
    cerrado: 'Dijo que lo lleva',
    reclamo: 'Reclamo',
    permuta: 'Hay que tasar una permuta',
    reparacion: 'Pregunta por una reparación',
    otro_medio_de_pago: 'Otro medio de pago — hay que calcular el recargo',
    en_mano: 'Lo estás llevando vos — el bot está pausado acá',
    visto: 'Quedó en silencio',
    no_supe_responder: 'El bot no supo qué contestar',
    bot_apagado: 'Entró con el bot apagado — nadie lo leyó',
    modo_prueba: 'Entró en modo prueba y no está autorizada — sin clasificar'
  };
  contextoApp.bdBorradores = {};
  window.bdBorrador = function (id, txt) {
    contextoApp.bdBorradores[id] = txt;
  };

  // El interruptor, con tres posiciones:
  //
  //   apagado  no manda nada solo
  //   prueba   solo le contesta a las cuentas que autorizaste — para afinarlo tranquilo
  //   todos    le contesta a cualquiera
  //
  // En las tres sigue leyendo, clasificando y guardando: lo que no contesta cae acá, en
  // la bandeja, para que lo contestes vos. Nunca se pierde un cliente.
  //
  // Lo que NUNCA se apaga es el botón "Aprobar y mandar": ahí el que manda sos vos.
  contextoApp.MODOS_BOT = {
    apagado: {
      emoji: '🔴',
      titulo: 'El bot está apagado',
      detalle: 'No manda ningún mensaje por su cuenta. Sigue anotando todo acá abajo para que lo contestes vos.'
    },
    prueba: {
      emoji: '🟡',
      titulo: 'El bot está en modo prueba',
      detalle: 'Solo le contesta a las cuentas autorizadas. Al resto lo anota acá abajo sin responderle, y el seguimiento automático queda frenado.'
    },
    todos: {
      emoji: '🟢',
      titulo: 'El bot le contesta a todos',
      detalle: 'Responde los DM y manda los seguimientos. Lo que no puede resolver cae acá abajo.'
    }
  };
  contextoApp.modoBotActual = () => !contextoApp.botCfg.activo ? 'apagado' : contextoApp.botCfg.modo === 'prueba' ? 'prueba' : 'todos';
  window.setModoBot = async function (modo) {
    if (!requiereDuenoDelLocal()) return;
    if (modo === 'todos' && !confirm('¿Poner el bot a contestarle a TODOS?\n\nDesde ahora responde solo cualquier DM que entre y vuelve a mandar los seguimientos automáticos.')) return;
    await guardarCfgBot({
      activo: modo !== 'apagado',
      modo: modo === 'prueba' ? 'prueba' : 'todos'
    }, modo === 'apagado' ? 'Bot apagado — sigue anotando en la bandeja' : modo === 'prueba' ? 'Modo prueba: solo contesta a las cuentas autorizadas' : 'El bot le contesta a todos');
  };
  window.agregarCuentaPrueba = async function (igUserId) {
    if (!requiereDuenoDelLocal()) return;
    const ya = contextoApp.botCfg.cuentasPrueba;
    if (ya.includes(String(igUserId))) {
      showToast('Esa cuenta ya estaba autorizada');
      return;
    }
    await guardarCfgBot({
      cuentasPrueba: [...ya, String(igUserId)]
    }, 'Cuenta autorizada para las pruebas');
  };
  window.quitarCuentaPrueba = async function (igUserId) {
    if (!requiereDuenoDelLocal()) return;
    await guardarCfgBot({
      cuentasPrueba: contextoApp.botCfg.cuentasPrueba.filter(x => x !== String(igUserId))
    }, 'Cuenta sacada de las pruebas');
  };
  window.toggleBotChat = async function (id) {
    const x = contextoApp.convsItems.find(c => c.id === id);
    if (!x) return;
    const quien = x.igUsuario ? '@' + x.igUsuario : 'IG ' + (x.igUserId || '—');
    if (!x.botPausado) {
      if (!confirm(`¿Pausar el bot en el chat de ${quien}?\n\nDeja de contestarle solo a esta persona: le contestás vos desde Instagram. Todo lo que entre, y todo lo que le escribas, se sigue guardando acá.\n\nAl resto de los clientes les sigue contestando igual.`)) return;
      await pausarChat(id, true, 'Bot pausado en este chat — contestale vos');
      return;
    }

    // Prenderlo de nuevo. Si el cliente escribió último y nadie le contestó, quedó alguien
    // esperando: el bot puede retomar AHORA, con la charla entera y la tuya adentro.
    const h = Array.isArray(x.historial) ? x.historial : [];
    const t = msDe(x.ultimoMensajeCliente);
    const pendiente = !!(h.length && h[h.length - 1].de === 'cliente' && t && Date.now() - t < contextoApp.META_24H);

    // Una sola pregunta, que dice exactamente qué va a pasar en cada caso. Prender con
    // algo sin contestar es, justamente, pedirle que lo conteste: no hace falta una
    // segunda ventana para eso.
    if (!confirm(pendiente ? `¿Que el bot vuelva a contestar el chat de ${quien}?\n\nQuedó un mensaje del cliente sin responder: lo va a leer con toda la charla —lo que le escribiste vos incluido— y le contesta ahora.` : `¿Que el bot vuelva a contestar el chat de ${quien}?\n\nRetoma cuando el cliente escriba, con todo lo que se dijo, incluido lo que le escribiste vos desde Instagram.`)) return;
    if (!(await pausarChat(id, false, pendiente ? 'Prendido — el bot está leyendo la charla…' : 'Bot prendido en este chat'))) return;
    if (pendiente) await retomarChat(x);
  };
  contextoApp.DIAS_CONVS = 60;
  contextoApp.desdeConvs = () => new Date(Date.now() - contextoApp.DIAS_CONVS * 24 * 60 * 60 * 1000); // A partir de cuándo una conversación se considera dormida y sirve para remarketing.
  contextoApp.DORMIDA_DESDE = 3 * 24 * 60 * 60 * 1000;
  contextoApp.ESTADOS_BOT = {
    cerrado: 'Va a pasar',
    indeciso: 'Interesado',
    permuta: 'Permuta',
    reparacion: 'Reparación',
    reclamo: 'Reclamo',
    curioso: 'Consulta suelta'
  }; // Cada pestaña: a quién muestra, cómo los ordena y qué decir cuando no hay ninguno.
  contextoApp.TABS_BD = {
    atencion: {
      label: '🔔 Para vos',
      filtra: x => x.necesitaAtencion === true,
      // Lo más urgente arriba y, dentro de cada nivel, el que hace más rato que espera.
      ordena: (a, b) => (a.prioridad ?? 99) - (b.prioridad ?? 99) || msDe(a.ultimoMensajeCliente) - msDe(b.ultimoMensajeCliente),
      vacio: 'No hay nada esperándote: el bot viene contestando todo solo. 🎉'
    },
    pasan: {
      label: '🛍 Van a pasar',
      filtra: x => x.estado === 'cerrado',
      ordena: (a, b) => msDe(b.ultimoMensajeCliente) - msDe(a.ultimoMensajeCliente),
      vacio: 'Todavía nadie dijo que pasa por el local.'
    },
    indecisos: {
      label: '🤔 Interesados',
      filtra: x => x.estado === 'indeciso',
      ordena: (a, b) => msDe(b.ultimoMensajeCliente) - msDe(a.ultimoMensajeCliente),
      vacio: 'Sin consultas de compra en este período.'
    },
    dormidas: {
      // Para remarketing a mano: preguntaron, no cerraron y se quedaron callados. Los más
      // recientes primero, que son los que todavía se acuerdan de vos.
      label: '💤 Sin novedades',
      filtra: x => Date.now() - msDe(x.ultimoMensajeCliente) >= contextoApp.DORMIDA_DESDE && x.estado !== 'curioso',
      ordena: (a, b) => msDe(b.ultimoMensajeCliente) - msDe(a.ultimoMensajeCliente),
      vacio: 'Ninguna conversación quedó colgada hace más de 3 días.'
    },
    todas: {
      label: '📋 Todas',
      filtra: () => true,
      ordena: (a, b) => msDe(b.ultimoMensajeCliente) - msDe(a.ultimoMensajeCliente),
      vacio: 'Todavía no entró ningún mensaje.'
    }
  };
  contextoApp.bdTab = 'atencion';
  contextoApp.bdAbiertas = new Set();
  window.setBdTab = function (tab) {
    contextoApp.bdTab = tab;
    renderBandeja();
  };

  // El chat se despliega al tocar la fila. Cerrado ocupa dos renglones, así que se puede
  // barrer el tablero de un vistazo; abierto se lee la charla completa y se contesta.
  window.toggleConv = function (id) {
    if (contextoApp.bdAbiertas.has(id)) contextoApp.bdAbiertas.delete(id);else contextoApp.bdAbiertas.add(id);
    renderBandeja();
  };
  window.borrarConversaciones = async function () {
    const FRASE = 'BORRAR';
    if (!confirm('⚠️ Esto borra TODAS las conversaciones de Instagram: los chats guardados, el historial de cada cliente y el contexto que el bot usa para contestarles.\n\nNo se puede deshacer, y no se puede recuperar de Instagram.\n\nOJO: no es lo mismo que "vaciar". Vaciar solo las saca de la bandeja y deja las charlas guardadas.')) return;
    setSyncDot('syncing');
    let snap;
    try {
      snap = await getDocs(contextoApp.myQ(contextoApp.convsCol));
    } catch (e) {
      showToast('No se pudo leer: ' + e.message, true);
      setSyncDot('error');
      return;
    }
    if (snap.empty) {
      showToast('No hay conversaciones para borrar');
      return;
    }
    const escrito = prompt(`Último paso — no se puede deshacer.\n\nSe van a borrar ${snap.size} conversación${snap.size === 1 ? '' : 'es'} con todo su historial.\n\nEscribí  ${FRASE}  para confirmar:`);
    if ((escrito || '').trim().toUpperCase() !== FRASE) {
      showToast('Cancelado — no se borró nada.');
      return;
    }
    try {
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(contextoApp.db);
        snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      Object.keys(contextoApp.bdBorradores).forEach(k => delete contextoApp.bdBorradores[k]);
      contextoApp.bdAbiertas.clear();
      showToast(`Borradas ${snap.size} conversaciones — el bot arranca de cero`);
    } catch (e) {
      showToast('No se pudo borrar: ' + e.message, true);
      setSyncDot('error');
    }
  };

  // Vaciar la bandeja de una. NO borra los documentos: los marca como contestados, igual
  // que el botón de cada fila. Borrarlos perdería el historial de la conversación, el
  // usuario de Instagram y el producto que consultó — y el bot los necesita para la
  // próxima vez que esa persona escriba.
  window.vaciarBandeja = async function () {
    const filas = contextoApp.convsItems.filter(contextoApp.TABS_BD.atencion.filtra);
    if (!filas.length) return;
    if (!confirm(`¿Marcar como contestadas las ${filas.length} conversaciones de la bandeja?\n\nNo se borra nada: las charlas quedan guardadas, solo dejan de pedirte atención. Usalo cuando ya las respondiste vos.`)) return;
    setSyncDot('syncing');
    try {
      // En lotes de 400, como el resto de las operaciones masivas del sistema.
      for (let i = 0; i < filas.length; i += 400) {
        const batch = writeBatch(contextoApp.db);
        for (const x of filas.slice(i, i + 400)) {
          batch.update(doc(contextoApp.db, 'conversaciones', x.id), {
            necesitaAtencion: false,
            motivo: null,
            prioridad: 99,
            seguimientoEnviado: true,
            revisado: true,
            aprobadoPor: contextoApp.currentUser && contextoApp.currentUser.email || contextoApp.uid,
            aprobadoEn: serverTimestamp()
          });
        }
        await batch.commit();
      }
      filas.forEach(x => {
        delete contextoApp.bdBorradores[x.id];
      });
      showToast(`Bandeja vaciada — ${filas.length} conversación${filas.length === 1 ? '' : 'es'}`);
    } catch (e) {
      showToast('No se pudo vaciar: ' + e.message, true);
      setSyncDot('error');
    }
  };
  window.aprobarBandeja = async function (id) {
    const x = contextoApp.convsItems.find(c => c.id === id);
    if (!x) return;
    if (!x.igUserId) {
      showToast('Esta conversación no tiene guardado el usuario de Instagram.', true);
      return;
    }
    const t = msDe(x.ultimoMensajeCliente);
    if (!t || Date.now() - t >= contextoApp.META_24H) {
      showToast('Pasaron las 24 h: hay que contestarle desde Instagram.', true);
      return;
    }

    // Una línea = un mensaje, igual que el array que devuelve el modelo.
    const mensajes = (contextoApp.bdBorradores[id] ?? (x.mensajes || []).join('\n')).split('\n').map(l => l.trim()).filter(Boolean);
    if (!mensajes.length) {
      showToast('Escribí la respuesta antes de mandar.', true);
      return;
    }
    const btn = document.getElementById('bd-btn-' + id);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Mandando...';
    }
    setSyncDot('syncing');
    try {
      const r = await fetch(contextoApp.IG_WORKER_URL + '/responder', {
        method: 'POST',
        headers: await workerHeaders(),
        body: JSON.stringify({
          igUserId: x.igUserId,
          mensajes
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `el Worker respondió ${r.status}`);

      // Recién con el DM afuera se saca de la bandeja. Si el envío falla, la conversación
      // se queda acá y se puede reintentar.
      // Lo que aprobaste entra al hilo igual que lo que manda el bot: si no, el chat de
      // la próxima vez que escriba este cliente aparece sin tus respuestas en el medio.
      // El tope es el mismo que usa el Worker (MAX_HISTORIAL).
      const historial = [...(Array.isArray(x.historial) ? x.historial : []), ...mensajes.map(t => ({
        de: 'bot',
        texto: t,
        fecha: new Date()
      }))].slice(-60);
      await updateDoc(doc(contextoApp.db, 'conversaciones', id), {
        historial,
        mensajes,
        sugerencia: mensajes.join('\n'),
        respondido: true,
        necesitaAtencion: false,
        motivo: null,
        prioridad: 99,
        seguimientoEnviado: true,
        // ya le escribimos: que el cron no la vuelva a agarrar
        revisado: true,
        aprobadoPor: contextoApp.currentUser && contextoApp.currentUser.email || contextoApp.uid,
        aprobadoEn: serverTimestamp()
      });
      delete contextoApp.bdBorradores[id];
      showToast(`Mandado — ${mensajes.length} mensaje${mensajes.length === 1 ? '' : 's'}`);
    } catch (e) {
      console.error('bandeja:', e);
      showToast('No se pudo mandar: ' + e.message, true);
      setSyncDot('error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✓ Aprobar y mandar';
      }
    }
  };

  // Para lo que ya contestaste vos desde Instagram — y para todo lo que pasó las 24 h,
  // que es la única salida que tiene.
  window.resolverBandeja = async function (id) {
    if (!confirm('¿Sacarla de la bandeja sin mandar nada?\n\nUsalo cuando ya le contestaste vos desde Instagram.')) return;
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'conversaciones', id), {
        necesitaAtencion: false,
        motivo: null,
        prioridad: 99,
        seguimientoEnviado: true,
        revisado: true,
        aprobadoPor: contextoApp.currentUser && contextoApp.currentUser.email || contextoApp.uid,
        aprobadoEn: serverTimestamp()
      });
      delete contextoApp.bdBorradores[id];
      showToast('Listo, sacada de la bandeja');
    } catch (e) {
      showToast('No se pudo actualizar: ' + e.message, true);
      setSyncDot('error');
    }
  };

  // ── Base de conocimiento (bot de Instagram) ──────────────
  // Dos cosas viven acá: el doc conocimiento/{uid} con los datos del local en texto
  // libre (lo que el bot contesta tal cual), y la colección listas_precios, un doc
  // por lista cargada. OJO: el precio de esas listas YA ES el precio final al
  // público — no se le aplica margen en ningún punto del flujo.
}
