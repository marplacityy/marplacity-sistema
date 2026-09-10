import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularTotales, letraPara, NOTA_CREDITO_DE } from '../server/services/facturador/comprobante.js';
import { cifrar, descifrar } from '../server/services/facturador/cripto.js';

test('Node conserva los totales por alícuota y admite precios finales o netos', () => {
  const tabla = [{ id: 5, desc: '21%' }, { id: 4, desc: '10,5%' }];
  const finales = calcularTotales([
    { descripcion: 'Equipo de prueba', cantidad: 1, precioUnitario: 121, alicuotaIva: 21 },
    { descripcion: 'Artículo de prueba', cantidad: 2, precioUnitario: 110.5, alicuotaIva: 10.5 },
  ], tabla);
  assert.equal(finales.impNeto, 300);
  assert.equal(finales.impIVA, 42);
  assert.equal(finales.impTotal, 342);
  const netos = calcularTotales([{ cantidad: 1, precioUnitario: 100, alicuotaIva: 21 }], tabla, { precioIncluyeIva: false });
  assert.equal(netos.impTotal, 121);
  assert.throws(() => calcularTotales([{ precioUnitario: 100, alicuotaIva: 27 }], tabla), /alicuota/);
});

test('la letra y la nota de crédito conservan su correspondencia', () => {
  const tabla = [{ id: 1, desc: 'IVA Responsable Inscripto' }, { id: 5, desc: 'Consumidor Final' }];
  assert.equal(letraPara(1, tabla).letra, 'A');
  assert.equal(letraPara(5, tabla).letra, 'B');
  assert.equal(NOTA_CREDITO_DE[letraPara(1, tabla).cbteTipo], 3);
  assert.equal(NOTA_CREDITO_DE[letraPara(5, tabla).cbteTipo], 8);
});

test('el material cifrado se puede leer en Node y no con otra identidad o entorno', async () => {
  const env = { CERT_MASTER_KEY: Buffer.alloc(32, 1).toString('base64') };
  const sobre = await cifrar(env, 'identidad-ficticia', 'homo', 'documento ficticio');
  assert.equal(await descifrar(env, 'identidad-ficticia', 'homo', sobre), 'documento ficticio');
  await assert.rejects(() => descifrar(env, 'otra-identidad', 'homo', sobre), /no se pudo descifrar/);
  await assert.rejects(() => descifrar(env, 'identidad-ficticia', 'prod', sobre), /no se pudo descifrar/);
});
