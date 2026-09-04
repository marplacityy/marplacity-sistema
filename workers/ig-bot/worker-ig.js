/**
 * MarplaCity — Worker de Instagram DM
 * ------------------------------------
 * Recibe el DM, lo clasifica con la IA, CONTESTA por Instagram y guarda todo en la
 * colección `conversaciones`. Lo que no puede resolver lo marca para que lo atienda
 * Juni a mano (necesitaAtencion + motivo + prioridad).
 *
 * Sin IG_TOKEN cargado no manda nada: clasifica y llena la bandeja, nada más. Es la
 * forma de tenerlo andando sin que le escriba a nadie.
 *
 * Variables a cargar en Cloudflare (Settings -> Variables):
 *   IG_VERIFY_TOKEN   (Secret)  -> lo inventás vos, ej: "marplacity2026"
 *   IG_APP_SECRET     (Secret)  -> "Clave secreta de la aplicación" de Meta
 *   IG_TOKEN          (Secret)  -> token de acceso de Instagram
 *   IG_ACCOUNT_ID     (Text)    -> id de la cuenta de IG del local (la de IG_TOKEN)
 *   FIREBASE_PROJECT  (Text)    -> mis-gastos-21e7b
 *   FIREBASE_KEY      (Secret)  -> API key de Firebase
 *   OWNER_UID         (Text)    -> tu uid de usuario, para que las convers sean tuyas
 *   BOT_EMAIL         (Text)    -> bot@marplacity.com (usuario creado en Firebase Auth)
 *   BOT_PASSWORD      (Secret)  -> la contraseña de ese usuario
 *   ANTHROPIC_KEY     (Secret)  -> API key de Anthropic (se llama la API directo)
 */

import { construirSystem, MARCA_CANAL } from './prompt.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Firebase-Token',
};

