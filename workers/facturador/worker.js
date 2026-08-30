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

    return json({ ok: false, error: 'ruta no encontrada' }, 404);
  },
};

export { ENTORNOS, QR_URL, entornoDe };
