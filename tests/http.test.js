import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { crearApp } from '../server/app.js';
import { cargarConfig, configPublica } from '../server/config.js';
import { crearTareas } from '../server/http/servicios.js';
import { firmaStripeValida } from '../server/services/tienda/worker.js';

async function levantar(t, env = {}, opciones = {}) {
  const config = cargarConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test', ...env });
  const sistema = await crearApp(config, opciones);
  const server = sistema.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await sistema.cerrar(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('la configuración pública nunca incluye credenciales', () => {
  const config = cargarConfig({ ANTHROPIC_KEY: 'secreto-prueba', FAC_PASSWORD: 'otra-clave' });
  assert.equal(JSON.stringify(configPublica(config)).includes('secreto-prueba'), false);
  assert.deepEqual(Object.keys(configPublica(config)).sort(), ['api', 'basePublica']);
  assert.throws(() => cargarConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => cargarConfig({ IA_REMOTE_URL: 'http://inseguro.example' }), /HTTPS/);
  assert.throws(() => cargarConfig({ IA_REMOTE_URL: 'https://nombre:clave@example.com' }), /credenciales/);
});

test('el servidor expone salud y configuración, sin publicar el repositorio', async t => {
  const base = await levantar(t);
  const salud = await fetch(base + '/api/salud');
  assert.equal(salud.status, 200);
  assert.equal((await salud.json()).runtime, 'Node.js');
  assert.equal(salud.headers.get('cache-control'), 'no-store');
  for (const ruta of ['/.env', '/package.json', '/server/config.js', '/.git/config', '/firestore.rules', '/tests/fixtures/firebase.js', '/api/inexistente']) {
    assert.equal((await fetch(base + ruta)).status, 404, ruta);
  }
  const origenAjeno = await fetch(base + '/api/config', { headers: { Origin: 'https://sitio-ajeno.invalid' } });
  assert.equal(origenAjeno.status, 403);
});

test('bloquea sitios cruzados sin Origin, host falso y embebido; limita abuso', async t => {
  let llamadas = 0;
  const base = await levantar(t, { API_LIMITE_POR_MINUTO: '2' }, { fetchImpl: async () => { llamadas++; return Response.json({ ok: true }); } });
  const cab = (await fetch(base)).headers;
  assert.match(cab.get('content-security-policy'), /object-src 'none'/);
  assert.match(cab.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(cab.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/api/config', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const hostFalso = await new Promise((resolve, reject) => {
    get(base + '/api/config', { headers: { Host: 'atacante.invalid' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(hostFalso, 403);
  for (let i = 0; i < 2; i++) assert.equal((await fetch(base + '/api/tienda/pedido', { method: 'POST', body: '{}' })).status, 200);
  const bloqueada = await fetch(base + '/api/tienda/pedido', { method: 'POST', body: '{}' });
  assert.equal(bloqueada.status, 429);
  assert.ok(bloqueada.headers.get('retry-after'));
  assert.equal(llamadas, 2);
  assert.equal((await fetch(base + '/api/salud')).status, 200);
});

test('el proxy conserva cuerpo, token y ruta pero nunca reenvía cookies o credenciales del host', async t => {
  let observado;
  const base = await levantar(t, {}, { fetchImpl: async (url, opciones) => {
    observado = { url: String(url), opciones };
    return Response.json({ id: 'pedido-prueba' }, { status: 201 });
  } });
  const cuerpo = '{ "productoId": "stock-1", "nombre": "Prueba" }';
  const r = await fetch(base + '/api/tienda/pedido?modo=prueba', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firebase-Token': 'token-prueba', Cookie: 'sesion=privada' }, body: cuerpo });
  assert.equal(r.status, 201);
  assert.equal(observado.url, 'https://tienda.fiwind702050.workers.dev/pedido?modo=prueba');
  assert.equal(observado.opciones.body.toString(), cuerpo);
  assert.equal(observado.opciones.headers.get('X-Firebase-Token'), 'token-prueba');
  assert.equal(observado.opciones.headers.has('cookie'), false);
});

test('un servicio remoto caído devuelve un error legible sin filtrar detalles', async t => {
  const base = await levantar(t, {}, { fetchImpl: async () => { throw new Error('clave-privada'); } });
  const r = await fetch(base + '/api/ia', { method: 'POST', body: '{}' });
  assert.equal(r.status, 502);
  assert.equal((await r.text()).includes('clave-privada'), false);
});

test('los servicios nativos no ejecutan operaciones con configuración incompleta', async t => {
  const base = await levantar(t, { SERVICIO_TIENDA: 'local' });
  const r = await fetch(base + '/api/tienda/pedido', { method: 'POST', body: '{}' });
  assert.equal(r.status, 503);
  assert.ok((await r.json()).campos.includes('TIENDA_PASSWORD'));
});

test('Node ejecuta la lógica nativa de tienda y valida pedidos sin consultar servicios externos', async t => {
  const base = await levantar(t, { SERVICIO_TIENDA: 'local', OWNER_UID: 'prueba', TIENDA_EMAIL: 'prueba', TIENDA_PASSWORD: 'prueba' });
  const r = await fetch(base + '/api/tienda/pedido', { method: 'POST', body: JSON.stringify({ productoId: 'x', pago: 'invalido' }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /forma de pago/);
});

test('el adaptador nativo conserva exactamente los bytes que firma Stripe', async t => {
  const cuerpo = '{\n  "id": "evt_prueba"\n}';
  const secret = 'whsec_prueba';
  const segundos = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firmado = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${segundos}.${cuerpo}`));
  const hex = Buffer.from(firmado).toString('hex');
  const base = await levantar(t, { SERVICIO_TIENDA: 'local', OWNER_UID: 'prueba', TIENDA_EMAIL: 'prueba', TIENDA_PASSWORD: 'prueba' }, { servicios: { tienda: { async fetch(req) {
    const valido = await firmaStripeValida(secret, req.headers.get('stripe-signature'), await req.text());
    return Response.json({ valido });
  } } } });
  const r = await fetch(base + '/api/tienda/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${segundos},v1=${hex}` }, body: cuerpo });
  assert.deepEqual(await r.json(), { valido: true });
});

test('las tareas de webhooks se esperan al detener el servidor', async () => {
  let resolver;
  const tareas = crearTareas({ error() {} });
  tareas.waitUntil(new Promise(resolve => { resolver = resolve; }));
  assert.equal(tareas.cantidad, 1);
  resolver();
  await tareas.terminar();
  assert.equal(tareas.cantidad, 0);
});

test('facturación, Instagram e IA nativos rechazan solicitudes sin identidad válida', async t => {
  const base = await levantar(t, {
    SERVICIO_FACTURADOR: 'local', SERVICIO_INSTAGRAM: 'local', SERVICIO_IA: 'local',
    OWNER_UID: 'prueba', FAC_EMAIL: 'prueba', FAC_PASSWORD: 'prueba', ARCA_CUIT: '00000000000', CERT_MASTER_KEY: 'prueba',
    BOT_EMAIL: 'prueba', BOT_PASSWORD: 'prueba', IG_APP_SECRET: 'prueba', IG_VERIFY_TOKEN: 'prueba', IG_ACCOUNT_ID: 'prueba', ANTHROPIC_KEY: 'prueba',
  });
  for (const ruta of ['/api/facturador/emitir', '/api/instagram', '/api/ia']) {
    const r = await fetch(base + ruta, { method: 'POST', body: '{}' });
    assert.equal(r.status, 401, ruta);
  }
});
