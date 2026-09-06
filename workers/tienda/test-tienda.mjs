/**
 * Chequeo sin red del Worker tienda: validación del pedido, montos y firma de MP.
 *
 *   node workers/tienda/test-tienda.mjs
 */
import assert from 'node:assert/strict';
import { validarPedido, montoDelPedido, firmaMPValida, firmaStripeValida } from './worker.js';

// ── validarPedido ──
const ok = validarPedido({ productoId: 'stock_1', pago: 'mp', entrega: 'retiro', nombre: 'Ana', whatsapp: '223 555-1234', email: 'ANA@x.com' });
assert.equal(ok.error, undefined);
assert.equal(ok.whatsapp, '2235551234');
assert.equal(ok.email, 'ana@x.com');
assert.ok(validarPedido({ productoId: 'x', pago: 'bitcoin', entrega: 'retiro', nombre: 'Ana', whatsapp: '2235551234' }).error);
assert.ok(validarPedido({ productoId: 'x', pago: 'mp', entrega: 'envio', nombre: 'Ana', whatsapp: '2235551234' }).error, 'envío sin dirección');
assert.ok(validarPedido({ productoId: 'x', pago: 'mp', entrega: 'retiro', nombre: 'Ana', whatsapp: '12' }).error, 'whatsapp corto');

// ── montoDelPedido ──
const cobro = { tc: 1410, recargoTarjetaPct: 5, recargoMpPct: 8, mpMaxUSD: 200 };
assert.deepEqual(montoDelPedido({ precioUSD: 150 }, 'mp', cobro), { montoUSD: 150, montoARS: 228420, tc: 1410 }, 'MP lleva 8%');
assert.equal(montoDelPedido({ precioUSD: 150 }, 'mp', { tc: 1410, mpMaxUSD: 200 }).montoARS, 211500, 'sin recargo cargado, sin recargo');
assert.ok(montoDelPedido({ precioUSD: 950 }, 'mp', cobro).error, 'un teléfono no va por MP');
assert.equal(montoDelPedido({ precioUSD: 950 }, 'tarjeta', cobro).montoUSD, 998, 'tarjeta lleva 5%');
assert.equal(montoDelPedido({ precioUSD: 950 }, 'efectivo', cobro).montoUSD, 950);
assert.ok(montoDelPedido({ precioUSD: 150 }, 'mp', { tc: 0 }).error, 'sin tipo de cambio no se cobra en pesos');

// ── firmaMPValida ──
// Firma calculada con la clave "clave-de-prueba" sobre "id:123;request-id:req-1;ts:1700000000;"
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('clave-de-prueba'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('id:123;request-id:req-1;ts:1700000000;'));
const v1 = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
assert.equal(await firmaMPValida('clave-de-prueba', `ts=1700000000,v1=${v1}`, 'req-1', '123'), true);
assert.equal(await firmaMPValida('clave-de-prueba', `ts=1700000000,v1=${v1}`, 'req-1', '124'), false, 'otro id, otra firma');
assert.equal(await firmaMPValida('', 'lo que sea', 'req-1', '123'), true, 'sin clave cargada no se verifica');

// ── firmaStripeValida ──
{
  const secret = 'whsec_prueba', cuerpo = '{"id":"evt_1","type":"checkout.session.completed"}', t = 1700000000;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const m = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${t}.${cuerpo}`));
  const hex = [...new Uint8Array(m)].map(b => b.toString(16).padStart(2, '0')).join('');
  const ahora = t * 1000 + 60_000;
  assert.equal(await firmaStripeValida(secret, `t=${t},v1=${hex}`, cuerpo, ahora), true);
  assert.equal(await firmaStripeValida(secret, `t=${t},v1=${hex}`, cuerpo + ' ', ahora), false, 'otro cuerpo, otra firma');
  assert.equal(await firmaStripeValida(secret, `t=${t},v1=${hex}`, cuerpo, ahora + 10 * 60_000), false, 'un aviso de hace 10 minutos no vale');
  assert.equal(await firmaStripeValida('', `t=${t},v1=${hex}`, cuerpo, ahora), false, 'sin secret no se acepta nada');
}

console.log('Todo verde');
