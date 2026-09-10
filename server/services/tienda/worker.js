/**
 * MarplaCity — Worker de la tienda (cobros del catálogo web)
 * -----------------------------------------------------------
 * La página pública (catalogo.html) no puede cobrar sola: las credenciales de Mercado
 * Pago viven acá. La página manda el pedido, este Worker lo guarda en `pedidos`, arma
 * el link de pago y recibe el aviso de Mercado Pago cuando el pago se aprueba.
 *
 * Es un Worker aparte del bot, del facturador y del asistente, por lo mismo que ellos:
 * un deploy de uno no tiene por qué poder romper a los otros, y el token de este no
 * puede tocar facturas ni conversaciones.
 *
 * Rutas:
 *   GET  /               diagnóstico: qué variables están cargadas
 *   POST /pedido         crea el pedido; devuelve {id, url} (url = a dónde ir a pagar)
 *   GET  /pedido/:id     el estado del pedido, para la pantalla de vuelta del pago
 *   POST /mp/webhook     Mercado Pago avisa que un pago cambió
 *   POST /stripe/webhook Stripe avisa que un pago cambió
 *   POST /fotos          busca en Amazon y sube a fotos/ las imágenes de un producto (solo el dueño)
 *
 * Variables (Settings → Variables del panel de Cloudflare, o `wrangler secret put`):
 *   FIREBASE_PROJECT   (Text)    mis-gastos-21e7b
 *   FIREBASE_KEY       (Secret)  API key web de Firebase
 *   OWNER_UID          (Text)    el uid del dueño: los pedidos son suyos
 *   TIENDA_EMAIL       (Text)    tienda@marplacity.com (usuario de servicio en Firebase Auth)
 *   TIENDA_PASSWORD    (Secret)  su contraseña
 *   MP_ACCESS_TOKEN    (Secret)  Access Token de Mercado Pago (el de prueba o el de producción)
 *   MP_WEBHOOK_SECRET  (Secret)  la "clave secreta" de Webhooks de la app de MP (opcional, pero conviene)
 *   STRIPE_SECRET_KEY  (Secret)  clave secreta de Stripe (sk_test_... primero, sk_live_... después)
 *   STRIPE_WEBHOOK_SECRET (Secret) el "signing secret" del endpoint de webhook en Stripe (whsec_...)
 *   SERPAPI_KEY, GITHUB_TOKEN, GITHUB_REPO  ver fotos.js
 *   CATALOGO_URL       (Text)    a dónde vuelve el cliente después de pagar
 *
 * Los precios NUNCA vienen de la página: se leen de `catalogo/publico`, que es lo que
 * publicó el dueño. Un cliente que edite el HTML no puede pagar menos.
 */

import { leerDoc, escribirDoc } from '../facturador/firestore.js';
import { fotosParaProducto } from './fotos.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Firebase-Token',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (request.method === 'GET' && url.pathname === '/') {
      return json({
        ok: true,
        vars: {
          FIREBASE_PROJECT: !!env.FIREBASE_PROJECT, FIREBASE_KEY: !!env.FIREBASE_KEY, OWNER_UID: !!env.OWNER_UID,
          TIENDA_EMAIL: !!env.TIENDA_EMAIL, TIENDA_PASSWORD: !!env.TIENDA_PASSWORD,
          MP_ACCESS_TOKEN: !!env.MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET: !!env.MP_WEBHOOK_SECRET,
          STRIPE_SECRET_KEY: !!env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: !!env.STRIPE_WEBHOOK_SECRET,
          SERPAPI_KEY: !!env.SERPAPI_KEY, GITHUB_TOKEN: !!env.GITHUB_TOKEN,
          CATALOGO_URL: !!env.CATALOGO_URL,
        },
      });
    }

    try {
      if (request.method === 'POST' && url.pathname === '/pedido') return await crearPedido(request, env, url);

      const m = /^\/pedido\/([A-Za-z0-9-]{8,64})$/.exec(url.pathname);
      if (request.method === 'GET' && m) return await verPedido(m[1], env);

      if (request.method === 'POST' && url.pathname === '/mp/webhook') return await webhookMP(request, env, ctx, url);
      if (request.method === 'POST' && url.pathname === '/stripe/webhook') return await webhookStripe(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/fotos') return await buscarFotos(request, env);
    } catch (e) {
      console.log('error', url.pathname, e.message);
      return json({ error: e.message }, 500);
    }

    return json({ error: 'no existe' }, 404);
  },
};

