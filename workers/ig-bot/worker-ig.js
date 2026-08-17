/**
 * MarplaCity — Worker de Instagram DM
 * ------------------------------------
 * FASE 1: recibe los mensajes, los guarda en Firestore y los clasifica.
 * NO responde todavía (modo "lee y sugiere").
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
 *   IA_URL            (Text)    -> https://anthropic-proxy.fiwind702050.workers.dev
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
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
          IA_URL: !!env.IA_URL,
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
      const res = await Promise.allSettled(tareas);
      res.forEach(r => { if (r.status === 'rejected') console.log('tarea fallo:', String(r.reason)); });

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

  // La IA lee el mensaje, lo clasifica y redacta una respuesta sugerida
  let ia = { estado: null, sugerencia: null, resumen: null };
  if (env.IA_URL && (texto || adjuntos.length)) {
    ia = await pensarRespuesta(texto, adjuntos, env);
  }

  const doc = {
    igUserId: senderId,
    sugerencia: ia.sugerencia || null,
    resumen: ia.resumen || null,
    respondido: false,
    ultimoMensaje: texto,
    adjuntos,
    tieneImagen: adjuntos.includes('image'),
    tieneAudio: adjuntos.includes('audio'),
    urlsAdjuntos: (m.attachments || []).map(a => a.payload?.url).filter(Boolean),
    fecha: new Date(ev.timestamp || Date.now()).toISOString(),
    estado: ia.estado || clasificarBasico(texto, adjuntos),
    revisado: false,
    userId: env.OWNER_UID,
  };

  await guardarEnFirestore(doc, env);
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

// ── La IA: clasifica y redacta una respuesta ──────────────────
async function pensarRespuesta(texto, adjuntos, env) {
  const vacio = { estado: null, sugerencia: null, resumen: null };

  const idToken = await tokenDelBot(env);
  const stock = idToken ? await stockDisponible(env, idToken) : [];

  const sistema = `Sos quien atiende los mensajes de Instagram de MarplaCity, un local de
venta y reparación de celulares en Miramar, Argentina.

TU FORMA DE ESCRIBIR:
- Español rioplatense, informal pero prolijo. Tuteo, nada de "usted".
- Mensajes cortos, como se escribe por DM. Sin párrafos largos ni listas.
- Directo y cordial. Nada de fórmulas de call center.
- No inventes NUNCA precios, modelos ni disponibilidad: usá solo el stock de abajo.
- Si no sabés algo, decilo y avisá que el dueño responde en un rato.
- Nunca menciones cuánto costó un equipo. Solo el precio de venta.

STOCK DISPONIBLE HOY (si está vacío, decí que consultás y avisás):
${stock.length ? JSON.stringify(stock) : 'sin datos'}

Vas a recibir un mensaje de un cliente. Respondé SOLO con un JSON, sin markdown
ni texto alrededor, con esta forma exacta:
{"estado":"...","resumen":"...","sugerencia":"..."}

- "estado": uno de permuta, reclamo, cerrado, indeciso, curioso, sin_stock, no_se.
  Usá "no_se" si no podés responder con lo que tenés.
  Usá "permuta" si menciona entregar su equipo como parte de pago.
  Usá "sin_stock" si pregunta por algo que no está en el stock de arriba.
- "resumen": qué quiere, en menos de 10 palabras.
- "sugerencia": el mensaje que le mandarías, listo para copiar y pegar.`;

  const usuario = texto
    ? texto
    : `(el cliente mandó ${adjuntos.join(' y ')} sin texto)`;

  try {
    const r = await fetch(env.IA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: sistema,
        messages: [{ role: 'user', content: usuario }],
      }),
    });

    if (!r.ok) { console.log('IA error', r.status, (await r.text()).slice(0, 200)); return vacio; }

    const d = await r.json();
    const crudo = (d.content?.map(x => x.text || '').join('') || d.text || '').trim();
    const limpio = crudo.replace(/```json|```/g, '').trim();
    const out = JSON.parse(limpio);

    console.log('IA ->', out.estado, '|', (out.sugerencia || '').slice(0, 50));
    return { estado: out.estado || null, sugerencia: out.sugerencia || null, resumen: out.resumen || null };
  } catch (e) {
    console.log('IA fallo:', e.message);
    return vacio;
  }
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
    else if (typeof v === 'number')  fields[k] = { doubleValue: v };
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
