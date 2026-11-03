import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescatarSerie } from '../src/shared/serie.js';

test('el número de serie que quedó en notas pasa al campo IMEI/serie', () => {
  assert.deepEqual(rescatarSerie({ producto: 'iPhone 13', notas: 'S/N: F2LXK3ABCD12, sin caja' }), { producto: 'iPhone 13', imei: 'F2LXK3ABCD12', notas: 'sin caja' });
  assert.deepEqual(rescatarSerie({ producto: 'iPhone 13', notas: 'Serie f2lxk3abcd' }), { producto: 'iPhone 13', imei: 'F2LXK3ABCD', notas: null });
  assert.deepEqual(rescatarSerie({ producto: 'iPhone 13', notas: 'G6TZ91ABN72Q' }), { producto: 'iPhone 13', imei: 'G6TZ91ABN72Q', notas: null });
  assert.deepEqual(rescatarSerie({ producto: 'Moto G', notas: 'liberado - 356789012345678' }), { producto: 'Moto G', imei: '356789012345678', notas: 'liberado' });
});

test('no toca el item si ya tiene IMEI o si las notas no traen un número de serie', () => {
  const conImei = { imei: '356789012345678', notas: 'S/N F2LXK3ABCD' };
  assert.equal(rescatarSerie(conImei), conImei);
  const sinSerie = { notas: 'sin caja, liberado, LIBERADO' };
  assert.equal(rescatarSerie(sinSerie), sinSerie);
  assert.equal(rescatarSerie({ notas: 'Batería 87% 619 ciclos' }).imei, undefined);
});