// ── El pedido ────────────────────────────────────────────────

const PAGOS = ['mp', 'tarjeta', 'efectivo'];
const ENTREGAS = ['retiro', 'envio'];

/**
 * Lo que manda la página, limpio y validado. Devuelve {error} si algo no sirve.
 * Exportado para el test.
 */
export function validarPedido(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'pedido inválido' };
  const t = (v, max) => String(v ?? '').trim().slice(0, max);
  const p = {
    productoId: t(body.productoId, 120),
    pago: t(body.pago, 20),
    entrega: t(body.entrega, 20),
    direccion: t(body.direccion, 300),
    nombre: t(body.nombre, 80),
    whatsapp: t(body.whatsapp, 30).replace(/[^\d+]/g, ''),
    email: t(body.email, 120).toLowerCase(),
  };
  if (!p.productoId) return { error: 'falta el producto' };
  if (!PAGOS.includes(p.pago)) return { error: 'forma de pago inválida' };
  if (!ENTREGAS.includes(p.entrega)) return { error: 'forma de entrega inválida' };
  if (p.entrega === 'envio' && p.direccion.length < 5) return { error: 'falta la dirección de entrega' };
  if (p.nombre.length < 2) return { error: 'falta el nombre' };
  if (p.whatsapp.replace(/\D/g, '').length < 8) return { error: 'el WhatsApp no parece un número' };
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return { error: 'el email no parece válido' };
  return p;
}

/**
 * Cuánto se cobra, según la forma de pago y las reglas publicadas con el catálogo.
 * Exportado para el test.
 */
export function montoDelPedido(producto, pago, cobro) {
  const usd = Number(producto.precioUSD) || 0;
  const tc = Number(cobro?.tc) || 0;
  const rec = Number(cobro?.recargoTarjetaPct) || 0;
  const recMp = Number(cobro?.recargoMpPct) || 0;
  const mpMax = Number(cobro?.mpMaxUSD) || 0;
  if (usd <= 0) return { error: 'el producto no tiene precio' };
  if (pago === 'mp') {
    if (!tc) return { error: 'el catálogo no tiene tipo de cambio: hay que volver a publicarlo' };
    if (mpMax && usd > mpMax) return { error: `Mercado Pago solo para productos de hasta u$s ${mpMax}` };
    // El recargo cubre la comisión de MP: el cliente paga el precio más ese porcentaje.
    return { montoUSD: usd, montoARS: Math.round(usd * tc * (1 + recMp / 100)), tc };
  }
  if (pago === 'tarjeta') return { montoUSD: Math.round(usd * (1 + rec / 100)), montoARS: null, tc };
  return { montoUSD: usd, montoARS: null, tc };
}

async function crearPedido(request, env, url) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'json inválido' }, 400); }
  const p = validarPedido(body);
  if (p.error) return json({ error: p.error }, 400);

  const idToken = await tokenDeLaTienda(env);
  if (!idToken) return json({ error: 'la tienda no se pudo loguear a Firebase' }, 503);

  // El producto y el precio salen de lo publicado, nunca del pedido.
  const catalogo = await leerDoc(env, idToken, 'catalogo/publico');
  const producto = (catalogo?.productos || []).find(x => x && x.id === p.productoId);
  if (!producto) return json({ error: 'ese producto ya no está en el catálogo' }, 404);

  const monto = montoDelPedido(producto, p.pago, catalogo.cobro);
  if (monto.error) return json({ error: monto.error }, 400);

  const id = crypto.randomUUID();
  const ahora = new Date().toISOString();
  const pedido = {
    userId: env.OWNER_UID,
    estado: p.pago === 'efectivo' ? 'reservado' : 'creado',
    producto: {
      id: producto.id, nombre: producto.nombre || '', gb: producto.gb || '', color: producto.color || '',
      tipo: producto.tipo || 'equipo', precioUSD: Number(producto.precioUSD) || 0,
    },
    pago: p.pago,
    entrega: p.entrega,
    direccion: p.direccion,
    cliente: { nombre: p.nombre, whatsapp: p.whatsapp, email: p.email },
    montoUSD: monto.montoUSD,
    montoARS: monto.montoARS,
    tc: monto.tc,
    creado: ahora,
    fecha: ahora.slice(0, 10),
    actualizado: ahora,
  };

  let pagoUrl = null;
  if (p.pago === 'mp') {
    const pref = await preferenciaMP(env, id, pedido, url.origin);
    pedido.mp = { preferenceId: pref.id };
    pagoUrl = pref.init_point;
  }
  if (p.pago === 'tarjeta') {
    const ses = await sesionStripe(env, id, pedido);
    pedido.stripe = { sessionId: ses.id };
    pagoUrl = ses.url;
  }

  await escribirDoc(env, idToken, `pedidos/${id}`, pedido);
  console.log('pedido creado', id, pedido.estado, pedido.producto.nombre, pedido.pago, pedido.montoARS ?? pedido.montoUSD);
  return json({ id, estado: pedido.estado, url: pagoUrl });
}