export default {
  // Cron Trigger: el seguimiento de los que quedaron en silencio. La frecuencia sale de
  // [triggers] crons en wrangler.toml (cada hora en punto).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(correrSeguimientos(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ── 1. Verificación del webhook (Meta llama una vez con GET) ──
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === env.IG_VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      // diagnóstico rápido: ¿están cargadas las variables?
      return new Response(JSON.stringify({
        ok: true,
        vars: {
          IG_VERIFY_TOKEN: !!env.IG_VERIFY_TOKEN,
          IG_APP_SECRET: !!env.IG_APP_SECRET,
          IG_TOKEN: !!env.IG_TOKEN,
          IG_ACCOUNT_ID: !!env.IG_ACCOUNT_ID,
          FIREBASE_PROJECT: !!env.FIREBASE_PROJECT,
          FIREBASE_KEY: !!env.FIREBASE_KEY,
          OWNER_UID: !!env.OWNER_UID,
          BOT_EMAIL: !!env.BOT_EMAIL,
          BOT_PASSWORD: !!env.BOT_PASSWORD,
          ANTHROPIC_KEY: !!env.ANTHROPIC_KEY,
        }
      }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── 2. Respuesta aprobada desde la bandeja del sistema ──
    // El navegador no puede mandar el DM por su cuenta: el IG_TOKEN vive acá. El
    // sistema manda los mensajes que Juni ya editó y aprobó, con su token de Firebase.
    if (request.method === 'POST' && url.pathname === '/responder') {
      return responder(request, env);
    }

    // ── 2b. Retomar un chat que estuvo pausado ──
    // El sistema despausa y llama acá: el bot lee la charla completa —lo que contestó
    // Juni a mano incluido— y contesta el último mensaje del cliente si quedó colgado.
    if (request.method === 'POST' && url.pathname === '/reanudar') {
      return reanudar(request, env);
    }

    // ── 3. Mensajes entrantes (POST) ──
    if (request.method === 'POST') {
      const raw = await request.text();

      // Verificar que el POST venga realmente de Meta
      const sig = request.headers.get('x-hub-signature-256') || '';
      if (env.IG_APP_SECRET && !(await firmaValida(raw, sig, env.IG_APP_SECRET))) {
        return new Response('firma invalida', { status: 401 });
      }

      console.log('PAYLOAD CRUDO >>>', raw);

      let body;
      try { body = JSON.parse(raw); } catch (e) {
        console.log('no se pudo parsear el json', e.message);
        return new Response('EVENT_RECEIVED');
      }

      // Meta espera un 200 rapidísimo. Procesamos sin bloquear la respuesta.
      const tareas = [];
      for (const entry of (body.entry || [])) {
        const eventos = entry.messaging || entry.changes || [];
        console.log('entry con', eventos.length, 'evento(s) — claves:', Object.keys(entry).join(','));
        for (const ev of eventos) {
          tareas.push(procesarMensaje(ev, env));
        }
      }
      console.log('tareas encoladas:', tareas.length);

      // Meta espera el 200 rapidísimo y reintenta si tarda. Desde que el bot contesta,
      // procesar un mensaje lleva segundos (la IA, y la pausa entre DM), así que el
      // 200 sale ya y el trabajo sigue por atrás con waitUntil.
      ctx.waitUntil(
        Promise.allSettled(tareas).then(res => {
          res.forEach(r => { if (r.status === 'rejected') console.log('tarea fallo:', String(r.reason)); });
        }),
      );

      return new Response('EVENT_RECEIVED', { status: 200 });
    }

    return new Response('Method not allowed', { status: 405, headers: CORS });
  }
};

// ── Procesar un mensaje entrante ──────────────────────────────
async function procesarMensaje(ev, env) {
  // El formato "changes" envuelve el evento en .value; el "messaging" lo trae directo
  if (ev.value && !ev.sender) ev = ev.value;

  const senderId = ev.sender?.id;
  const esMio = senderId === ev.recipient?.id;
  if (!senderId)  { console.log('descarto: sin sender'); return; }
  if (esMio)      { console.log('descarto: sender == recipient'); return; }
  if (!ev.message){ console.log('descarto: no es mensaje, claves:', Object.keys(ev).join(',')); return; }

  const m = ev.message;

  // Un eco es un mensaje que salió DE la cuenta del local. Antes se descartaba entero;
  // ahora el que escribió Juni a mano se anota en el historial, que es lo único que le
  // permite al bot retomar una charla que estuvo pausada. Ver `anotarEco`.
  if (m.is_echo) return anotarEco(ev, env);

  // El webhook puede traer eventos de MAS DE UNA cuenta de Instagram, si hay varias
  // conectadas a la misma app de Meta. IG_TOKEN es de una sola: contestar un mensaje
  // que era para otra termina en "The requested user cannot be found" y, peor, nos
  // guarda en `conversaciones` charlas que no son del local. Paso el 22/08/2026.
  const paraQuien = ev.recipient?.id;
  if (env.IG_ACCOUNT_ID && paraQuien !== env.IG_ACCOUNT_ID) {
    console.log('descarto: era para la cuenta', paraQuien, '— la nuestra es', env.IG_ACCOUNT_ID);
    return;
  }
  if (!env.IG_ACCOUNT_ID) console.log('OJO: sin IG_ACCOUNT_ID no se filtra por cuenta, ver README');

  console.log('procesando mensaje de', senderId);

  const fechaMensaje = new Date(ev.timestamp || Date.now());

  // Se pide en paralelo con la IA, que es lo que tarda. Es solo para que la bandeja
  // muestre @usuario en vez de un id de 17 dígitos.
  const pedidoUsuario = usuarioDeIG(env, senderId);

  // Tipo de contenido
  const adjuntos = (m.attachments || []).map(a => a.type);   // image, audio, video, share...
  const texto = m.text || '';

  // El doc de la conversación se lee UNA vez y sirve para las dos cosas: darle contexto
  // al modelo y saber sobre qué historial hay que agregar las líneas nuevas.
  const idToken = await tokenDelBot(env);
  const previo = idToken ? await leerDoc(env, idToken, `conversaciones/${senderId}`) : null;
  const historial = Array.isArray(previo && previo.historial) ? previo.historial : [];

  // Pausado en ESTE chat: la charla la lleva Juni a mano. No se llama a la IA —no hay
  // respuesta que redactar y cada llamada se paga— pero el mensaje se guarda igual y
  // sube a la bandeja, que es donde ella lo va a ver.
  const pausado = previo ? previo.botPausado === true : false;

  // EL INTERRUPTOR SE LEE ACA, ANTES DE LA IA, Y ESA ES TODA LA GRACIA.
  //
  // Hasta el 31/08/2026 el `activo` se miraba recien en mandarAutomatico, o sea a la
  // hora de mandar. El bot apagado entonces cortaba la boca pero no el cerebro: por cada
  // DM que entraba se le seguia pagando a Anthropic una respuesta que despues se tiraba.
  // Apagarlo no bajaba el gasto, y de eso uno se entera cuando se le acabaron los
  // creditos. Apagado es apagado: no se llama a la IA.
  const cfg = await configDelBot(env);
  const apagado = !cfg.activo;
  // En prueba solo se atiende a las cuentas autorizadas. Al resto tampoco se lo
  // clasifica: la respuesta no iba a salir igual, y la clasificacion se paga.
  const fueraDePrueba = cfg.modo === 'prueba' && !cfg.cuentasPrueba.includes(String(senderId));

  // La IA lee el mensaje EN CONTEXTO de la charla, lo clasifica y redacta la respuesta
  let ia = { ...SIN_RESPUESTA };
  if (apagado) {
    ia = { ...APAGADO };
    console.log('bot APAGADO desde el sistema — no se llama a la IA, el mensaje va a la bandeja');
  } else if (fueraDePrueba) {
    ia = { ...FUERA_DE_PRUEBA };
    console.log('modo prueba y', senderId, 'no esta autorizada — no se llama a la IA, va a la bandeja');
  } else if (pausado) {
    ia = { ...EN_MANO };
    console.log('bot PAUSADO en el chat de', senderId, '— no contesta, va a la bandeja');
  } else if (env.ANTHROPIC_KEY && (texto || adjuntos.length)) {
    ia = await pensarRespuesta(texto, adjuntos, env, historial);
  } else {
    console.log(env.ANTHROPIC_KEY ? 'mensaje sin texto ni adjuntos' : 'sin ANTHROPIC_KEY: no se llama a la IA');
  }

  // El ida y vuelta se anota ANTES de mandar los DM, no después. Dos razones, las dos
  // aprendidas a los golpes:
  //
  //  - el eco de cada DM que manda el bot vuelve por el webhook un segundo después de
  //    salir. Si sus líneas todavía no están escritas, ese eco parece escrito a mano y la
  //    charla queda con el mensaje repetido;
  //  - y sobre todo: mientras la IA piensa y los DM salen, Juni puede estar contestando a
  //    mano desde Instagram. Esa respuesta entra al historial por su cuenta, y si al
  //    final escribiéramos el historial que leímos al principio, la pisaríamos.
  //
  // Lo que no salga se saca después: es mucho más barato corregir un envío fallado —que
  // es raro— que perder lo que Juni escribió, que no se puede recuperar de ningún lado.
  const nuevas = [linea('cliente', texto || (adjuntos[0] ? `[${adjuntos[0]}]` : ''), fechaMensaje)];
  ia.mensajes.forEach(t => nuevas.push(linea('bot', t, new Date())));
  if (idToken) await anotarEnHistorial(env, idToken, senderId, nuevas);

  // Cada elemento del array sale como un DM aparte, en orden.
  const enviados = await mandarAutomatico(env, senderId, ia.mensajes, { pausado, cfg });

  // Lo que no llegó a salir queda para Juni: sin IG_TOKEN (modo lee y sugiere) no sale
  // ninguno, y si un envío falla se corta ahí. En los dos casos la conversación sube a
  // la bandeja, pero conservando el motivo que puso el modelo si tenía uno: pisar un
  // `pidio_foto` de prioridad 1 con `no_supe_responder` lo mandaría al fondo de la cola.
  const quedoSinMandar = enviados < ia.mensajes.length;

  const doc = {
    igUserId: senderId,
    mensajes: ia.mensajes,
    sugerencia: ia.mensajes.join('\n') || null,   // texto plano, para la bandeja
    resumen: ia.resumen,
    respondido: enviados > 0,
    ultimoMensaje: texto,
    adjuntos,
    tieneImagen: adjuntos.includes('image'),
    tieneAudio: adjuntos.includes('audio'),
    urlsAdjuntos: (m.attachments || []).map(a => a.payload?.url).filter(Boolean),
    fecha: fechaMensaje.toISOString(),
    // El mismo instante que `fecha`, pero como timestamp de verdad: es el campo por el
    // que el cron filtra por rango, y un string ISO no sirve para eso. `fecha` se
    // mantiene porque es lo que ya venían guardando los docs.
    ultimoMensajeCliente: fechaMensaje,
    // El cliente escribió: si vuelve a quedar en silencio, merece un seguimiento nuevo.
    seguimientoEnviado: false,
    estado: ia.categoria || clasificarBasico(texto, adjuntos),
    confianza: ia.confianza,
    necesitaAtencion: ia.necesitaAtencion || quedoSinMandar,
    motivo: quedoSinMandar ? (ia.motivo || 'no_supe_responder') : ia.motivo,
    prioridad: quedoSinMandar ? Math.min(ia.prioridad, 8) : ia.prioridad,
    revisado: false,
    userId: env.OWNER_UID,
  };

  // EL BOT SE CALLA SOLO CUANDO PROMETE ALGO.
  //
  // Si le dijo al cliente "ya te confirmo" o "ahora te mando la foto", eso lo tiene que
  // hacer una persona. Dejar el chat activo hace que el bot conteste el proximo mensaje
  // encima de Juni, que ya esta escribiendo: los dos contestando lo mismo, o peor, cosas
  // distintas.
  //
  // Se pausa el chat, que es exactamente lo que Juni haria a mano con el semaforo. El
  // bot no vuelve a contestar ahi hasta que ella lo despause desde la bandeja.
  if (ia.pasoAHumano && !pausado) {
    doc.botPausado = true;
    // Que se note POR QUE quedo pausado: sin esto aparece en rojo en la bandeja y no se
    // sabe si lo paro ella o el bot.
    doc.motivoPausa = 'el bot prometio algo y te lo dejo a vos';
    console.log('el bot prometio algo — pauso el chat de', senderId);
  }

  // Pausado, el doc guarda el mensaje y poco más: `mensajes` y `sugerencia` sí se
  // limpian (la respuesta vieja ya salió, ofrecerla de nuevo en la bandeja sería
  // mandarla dos veces), pero la clasificación no se toca. Sin la IA solo quedaría
  // `clasificarBasico()`, y una charla que venía como `cerrado` no se merece volver a
  // `curioso` porque el último mensaje fue "dale". Lo que no entra en el PATCH conserva
  // su valor (ver `guardarEnFirestore`).
  if (pausado) {
    delete doc.estado;
    delete doc.confianza;
    delete doc.resumen;
  }

  // Igual que el producto: si no se pudo traer, el campo no entra en la máscara y el
  // doc conserva el que ya tenía.
  const igUsuario = await pedidoUsuario;
  if (igUsuario) doc.igUsuario = igUsuario;

  // El historial ya se escribió arriba. Acá solo se corrige si algo no llegó a salir: el
  // cliente tiene que ver en la charla lo que realmente le llegó, no lo que se pensaba
  // mandar. Si el bot está apagado, en prueba o pausado no sale nada, y las líneas del
  // bot se sacan todas.
  if (idToken && quedoSinMandar) {
    await sacarDelHistorial(env, idToken, senderId, ia.mensajes.slice(enviados));
  }

  // Solo va si el modelo nombró un equipo. Si este mensaje no habla de ninguno el campo
  // no entra en la máscara del PATCH, así que el doc conserva el de la consulta
  // anterior en vez de quedarse sin nada para el seguimiento.
  if (ia.producto) doc.ultimoProducto = nombreLindo(ia.producto);

  await guardarEnFirestore(doc, env);
}

/**
 * El @usuario de Instagram del cliente.
 *
 * El webhook trae solo el id numérico, y un id de 17 dígitos no le dice nada a nadie
 * mirando la bandeja. Si la consulta falla se devuelve null, no se escribe el campo y
 * la pantalla cae al id: es un lujo, no algo por lo que valga la pena perder el mensaje.
 */
async function usuarioDeIG(env, igUserId) {
  if (!env.IG_TOKEN) return null;
  try {
    const r = await fetch(`https://graph.instagram.com/v21.0/${igUserId}?fields=username&access_token=${env.IG_TOKEN}`);
    if (!r.ok) { console.log('no se pudo traer el usuario', r.status); return null; }
    const d = await r.json();
    return d.username || null;
  } catch (e) {
    console.log('no se pudo traer el usuario', e.message);
    return null;
  }
}

// ── Lo que contesta Juni a mano ───────────────────────────────

// Cuántas líneas de las nuestras se miran para reconocer un eco propio. Con 10 alcanza:
// el bot manda como mucho 3 o 4 mensajes por tanda.
const ECOS_A_MIRAR = 10;

/**
 * ¿Este eco es un mensaje que ya mandamos nosotros?
 *
 * El bot se escucha a sí mismo: los DM que manda por la API vuelven como eco, y ya
 * quedaron anotados en el historial al salir. Se los reconoce por el texto contra las
 * últimas líneas de este lado —las del bot y las que ya se anotaron de Juni—, así una
 * respuesta aprobada desde la bandeja tampoco se duplica.
 *
 * Comparación exacta a propósito: dos mensajes distintos con el mismo texto en la misma
 * tanda no existen, y aflojar el criterio se comería una respuesta de verdad.
 */
export function esEcoPropio(historial, texto) {
  const limpio = String(texto || '').trim();
  if (!limpio) return false;
  return (Array.isArray(historial) ? historial : [])
    .filter(h => h && h.de !== 'cliente')
    .slice(-ECOS_A_MIRAR)
    .some(h => String(h.texto || '').trim() === limpio);
}

/**
 * Un mensaje que salió de la cuenta del local, que Meta nos avisa como eco.
 *
 * Puede venir de dos lados y solo uno interesa:
 *  - lo mandó el bot por la API: ya quedó anotado al mandarlo, se descarta;
 *  - lo escribió Juni a mano desde Instagram: ESO es lo que hay que anotar.
 *
 * Sin esto, pausar el bot en un chat lo dejaba ciego. Juni contestaba cuatro mensajes a
 * mano, lo volvía a prender, y el bot retomaba como si esos cuatro no existieran:
 * repitiendo lo ya dicho, o contradiciendo el precio que ella acababa de arreglar. El
 * historial es lo único que el modelo ve de la charla, así que lo que no entra acá, para
 * el bot no pasó.
 *
 * Solo anota sobre conversaciones que YA existen. Si Juni le escribe primero a alguien
 * que nunca mandó un DM, el doc que se crearía no tendría `ultimoMensajeCliente` y
 * quedaría fuera de la consulta del sistema: invisible en la bandeja y sin forma de
 * arreglarlo desde la pantalla.
 */
async function anotarEco(ev, env) {
  const deQuien = ev.sender?.id;
  const cliente = ev.recipient?.id;

  // Una respuesta a mano puede ser una foto sin una palabra. No se puede anotar lo que
  // dice una imagen, pero sí QUE le mandaste una: sin eso, el bot retoma una charla
  // donde vos ya mandaste la foto que el cliente pedía y le vuelve a decir "ahora te
  // mando". Misma convención que el lado del cliente: `[image]`, `[video]`.
  const textoReal = String(ev.message?.text || '').trim();
  const adjunto = ev.message?.attachments?.[0]?.type;
  const texto = textoReal || (adjunto ? `[${adjunto}]` : '');

  // En un eco los roles están al revés —el sender es la cuenta del local y el recipient
  // es el cliente—, así que el filtro por cuenta del webhook no se puede reusar tal cual.
  if (env.IG_ACCOUNT_ID && deQuien !== env.IG_ACCOUNT_ID) {
    console.log('eco: salió de la cuenta', deQuien, '— la nuestra es', env.IG_ACCOUNT_ID);
    return;
  }
  if (!cliente || !texto) { console.log('eco: sin destinatario o sin texto, lo salteo'); return; }

  const idToken = await tokenDelBot(env);
  if (!idToken) { console.log('eco: sin token, no se anota'); return; }

  const previo = await leerDoc(env, idToken, `conversaciones/${cliente}`);
  if (!previo) { console.log('eco: no hay conversación con', cliente, '— no se anota'); return; }

  const historial = Array.isArray(previo.historial) ? previo.historial : [];

  // (`app_id` distinguiría el origen sin ambigüedad, pero Meta no lo manda siempre; se
  // loguea para poder confirmarlo mirando los logs.)
  // El chequeo corre solo si hay TEXTO: el bot nunca manda adjuntos, así que un eco sin
  // texto no puede ser suyo. Y si corriera, dos fotos seguidas darían dos líneas iguales
  // y la segunda se perdería tomada por un duplicado.
  if (ev.message?.app_id) console.log('eco con app_id', ev.message.app_id);
  if (textoReal && esEcoPropio(historial, textoReal)) {
    console.log('eco: es un mensaje que ya mandamos, no se duplica');
    return;
  }

  // Se anota `historial` y NADA más. En particular no se toca `ultimoMensajeCliente`:
  // ese campo es la ventana de 24 h de Meta, y la corre el cliente cuando escribe, no
  // nosotros cuando le contestamos. Moverlo daría 24 h de aire que Meta no dio.
  const ok = await anotarEnHistorial(env, idToken, cliente, [linea('juni', texto, new Date(ev.timestamp || Date.now()))]);
  console.log(ok ? `eco anotado: le contestaste a mano a ${cliente}` : 'eco: no se pudo anotar');
}

/**
 * La ruta completa del doc de una conversación, como la piden `patchDoc` y las queries.
 */
const docConversacion = (env, igUserId) =>
  `projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/conversaciones/${encodeURIComponent(igUserId)}`;

/**
 * Agrega líneas al final del historial de una conversación.
 *
 * RELEE el doc justo antes de escribir, en vez de usar la copia que se leyó al empezar a
 * procesar el mensaje. Entre una cosa y la otra pasan varios segundos —la IA piensa, los
 * DM salen de a uno— y en esos segundos puede entrar otra línea: casi siempre, una
 * respuesta que Juni escribió a mano desde Instagram. Con la copia vieja, esa línea se
 * perdía: la escribía el eco y la pisaba el guardado del webhook un segundo después.
 *
 * Queda una ventana chica: si dos escrituras releen en el mismo instante, la segunda pisa
 * a la primera. Cerrarla del todo pide transacciones en el camino caliente del webhook, y
 * el historial es contexto, no el registro contable.
 *
 * `userId` viaja siempre porque este puede ser el PRIMER write del doc (el primer DM de
 * un cliente nuevo): sin ese campo el doc queda sin dueño y las reglas rechazan el
 * update siguiente entero.
 */
async function anotarEnHistorial(env, idToken, igUserId, lineas) {
  if (!lineas.length) return true;

  const previo = await leerDoc(env, idToken, `conversaciones/${igUserId}`);
  const historial = Array.isArray(previo && previo.historial) ? previo.historial : [];

  // El tercer argumento va en una variable `name`, como en el resto de las llamadas a
  // patchDoc(): asi lo espera el test que compara lo que escribe el bot contra la lista
  // blanca de firestore.rules.
  const name = docConversacion(env, igUserId);
  return patchDoc(env, idToken, name, {
    historial: [...historial, ...lineas].slice(-MAX_HISTORIAL),
    userId: env.OWNER_UID,
  });
}

/**
 * Saca del historial las líneas del bot que no llegaron a salir.
 *
 * Se anota lo que se VA a mandar antes de mandarlo, así que si un envío falla queda
 * anotado algo que el cliente nunca vio. Peor que un hueco: el bot retomaría dando por
 * dicho un precio que no llegó.
 */
async function sacarDelHistorial(env, idToken, igUserId, textos) {
  if (!textos.length) return true;

  const previo = await leerDoc(env, idToken, `conversaciones/${igUserId}`);
  const historial = Array.isArray(previo && previo.historial) ? previo.historial : [];

  console.log('sacando del historial', textos.length, 'mensaje(s) que no salieron');
  const name = docConversacion(env, igUserId);
  return patchDoc(env, idToken, name, {
    historial: sinLasQueNoSalieron(historial, textos),
    userId: env.OWNER_UID,
  });
}

/**
 * El historial sin las líneas del bot que no salieron.
 *
 * Se busca desde el final y una por una: si el bot mandó dos veces el mismo texto en la
 * charla y solo falló el segundo, tiene que quedar el primero.
 */
export function sinLasQueNoSalieron(historial, textos) {
  const pendientes = (textos || []).map(t => String(t || '').trim());
  const salida = [];

  for (let i = (historial || []).length - 1; i >= 0; i--) {
    const l = historial[i];
    const j = l && l.de === 'bot' ? pendientes.indexOf(String(l.texto || '').trim()) : -1;
    if (j !== -1) { pendientes.splice(j, 1); continue; }
    salida.unshift(l);
  }
  return salida;
}

// ── El historial de la conversación ───────────────────────────

// Cuantas lineas se guardan por conversacion. Alcanza de sobra para entender de que se
// venia hablando, y sin tope el doc crece para siempre (Firestore corta en 1 MB).
const MAX_HISTORIAL = 60;

// El doc se lee una vez por mensaje (en procesarMensaje) y de ahi salen el contexto para
// el modelo y la base sobre la que se agregan las lineas nuevas. Eso abre una ventana
// chica: si entran dos DM en el mismo instante, los dos leen el mismo historial y el
// segundo pisa al primero, y se pierde una linea. Es aceptable —el historial es
// contexto, no el registro contable— y a cambio no hay que meter transacciones en el
// camino caliente del webhook.

// Una linea del historial. `de` es 'cliente', 'bot' o 'juni' (lo que contesto ella a
// mano desde Instagram, que entra por `anotarEco`).
const linea = (de, texto, fecha) => ({ de, texto: String(texto || '').slice(0, 1000), fecha });

// Cuantos turnos del historial se le pasan al modelo. No hace falta la charla entera:
// alcanza con lo que se venia hablando, y cada turno se paga en cada mensaje.
const MAX_CONTEXTO = 20;

/**
 * El historial guardado, traducido a los turnos que espera la Messages API.
 *
 * Sin esto el modelo veia UN mensaje suelto y clasificaba a ciegas: "que medios de pago
 * tienen?" le parecia un curioso, cuando dos minutos antes esa persona habia preguntado
 * por un cargador y le habian pasado el precio.
 *
 * Dos reglas de la API que hay que respetar y el historial no garantiza:
 *  - los turnos se alternan, asi que dos seguidos del mismo lado se juntan en uno;
 *  - el primero tiene que ser del cliente, asi que si la charla arranca con algo del bot
 *    (porque el recorte a MAX_CONTEXTO cayo ahi) esas lineas se descartan.
 */
export function turnosParaLaIA(historial, ahora) {
  const previos = (Array.isArray(historial) ? historial : []).slice(-MAX_CONTEXTO);
  const turnos = [];

  for (const h of previos) {
    const texto = h && typeof h.texto === 'string' ? h.texto.trim() : '';
    if (!texto) continue;
    // Todo lo que no escribió el cliente es nuestro: lo del bot y lo que contestó Juni
    // a mano. Los dos van como assistant, y eso es lo que hace que el bot retome una
    // charla pausada sin repetir lo que ella ya dijo ni contradecirla.
    const role = h.de === 'cliente' ? 'user' : 'assistant';
    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += '\n' + texto;
    else turnos.push({ role, content: texto });
  }

  while (turnos.length && turnos[0].role === 'assistant') turnos.shift();

  // El mensaje de ahora siempre cierra, del lado del cliente.
  const ultimo = turnos[turnos.length - 1];
  if (ultimo && ultimo.role === 'user') ultimo.content += '\n' + ahora;
  else turnos.push({ role: 'user', content: ahora });

  return turnos;
}

// ── El nombre de un producto, escrito como se escribe ─────────

/**
 * `ultimoProducto` sale del JSON del modelo y se guarda tal cual. Los docs que ya
 * existen —y cualquier descuido nuevo— lo tienen en minúscula, y el seguimiento del cron
 * lo mete adentro de un mensaje que le llega al cliente: "che seguis interesado en el
 * macbook pro 14 m5 pro?". El prompt ya pide el nombre bien escrito, pero eso no arregla
 * lo guardado ni cubre el día que el modelo se distraiga; esto sí, y es barato.
 *
 * No es un corrector general: solo las marcas y los apellidos de modelo que vende el
 * local. Lo que no reconoce lo deja como está.
 */
const NOMBRES_PROPIOS = [
  [/\bairpods\b/gi, 'AirPods'],   [/\biphone\b/gi, 'iPhone'],  [/\bipad\b/gi, 'iPad'],
  [/\bipod\b/gi, 'iPod'],         [/\bimac\b/gi, 'iMac'],      [/\bmacbook\b/gi, 'MacBook'],
  [/\bmac\b/gi, 'Mac'],           [/\bairtag\b/gi, 'AirTag'],  [/\bapple\b/gi, 'Apple'],
  [/\bwatch\b/gi, 'Watch'],       [/\bsamsung\b/gi, 'Samsung'], [/\bgalaxy\b/gi, 'Galaxy'],
  [/\bxiaomi\b/gi, 'Xiaomi'],     [/\bredmi\b/gi, 'Redmi'],    [/\bmotorola\b/gi, 'Motorola'],
  [/\bpro\b/gi, 'Pro'],           [/\bmax\b/gi, 'Max'],        [/\bplus\b/gi, 'Plus'],
  [/\bmini\b/gi, 'Mini'],         [/\bair\b/gi, 'Air'],        [/\bultra\b/gi, 'Ultra'],
  [/\bse\b/gi, 'SE'],             [/\banc\b/gi, 'ANC'],        [/\busb\s*-?\s*c\b/gi, 'USB-C'],
  [/\b(\d+)\s*gb\b/gi, '$1GB'],  [/\b(\d+)\s*tb\b/gi, '$1TB'], [/\bm(\d)\b/gi, 'M$1'],
  // Los Galaxy: s24, s23 ultra. Dos digitos para no tocar un "s" suelto de otra cosa.
  [/\bs(\d{2})\b/gi, 'S$1'],
];

/**
 * El mensaje del seguimiento: "te sigue interesando el iPhone 15?".
 *
 * El texto de antes era "che seguís interesado en el X?" y tenía dos problemas. El "che"
 * adelante, y sobre todo **interesado**, que le pone género a alguien de quien lo único
 * que sabemos es el usuario de Instagram. "te sigue interesando" no lleva género: la
 * misma frase sirve para cualquiera.
 *
 * Lo único que hay que resolver es el artículo. Los productos en plural —AirPods,
 * auriculares, fundas— piden "los" y el verbo en plural, o sale "el AirPods 4". Se
 * decide por la primera palabra del nombre, que es la del producto: si termina en s, es
 * plural. "AirPods 4" sí, "MacBook Pro 14" no.
 */
export function textoSeguimiento(producto) {
  const nombre = nombreLindo(producto);
  if (!nombre) return 'te sigue interesando el producto?';

  return /s$/i.test(nombre.split(/\s+/)[0])
    ? `te siguen interesando los ${nombre}?`
    : `te sigue interesando el ${nombre}?`;
}

export function nombreLindo(producto) {
  let txt = String(producto || '').trim();
  if (!txt) return txt;
  for (const [busca, pone] of NOMBRES_PROPIOS) txt = txt.replace(busca, pone);
  return txt;
}

// ── El interruptor ────────────────────────────────────────────

/**
 * Como esta configurado el bot, desde el sistema (doc `config/bot`).
 *
 *   activo: false        -> no manda NADA solo
 *   modo: 'prueba'       -> solo le contesta a las cuentas de cuentasPrueba
 *   modo: 'todos'        -> le contesta a cualquiera
 *
 * Si el doc no existe o no se puede leer, queda encendido y para todos: es el estado
 * inicial de cualquier instalacion, y `leerDoc` devuelve null en los dos casos, asi que
 * no se pueden distinguir. El respaldo duro sigue siendo sacar IG_TOKEN del panel.
 */
async function configDelBot(env) {
  const porDefecto = { activo: true, modo: 'todos', cuentasPrueba: [] };

  const idToken = await tokenDelBot(env);
  if (!idToken) return porDefecto;   // sin token no va a poder mandar nada igual

  const cfg = await leerDoc(env, idToken, 'config/bot');
  if (!cfg) return porDefecto;
  return {
    activo: cfg.activo !== false,
    modo: cfg.modo === 'prueba' ? 'prueba' : 'todos',
    cuentasPrueba: Array.isArray(cfg.cuentasPrueba) ? cfg.cuentasPrueba.map(String) : [],
  };
}

// ── Mandar los DM ─────────────────────────────────────────────

// Pausa entre mensaje y mensaje: si salen los tres en el mismo instante se lee como
// un volcado de bot, y además Instagram a veces los entrega desordenados.
const PAUSA_ENTRE_DM = 1200;
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function mandarDM(env, igUserId, texto) {
  try {
    const r = await fetch(
      `https://graph.instagram.com/v21.0/me/messages?access_token=${env.IG_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: igUserId }, message: { text: texto } }),
      },
    );
    if (!r.ok) { console.log('envio fallo', igUserId, r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) {
    console.log('envio fallo', igUserId, e.message);
    return false;
  }
}

/**
 * Manda los mensajes en orden y devuelve cuántos salieron.
 *
 * Si uno falla corta ahí: mandar el tercero cuando el segundo no llegó deja una
 * conversación sin sentido del lado del cliente.
 *
 * Sin IG_TOKEN no manda nada y devuelve 0 — es el modo "lee y sugiere": el bot
 * clasifica y llena la bandeja, pero no le escribe a nadie.
 */
async function mandarMensajes(env, igUserId, mensajes) {
  if (!mensajes.length) return 0;
  if (!env.IG_TOKEN) { console.log('sin IG_TOKEN: no se manda nada (modo lee y sugiere)'); return 0; }

  let enviados = 0;
  for (const texto of mensajes) {
    if (enviados > 0) await dormir(PAUSA_ENTRE_DM);
    if (!await mandarDM(env, igUserId, texto)) break;
    enviados++;
  }
  console.log('enviados', enviados, 'de', mensajes.length);
  return enviados;
}


// ── Respuestas aprobadas desde la bandeja ─────────────────────

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/**
 * Manda los mensajes que el dueño aprobó desde la bandeja del sistema.
 *
 * El Worker no decide nada acá: el texto viene ya editado y aprobado, y lo único que
 * aporta es el IG_TOKEN, que no puede vivir en el navegador. Tampoco toca Firestore —
 * el doc lo actualiza el sistema, que es el que sabe quién aprobó.
 */
async function responder(request, env) {
  const uid = await uidDelToken(request.headers.get('X-Firebase-Token'), env);
  if (!uid || uid !== env.OWNER_UID) return json({ error: 'no autorizado' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'json invalido' }, 400); }

  const igUserId = String(body.igUserId || '').trim();
  const mensajes = (Array.isArray(body.mensajes) ? body.mensajes : [])
    .map(m => String(m ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_MENSAJES);

  if (!igUserId || !mensajes.length) return json({ error: 'falta igUserId o mensajes' }, 400);
  if (!env.IG_TOKEN) return json({ error: 'el Worker no tiene IG_TOKEN cargado' }, 503);

  const enviados = await mandarMensajes(env, igUserId, mensajes);

  // Si salieron algunos y otros no, el 502 hace que el sistema deje la conversación en
  // la bandeja: es peor darla por contestada cuando el cliente vio media respuesta.
  return json({ enviados, total: mensajes.length }, enviados === mensajes.length ? 200 : 502);
}

/**
 * El uid del dueño de un ID token de Firebase, o null si no vale.
 *
 * Se valida contra Google en vez de leerle el payload al JWT: así un token vencido, de
 * otro proyecto o directamente inventado lo rechaza Firebase y no nuestra lectura.
 */
async function uidDelToken(idToken, env) {
  if (!idToken) return null;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!r.ok) { console.log('token rechazado', r.status); return null; }
    const d = await r.json();
    return d.users?.[0]?.localId || null;
  } catch (e) {
    console.log('no se pudo validar el token', e.message);
    return null;
  }
}

/**
 * Retomar una conversacion que estuvo pausada.
 *
 * Mientras el bot estuvo pausado en ese chat, Juni contesto a mano desde Instagram y
 * esas respuestas quedaron anotadas en el historial (ver `anotarEco`). Al prenderlo
 * puede haber quedado un mensaje del cliente sin contestar; esto le pasa al modelo la
 * charla COMPLETA —lo de ella incluido— y lo deja contestar ese ultimo mensaje.
 *
 * Sin esto, prender el bot no hacia nada hasta que el cliente volviera a escribir, y el
 * que estaba esperando una respuesta se quedaba esperando.
 */
async function reanudar(request, env) {
  const uid = await uidDelToken(request.headers.get('X-Firebase-Token'), env);
  if (!uid || uid !== env.OWNER_UID) return json({ error: 'no autorizado' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'json invalido' }, 400); }

  const igUserId = String(body.igUserId || '').trim();
  if (!igUserId) return json({ error: 'falta igUserId' }, 400);

  const idToken = await tokenDelBot(env);
  if (!idToken) return json({ error: 'el Worker no se pudo loguear a Firebase' }, 503);

  const previo = await leerDoc(env, idToken, `conversaciones/${igUserId}`);
  if (!previo) return json({ error: 'no hay conversacion con esa cuenta' }, 404);

  // El sistema despausa ANTES de llamar acá. Si sigue pausado es que esa escritura no
  // llego, y contestar igual seria exactamente lo que la pausa quiere evitar.
  if (previo.botPausado === true) return json({ error: 'el chat sigue pausado' }, 409);

  const historial = Array.isArray(previo.historial) ? previo.historial : [];
  const ultima = historial[historial.length - 1];

  // Si la ultima palabra es nuestra no quedo nada colgado. Meter un mensaje ahi es
  // hablar porque si, que es justo lo que el prompt le prohibe en CUANDO NO CONTESTAR.
  if (!ultima || ultima.de !== 'cliente') return json({ pendiente: false, enviados: 0, total: 0 });

  // La ventana de Meta vale igual que en el cron: esto lo redacta el bot, no Juni.
  const desde = Date.parse(previo.ultimoMensajeCliente);
  if (!desde || Date.now() - desde >= VENTANA_META) return json({ error: 'pasaron las 24 h', vencida: true }, 409);

  // Con el bot apagado no hay nada que redactar: mandarAutomatico no lo iba a mandar, y
  // la llamada a la IA se pagaba igual. Es el mismo agujero que tenia el webhook.
  const cfg = await configDelBot(env);
  if (!cfg.activo) {
    return json({ error: 'el bot esta apagado desde el sistema: prendelo antes de retomar el chat' }, 409);
  }

  // El ultimo mensaje del cliente va como "el mensaje de ahora"; todo lo anterior, de
  // contexto. Es el mismo reparto que hace el webhook.
  const ia = await pensarRespuesta(String(ultima.texto || ''), [], env, historial.slice(0, -1));
  const enviados = await mandarAutomatico(env, igUserId, ia.mensajes, { cfg });
  const quedoSinMandar = enviados < ia.mensajes.length;

  const doc = {
    mensajes: ia.mensajes,
    sugerencia: ia.mensajes.join('\n') || null,
    respondido: enviados > 0,
    necesitaAtencion: ia.necesitaAtencion || quedoSinMandar,
    motivo: quedoSinMandar ? (ia.motivo || 'no_supe_responder') : ia.motivo,
    prioridad: quedoSinMandar ? Math.min(ia.prioridad, 8) : ia.prioridad,
    historial: [...historial, ...ia.mensajes.slice(0, enviados).map(txt => linea('bot', txt, new Date()))].slice(-MAX_HISTORIAL),
  };

  // Lo que el modelo no nombro no se pisa: la conversacion ya venia clasificada de antes
  // y un campo en null la sacaria de su pestaña del tablero.
  if (ia.categoria) doc.estado = ia.categoria;
  if (ia.confianza) doc.confianza = ia.confianza;
  if (ia.resumen)   doc.resumen = ia.resumen;
  if (ia.producto)  doc.ultimoProducto = nombreLindo(ia.producto);

  const name = `projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/conversaciones/${encodeURIComponent(igUserId)}`;
  await patchDoc(env, idToken, name, doc);

  return json({ pendiente: true, enviados, total: ia.mensajes.length },
               enviados === ia.mensajes.length ? 200 : 502);
}

/**
 * TODO mensaje que el bot manda por su cuenta pasa por aca. Los dos caminos automaticos
 * —la respuesta del webhook y el seguimiento del cron— llaman a esta funcion y a
 * ninguna otra; `mandarMensajes()` queda para lo que manda el dueño desde la bandeja,
 * que el interruptor no toca a proposito.
 *
 * (Antes el chequeo vivia adentro de mandarMensajes y el cron se lo salteaba, porque
 * llamaba a mandarDM directo. Andaba de casualidad, por un corte aparte en el cron.)
 *
 * `opciones.pausado` es el interruptor de UN chat, el del semaforo de cada fila de la
 * bandeja. Viene de afuera y no se lee acá a proposito: los dos que llaman ya tienen el
 * doc de la conversacion en la mano, y volver a leerlo seria una lectura de Firestore de
 * mas en el camino caliente del webhook.
 */
async function mandarAutomatico(env, igUserId, mensajes, opciones = {}) {
  if (opciones.pausado) { console.log('chat pausado:', igUserId, '— no se manda nada'); return 0; }

  // El que ya leyo la config la pasa y se ahorra una lectura de Firestore en el camino
  // caliente del webhook. El chequeo se hace igual: es el ultimo cierre antes de que
  // salga un DM, y no depende de que el llamador se haya acordado.
  const cfg = opciones.cfg || await configDelBot(env);

  if (!cfg.activo) { console.log('bot APAGADO desde el sistema: no se manda nada'); return 0; }

  // En prueba el bot solo le habla a las cuentas autorizadas. Al resto lo sigue
  // clasificando y guardando: caen en la bandeja como cualquier mensaje sin contestar.
  if (cfg.modo === 'prueba' && !cfg.cuentasPrueba.includes(String(igUserId))) {
    console.log('modo prueba: no se le contesta a', igUserId, '— autorizadas:', cfg.cuentasPrueba.join(', ') || '(ninguna)');
    return 0;
  }

  return mandarMensajes(env, igUserId, mensajes);
}

/**
 * Los accesorios: cargadores, fundas, vidrios, cables. Viven en `inventario`, aparte de
 * `stock`, que son los equipos con IMEI.
 *
 * Hasta el 23/08/2026 el bot ni siquiera podia leer esta coleccion, asi que contestaba
 * "cargadores originales no tengo" con los cargadores cargados en el sistema.
 *
 * Solo lo que tiene unidades, y NUNCA el costo: igual que en stock, de aca sale el
 * precio de venta y nada mas.
 */
async function accesoriosDisponibles(env, idToken) {
  const proj = env.FIREBASE_PROJECT;
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents:runQuery`;

  const q = {
    structuredQuery: {
      from: [{ collectionId: 'inventario' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: env.OWNER_UID } } },
            { fieldFilter: { field: { fieldPath: 'qty' }, op: 'GREATER_THAN', value: { integerValue: '0' } } },
          ],
        },
      },
      // Sin orderBy explicito: con un filtro de rango, Firestore ordena solo por ese
      // campo y le alcanza el indice (userId + qty) que ya existe. Pedir qty DESC
      // exigia un indice con esa direccion — que es lo que faltaba y hacia que el bot
      // dijera "no tengo cables" con los cables cargados (23/08/2026).
      //
      // El limite es alto a proposito: asi el orden no decide que se pierde. Un local
      // no tiene 200 accesorios distintos con stock.
      limit: 200,
    },
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(q),
    });
    if (!r.ok) { console.log('accesorios no disponibles', r.status, (await r.text()).slice(0, 300)); return []; }

    const d = await r.json();
    return (Array.isArray(d) ? d : [])
      .filter(x => x.document)
      .map(x => {
        const f = campos(x.document.fields);
        return {
          producto: f.nombre,
          categoria: f.categoria || null,
          // `sugerido` es el precio de venta al publico. En 0 significa sin cargar: va
          // null para que el modelo no lo lea como "sale cero".
          precio: Number(f.sugerido) > 0 ? Number(f.sugerido) : null,
          moneda: f.moneda || 'USD',
        };
      })
      .filter(a => a.producto);
  } catch (e) {
    console.log('error trayendo accesorios', e.message);
    return [];
  }
}

