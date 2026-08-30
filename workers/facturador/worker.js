/**
 * Worker facturador — factura electronica de ARCA (WSAA + WSFEv1).
 * ----------------------------------------------------------------
 * Emite comprobantes con CAE contra los webservices oficiales, sin intermediarios.
 *
 * Este archivo es el esqueleto: routing, salud y el interruptor de entorno. La
 * autenticacion (WSAA), la emision (WSFEv1) y el guardado del comprobante llegan en los
 * puntos siguientes.
 *
 * DOS COSAS QUE NO SE NEGOCIAN, y estan escritas en el codigo, no solo en el README:
 *
 * 1. El certificado y la clave privada NUNCA pasan por el navegador ni entran al repo.
 *    Se suben con un script local y se guardan cifrados. Si alguna vez un cambio hace
 *    que la clave privada viaje al front, el diseño esta mal.
 *
 * 2. Homologacion es el default. Emitir en produccion exige que el entorno este puesto
 *    explicitamente Y que el pedido lo confirme; ver `entornoDe()`.
 */

import { cifrar } from './cripto.js';
import { loginFacturador, esElDueño } from './identidad.js';
import { leerDoc, escribirDoc } from './firestore.js';

// ── Entornos ──────────────────────────────────────────────────
//
// Las URLs salen del manual del desarrollador de WSFEv1 (v4.7) y del WSDL publicado.
// No se arman a mano ni se derivan una de la otra: son cuatro constantes y punto.
const ENTORNOS = {
  homo: {
    nombre: 'HOMOLOGACION',
    wsaa:   'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfev1: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  prod: {
    nombre: 'PRODUCCION',
    wsaa:   'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfev1: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};

// El QR de los comprobantes apunta siempre acá, en los dos entornos: es la pagina donde
// el que recibe la factura la verifica. Sale de la especificacion oficial de ARCA.
const QR_URL = 'https://www.arca.gob.ar/fe/qr/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Firebase-Token',
};

/**
 * Donde vive el material fiscal de un CUIT. Un doc por CUIT y entorno: el certificado de
 * homologacion y el de produccion son distintos y no se pisan.
 */
const docCert = (cuit, entorno) => `fiscal_certs/${cuit}_${entorno}`;

/**
 * En que entorno esta parado el Worker. Sin variable, homologacion: el default nunca
 * puede ser el que emite comprobantes fiscales de verdad.
 */
function entornoDe(env) {
  const clave = (env.ARCA_ENTORNO || 'homo').toLowerCase();
  const cfg = ENTORNOS[clave];
  if (!cfg) return { clave: 'homo', ...ENTORNOS.homo, invalido: clave };
  return { clave, ...cfg };
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // Salud: que variables estan cargadas y en que entorno esta parado. Devuelve
    // true/false, nunca el valor: esto es una URL publica.
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/salud')) {
      const ent = entornoDe(env);
      return json({
        ok: true,
        entorno: ent.nombre,
        entornoInvalido: ent.invalido || undefined,
        endpoints: { wsaa: ent.wsaa, wsfev1: ent.wsfev1, qr: QR_URL },
        vars: {
          ARCA_ENTORNO: !!env.ARCA_ENTORNO,
          ARCA_CUIT: !!env.ARCA_CUIT,
          FIREBASE_PROJECT: !!env.FIREBASE_PROJECT,
          FIREBASE_KEY: !!env.FIREBASE_KEY,
          OWNER_UID: !!env.OWNER_UID,
          FAC_EMAIL: !!env.FAC_EMAIL,
          FAC_PASSWORD: !!env.FAC_PASSWORD,
          CERT_MASTER_KEY: !!env.CERT_MASTER_KEY,
        },
      });
    }

    // ── El certificado ────────────────────────────────────────
    // Las dos rutas son solo para el dueño, y el token se verifica de verdad (firma,
    // emisor, destinatario, vencimiento y uid). Sin eso, el que descubra esta URL sube
    // su propio certificado y factura a nombre nuestro.
    if (url.pathname === '/certificado') {
      if (!(await esElDueño(env, request))) {
        return json({ ok: false, error: 'no autorizado' }, 401);
      }
      if (request.method === 'POST') return guardarCertificado(request, env);
      if (request.method === 'GET')  return estadoCertificado(url, env);
      return json({ ok: false, error: 'usa GET o POST' }, 405);
    }

    return json({ ok: false, error: 'ruta no encontrada' }, 404);
  },
};