/**
 * Lo que la página puede mostrar de un pedido. Quien tiene el id (largo y al azar) ve
 * esto y nada más.
 *
 * Si el pedido sigue "creado", antes de contestar se le pregunta a la pasarela por el
 * pago. La página llama acá justo cuando el cliente vuelve de pagar, y el webhook puede
 * no haber llegado todavía (o no estar configurado): sin esto, el cliente veía "pago
 * aprobado" y el sistema "sin pagar". Pasó el 06/09/2026 con el primer pago real de Stripe.
 */
async function verPedido(id, env) {
  const idToken = await tokenDeLaTienda(env);
  if (!idToken) return json({ error: 'la tienda no se pudo loguear a Firebase' }, 503);
  let d = await leerDoc(env, idToken, `pedidos/${id}`);
  if (!d) return json({ error: 'no existe' }, 404);
  if (d.estado === 'creado') {
    try {
      if (d.pago === 'tarjeta' && d.stripe?.sessionId) await actualizarSesionStripe(env, d.stripe.sessionId);
      if (d.pago === 'mp') await buscarPagoMP(env, id);
      d = (await leerDoc(env, idToken, `pedidos/${id}`)) || d;
    } catch (e) { console.log('no se pudo consultar el pago de', id, e.message); }
  }
  return json({
    id, estado: d.estado, pago: d.pago, entrega: d.entrega,
    producto: d.producto?.nombre || '', montoUSD: d.montoUSD, montoARS: d.montoARS,
  });
}

// ── Fotos desde Amazon ───────────────────────────────────────

/**
 * Lo llama el sistema (solo el dueño, con su token de Firebase) para un producto sin
 * foto. Cada llamada es una búsqueda en SerpApi: el sistema las hace de a una, con el
 * progreso a la vista, para que el dueño pueda frenar.
 */
async function buscarFotos(request, env) {
  const uid = await uidDelToken(request.headers.get('X-Firebase-Token'), env);
  if (!uid || uid !== env.OWNER_UID) return json({ error: 'no autorizado' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'json inválido' }, 400); }
  const nombre = String(body.nombre || '').trim().slice(0, 120);
  if (!nombre) return json({ error: 'falta el nombre' }, 400);
  try {
    const r = await fotosParaProducto(env, {
      nombre, gb: String(body.gb || '').trim(), color: String(body.color || '').trim(), esAccesorio: body.tipo === 'accesorio',
    });
    console.log('fotos', r.consulta, '->', r.subidos.length, 'subidas de', r.candidatos, 'resultados');
    return json(r);
  } catch (e) {
    console.log('fotos error', nombre, e.message);
    return json({ error: e.message }, 502);
  }
}

/** El uid de un ID token de Firebase, validado contra Google. Null si no vale. */
async function uidDelToken(idToken, env) {
  if (!idToken) return null;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
    });
    if (!r.ok) return null;
    return (await r.json()).users?.[0]?.localId || null;
  } catch { return null; }
}

// ── Mercado Pago ─────────────────────────────────────────────