// ── Traer los equipos disponibles para que la IA sepa qué hay ─
//
// Son DOS colecciones y las dos se venden igual en el mostrador:
//
//   stock   equipos propios del local
//   consig  equipos en consignación, de un proveedor
//
// Para el cliente no hay ninguna diferencia —es un celular que está en el local, a un
// precio— así que van juntos en el mismo bloque. Hasta el 23/08/2026 el bot solo veía
// `stock`: la mitad de los equipos que el local tenía para vender no existían para él.
//
// De los dos se sacan solo campos de venta: nombre, gb, color, batería, ciclos, condición
// (nuevo o usado) y PRECIO
// DE VENTA. Nunca el costo, ni el proveedor de la consignación — no queremos que la IA
// los mencione ni por error.

/**
 * Los equipos de las dos colecciones, en una sola lista.
 */
async function equiposDisponibles(env, idToken) {
  const [propios, consignados] = await Promise.all([
    stockDisponible(env, idToken),
    consigDisponible(env, idToken),
  ]);
  return [...propios, ...consignados];
}

async function stockDisponible(env, idToken) {
  const proj = env.FIREBASE_PROJECT;
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents:runQuery`;

  const q = {
    structuredQuery: {
      from: [{ collectionId: 'stock' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: env.OWNER_UID } } },
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'en_stock' } } },
          ],
        },
      },
      limit: 60,
    },
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(q),
    });
    if (!r.ok) { console.log('stock no disponible', r.status, (await r.text()).slice(0, 300)); return []; }

    const d = await r.json();
    return (d || [])
      .filter(x => x.document)
      .map(x => {
        const f = x.document.fields || {};
        const v = k => f[k]?.stringValue ?? f[k]?.doubleValue ?? f[k]?.integerValue ?? null;
        return {
          equipo: v('nombre'),
          gb: v('gb'),
          color: v('color'),
          bateria: v('bateria'),
          ciclos: v('ciclos'),
          // Nuevo sellado o usado. Sin esto el modelo lo deducía —mal— de la batería.
          condicion: v('estadoProducto'),
          precio: v('precioVentaUSD'),   // precio de venta, NUNCA el costo
          // No es un campo para el modelo: se usa acá abajo y se saca antes de pasarlo.
          refurb: f.refurb?.booleanValue === true,
        };
      })
      // En refurbishment = está en el taller, no se puede vender hoy. Se filtra acá y no
      // en la consulta porque un `refurb != true` de Firestore deja afuera también a los
      // documentos que no tienen el campo, que son casi todos. Es el mismo criterio con
      // el que el sistema arma la lista de precios que se le pasa a un cliente.
      .filter(x => x.equipo && !x.refurb)
      .map(({ refurb, ...equipo }) => equipo);
  } catch (e) {
    console.log('error trayendo stock', e.message);
    return [];
  }
}

/**
 * Los equipos en consignación disponibles.
 *
 * Misma forma que `stockDisponible`, con dos diferencias del doc: el nombre está en
 * `producto` (no en `nombre`) y el precio de venta puede estar en `precioVentaUSD` o en
 * `precioUSD`, según cómo se cargó. El mismo criterio que usa el sistema para armar la
 * lista de precios que se le manda a un cliente.
 *
 * El proveedor NO se pasa: es información nuestra, no del cliente.
 */
async function consigDisponible(env, idToken) {
  const proj = env.FIREBASE_PROJECT;
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents:runQuery`;

  const q = {
    structuredQuery: {
      from: [{ collectionId: 'consig' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: env.OWNER_UID } } },
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'en_stock' } } },
          ],
        },
      },
      limit: 60,
    },
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(q),
    });
    if (!r.ok) { console.log('consignacion no disponible', r.status, (await r.text()).slice(0, 300)); return []; }

    const d = await r.json();
    return (d || [])
      .filter(x => x.document)
      .map(x => {
        const f = x.document.fields || {};
        const v = k => f[k]?.stringValue ?? f[k]?.doubleValue ?? f[k]?.integerValue ?? null;
        return {
          equipo: v('producto'),
          gb: v('gb'),
          color: v('color'),
          bateria: v('bateria'),
          ciclos: v('ciclos'),
          condicion: v('estadoProducto'),
          precio: v('precioVentaUSD') ?? v('precioUSD'),
        };
      })
      .filter(x => x.equipo);
  } catch (e) {
    console.log('error trayendo consignacion', e.message);
    return [];
  }
}

