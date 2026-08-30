/**
 * Sube el certificado fiscal de ARCA al Worker, que lo cifra y lo guarda.
 *
 * POR QUE UN SCRIPT Y NO UNA PANTALLA DEL SISTEMA
 *
 * Porque la clave privada no puede pasar por el navegador. Con ella cualquiera emite
 * comprobantes a nombre del CUIT, y el navegador es el lugar menos controlado de todo
 * el sistema: extensiones, historial, caches, la maquina del local. Asi que el archivo
 * sale de tu disco, va por HTTPS al Worker, y el Worker lo cifra antes de guardarlo. En
 * Firestore nunca hay texto plano y en el repo no hay nada.
 *
 * USO
 *
 *   MC_EMAIL='tu@mail.com' MC_PASSWORD='tu-contraseña' \
 *   node workers/facturador/subir-certificado.mjs \
 *     --cert ~/arca-certs/marplacity.crt \
 *     --key  ~/arca-certs/marplacity.key \
 *     --entorno homo
 *
 * Para ver que hay cargado, sin subir nada:
 *
 *   MC_EMAIL=... MC_PASSWORD=... node workers/facturador/subir-certificado.mjs --ver
 *
 * Las credenciales son las tuyas del sistema y van por variable de entorno a proposito:
 * no quedan en este archivo ni en el repo. Necesita Node 18+ y openssl. No instala nada.
 *
 * LA CLAVE NO SE IMPRIME NUNCA, ni en un error ni en modo verboso. Si algun dia agregas
 * un console.log para depurar, sacalo antes de commitear.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PROJECT = process.env.FIREBASE_PROJECT || 'mis-gastos-21e7b';
// API key web de Firebase: es publica (viaja dentro de index.html). Lo que protege los
// datos son las Security Rules.
const API_KEY = process.env.FIREBASE_KEY || 'AIzaSyCxT-g9yMRhrRcjwI5uz3ITTWUB8ddeZCg';
const WORKER  = process.env.FACTURADOR_URL || 'https://facturador.fiwind702050.workers.dev';
const EMAIL    = process.env.MC_EMAIL;
const PASSWORD = process.env.MC_PASSWORD;

const arg = n => {
  const i = process.argv.indexOf('--' + n);
  return i > -1 ? process.argv[i + 1] : null;
};
const SOLO_VER = process.argv.includes('--ver');

const salir = msg => { console.error('\n✗ ' + msg + '\n'); process.exit(1); };

if (!EMAIL || !PASSWORD) {
  salir("Faltan las credenciales.\n\n  MC_EMAIL='tu@mail.com' MC_PASSWORD='tu-contraseña' node workers/facturador/subir-certificado.mjs ...");
}

// ── Login con tu usuario del sistema ─────────────────────────
async function idTokenDelDueño() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
  });
  if (!r.ok) salir('No se pudo iniciar sesion: ' + (await r.text()));
  return (await r.json()).idToken;
}

// ── Datos publicos del certificado ───────────────────────────
// De la clave privada NO se lee nada: para saber si es el par del certificado alcanza
// con comparar el modulo, y ni siquiera hace falta imprimirlo.
function datosDelCert(ruta) {
  const txt = execFileSync('openssl', ['x509', '-in', ruta, '-noout', '-subject', '-dates'], { encoding: 'utf8' });
  const subject   = /subject=\s*(.+)/.exec(txt)?.[1]?.trim() || '';
  const notBefore = /notBefore=(.+)/.exec(txt)?.[1]?.trim() || '';
  const notAfter  = /notAfter=(.+)/.exec(txt)?.[1]?.trim() || '';
  const cuit  = /CUIT\s*(\d{11})/.exec(subject)?.[1] || null;
  const alias = /CN\s*=\s*([^/,]+)/.exec(subject)?.[1]?.trim() || '';
  return { subject, notBefore, notAfter, cuit, alias };
}

function mismoPar(cert, key) {
  const md5 = args => execFileSync('openssl', args, { encoding: 'utf8' }).trim();
  const a = md5(['x509', '-in', cert, '-noout', '-modulus']);
  const b = md5(['rsa',  '-in', key,  '-noout', '-modulus']);
  return a === b;
}

/**
 * La clave, en PKCS#8. `openssl genrsa` escribe PKCS#1 (`BEGIN RSA PRIVATE KEY`) y
 * WebCrypto —lo unico que hay adentro de un Worker— solo importa PKCS#8. La conversion
 * es en memoria: no se escribe ningun archivo nuevo con la clave.
 */
function clavePkcs8(ruta) {
  const pem = readFileSync(ruta, 'utf8');
  if (pem.includes('BEGIN PRIVATE KEY')) return pem;
  if (!pem.includes('BEGIN RSA PRIVATE KEY')) salir('El archivo de la clave no parece un PEM.');
  return execFileSync('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', ruta], { encoding: 'utf8' });
}

// ── Main ─────────────────────────────────────────────────────
const token = await idTokenDelDueño();

if (SOLO_VER) {
  const entorno = arg('entorno') || 'homo';
  const cuit = arg('cuit');
  const url = `${WORKER}/certificado?entorno=${entorno}` + (cuit ? `&cuit=${cuit}` : '');
  const r = await fetch(url, { headers: { 'X-Firebase-Token': token } });
  console.log(JSON.stringify(await r.json(), null, 2));
  process.exit(r.ok ? 0 : 1);
}

const certRuta = arg('cert');
const keyRuta  = arg('key');
const entorno  = arg('entorno') || 'homo';

if (!certRuta || !keyRuta) salir('Faltan --cert y --key.');
if (!['homo', 'prod'].includes(entorno)) salir("--entorno tiene que ser 'homo' o 'prod'.");

const meta = datosDelCert(certRuta);
const cuit = arg('cuit') || meta.cuit;
if (!cuit) salir('No pude sacar el CUIT del certificado. Pasalo con --cuit.');

if (!mismoPar(certRuta, keyRuta)) {
  salir('La clave privada NO es la del certificado. Revisá que sean el par que generaste juntos.');
}

console.log('\nCertificado a subir');
console.log('  alias    ', meta.alias);
console.log('  CUIT     ', cuit);
console.log('  subject  ', meta.subject);
console.log('  vence    ', meta.notAfter);
console.log('  entorno  ', entorno === 'prod' ? 'PRODUCCION ⚠️' : 'homologacion');

if (entorno === 'prod') {
  console.log('\n⚠️  Estás subiendo un certificado de PRODUCCIÓN: con este se emiten comprobantes fiscales reales.');
}

const r = await fetch(`${WORKER}/certificado`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Firebase-Token': token },
  body: JSON.stringify({
    cuit,
    entorno,
    alias: meta.alias,
    certPem: readFileSync(certRuta, 'utf8'),
    keyPem: clavePkcs8(keyRuta),
    meta: { subject: meta.subject, notBefore: meta.notBefore, notAfter: meta.notAfter },
  }),
});

const res = await r.json().catch(() => ({}));
if (!r.ok || !res.ok) salir('El Worker rechazó la subida:\n' + JSON.stringify(res, null, 2));

console.log('\n✓ Guardado y cifrado en Firestore.\n');