const MP = 'https://api.mercadopago.com';
const mpHeaders = env => ({ Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' });

/**
 * La "preferencia" es el link de pago de Checkout Pro: un pedido, un ítem, un monto en
 * pesos. `external_reference` lleva el id del pedido, y con eso el webhook sabe cuál
 * actualizar. Meta también las back_urls: a dónde vuelve el cliente al terminar.
 */
async function preferenciaMP(env, pedidoId, pedido, origin) {
  if (!env.MP_ACCESS_TOKEN) throw new Error('falta MP_ACCESS_TOKEN');
  if (env.RUNTIME_NODE && !env.TIENDA_WEBHOOK_URL) throw new Error('Configurá TIENDA_WEBHOOK_URL con la URL pública del webhook de Node.js.');
  const vuelta = `${env.CATALOGO_URL || 'https://marplacityy.github.io/marplacity-sistema/catalogo.html'}?pedido=${pedidoId}`;
  const titulo = [pedido.producto.nombre, pedido.producto.gb, pedido.producto.color].filter(Boolean).join(' ');
  const r = await fetch(`${MP}/checkout/preferences`, {
    method: 'POST',
    headers: { ...mpHeaders(env), 'X-Idempotency-Key': pedidoId },
    body: JSON.stringify({
      items: [{ id: pedido.producto.id, title: titulo, quantity: 1, unit_price: pedido.montoARS, currency_id: 'ARS' }],
      payer: { name: pedido.cliente.nombre, email: pedido.cliente.email || undefined },
      external_reference: pedidoId,
      back_urls: { success: vuelta, pending: vuelta, failure: vuelta },
      auto_return: 'approved',
      notification_url: env.TIENDA_WEBHOOK_URL || `${origin}/mp/webhook`,
      statement_descriptor: 'MARPLACITY',
      metadata: { pedido: pedidoId },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.log('MP preferencia', r.status, JSON.stringify(d).slice(0, 300));
    throw new Error(`Mercado Pago rechazó el pedido (${r.status})`);
  }
  return d;
}

/**
 * ¿La notificación la mandó Mercado Pago? Firma HMAC-SHA256 sobre
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con la clave secreta de la app.
 * Exportado para el test.
 */
export async function firmaMPValida(secret, xSignature, xRequestId, dataId) {
  if (!secret) return true;   // sin clave cargada no se puede verificar: se confía en el fetch del pago
  const partes = Object.fromEntries(String(xSignature || '').split(',').map(s => s.trim().split('=')));
  const ts = partes.ts, v1 = partes.v1;
  if (!ts || !v1) return false;
  const id = /^[a-zA-Z0-9]+$/.test(dataId || '') ? String(dataId).toLowerCase() : String(dataId || '');
  const manifest = `id:${id};request-id:${xRequestId || ''};ts:${ts};`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === v1;
}

const ESTADO_MP = { approved: 'pagado', pending: 'pendiente', in_process: 'pendiente', authorized: 'pendiente',
                    rejected: 'rechazado', cancelled: 'rechazado', refunded: 'devuelto', charged_back: 'devuelto' };

/**
 * Mercado Pago avisa por acá cada vez que un pago cambia. Se contesta 200 enseguida y se
 * consulta el pago a la API de MP: lo que dice el aviso no se toma por bueno, lo que
 * vale es lo que devuelve MP al preguntarle por ese id.
 */
async function webhookMP(request, env, ctx, url) {
  let body = {};
  try { body = await request.json(); } catch { /* MP a veces manda solo query params */ }
  const tipo = body.type || url.searchParams.get('type') || url.searchParams.get('topic') || '';
  const dataId = body.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '';
  console.log('webhook MP', tipo, dataId);

  // La firma se chequea y se loguea, pero NO frena: lo que vale es consultar el pago a la
  // API de MP con nuestro token. Un aviso falso solo puede hacernos releer un pago real.
  // Se loguean las piezas (no la clave) para poder ajustar el formato si MP lo cambia.
  const firmaOk = await firmaMPValida(env.MP_WEBHOOK_SECRET, request.headers.get('x-signature'), request.headers.get('x-request-id'), dataId);
  if (!firmaOk) {
    console.log('webhook MP: firma inválida —', 'x-signature:', request.headers.get('x-signature') || '(sin header)',
      '| x-request-id:', request.headers.get('x-request-id') || '(sin header)', '| data.id:', dataId, '| query:', url.search);
  }
  if (tipo !== 'payment' || !dataId) return json({ ok: true, ignorado: tipo });

  ctx.waitUntil(actualizarPago(env, dataId).catch(e => console.log('webhook MP falló:', e.message)));
  return json({ ok: true });
}

/** Busca en MP el último pago de un pedido (por external_reference) y lo aplica. */
async function buscarPagoMP(env, pedidoId) {
  const r = await fetch(`${MP}/v1/payments/search?external_reference=${encodeURIComponent(pedidoId)}&sort=date_created&criteria=desc&limit=1`, { headers: mpHeaders(env) });
  if (!r.ok) throw new Error(`MP no devolvió la búsqueda (${r.status})`);
  const pago = (await r.json()).results?.[0];
  if (pago?.id) await actualizarPago(env, pago.id);
}

async function actualizarPago(env, paymentId) {
  const r = await fetch(`${MP}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: mpHeaders(env) });
  if (!r.ok) throw new Error(`MP no devolvió el pago ${paymentId} (${r.status})`);
  const pago = await r.json();
  const pedidoId = pago.external_reference || pago.metadata?.pedido;
  if (!pedidoId) { console.log('pago sin pedido', paymentId); return; }

  const idToken = await tokenDeLaTienda(env);
  if (!idToken) throw new Error('la tienda no se pudo loguear a Firebase');
  const pedido = await leerDoc(env, idToken, `pedidos/${pedidoId}`);
  if (!pedido) { console.log('pedido no existe', pedidoId); return; }

  const estado = ESTADO_MP[pago.status] || 'pendiente';
  // Un pago aprobado no vuelve a "pendiente" por un aviso viejo que llegue después.
  if (pedido.estado === 'pagado' && estado === 'pendiente') return;

  await escribirDoc(env, idToken, `pedidos/${pedidoId}`, {
    estado,
    actualizado: new Date().toISOString(),
    ...(estado === 'pagado' ? { pagadoEn: pago.date_approved || new Date().toISOString() } : {}),
    mp: {
      ...(pedido.mp || {}),
      paymentId: String(pago.id), status: pago.status, statusDetail: pago.status_detail || '',
      monto: pago.transaction_amount ?? null, medio: pago.payment_method_id || '',
    },
  });
  console.log('pedido', pedidoId, '->', estado, `(MP ${pago.status})`);
}

// ── Stripe ───────────────────────────────────────────────────

const STRIPE = 'https://api.stripe.com/v1';

/** Stripe habla form-urlencoded, con claves anidadas entre corchetes. */
const formStripe = obj => {
  const out = new URLSearchParams();
  const meter = (k, v) => {
    if (v === undefined || v === null) return;
    if (typeof v === 'object') Object.entries(v).forEach(([k2, v2]) => meter(`${k}[${k2}]`, v2));
    else out.append(k, String(v));
  };
  Object.entries(obj).forEach(([k, v]) => meter(k, v));
  return out;
};

/**
 * La sesión de Checkout: un pedido, un ítem, el monto en dólares con el recargo ya
 * sumado. `client_reference_id` lleva el id del pedido, y con eso el webhook sabe cuál
 * actualizar. Stripe cobra en centavos.
 */
async function sesionStripe(env, pedidoId, pedido) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('falta STRIPE_SECRET_KEY');
  const vuelta = `${env.CATALOGO_URL || 'https://marplacityy.github.io/marplacity-sistema/catalogo.html'}?pedido=${pedidoId}`;
  const titulo = [pedido.producto.nombre, pedido.producto.gb, pedido.producto.color].filter(Boolean).join(' ');
  const r = await fetch(`${STRIPE}/checkout/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': pedidoId },
    body: formStripe({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(pedido.montoUSD * 100), product_data: { name: titulo } } }],
      client_reference_id: pedidoId,
      metadata: { pedido: pedidoId },
      customer_email: pedido.cliente.email || undefined,
      success_url: `${vuelta}&status=approved`,
      cancel_url: `${vuelta}&status=cancelled`,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.log('Stripe sesion', r.status, JSON.stringify(d).slice(0, 300));
    throw new Error(`Stripe rechazó el pedido (${r.status})`);
  }
  return d;
}

/**
 * ¿La notificación la mandó Stripe? Header "Stripe-Signature: t=<ts>,v1=<hmac>", firma
 * HMAC-SHA256 de "<ts>.<cuerpo crudo>" con el signing secret del endpoint.
 * Exportado para el test.
 */
export async function firmaStripeValida(secret, header, cuerpo, ahora = Date.now()) {
  if (!secret) return false;
  const partes = {};
  for (const s of String(header || '').split(',')) { const [k, v] = s.trim().split('='); if (k && v) (partes[k] ||= []).push(v); }
  const t = partes.t?.[0];
  if (!t || !partes.v1?.length) return false;
  if (Math.abs(ahora / 1000 - Number(t)) > 300) return false;   // 5 minutos de tolerancia
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${cuerpo}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return partes.v1.includes(hex);
}

/**
 * Stripe avisa por acá. A diferencia de MP, acá la firma sí es confiable y se exige.
 * Igual el estado se toma de la sesión consultada a la API, no del cuerpo del aviso.
 */
async function webhookStripe(request, env, ctx) {
  const cuerpo = await request.text();
  if (!(await firmaStripeValida(env.STRIPE_WEBHOOK_SECRET, request.headers.get('stripe-signature'), cuerpo))) {
    console.log('webhook Stripe: firma inválida');
    return json({ error: 'firma inválida' }, 401);
  }
  let ev = {};
  try { ev = JSON.parse(cuerpo); } catch { return json({ error: 'json inválido' }, 400); }
  console.log('webhook Stripe', ev.type, ev.data?.object?.id);

  const obj = ev.data?.object || {};
  if (String(ev.type || '').startsWith('checkout.session.')) {
    ctx.waitUntil(actualizarSesionStripe(env, obj.id).catch(e => console.log('webhook Stripe falló:', e.message)));
  } else if (ev.type === 'charge.refunded' && obj.payment_intent) {
    ctx.waitUntil(marcarDevueltoStripe(env, obj.payment_intent).catch(e => console.log('webhook Stripe falló:', e.message)));
  }
  return json({ ok: true });
}

const ESTADO_STRIPE = { paid: 'pagado', unpaid: 'pendiente', no_payment_required: 'pagado' };

async function actualizarSesionStripe(env, sessionId) {
  const r = await fetch(`${STRIPE}/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`Stripe no devolvió la sesión ${sessionId} (${r.status})`);
  const ses = await r.json();
  const pedidoId = ses.client_reference_id || ses.metadata?.pedido;
  if (!pedidoId) { console.log('sesión sin pedido', sessionId); return; }

  const idToken = await tokenDeLaTienda(env);
  if (!idToken) throw new Error('la tienda no se pudo loguear a Firebase');
  const pedido = await leerDoc(env, idToken, `pedidos/${pedidoId}`);
  if (!pedido) { console.log('pedido no existe', pedidoId); return; }

  // Una sesión que venció o se canceló sin pagar: el pedido vuelve a "rechazado" solo si nunca se pagó.
  let estado = ESTADO_STRIPE[ses.payment_status] || 'pendiente';
  if (ses.status === 'expired' && estado !== 'pagado') estado = 'rechazado';
  if (pedido.estado === 'pagado' && estado !== 'pagado') return;

  await escribirDoc(env, idToken, `pedidos/${pedidoId}`, {
    estado,
    actualizado: new Date().toISOString(),
    ...(estado === 'pagado' ? { pagadoEn: new Date().toISOString() } : {}),
    stripe: {
      ...(pedido.stripe || {}),
      sessionId: ses.id, paymentIntent: ses.payment_intent || '', paymentStatus: ses.payment_status || '',
      monto: ses.amount_total != null ? ses.amount_total / 100 : null, moneda: ses.currency || 'usd',
    },
  });
  console.log('pedido', pedidoId, '->', estado, `(Stripe ${ses.payment_status})`);
}

/** Un reembolso: se busca el pedido por el payment_intent guardado en la sesión. */
async function marcarDevueltoStripe(env, paymentIntent) {
  const r = await fetch(`${STRIPE}/checkout/sessions?payment_intent=${encodeURIComponent(paymentIntent)}&limit=1`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`Stripe no devolvió la sesión del pago ${paymentIntent} (${r.status})`);
  const ses = (await r.json()).data?.[0];
  const pedidoId = ses?.client_reference_id || ses?.metadata?.pedido;
  if (!pedidoId) { console.log('reembolso sin pedido', paymentIntent); return; }
  const idToken = await tokenDeLaTienda(env);
  if (!idToken) throw new Error('la tienda no se pudo loguear a Firebase');
  await escribirDoc(env, idToken, `pedidos/${pedidoId}`, { estado: 'devuelto', actualizado: new Date().toISOString() });
  console.log('pedido', pedidoId, '-> devuelto (Stripe)');
}

// ── Firebase ─────────────────────────────────────────────────

let tokenCache = { idToken: null, vence: 0 };

async function tokenDeLaTienda(env) {
  const ahora = Date.now();
  if (tokenCache.idToken && ahora < tokenCache.vence) return tokenCache.idToken;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.TIENDA_EMAIL, password: env.TIENDA_PASSWORD, returnSecureToken: true }),
  });
  if (!r.ok) { console.log('login de la tienda FALLO', r.status, await r.text()); return null; }
  const d = await r.json();
  tokenCache = { idToken: d.idToken, vence: ahora + 50 * 60 * 1000 };   // duran 1 h
  return d.idToken;
}