// ── Leer documentos y colecciones de Firestore (REST) ─────────

// Los valores de la REST API vienen envueltos por tipo ({stringValue: "x"}).
// Esto los desenvuelve, incluyendo arrays y mapas anidados (los items de las listas).
function valor(v) {
  if (v == null) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('nullValue'    in v) return null;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(valor);
  if ('mapValue'     in v) return campos(v.mapValue.fields);
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
function campos(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) o[k] = valor(v);
  return o;
}

async function leerDoc(env, idToken, path) {
  const proj = env.FIREBASE_PROJECT;
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/${path}`;
  try {
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
    if (!r.ok) { console.log('no se pudo leer', path, r.status); return null; }
    const d = await r.json();
    return campos(d.fields);
  } catch (e) {
    console.log('error leyendo', path, e.message);
    return null;
  }
}

/**
 * La lista vigente de un origen: la más reciente. Igual criterio que el sistema, así el
 * bot cotiza con lo mismo que ve el dueño en pantalla.
 *
 * "Más reciente" es (`fecha`, `createdAt`), no solo `fecha`, y el detalle importa: cada
 * vez que se agregan productos desde el sistema se guarda un doc NUEVO con la lista
 * completa y la fecha del día, así que un día cualquiera hay VARIOS docs con la misma
 * fecha. Ordenando solo por fecha, cuál de todos gana lo termina decidiendo el id del
 * documento: le puede tocar el de la mañana y quedarse sin lo que se cargó a la tarde.
 *
 * Pasó el 23/08/2026: se cargaron AirPods en la lista de Mar del Plata, el sistema los
 * mostraba en pantalla, y el bot le contestaba a un cliente "airpods no tengo en este
 * momento" — estaba leyendo otro doc del mismo día. El sistema ya desempataba por
 * `createdAt` (ver `kbUltimaLista`); el Worker se había quedado atrás.
 *
 * Si la consulta ordenada falla o no devuelve nada, cae a la de antes. Los docs
 * anteriores a que existiera `createdAt` no tienen ese campo, y Firestore deja afuera de
 * una consulta ordenada todo doc al que le falte el campo del orden: sin ese respaldo,
 * una lista vieja dejaría al bot sin precios en vez de darle los de ayer. Vale lo mismo
 * para el rato en que el índice nuevo se está construyendo.
 */
async function ultimaLista(env, idToken, origen) {
  const proj = env.FIREBASE_PROJECT;
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents:runQuery`;

  const consulta = orderBy => ({
    structuredQuery: {
      from: [{ collectionId: 'listas_precios' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: env.OWNER_UID } } },
            { fieldFilter: { field: { fieldPath: 'origen' }, op: 'EQUAL', value: { stringValue: origen } } },
          ],
        },
      },
      orderBy,
      limit: 1,
    },
  });

  const porFecha    = [{ field: { fieldPath: 'fecha' }, direction: 'DESCENDING' }];
  const porCreacion = [...porFecha, { field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }];

  const traer = async (orderBy, cual) => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify(consulta(orderBy)),
      });
      // Firestore manda el link para crear el indice que falta adentro del cuerpo, asi
      // que sin el texto un 400 no se distingue de una query mal armada.
      if (!r.ok) { console.log('lista', origen, cual, 'no disponible', r.status, (await r.text()).slice(0, 300)); return null; }
      const d = await r.json();
      const doc = (d || []).find(x => x.document);
      return doc ? campos(doc.document.fields) : null;
    } catch (e) {
      console.log('error trayendo lista', origen, cual, e.message);
      return null;
    }
  };

  const lista = await traer(porCreacion, '(fecha + createdAt)');
  if (lista) return lista;

  console.log('lista', origen, ': sin resultado por createdAt, voy con el orden viejo');
  return traer(porFecha, '(solo fecha)');
}

