/**
 * WSAA — el login de ARCA.
 * ------------------------
 * Para hablar con WSFEv1 hace falta un ticket de acceso (TA): un token y un sign que se
 * mandan en cada pedido. El TA se saca del WSAA firmando un pedido con el certificado
 * fiscal, y **dura 12 horas**.
 *
 * QUE ESAS 12 HORAS SE APROVECHEN NO ES UNA OPTIMIZACION, ES EL DISEÑO. Si se pide un
 * TA nuevo por cada factura, WSAA contesta que el CUIT ya tiene uno valido y rechaza el
 * pedido: el segundo comprobante del dia ya falla. Por eso el TA se guarda cifrado en
 * Firestore y se reusa hasta poco antes de vencer.
 *
 * El TA mientras vive es una credencial: el que lo tiene factura sin necesitar el
 * certificado. Por eso se guarda cifrado igual que la clave privada.
 */

import { firmarCms } from './cms.js';
import { cifrar, descifrar } from './cripto.js';
import { leerDoc, escribirDoc } from './firestore.js';
import { pemADer } from './asn1.js';

/** Se renueva con este margen antes del vencimiento, no al filo. */
const MARGEN_MS = 10 * 60 * 1000;

const docTa = (cuit, entorno, servicio) => `fiscal_ta/${cuit}_${entorno}_${servicio}`;

/** Argentina es UTC-3 todo el año: no hay horario de verano que corregir. */
function isoAr(fecha) {
  const t = new Date(fecha.getTime() - 3 * 3600 * 1000);
  return t.toISOString().replace(/\.\d{3}Z$/, '') + '-03:00';
}

/**
 * El pedido de acceso. `generationTime` va diez minutos atras y `expirationTime` diez
 * adelante: el margen para atras cubre que el reloj del Worker y el de ARCA no sean
 * exactamente el mismo, que es un rechazo clasico y dificil de diagnosticar.
 */
function loginTicketRequest(servicio, ahora) {
  const desde = new Date(ahora.getTime() - 10 * 60 * 1000);
  const hasta = new Date(ahora.getTime() + 10 * 60 * 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(ahora.getTime() / 1000) % 4294967295}</uniqueId>
    <generationTime>${isoAr(desde)}</generationTime>
    <expirationTime>${isoAr(hasta)}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

const desescapar = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const entre = (xml, tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
};

/**
 * Pide un TA nuevo al WSAA. No se llama directo: se llama desde `ticketDeAcceso`, que
 * es el que sabe si hace falta.
 */
async function pedirTicket(env, ent, cuit, servicio, certPem, clavePem) {
  const ahora = new Date();
  const xml = new TextEncoder().encode(loginTicketRequest(servicio, ahora));

  const clave = await crypto.subtle.importKey(
    'pkcs8', pemADer(clavePem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const cms = await firmarCms(xml, certPem, clave, ahora);

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const r = await fetch(ent.wsaa, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: sobre,
  });
  const texto = await r.text();

  if (!r.ok) {
    // El detalle del rechazo viene en el faultstring, y es lo unico que explica por que.
    const motivo = entre(texto, 'faultstring') || texto.slice(0, 400);
    console.log('WSAA rechazo el login:', r.status, motivo);
    // Este es el caso de todos los dias si el cache falla: ARCA no deja tener dos TA
    // vivos para el mismo servicio.
    if (/ya posee un TA valido|alreadyAuthenticated/i.test(motivo)) {
      const e = new Error('ARCA dice que ya hay un ticket valido para este servicio: hay que reusar el que esta guardado.');
      e.yaHayTicket = true;
      throw e;
    }
    throw new Error('WSAA: ' + motivo);
  }

  const dentro = desescapar(entre(texto, 'loginCmsReturn') || '');
  const token = entre(dentro, 'token');
  const sign  = entre(dentro, 'sign');
  const expira = entre(dentro, 'expirationTime');
  if (!token || !sign) throw new Error('WSAA contesto sin token: ' + texto.slice(0, 300));

  console.log(`TA nuevo para ${servicio} (${ent.nombre}), vence ${expira}`);
  return { token, sign, expira };
}

/**
 * El ticket de acceso para un servicio. Devuelve el guardado si todavia sirve, y si no
 * pide uno nuevo y lo guarda cifrado.
 *
 * `dameCertificado` es una funcion, no el certificado: asi el material solo se descifra
 * cuando de verdad hay que pedir un TA, y no en cada factura.
 */
export async function ticketDeAcceso(env, ent, cuit, servicio, idToken, dameCertificado) {
  const path = docTa(cuit, ent.clave, servicio);

  const guardado = await leerDoc(env, idToken, path);
  const vigente = g => g?.expira && new Date(g.expira).getTime() - Date.now() > MARGEN_MS;

  if (vigente(guardado)) {
    return {
      token: await descifrar(env, cuit, ent.clave, guardado.token),
      sign:  await descifrar(env, cuit, ent.clave, guardado.sign),
      expira: guardado.expira,
      delCache: true,
    };
  }

  const { certPem, clavePem } = await dameCertificado();

  let ta;
  try {
    ta = await pedirTicket(env, ent, cuit, servicio, certPem, clavePem);
  } catch (e) {
    // Dos pedidos al mismo tiempo: el otro ya saco el TA y lo guardo mientras este
    // esperaba. Se relee antes de darse por vencido.
    if (e.yaHayTicket) {
      const otro = await leerDoc(env, idToken, path);
      if (vigente(otro)) {
        return {
          token: await descifrar(env, cuit, ent.clave, otro.token),
          sign:  await descifrar(env, cuit, ent.clave, otro.sign),
          expira: otro.expira,
          delCache: true,
        };
      }
    }
    throw e;
  }

  await escribirDoc(env, idToken, path, {
    cuit: String(cuit),
    entorno: ent.clave,
    servicio,
    token: await cifrar(env, cuit, ent.clave, ta.token),
    sign:  await cifrar(env, cuit, ent.clave, ta.sign),
    expira: ta.expira,
    generado: new Date().toISOString(),
  });

  return { ...ta, delCache: false };
}

// `pedirTicket` se exporta para poder probar el login contra homologacion sin Firestore
// de por medio; en el Worker no se llama directo nunca: se pasa por `ticketDeAcceso`,
// que es el que cuida las 12 horas.
export { loginTicketRequest, isoAr, pedirTicket };