/**
 * Recibe el certificado y la clave privada, los valida, los cifra y los guarda.
 *
 * La clave llega en PKCS#8 (`BEGIN PRIVATE KEY`), no en el PKCS#1 que escupe `openssl
 * genrsa`: WebCrypto solo importa PKCS#8, y el que convierte es el script de subida.
 * Se rechaza el PKCS#1 con el comando exacto para convertirlo, en vez de guardarlo y
 * fallar recien cuando haya que firmar.
 */
async function guardarCertificado(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'el cuerpo no es JSON' }, 400); }

  const { cuit, entorno, alias, certPem, keyPem, meta } = body || {};

  if (!/^\d{11}$/.test(String(cuit || ''))) return json({ ok: false, error: 'cuit invalido: son 11 digitos' }, 400);
  if (!ENTORNOS[entorno]) return json({ ok: false, error: "entorno tiene que ser 'homo' o 'prod'" }, 400);
  if (!certPem?.includes('BEGIN CERTIFICATE')) return json({ ok: false, error: 'el certificado no parece un PEM' }, 400);
  if (keyPem?.includes('BEGIN RSA PRIVATE KEY')) {
    return json({
      ok: false,
      error: 'la clave esta en PKCS#1 y hace falta PKCS#8',
      comoConvertir: 'openssl pkcs8 -topk8 -nocrypt -in tu.key',
    }, 400);
  }
  if (!keyPem?.includes('BEGIN PRIVATE KEY')) return json({ ok: false, error: 'la clave no parece un PEM PKCS#8' }, 400);

  // Que importe con WebCrypto es la prueba de que sirve para firmar. Mejor que se caiga
  // aca, subiendo, que en la primera factura.
  try { await importarClave(keyPem); }
  catch (e) { return json({ ok: false, error: 'la clave no se pudo importar: ' + e.message }, 400); }

  const idToken = await loginFacturador(env);
  if (!idToken) return json({ ok: false, error: 'el Worker no pudo loguearse a Firestore' }, 500);

  try {
    const [cert, clave] = await Promise.all([
      cifrar(env, cuit, entorno, certPem),
      cifrar(env, cuit, entorno, keyPem),
    ]);
    await escribirDoc(env, idToken, docCert(cuit, entorno), {
      cuit: String(cuit),
      entorno,
      alias: alias || '',
      // Metadatos publicos del certificado, para poder avisar que vence sin descifrar
      // nada. Los manda el script, que ya los leyo con openssl.
      subject:    meta?.subject    || '',
      notBefore:  meta?.notBefore  || '',
      notAfter:   meta?.notAfter   || '',
      cert,
      clave,
      subidoEn: new Date().toISOString(),
    });
    console.log(`certificado guardado: ${cuit} ${entorno} (vence ${meta?.notAfter || 'sin dato'})`);
    return json({ ok: true, guardado: { cuit: String(cuit), entorno, alias, notAfter: meta?.notAfter || null } });
  } catch (e) {
    console.log('no se pudo guardar el certificado:', e.message);
    return json({ ok: false, error: e.message }, 500);
  }
}

/** Que hay guardado, sin devolver jamas el material: solo los datos publicos. */
async function estadoCertificado(url, env) {
  const cuit = url.searchParams.get('cuit') || env.ARCA_CUIT;
  const entorno = url.searchParams.get('entorno') || entornoDe(env).clave;
  if (!/^\d{11}$/.test(String(cuit || ''))) return json({ ok: false, error: 'falta el cuit' }, 400);

  const idToken = await loginFacturador(env);
  if (!idToken) return json({ ok: false, error: 'el Worker no pudo loguearse a Firestore' }, 500);

  const d = await leerDoc(env, idToken, docCert(cuit, entorno));
  if (!d) return json({ ok: true, hay: false, cuit, entorno });

  const dias = d.notAfter ? Math.floor((new Date(d.notAfter) - Date.now()) / 86400000) : null;
  return json({
    ok: true,
    hay: true,
    cuit: d.cuit,
    entorno: d.entorno,
    alias: d.alias,
    subject: d.subject,
    notAfter: d.notAfter,
    diasParaVencer: dias,
    vencido: dias != null && dias < 0,
    subidoEn: d.subidoEn,
  });
}

const B64_PEM = pem => pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');

/** Importa una clave privada PKCS#8 para firmar con RSA (lo que pide el CMS del WSAA). */
export async function importarClave(keyPem) {
  const der = Uint8Array.from(atob(B64_PEM(keyPem)), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
}

export { ENTORNOS, QR_URL, entornoDe };