/**
 * La fecha de un instante segun el reloj argentino.
 *
 * Antes esto era `new Date().toISOString()`, o sea la fecha UTC. Despues de las 21:00 de
 * Argentina eso ya es el dia siguiente, asi que una lista cargada esa misma tarde quedaba
 * marcada como vieja y el prompt le hacia decir al bot que los precios podian haber
 * cambiado, todas las noches. El sistema guarda `fecha` con la fecha LOCAL (today() en
 * index.html), asi que hay que compararla contra la misma.
 */
export const fechaAR = ms => new Date(ms + AR).toISOString().split('T')[0];

// ── La IA: clasifica y redacta una respuesta ──────────────────

// Lo que devolvemos cuando la IA no contestó o contestó algo que no se pudo parsear.
// El mensaje del cliente NO se descarta: la conversación se guarda igual y sube a la
// bandeja con prioridad 8 para que la conteste Juni a mano.
const SIN_RESPUESTA = {
  categoria: null,
  confianza: 'baja',
  necesitaAtencion: true,
  motivo: 'no_supe_responder',
  prioridad: 8,
  resumen: null,
  producto: null,
  mensajes: [],
};

// Lo que se guarda cuando el bot está pausado en ese chat. No es una falla: nadie se
// equivocó, la conversación la está llevando Juni. Por eso motivo propio y no
// `no_supe_responder`, que la mandaría al fondo de la cola con prioridad 8.
// Lo que se guarda cuando el bot esta APAGADO desde el sistema. Igual que `EN_MANO`, con
// su propio motivo: el mensaje entra, se guarda y sube a la bandeja, pero nadie lo
// clasifico porque no se llamo a la IA.
const APAGADO = {
  categoria: null,
  confianza: null,
  necesitaAtencion: true,
  motivo: 'bot_apagado',
  prioridad: 2,
  resumen: null,
  producto: null,
  mensajes: [],
};

