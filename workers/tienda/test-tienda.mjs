/**
 * Chequeo sin red del Worker tienda: validación del pedido, montos y firma de MP.
 *
 *   node workers/tienda/test-tienda.mjs
 */
import assert from 'node:assert/strict';
import { validarPedido, montoDelPedido, firmaMPValida, firmaStripeValida } from './worker.js';
import { elegirImagenes, slugFoto, nombreParaAmazon } from './fotos.js';

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
assert.equal(await firmaMPValida('', 'lo que sea', 'req-1', '123'), false, 'sin clave cargada se rechaza');

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

// ── elegirImagenes ──
{
  const res = [
    { title: 'Apple iPhone 13, 128GB, Red - Unlocked (Renewed)', thumbnail: 'https://m.media-amazon.com/images/I/a._AC_UY218_.jpg' },
    { title: 'Silicone Case for iPhone 13 Red with MagSafe', thumbnail: 'https://m.media-amazon.com/images/I/b._AC_UY218_.jpg' },
    { title: 'Apple iPhone 13 Pro 128GB Graphite', thumbnail: 'https://m.media-amazon.com/images/I/c.jpg' },
    { title: 'Apple iPhone 13 (Product) RED 256GB', thumbnail: 'https://m.media-amazon.com/images/I/a._AC_UY218_.jpg' },   // misma imagen
    { title: 'Apple iPhone 13 Red 512GB', thumbnail: 'https://m.media-amazon.com/images/I/d._SX300_.jpg' },
  ];
  const u = elegirImagenes(res, { nombre: 'iPhone 13', color: 'Red' });
  assert.deepEqual(u, ['https://m.media-amazon.com/images/I/a.jpg', 'https://m.media-amazon.com/images/I/d.jpg'], 'sin fundas, sin el Pro, sin repetidas, sin sufijo de tamaño');
  assert.deepEqual(elegirImagenes(res, { nombre: 'iPhone 13', color: 'Blue' }), [], 'otro color, nada');
  assert.equal(elegirImagenes([{ title: 'USB-C Cable 2m Apple', thumbnail: 'https://m.media-amazon.com/images/I/y.jpg' }], { nombre: 'USB-C Cable', esAccesorio: true }).length, 1, 'un accesorio no se filtra por ser accesorio');
  assert.equal(slugFoto('iPhone 13 128GB'), 'iphone-13');
  assert.equal(slugFoto('iPhone 13 (Usado Grado A, 100% Ampsentrix)'), 'iphone-13', 'el estado no es parte del modelo');
  assert.equal(slugFoto('iPhone 14 Pro (Usado Grado A, 87-89%)'), 'iphone-14-pro');
  assert.equal(nombreParaAmazon('iPhone 13 Pro Max (Usado Grado A, 100% Ampsentrix)'), 'iPhone 13 Pro Max');
  assert.equal(nombreParaAmazon('AirPods Max ( USB - C ) Black Black'), 'AirPods Max Black');   // el paréntesis se va entero, y 'Black Black' queda una vez
  assert.equal(nombreParaAmazon('iPhone 17 Lavander'), 'iPhone 17 Lavender');
  const verde = [{ title: 'Apple Watch Ultra 2 [GPS + Cellular 49mm] Titanium Case with Green Alpine Loop', thumbnail: 'https://m.media-amazon.com/images/I/g.jpg' }];
  assert.equal(elegirImagenes(verde, { nombre: 'Apple Watch Ultra 2 49mm', color: 'Dark Green' }).length, 1, 'Dark Green encuentra Green');

  // Nombres de lista → como los escribe Amazon.
  assert.equal(nombreParaAmazon('Apple Watch Serie 10 46mm GPS M/L Silver Aluminio · Denim SB'), 'Apple Watch Series 10 46mm Silver Aluminum');
  assert.equal(nombreParaAmazon('Genuine Apple\u200e USB-C to C Cable'), 'Apple USB-C to C Cable');
  assert.equal(nombreParaAmazon('MacBook NEO A18 13" 8GB RAM 256GB Citrus'), 'MacBook NEO A18 13" 256GB Citrus');
  // Un reloj con la medida en el título de Amazon pasa aunque falte "aluminum".
  const reloj = [{ title: 'Apple Watch Series 10 [GPS 46mm] Smartwatch with Silver Aluminum Case', thumbnail: 'https://m.media-amazon.com/images/I/w.jpg' }];
  assert.equal(elegirImagenes(reloj, { nombre: 'Apple Watch Serie 10 46mm GPS M/L Silver Aluminio · Denim SB', color: '' }).length, 1, 'reloj de lista encontrado');
}

console.log('Todo verde');
