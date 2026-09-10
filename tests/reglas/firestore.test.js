import { test, before, after, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where } from 'firebase/firestore';

// Este archivo SOLO puede ejecutarse contra el emulador local, nunca contra el local real.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085') throw new Error('Usá npm run test:reglas (emulador aislado).');
let entorno;
const db = uid => uid ? entorno.authenticatedContext(uid, { email: `${uid}@example.invalid` }).firestore() : entorno.unauthenticatedContext().firestore();
before(async () => {
  entorno = await initializeTestEnvironment({ projectId: 'demo-marplacity', firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') } });
});
after(async () => { await entorno?.cleanup(); });
beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async contexto => {
    const base = contexto.firestore();
    for (const [path, valor] of Object.entries({
      'catalogo/publico': { userId: 'dueno', productos: [] },
      'catalogo/fotos': { userId: 'dueno', fotos: {} },
      'stock/equipo': { userId: 'dueno', nombre: 'Equipo ficticio' },
      'stock/ajeno': { userId: 'otra-cuenta', nombre: 'Equipo ajeno' },
      'pedidos/pedido': { userId: 'dueno', estado: 'pagado', montoUSD: 100 },
      'pedidos/ajeno': { userId: 'otra-cuenta', estado: 'pagado', montoUSD: 100 },
      'docs_publicos/token-aleatorio-de-prueba': { userId: 'dueno', pdf: 'ficticio' },
    })) await setDoc(doc(base, path), valor);
  });
});

test('solo el dueño puede cambiar el catálogo, sin apropiarse de él ni borrarlo', async () => {
  await assertSucceeds(getDoc(doc(db(), 'catalogo/publico')));
  await assertFails(getDocs(collection(db(), 'catalogo')));
  await assertFails(setDoc(doc(db('otra-cuenta'), 'catalogo/publico'), { userId: 'otra-cuenta', productos: [] }));
  await assertFails(updateDoc(doc(db('otra-cuenta'), 'catalogo/fotos'), { userId: 'otra-cuenta' }));
  await assertFails(setDoc(doc(db('otra-cuenta'), 'catalogo/nuevo'), { userId: 'otra-cuenta' }));
  await assertSucceeds(updateDoc(doc(db('dueno'), 'catalogo/publico'), { productos: [{ nombre: 'Otro equipo' }] }));
  await assertFails(updateDoc(doc(db('dueno'), 'catalogo/publico'), { userId: 'otra-cuenta' }));
  await assertFails(deleteDoc(doc(db('dueno'), 'catalogo/publico')));
});

test('una cuenta nueva administra sus datos sin leer ni escribir los de otra', async () => {
  const propia = db('nueva');
  await assertSucceeds(setDoc(doc(propia, 'config/nueva'), { userId: 'nueva', nombre: 'Local nuevo' }));
  await assertSucceeds(setDoc(doc(propia, 'stock/nuevo'), { userId: 'nueva', nombre: 'Equipo nuevo' }));
  await assertSucceeds(getDocs(query(collection(propia, 'stock'), where('userId', '==', 'nueva'))));
  await assertFails(getDocs(collection(propia, 'stock')));
  await assertFails(getDoc(doc(propia, 'stock/equipo')));
  await assertFails(updateDoc(doc(propia, 'stock/equipo'), { nombre: 'Modificado' }));
  await assertFails(updateDoc(doc(propia, 'stock/nuevo'), { userId: 'dueno' }));
  await assertFails(getDoc(doc(db(), 'stock/equipo')));
});

test('nadie se apropia de los documentos globales del bot al crearlos', async () => {
  for (const nombre of ['bot', 'prompt', 'mensajes']) {
    await assertFails(setDoc(doc(db('nueva'), `config/${nombre}`), { userId: 'nueva' }));
    await assertSucceeds(setDoc(doc(db('dueno'), `config/${nombre}`), { userId: 'dueno' }));
    await assertFails(updateDoc(doc(db('nueva'), `config/${nombre}`), { userId: 'nueva' }));
  }
});

test('el dueño cierra pedidos pero no falsifica su cobro ni cambia sus importes', async () => {
  const pedido = doc(db('dueno'), 'pedidos/pedido');
  await assertFails(updateDoc(pedido, { montoUSD: 1 }));
  await assertFails(updateDoc(pedido, { estado: 'pagado', montoUSD: 1 }));
  await assertSucceeds(updateDoc(pedido, { estado: 'entregado', actualizado: '2026-09-10', cerradoPor: 'dueno@example.invalid' }));
  await assertFails(updateDoc(pedido, { estado: 'pagado' }));
  await assertFails(updateDoc(doc(db('otra-cuenta'), 'pedidos/pedido'), { estado: 'cancelado' }));
});

test('usuarios de servicio solo acceden a los datos del local que atienden', async () => {
  const bot = db('s8mcf3uMoBc0S3G2HMR9htqLU403');
  await assertSucceeds(getDoc(doc(bot, 'stock/equipo')));
  await assertFails(getDoc(doc(bot, 'stock/ajeno')));
  await assertSucceeds(getDocs(query(collection(bot, 'stock'), where('userId', '==', 'dueno'))));
  await assertFails(setDoc(doc(bot, 'conversaciones/ajena'), { userId: 'otra-cuenta' }));
  const tienda = db('vhF3llim3Ghy8OOzKFodUuGfLmD2');
  await assertSucceeds(getDoc(doc(tienda, 'pedidos/pedido')));
  await assertFails(getDoc(doc(tienda, 'pedidos/ajeno')));
  await assertFails(setDoc(doc(tienda, 'pedidos/nuevo'), { userId: 'otra-cuenta' }));
  await assertSucceeds(updateDoc(doc(tienda, 'pedidos/pedido'), { estado: 'devuelto' }));
});

test('documentos públicos solo por token; material fiscal cerrado para usuarios', async () => {
  await assertSucceeds(getDoc(doc(db(), 'docs_publicos/token-aleatorio-de-prueba')));
  await assertFails(getDocs(collection(db(), 'docs_publicos')));
  await assertFails(getDoc(doc(db('dueno'), 'fiscal_certs/prueba_homo')));
  await assertFails(setDoc(doc(db('dueno'), 'fiscal_certs/prueba_homo'), { clave: 'no' }));
});