// Modo prueba y este no es de los autorizados. Igual que `APAGADO`: entra, se guarda y
// sube a la bandeja, pero sin clasificar. Antes se lo clasificaba igual —era a
// proposito, para no perder de vista lo que entraba mientras se afinaba el bot— pero
// cada mensaje de un desconocido se pagaba, y en modo prueba son casi todos.
const FUERA_DE_PRUEBA = {
  categoria: null,
  confianza: null,
  necesitaAtencion: true,
  motivo: 'modo_prueba',
  prioridad: 2,
  resumen: null,
  producto: null,
  mensajes: [],
};

const EN_MANO = {
  categoria: null,
  confianza: null,
  necesitaAtencion: true,
  motivo: 'en_mano',
  prioridad: 2,
  resumen: null,
  producto: null,
  mensajes: [],
};

async function pensarRespuesta(texto, adjuntos, env, historial) {
  const idToken = await tokenDelBot(env);
  if (!idToken) return { ...SIN_RESPUESTA };

  // Todo lo que el prompt necesita, en paralelo: sin esto el modelo no sabe qué hay
  // ni a qué precio, y las secciones de stock y listas del prompt quedan vacías.
  const [stock, accesorios, conocimiento, listaMdp, listaCaba, listaProv, mensajesFijos, promptDoc] = await Promise.all([
    equiposDisponibles(env, idToken),
    accesoriosDisponibles(env, idToken),
    leerDoc(env, idToken, `conocimiento/${env.OWNER_UID}`),
    ultimaLista(env, idToken, 'mdp'),
    ultimaLista(env, idToken, 'caba'),
    ultimaLista(env, idToken, 'prov'),
    leerDoc(env, idToken, 'config/mensajes'),
    leerDoc(env, idToken, 'config/prompt'),
  ]);

  // La lista de MDP es la del día: si es de una fecha anterior, el prompt se lo avisa
  // al modelo para que no prometa un precio viejo como si fuera el de hoy.
  const mdpVencida = !!(listaMdp && listaMdp.fecha !== fechaAR(Date.now()));

  // Las reglas del bot: las que el dueño escribió desde el sistema si las hay, y si no
  // las del archivo prompt.js. Se lee en cada mensaje a propósito: cambiar una regla
  // tiene que ser guardar en el sistema, sin deploy de por medio.
  const sistema = construirSystem({ base: promptDoc?.texto, conocimiento, stock, accesorios, listaMdp, listaCaba, listaProv, mdpVencida });
  console.log('prompt:', promptDoc?.texto ? 'editado desde el sistema' : 'el de prompt.js');
  const textoCanal = mensajesFijos?.invitacionCanal || null;

  const usuario = texto
    ? texto
    : `(el cliente mandó ${adjuntos.join(' y ')} sin texto)`;

  try {
    // Cloudflare no permite que un Worker llame a otro en workers.dev (error 1042),
    // así que se llama directo a la API de Anthropic.
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Sonnet 5 piensa por defecto y ese pensamiento se descuenta de max_tokens, asi
        // que hay que dejar aire: si se corta a la mitad, el JSON queda truncado y
        // volvemos al problema que estamos arreglando. Solo se paga lo que genera.
        max_tokens: 4000,
        system: sistema,
        messages: turnosParaLaIA(historial, usuario),
        output_config: {
          // La API devuelve JSON valido si o si. Sonnet 4.6 no soportaba esto: por eso
          // el cambio de modelo (mismo precio de lista, y mas nuevo).
          format: { type: 'json_schema', schema: ESQUEMA_RESPUESTA },
          // Contestar un DM no necesita que piense de mas: encarece cada mensaje y hace
          // esperar al cliente. Si se lo nota flojo en las situaciones dificiles, esto
          // es lo primero a subir.
          effort: 'medium',
        },
      }),
    });

    if (!r.ok) {
      const cuerpo = await r.text();
      console.log('IA error', r.status, cuerpo.slice(0, 300));
      // El resumen es lo unico de esto que se ve desde la bandeja. Sin el, un problema
      // de la API (sin credito, rate limit, servicio caido) se lee igual que "el modelo
      // dudo", y son cosas muy distintas: una se arregla contestando a mano, la otra
      // deja al bot mudo con TODOS hasta que alguien vaya a mirar los logs.
      return { ...SIN_RESPUESTA, resumen: `⚠️ ${motivoDeLaFalla(r.status, cuerpo)} — el bot no pudo contestar` };
    }

    const d = await r.json();

    // Sin esto no hay forma de saber si el cache del prompt esta sirviendo. Con `cache
    // leido` alto, pego y el mensaje sale a una decima parte; con `cache escrito` en
    // todos los mensajes y `leido` siempre en cero, algo del bloque fijo esta cambiando
    // entre llamadas y estamos pagando MAS que sin cache, en silencio.
    const u = d.usage || {};
    console.log(`tokens: entrada ${u.input_tokens ?? '?'} · cache leido ${u.cache_read_input_tokens ?? 0}` +
                ` · cache escrito ${u.cache_creation_input_tokens ?? 0} · salida ${u.output_tokens ?? '?'}`);

    // Con el esquema puesto, lo unico que puede volver mal formado es una respuesta
    // cortada por max_tokens o un rechazo del modelo. Las dos se ven en stop_reason y
    // no en el texto, asi que sin esto se diagnostican a ciegas.
    if (d.stop_reason === 'max_tokens' || d.stop_reason === 'refusal') {
      console.log('IA stop_reason:', d.stop_reason, JSON.stringify(d.stop_details || {}));
    }

    const crudo = (d.content?.map(x => x.text || '').join('') || d.text || '').trim();
    const out = JSON.parse(limpiarJson(crudo));
    const r2 = normalizar(out, textoCanal);

    console.log('IA ->', r2.categoria, '| prioridad', r2.prioridad, '|', r2.mensajes.length, 'mensaje(s)');
    return r2;
  } catch (e) {
    // Puede ser un JSON cortado, un texto suelto o un campo que no vino. Da igual:
    // el mensaje sube a la bandeja en vez de perderse.
    console.log('IA fallo:', e.message);
    return { ...SIN_RESPUESTA };
  }
}

/**
 * Traduce el error de la API a algo accionable para el que mira la bandeja.
 *
 * Interesa la diferencia entre "hay que poner plata", "hay que esperar" y "hay que
 * revisar", que son tres acciones distintas y ninguna es contestar el mensaje a mano.
 */
export function motivoDeLaFalla(status, cuerpo) {
  const txt = String(cuerpo || '');
  if (/credit balance is too low/i.test(txt)) return 'SIN CRÉDITO en la API de Anthropic: cargá saldo en console.anthropic.com';
  if (status === 401 || status === 403)       return 'La API de Anthropic rechazó la credencial (ANTHROPIC_KEY)';
  if (status === 429)                         return 'La API de Anthropic pidió esperar (demasiados mensajes juntos)';
  if (status >= 500)                          return `La API de Anthropic falló (${status})`;
  return `La API de Anthropic devolvió ${status}`;
}

/**
 * Deja el texto crudo listo para JSON.parse().
 *
 * El prompt pide JSON pelado, pero igual conviene sacar los backticks por las dudas y
 * quedarse con lo que hay entre la primera llave y la última: a veces se cuela una
 * línea de texto antes o después.
 */
