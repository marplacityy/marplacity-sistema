import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, listAll, deleteObject } from 'firebase/storage';
import { urlSubidaStorage } from '../../server/services/tienda/fotos.js';

// Este archivo SOLO puede ejecutarse contra el emulador local, nunca contra el local real.
if (process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') throw new Error('Usá npm run test:reglas (emulador aislado).');

const PROYECTO = 'demo-marplacity';
const BUCKET = `${PROYECTO}.appspot.com`;
const JPG = { contentType: 'image/jpeg' };
// Lo mínimo para que sea una imagen: a las reglas les importa el tipo y el tamaño, no el contenido.
const foto = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

let entorno;
const fotos = uid => uid ? entorno.authenticatedContext(uid).storage() : entorno.unauthenticatedContext().storage();

before(async () => {
  entorno = await initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile('storage.rules', 'utf8') },
  });
});
after(async () => { await entorno?.cleanup(); });
beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.clearStorage();
  await entorno.withSecurityRulesDisabled(async contexto => {
    await setDoc(doc(contexto.firestore(), 'catalogo/publico'), { userId: 'dueno', productos: [] });
    await uploadBytes(ref(contexto.storage(), 'fotos/iphone-15-black.jpg'), foto(), JPG);
    await uploadBytes(ref(contexto.storage(), 'privado/nota.jpg'), foto(), JPG);
  });
});

test('las fotos las lee y las lista cualquiera, también sin sesión', async () => {
  await assertSucceeds(getBytes(ref(fotos(), 'fotos/iphone-15-black.jpg')));
  await assertSucceeds(listAll(ref(fotos(), 'fotos')));
  await assertFails(getBytes(ref(fotos(), 'privado/nota.jpg')));
  await assertFails(getBytes(ref(fotos('dueno'), 'privado/nota.jpg')));
});

test('el dueño del local sube y pisa fotos', async () => {
  const s = fotos('dueno');
  await assertSucceeds(uploadBytes(ref(s, 'fotos/iphone-17-white.jpg'), foto(), JPG));
  await assertSucceeds(uploadBytes(ref(s, 'fotos/iphone-17-white-2.png'), foto(), { contentType: 'image/png' }));
  await assertSucceeds(uploadBytes(ref(s, 'fotos/iphone-17-white-3.webp'), foto(), { contentType: 'image/webp' }));
  await assertSucceeds(uploadBytes(ref(s, 'fotos/16promaxwhite.jpeg'), foto(), JPG));
  // pisar una que ya está
  await assertSucceeds(uploadBytes(ref(s, 'fotos/iphone-15-black.jpg'), foto(), JPG));
});

test('nadie más sube: ni sin sesión ni otra cuenta', async () => {
  await assertFails(uploadBytes(ref(fotos(), 'fotos/iphone-17-white.jpg'), foto(), JPG));
  await assertFails(uploadBytes(ref(fotos('otra-cuenta'), 'fotos/iphone-17-white.jpg'), foto(), JPG));
  await assertFails(uploadBytes(ref(fotos('otra-cuenta'), 'fotos/iphone-15-black.jpg'), foto(), JPG));
});

test('el dueño solo sube imágenes, con el nombre que arma el sistema y dentro de fotos/', async () => {
  const s = fotos('dueno');
  await assertFails(uploadBytes(ref(s, 'fotos/factura.pdf'), foto(), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(s, 'fotos/iphone-17-white.jpg'), foto(), { contentType: 'text/html' }));
  await assertFails(uploadBytes(ref(s, 'fotos/sub/iphone-17-white.jpg'), foto(), JPG));
  await assertFails(uploadBytes(ref(s, 'fotos/iPhone 17.jpg'), foto(), JPG));
  await assertFails(uploadBytes(ref(s, 'fotos/-white.jpg'), foto(), JPG));
  await assertFails(uploadBytes(ref(s, 'otra/iphone-17-white.jpg'), foto(), JPG));
  await assertFails(uploadBytes(ref(s, 'iphone-17-white.jpg'), foto(), JPG));
});

test('las fotos no se borran, tampoco el dueño', async () => {
  await assertFails(deleteObject(ref(fotos('dueno'), 'fotos/iphone-15-black.jpg')));
  await assertFails(deleteObject(ref(fotos(), 'fotos/iphone-15-black.jpg')));
});

// ── La subida del Worker tienda: por la API REST, con el token que mandó el dueño ──

/** Un ID token como los que acepta el emulador: sin firma. */
function tokenDePrueba(uid) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROYECTO}`, aud: PROYECTO, sub: uid, user_id: uid,
    iat: ahora, exp: ahora + 3600, auth_time: ahora, firebase: { sign_in_provider: 'custom', identities: {} },
  })}.`;
}

/** La misma solicitud que arma subirAStorage(), apuntada al emulador. */
function subirComoElWorker(archivo, token, tipo = 'image/jpeg') {
  const url = urlSubidaStorage(BUCKET, archivo).replace('https://firebasestorage.googleapis.com', 'http://127.0.0.1:9199');
  return fetch(url, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Firebase ${token}` } : {}), 'Content-Type': tipo },
    body: foto(),
  });
}

test('el Worker tienda sube por REST con el token del dueño, y sin él no', async () => {
  const bien = await subirComoElWorker('iphone-17-white.jpg', tokenDePrueba('dueno'));
  assert.equal(bien.status, 200, await bien.text());
  await assertSucceeds(getBytes(ref(fotos(), 'fotos/iphone-17-white.jpg')));

  assert.equal((await subirComoElWorker('iphone-17-black.jpg', tokenDePrueba('otra-cuenta'))).status, 403);
  assert.equal((await subirComoElWorker('iphone-17-black.jpg', '')).status, 403);
  assert.equal((await subirComoElWorker('iphone-17-black.jpg', tokenDePrueba('dueno'), 'text/html')).status, 403);
});
