import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, escJs } from '../src/shared/seguridad.js';
import tienda, { pagoCorresponde, montoDelPedido, firmaStripeValida } from '../server/services/tienda/worker.js';
import instagram from '../server/services/ig-bot/worker-ig.js';
import { bajarImagen, urlImagenPermitida } from '../server/services/tienda/fotos.js';
import { verificarTokenDelDueño } from '../server/services/facturador/identidad.js';

test('el escape conserva texto y no deja comillas ni etiquetas en atributos o literales', () => {
  const ataque = `"'><img src=x onerror=alert(1)> &quot; \\ \n\u2028`;
  assert.doesNotMatch(esc(ataque), /[<>"']/);
  assert.doesNotMatch(escJs(ataque), /[&<>"'\n\u2028]/);
  assert.equal(esc(0), '0');
});

test('webhooks sin firma válida no consultan APIs ni encolan operaciones', async t => {
  let consultas = 0, tareas = 0;
  t.mock.method(globalThis, 'fetch', async () => { consultas++; throw new Error('No debe consultar red.'); });
  const contexto = { waitUntil() { tareas++; } };
  const mp = env => tienda.fetch(new Request('https://local/mp/webhook', { method: 'POST', body: '{"type":"payment","data":{"id":"123"}}' }), env, contexto);
  assert.equal((await mp({})).status, 503);
  assert.equal((await mp({ MP_WEBHOOK_SECRET: 'solo-prueba' })).status, 401);
  assert.equal((await instagram.fetch(new Request('https://local/', { method: 'POST', body: '{}' }), {}, contexto)).status, 503);
  assert.equal((await instagram.fetch(new Request('https://local/', { method: 'POST', body: '{}' }), { IG_APP_SECRET: 'solo-prueba' }, contexto)).status, 401);
  assert.equal(consultas, 0); assert.equal(tareas, 0);
});

test('un pago de otro monto, moneda, cliente o sesión nunca acredita el pedido', () => {
  const pedido = { userId: 'dueno', pago: 'mp', montoARS: 140000, mp: {} };
  const pago = { id: 123, currency_id: 'ARS', transaction_amount: 140000 };
  assert.equal(pagoCorresponde(pedido, pago, 'mp', 'dueno'), true);
  for (const cambio of [{ transaction_amount: 1 }, { currency_id: 'USD' }, { transaction_amount: Infinity }]) {
    assert.equal(pagoCorresponde(pedido, { ...pago, ...cambio }, 'mp', 'dueno'), false);
  }
  assert.equal(pagoCorresponde(pedido, pago, 'mp', 'otra-cuenta'), false);
  assert.equal(pagoCorresponde({ ...pedido, mp: { paymentId: 'otro' } }, pago, 'mp', 'dueno'), false);
  const tarjeta = { userId: 'dueno', pago: 'tarjeta', montoUSD: 100, stripe: { sessionId: 'cs_original' } };
  const sesion = { id: 'cs_original', currency: 'usd', amount_total: 10000 };
  assert.equal(pagoCorresponde(tarjeta, sesion, 'tarjeta', 'dueno'), true);
  assert.equal(pagoCorresponde(tarjeta, { ...sesion, id: 'cs_ajena' }, 'tarjeta', 'dueno'), false);
  assert.equal(pagoCorresponde(tarjeta, { ...sesion, amount_total: 1 }, 'tarjeta', 'dueno'), false);
  assert.ok(montoDelPedido({ precioUSD: Infinity }, 'mp', { tc: 1400 }).error);
  assert.ok(montoDelPedido({ precioUSD: 100 }, 'mp', { tc: -1400 }).error);
});

test('una firma Stripe con timestamp no numérico no evita el vencimiento', async () => {
  const cuerpo = '{}', secret = 'prueba';
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = Buffer.from(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(`NaN.${cuerpo}`))).toString('hex');
  assert.equal(await firmaStripeValida(secret, `t=NaN,v1=${firma}`, cuerpo), false);
});

test('las fotos bloquean SSRF, credenciales, puertos y redirecciones; limitan tamaño', async t => {
  const buena = 'https://m.media-amazon.com/images/I/prueba.jpg';
  assert.equal(urlImagenPermitida(buena), true);
  let solicitudes = 0;
  t.mock.method(globalThis, 'fetch', async (_url, opciones) => {
    solicitudes++;
    assert.equal(opciones.redirect, 'error');
    return new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } });
  });
  for (const mala of ['http://127.0.0.1/','https://169.254.169.254/','https://m.media-amazon.com.evil.invalid/a','https://m.media-amazon.com@localhost/a','https://m.media-amazon.com:8443/a','file:///etc/passwd']) {
    assert.equal(urlImagenPermitida(mala), false, mala);
    assert.equal(await bajarImagen(mala), null);
  }
  assert.equal(solicitudes, 0);
  assert.equal(await bajarImagen(buena), null);
  assert.equal(solicitudes, 1);
});

test('los tokens firmados también requieren proyecto, fechas e identidad válidos', async t => {
  const claves = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', claves.publicKey), kid: 'prueba-owasp' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [jwk] }));
  const ahora = Math.floor(Date.now() / 1000);
  const claims = { sub: 'dueno', aud: 'demo-marplacity', iss: 'https://securetoken.google.com/demo-marplacity', exp: ahora + 3600, iat: ahora - 10, auth_time: ahora - 10 };
  const token = async cambios => {
    const cab = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...claims, ...cambios })).toString('base64url');
    const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', claves.privateKey, new TextEncoder().encode(`${cab}.${body}`));
    return `${cab}.${body}.${Buffer.from(firma).toString('base64url')}`;
  };
  const env = { FIREBASE_PROJECT: 'demo-marplacity' };
  assert.equal(await verificarTokenDelDueño(env, await token({})), 'dueno');
  for (const cambio of [{ aud: 'otro' }, { iss: 'https://otro' }, { exp: ahora }, { iat: ahora + 60 }, { auth_time: ahora + 60 }, { sub: '' }, { exp: '9999999999' }]) {
    assert.equal(await verificarTokenDelDueño(env, await token(cambio)), null);
  }
});