export function limpiarJson(crudo) {
  const sinFences = crudo.replace(/```(?:json)?/gi, '').trim();
  const a = sinFences.indexOf('{');
  const b = sinFences.lastIndexOf('}');
  return (a !== -1 && b > a) ? sinFences.slice(a, b + 1) : sinFences;
}

/**
 * El esquema de la respuesta, para structured outputs.
 *
 * Con esto la API GARANTIZA que lo que vuelve es JSON valido con esta forma. Antes se le
 * pedia por prompt y a veces contestaba en prosa: la respuesta se tiraba entera y el
 * cliente quedaba sin contestar aunque el modelo supiera perfectamente que decirle
 * ("las Air 13..." — tenia los precios y se perdio).
 *
 * `normalizar()` sigue validando igual: el esquema garantiza la FORMA, no que la
 * categoria o el motivo esten dentro de lo que el negocio espera.
 */
const ESQUEMA_RESPUESTA = {
  type: 'object',
  properties: {
    categoria:         { type: 'string' },
    confianza:         { type: 'string' },
    necesita_atencion: { type: 'boolean' },
    motivo:            { type: ['string', 'null'] },
    prioridad:         { type: 'integer' },
    // El bot le prometio al cliente algo para despues ("ya te confirmo"). Cuando viene
    // en true, el chat se pausa y lo sigue Juni: ver `PROMESAS` mas abajo.
    paso_a_humano:     { type: 'boolean' },
    resumen:           { type: 'string' },
    producto:          { type: ['string', 'null'] },
    mensajes:          { type: 'array', items: { type: 'string' } },
  },
  required: ['categoria', 'confianza', 'necesita_atencion', 'motivo', 'prioridad', 'paso_a_humano', 'resumen', 'producto', 'mensajes'],
  additionalProperties: false,
};

const MOTIVOS = ['averiguar', 'pidio_foto', 'cerrado', 'reclamo', 'permuta', 'reparacion', 'otro_medio_de_pago', 'visto', 'no_supe_responder'];

/**
 * Frases con las que el bot promete algo para despues. Es la red por si el modelo se
 * olvida de marcar `paso_a_humano`: la promesa la ve el cliente igual, y un bot que dice
 * "ya te confirmo" y sigue contestando encima de Juni es peor que uno que se calla de
 * mas. Ante la duda, se calla.
 */
const PROMESAS = new RegExp([
  // "ya te digo", "ahora te confirmo", "en un rato te aviso"
  '\\b(ya|ahora|enseguida|en un (rato|toque|momento)|despu[eé]s)\\s+te\\s+(digo|confirmo|aviso|paso|mando|env[ií]o|cuento)',
  // "te confirmo en un rato", "te aviso apenas..."
  'te\\s+(confirmo|aviso|digo|paso|mando)\\s+(en un|ahora|enseguida|mas tarde|m[aá]s tarde|apenas)',
  // "lo chequeo", "te lo averiguo"
  '\\b(lo|te lo)\\s+(chequeo|reviso|consulto|averiguo|miro|fijo)\\b',
  // "te averiguo", "te chequeo" — la forma que pide la regla de NO TENGO
  '\\bte\\s+(averiguo|chequeo|consulto|reviso)\\b',
  // "bancá que averiguo", "esperá que me fijo"
  '\\b(banc[aá]|esper[aá])\\b[^.!?]{0,30}\\b(averiguo|chequeo|consulto|fijo|miro|pregunto)\\b',
  '\\bd[eé]jame\\s+(ver|chequear|consultar|fijarme)',
  '\\b(consulto|averiguo|pregunto)\\s+y\\s+te\\b',
  '\\bme\\s+fijo\\b',
].join('|'), 'i');

export const prometeSeguimiento = mensajes =>
  (Array.isArray(mensajes) ? mensajes : []).some(m => PROMESAS.test(String(m || '')));
const CATEGORIAS = ['reclamo', 'permuta', 'reparacion', 'cerrado', 'indeciso', 'curioso'];
const MAX_MENSAJES = 4;

/**
 * Valida y acomoda lo que devolvió el modelo. Nada de lo que viene se toma por bueno:
 * si un campo falta o no es de los válidos, la conversación se marca para revisar en
 * vez de guardarse con datos que después rompen la bandeja o la query del cron.
 */
export function normalizar(out, textoCanal) {
  const mensajes = expandirCanal(out.mensajes, textoCanal).slice(0, MAX_MENSAJES);

  const categoria = CATEGORIAS.includes(out.categoria) ? out.categoria : null;
  const confianza = out.confianza === 'baja' ? 'baja' : 'alta';

  // Sube a la bandeja si el modelo lo pide, si dudó de la categoría, o si la categoría
  // no es una de las válidas.
  //
  // Un array de mensajes VACÍO ya no cuenta como problema: puede ser una decisión, y es
  // la única forma que tiene el bot de terminar una conversación. El cliente cierra con
  // "dale" y no hay nada más que decir; contestarle otro "dale" es peor que callarse.
  // Las fallas de verdad —JSON que no parsea, la API que no responde— no pasan por acá:
  // esas devuelven SIN_RESPUESTA, que trae necesitaAtencion en true por su cuenta.
  let necesitaAtencion = out.necesita_atencion === true
    || confianza === 'baja'
    || !categoria;

  let motivo = MOTIVOS.includes(out.motivo) ? out.motivo : null;
  if (necesitaAtencion && !motivo) motivo = 'no_supe_responder';

  // El prompt fija 1..8 para lo que hay que mirar y 99 para lo que no.
  let prioridad = Number(out.prioridad);
  if (!Number.isInteger(prioridad) || prioridad < 1 || prioridad > 8) {
    prioridad = necesitaAtencion ? 8 : 99;
  }
  if (!necesitaAtencion) { motivo = null; prioridad = 99; }

  // El modelo lo declara, y si se olvida lo detectamos por lo que escribio.
  const pasoAHumano = out.paso_a_humano === true || prometeSeguimiento(mensajes);

  return {
    categoria,
    confianza,
    necesitaAtencion: necesitaAtencion || pasoAHumano,
    motivo,
    prioridad,
    pasoAHumano,
    resumen: typeof out.resumen === 'string' ? out.resumen.trim() || null : null,
    // El equipo del que se habló. Lo usa el cron: el seguimiento se escribe por ese
    // modelo. Se corta por las dudas, que va a parar a un doc y a la bandeja.
    producto: typeof out.producto === 'string' ? out.producto.trim().slice(0, 60) || null : null,
    mensajes,
  };
}

/**
 * Cambia la marca del canal por el texto real de Firestore.
 *
 * El modelo nunca ve ese texto (está en primera persona del plural y le contagiaría
 * el "nosotros" al resto de la charla): solo pone la marca donde va, y acá se
 * reemplaza carácter por carácter. Si el texto no está cargado, la marca se cae del
 * array en vez de mandarse literal al cliente.
 */
export function expandirCanal(mensajes, textoCanal) {
  if (!Array.isArray(mensajes)) return [];
  return mensajes
    .map(m => {
      const s = String(m ?? '').trim();
      if (s !== MARCA_CANAL) return s;
      if (!textoCanal) { console.log('falta config/mensajes.invitacionCanal: se descarta la marca'); return ''; }
      return textoCanal;
    })
    .filter(Boolean);
}

// ── Clasificación de respaldo (si la IA no contesta) (después la reemplaza la IA) ─────
function clasificarBasico(texto, adjuntos) {
  const t = (texto || '').toLowerCase();

  if (/permut|cambio mi|entrego mi|parte de pago/.test(t)) return 'permuta';
  if (/garant|reclam|anda mal|no funciona|problema con/.test(t)) return 'reclamo';
  if (/lo llevo|me lo quedo|lo compro|cuando paso|reservam/.test(t)) return 'cerrado';
  if (/precio|cuanto|cuánto|vale|sale|tenes|tenés|hay stock/.test(t)) return 'indeciso';
  if (adjuntos.includes('image')) return 'no_se';   // foto de pantalla rota, etc.
  if (adjuntos.includes('audio')) return 'no_se';

  return 'curioso';
}

// ── Login del bot en Firebase Auth ────────────────────────────
// El Worker no es un navegador: no tiene sesión. Se loguea con un
// usuario propio ("bot@...") para que las reglas de Firestore lo dejen
// escribir. Nunca usamos la cuenta personal del dueño acá.
let tokenCache = { idToken: null, vence: 0 };

async function tokenDelBot(env) {
  const ahora = Date.now();
  if (tokenCache.idToken && ahora < tokenCache.vence) return tokenCache.idToken;

  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: env.BOT_EMAIL,
        password: env.BOT_PASSWORD,
        returnSecureToken: true,
      }),
    }
  );

  if (!r.ok) {
    console.log('login del bot FALLO', r.status, await r.text());
    return null;
  }

  const d = await r.json();
  // los tokens duran 1h; renovamos a los 50 min por las dudas
  tokenCache = { idToken: d.idToken, vence: ahora + 50 * 60 * 1000 };
  return d.idToken;
}

// ── Cron de seguimiento ───────────────────────────────────────
//
// Meta deja responder libre solo dentro de las 24 h desde el último mensaje del
// cliente. El tag HUMAN_AGENT estira eso a 7 días, pero es exclusivo para humanos:
// usarlo desde un bot es de las formas más rápidas de perder el acceso a la API.
//
// Por eso el seguimiento automático sale a las 20 h de silencio —adelantándose si esas
// 20 h caen de madrugada, ver `momentoDeSeguir()`— y lo que ya pasó las 24 h no lo toca
// el bot: se marca `visto` para que lo mande Juni a mano desde la bandeja. Ninguna de
// las dos ventanas se cambia.

const H = 60 * 60 * 1000;
const VENTANA_SEGUIMIENTO = 20 * H;   // a las 20 h calladas, el bot escribe
const VENTANA_META        = 24 * H;   // límite duro de Meta: pasado esto, ni lo intenta
const MAX_POR_CORRIDA     = 50;

// Nadie quiere un "te sigue interesando?" a las 3 de la mañana. Si las 20 h caen de
// madrugada, el mensaje se ADELANTA a las 23:00 del día anterior. Adelantar es lo único
// que se puede hacer sin romper nada: mandarlo más tarde para esquivar la noche se
// comería las 24 h de Meta, y pasada esa ventana el bot no puede escribir.
const AR          = -3 * H;   // Argentina es UTC-3 fijo, sin horario de verano desde 2009
const FIN_NOCHE   = 8;        // de 00:00 a 08:00 no se manda nada
const HORA_ADELANTO = 23;     // se manda a las 23:00 del día anterior

// Lo más que se puede adelantar: de las 23:00 a las 07:59 hay 9 h. O sea que en el peor
// caso el mensaje sale a las 11 h de silencio en vez de a las 20 h, y por ahí tiene que
// arrancar a mirar la query.
const ADELANTO_MAX     = (24 - HORA_ADELANTO + FIN_NOCHE) * H;
const VENTANA_MINIMA   = VENTANA_SEGUIMIENTO - ADELANTO_MAX;

// La hora del reloj argentino para un instante dado.
const horaAR = ms => new Date(ms + AR).getUTCHours();

/**
 * Cuándo mandarle el seguimiento a alguien cuyo último mensaje entró en `t`.
 *
 * Normalmente a las 20 h de silencio. Si ese momento cae entre las 00:00 y las 08:00 de
 * Argentina, se adelanta a las 23:00 del día anterior, que es el último horario decente
 * antes de la noche.
 *
 * Siempre devuelve un instante ANTERIOR o igual a las 20 h de silencio, nunca posterior:
 * por eso el límite de 24 h de Meta no corre riesgo por más que se mueva la hora.
 */
export function momentoDeSeguir(t) {
  const base = t + VENTANA_SEGUIMIENTO;
  if (horaAR(base) >= FIN_NOCHE) return base;

  // Los campos UTC de esta fecha son la hora de Argentina; se retrocede un día, se fija
  // la hora y se vuelve a UTC real. setUTCDate(0) se encarga solo del cambio de mes.
  const d = new Date(base + AR);
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(HORA_ADELANTO, 0, 0, 0);
  return d.getTime() - AR;
}

// Lo que se le pone al doc cuando el bot no puede seguir la conversación y la tiene que
// mirar Juni. `visto` y 7 salen de la tabla de prioridades de prompt-bot.md.
const A_LA_BANDEJA = { necesitaAtencion: true, motivo: 'visto', prioridad: 7 };

async function correrSeguimientos(env) {
  const idToken = await tokenDelBot(env);
  if (!idToken) { console.log('cron: sin token, no corre'); return; }

  // Apagado o en prueba, el cron no toca nada: ni manda seguimientos ni marca `visto`.
  // Las conversaciones quedan como estan y se retoman cuando se pone en 'todos'.
  // Mientras estas afinando el bot no querés que se dispare nada de fondo.
  const cfg = await configDelBot(env);
  if (!cfg.activo || cfg.modo === 'prueba') {
    console.log('cron: bot', cfg.activo ? 'en modo prueba' : 'apagado', '— no corre');
    return;
  }

  const ahora = Date.now();
  const candidatos = await paraSeguir(env, idToken, ahora);
  console.log('cron: candidatos', candidatos.length);

  for (const { name, doc } of candidatos) {
    // Un doc al que le falte alguno de los dos no se puede seguir: sin fecha no se sabe
    // en qué ventana cae y sin igUserId no hay a quién escribirle.
    if (!doc.ultimoMensajeCliente || !doc.igUserId) {
      console.log('cron: doc incompleto, lo salteo', name);
      continue;
    }

    // Pausado a mano: ese chat lo lleva Juni. Ni seguimiento ni `visto` — se deja como
    // esta y se retoma cuando lo vuelva a prender. Un "te sigue interesando?" automatico
    // arriba de una charla que esta atendiendo una persona es lo peor de los dos mundos.
    if (doc.botPausado === true) { console.log('cron: chat pausado, lo salteo', name); continue; }

    // Se pasó la ventana de Meta: el bot no le escribe, va derecho a la bandeja.
    // `seguimientoEnviado` se marca igual, para no volver a mirarlo cada hora.
    const t = Date.parse(doc.ultimoMensajeCliente);
    if (ahora - t >= VENTANA_META) {
      await patchDoc(env, idToken, name, { ...A_LA_BANDEJA, seguimientoEnviado: true });
      continue;
    }

    // Todavía no le toca. La query trae desde las 11 h de silencio porque el horario se
    // puede adelantar, así que acá caen varios que hay que dejar para una corrida
    // siguiente. No se los toca: siguen apareciendo cada hora hasta que les toque.
    if (ahora < momentoDeSeguir(t)) continue;

    // Un solo mensaje, corto y sin apurar a nadie.
    // Adentro pasa por nombreLindo() aunque el nombre ya se guarde arreglado: los docs
    // de antes de que eso existiera tienen la minúscula guardada.
    const texto = textoSeguimiento(doc.ultimoProducto);

    // Sin IG_TOKEN el Worker no le escribe a nadie (modo lee y sugiere): el seguimiento
    // no sale y la conversación queda para que la mande Juni.
    // El `pausado` va igual, aunque el `continue` de arriba ya los saco: si alguna vez
    // se agrega otra salida, el chequeo tiene que estar en el embudo y no en el camino.
    const salio = await mandarAutomatico(env, doc.igUserId, [texto], { pausado: doc.botPausado === true }) > 0;

    // Si el envío no salió, la conversación no se pierde: sube a la bandeja. Y se marca
    // igual como seguida, para no reintentar el mismo mensaje cada hora.
    await patchDoc(env, idToken, name, salio
      ? { seguimientoEnviado: true }
      : { ...A_LA_BANDEJA, seguimientoEnviado: true });
  }
}

/**
 * Las conversaciones candidatas: indecisas, sin seguimiento mandado, calladas hace más
 * de 11 h y que no estén ya esperando a Juni.
 *
 * Son candidatas, no un "para mandar ya": el horario exacto de cada una lo decide
 * `momentoDeSeguir()`, que puede adelantarlo hasta 9 h para esquivar la madrugada. Por
 * eso el corte de la query es el más temprano posible y el resto se filtra en el loop.
 *
 * El filtro por `necesitaAtencion` no es de más. Si la conversación ya está en la
 * bandeja —pidió una foto, por ejemplo— el cliente está esperando algo puntual, y un "te sigue interesando?"
 * automático encima queda pésimo. Además evita que el cron le pise el motivo y la
 * prioridad con `visto`/7 y le entierre un caso urgente al fondo de la cola.
 *
 * Los cuatro campos son los del índice compuesto de `firestore.indexes.json`: los tres
 * de igualdad primero y el del rango al final. Si cambia esta query, cambia el índice.
 */
async function paraSeguir(env, idToken, ahora) {
  const proj = env.FIREBASE_PROJECT;
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents:runQuery`;

  const igual = (campo, value) => ({ fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value } });
  const q = {
    structuredQuery: {
      from: [{ collectionId: 'conversaciones' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            igual('estado', { stringValue: 'indeciso' }),
            igual('seguimientoEnviado', { booleanValue: false }),
            igual('necesitaAtencion', { booleanValue: false }),
            {
              fieldFilter: {
                field: { fieldPath: 'ultimoMensajeCliente' },
                op: 'LESS_THAN',
                value: { timestampValue: new Date(ahora - VENTANA_MINIMA).toISOString() },
              },
            },
          ],
        },
      },
      // Los más callados primero: son los que están más cerca de las 24 h de Meta. Si
      // alguna vez hay más de 50, los que se caen del límite son los más nuevos, que
      // todavía tienen horas de margen.
      orderBy: [{ field: { fieldPath: 'ultimoMensajeCliente' }, direction: 'ASCENDING' }],
      limit: MAX_POR_CORRIDA,
    },
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(q),
    });
    // Si falta el índice, Firestore contesta 400 con el link para crearlo adentro del
    // mensaje: por eso se loguea el texto y no solo el status.
    if (!r.ok) { console.log('cron: la query fallo', r.status, (await r.text()).slice(0, 300)); return []; }

    const d = await r.json();
    return (Array.isArray(d) ? d : [])
      .filter(x => x.document)
      .map(x => ({ name: x.document.name, doc: campos(x.document.fields) }));
  } catch (e) {
    console.log('cron: la query fallo', e.message);
    return [];
  }
}

