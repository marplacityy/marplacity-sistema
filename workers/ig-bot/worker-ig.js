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
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
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
          FIREBASE_PROJECT: !!env.FIREBASE_PROJECT,
          FIREBASE_KEY: !!env.FIREBASE_KEY,
          OWNER_UID: !!env.OWNER_UID,
          BOT_EMAIL: !!env.BOT_EMAIL,
          BOT_PASSWORD: !!env.BOT_PASSWORD,
          ANTHROPIC_KEY: !!env.ANTHROPIC_KEY,
        }
      }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── 2. Mensajes entrantes (POST) ──
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
  if (m.is_echo)  { console.log('descarto: es eco de un mensaje mio'); return; }
  console.log('procesando mensaje de', senderId);

  // Tipo de contenido
  const adjuntos = (m.attachments || []).map(a => a.type);   // image, audio, video, share...
  const texto = m.text || '';

  // La IA lee el mensaje, lo clasifica y redacta la respuesta
  let ia = { ...SIN_RESPUESTA };
  if (env.ANTHROPIC_KEY && (texto || adjuntos.length)) {
    ia = await pensarRespuesta(texto, adjuntos, env);
  } else {
    console.log(env.ANTHROPIC_KEY ? 'mensaje sin texto ni adjuntos' : 'sin ANTHROPIC_KEY: no se llama a la IA');
  }

  // Cada elemento del array sale como un DM aparte, en orden.
  const enviados = await mandarMensajes(env, senderId, ia.mensajes);

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
    fecha: new Date(ev.timestamp || Date.now()).toISOString(),
    estado: ia.categoria || clasificarBasico(texto, adjuntos),
    confianza: ia.confianza,
    necesitaAtencion: ia.necesitaAtencion || quedoSinMandar,
    motivo: quedoSinMandar ? (ia.motivo || 'no_supe_responder') : ia.motivo,
    prioridad: quedoSinMandar ? Math.min(ia.prioridad, 8) : ia.prioridad,
    revisado: false,
    userId: env.OWNER_UID,
  };

  await guardarEnFirestore(doc, env);
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


// ── Traer el stock disponible para que la IA sepa qué hay ─────
// Solo campos de venta: nombre, gb, color, batería y PRECIO DE VENTA.
// Nunca el costo — no queremos que la IA lo mencione ni por error.
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
    if (!r.ok) { console.log('stock no disponible', r.status); return []; }

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
          precio: v('precioVentaUSD'),   // precio de venta, NUNCA el costo
        };
      })
      .filter(x => x.equipo);
  } catch (e) {
    console.log('error trayendo stock', e.message);
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

// La lista vigente de un origen: la de fecha más reciente. Igual criterio que el
// sistema, así el bot cotiza con lo mismo que ve el dueño en pantalla.
async function ultimaLista(env, idToken, origen) {
  const proj = env.FIREBASE_PROJECT;
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents:runQuery`;
  const q = {
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
      orderBy: [{ field: { fieldPath: 'fecha' }, direction: 'DESCENDING' }],
      limit: 1,
    },
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(q),
    });
    if (!r.ok) { console.log('lista', origen, 'no disponible', r.status); return null; }
    const d = await r.json();
    const doc = (d || []).find(x => x.document);
    return doc ? campos(doc.document.fields) : null;
  } catch (e) {
    console.log('error trayendo lista', origen, e.message);
    return null;
  }
}

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
  mensajes: [],
};

async function pensarRespuesta(texto, adjuntos, env) {
  const idToken = await tokenDelBot(env);
  if (!idToken) return { ...SIN_RESPUESTA };

  // Todo lo que el prompt necesita, en paralelo: sin esto el modelo no sabe qué hay
  // ni a qué precio, y las secciones de stock y listas del prompt quedan vacías.
  const [stock, conocimiento, listaMdp, listaCaba, mensajesFijos] = await Promise.all([
    stockDisponible(env, idToken),
    leerDoc(env, idToken, `conocimiento/${env.OWNER_UID}`),
    ultimaLista(env, idToken, 'mdp'),
    ultimaLista(env, idToken, 'caba'),
    leerDoc(env, idToken, 'config/mensajes'),
  ]);

  // La lista de MDP es la del día: si es de una fecha anterior, el prompt se lo avisa
  // al modelo para que no prometa un precio viejo como si fuera el de hoy.
  const hoy = new Date().toISOString().split('T')[0];
  const mdpVencida = !!(listaMdp && listaMdp.fecha !== hoy);

  const sistema = construirSystem({ conocimiento, stock, listaMdp, listaCaba, mdpVencida });
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
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: sistema,
        messages: [{ role: 'user', content: usuario }],
      }),
    });

    if (!r.ok) { console.log('IA error', r.status, (await r.text()).slice(0, 200)); return { ...SIN_RESPUESTA }; }

    const d = await r.json();
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

const MOTIVOS = ['pidio_foto', 'cerrado', 'reclamo', 'permuta', 'reparacion', 'otro_medio_de_pago', 'visto', 'no_supe_responder'];
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

  // Sube a la bandeja si el modelo lo pide, si dudó de la categoría, si la categoría
  // no es una de las válidas, o si no dejó nada para contestar.
  let necesitaAtencion = out.necesita_atencion === true
    || confianza === 'baja'
    || !categoria
    || !mensajes.length;

  let motivo = MOTIVOS.includes(out.motivo) ? out.motivo : null;
  if (necesitaAtencion && !motivo) motivo = 'no_supe_responder';

  // El prompt fija 1..8 para lo que hay que mirar y 99 para lo que no.
  let prioridad = Number(out.prioridad);
  if (!Number.isInteger(prioridad) || prioridad < 1 || prioridad > 8) {
    prioridad = necesitaAtencion ? 8 : 99;
  }
  if (!necesitaAtencion) { motivo = null; prioridad = 99; }

  return {
    categoria,
    confianza,
    necesitaAtencion,
    motivo,
    prioridad,
    resumen: typeof out.resumen === 'string' ? out.resumen.trim() || null : null,
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

// ── Guardar en Firestore (REST API) ───────────────────────────
async function guardarEnFirestore(doc, env) {
  const proj = env.FIREBASE_PROJECT;
  const url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/conversaciones?key=${env.FIREBASE_KEY}`;

  const idToken = await tokenDelBot(env);
  if (!idToken) { console.log('sin token: no se guarda'); return; }

  const fields = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string')       fields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    // prioridad va como entero: el cron patchea integerValue y la bandeja ordena por
    // este campo, así que conviene que todos los docs lo guarden del mismo tipo.
    else if (typeof v === 'number')  fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (Array.isArray(v))       fields[k] = { arrayValue: { values: v.map(x => ({ stringValue: String(x) })) } };
  }

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields }),
  });

  if (!r.ok) console.log('firestore error', r.status, await r.text());
  else console.log('guardado OK:', doc.estado, '-', doc.ultimoMensaje.slice(0, 40));
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