/**
 * Pisa unos pocos campos de un doc que ya existe. `name` es la ruta completa que
 * devuelve la query (`projects/.../documents/conversaciones/xxx`), y la arman igual
 * `anotarEco` y `reanudar`, que escriben sobre un doc que ya existe seguro.
 *
 * Los campos que toca el cron son de los que habilita `soloCamposDelBot()` en
 * `firestore.rules`; si se agrega otro hay que sumarlo también allá o el update se
 * rechaza entero.
 */
async function patchDoc(env, idToken, name, doc) {
  const fields = aFields(doc);
  const mascara = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');

  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/${name}?${mascara}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ fields }),
    });
    if (!r.ok) console.log('no se pudo actualizar', name, r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.log('no se pudo actualizar', name, e.message);
    return false;
  }
}

// ── Guardar en Firestore (REST API) ───────────────────────────

/**
 * Traduce el doc a la representación de campos de la REST API de Firestore.
 *
 * Un `null` explícito se manda como nullValue en vez de saltearse: el PATCH pisa campo
 * por campo, así que saltearlo dejaría vivo el valor anterior — una conversación que ya
 * se resolvió seguiría arrastrando el `motivo` viejo y no se iría nunca de la bandeja.
 * Para dejar un campo como está hay que no ponerlo en el doc (ver `ultimoProducto`).
 */
// Un valor suelto, en la representacion por tipo de la REST API.
function valorDe(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date)      return { timestampValue: v.toISOString() };
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  // prioridad va como entero: el cron patchea integerValue y la bandeja ordena por este
  // campo, así que conviene que todos los docs lo guarden del mismo tipo.
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(valorDe) } };
  if (typeof v === 'object')  return { mapValue: { fields: aFields(v) } };
  return { stringValue: String(v) };
}

export function aFields(doc) {
  const fields = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === undefined) continue;
    fields[k] = valorDe(v);
  }
  return fields;
}

/**
 * Un doc por conversación, con el id de Instagram del cliente como id del doc.
 *
 * Es un PATCH con updateMask: crea el doc la primera vez y después pisa solo los campos
 * de la máscara, sin tocar lo que le haya agregado la bandeja (quién aprobó y cuándo).
 *
 * Un doc por mensaje no servía: el cron mandaría un seguimiento por cada DM que escribió
 * el cliente, y la bandeja mostraría a la misma persona repetida en cinco filas.
 */
async function guardarEnFirestore(doc, env) {
  const proj = env.FIREBASE_PROJECT;

  const idToken = await tokenDelBot(env);
  if (!idToken) { console.log('sin token: no se guarda'); return; }

  const fields = aFields(doc);
  const mascara = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/conversaciones/${encodeURIComponent(doc.igUserId)}?key=${env.FIREBASE_KEY}&${mascara}`;

  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields }),
  });

  if (!r.ok) console.log('firestore error', r.status, await r.text());
  // `estado` no viaja cuando el chat está pausado: ahí la clasificación vieja se
  // conserva a propósito, y el log tiene que decir eso y no "null".
  else console.log('guardado OK:', doc.estado || '(clasificacion sin cambios)', '-', String(doc.ultimoMensaje || '').slice(0, 40));
}

// ── Verificar firma HMAC de Meta ──────────────────────────────
async function firmaValida(raw, header, secret) {
  if (!header.startsWith('sha256=')) return false;
  const esperada = header.slice(7);

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  return hex === esperada;
}
