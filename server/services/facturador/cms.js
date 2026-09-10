/**
 * CMS / PKCS#7 SignedData — el sobre firmado que pide el WSAA.
 * ------------------------------------------------------------
 * WSAA no recibe el pedido de acceso en limpio: hay que meterlo adentro de un CMS
 * firmado con el certificado fiscal, en base64. Es exactamente lo que hace
 * `openssl cms -sign -signer cert.crt -inkey clave.key -nodetach -outform DER`.
 *
 * Se arma con atributos firmados (contentType, signingTime, messageDigest) porque es lo
 * que produce openssl por defecto, y por lo tanto lo que ARCA viene recibiendo desde
 * siempre de todos los que se conectan. Cuando hay atributos firmados, la firma NO va
 * sobre el contenido: va sobre el DER del conjunto de atributos, y uno de esos
 * atributos es el hash del contenido. Confundir eso es el error clasico y da un CMS que
 * parece bien armado y no valida.
 *
 * OIDs, todos de RFC 5652:
 *   1.2.840.113549.1.7.2   signedData
 *   1.2.840.113549.1.7.1   data
 *   1.2.840.113549.1.9.3   contentType
 *   1.2.840.113549.1.9.4   messageDigest
 *   1.2.840.113549.1.9.5   signingTime
 *   2.16.840.1.101.3.4.2.1 sha256
 *   1.2.840.113549.1.1.1   rsaEncryption
 */

import {
  seq, set, octeto, entero, oid, utcTime, algoritmo, unir,
  explicito, implicito, emisorYSerie, pemADer, aBase64,
} from './asn1.js';

const OID = {
  signedData:    '1.2.840.113549.1.7.2',
  data:          '1.2.840.113549.1.7.1',
  contentType:   '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime:   '1.2.840.113549.1.9.5',
  sha256:        '2.16.840.1.101.3.4.2.1',
  rsa:           '1.2.840.113549.1.1.1',
};

const atributo = (id, valor) => seq(oid(id), set(valor));

/**
 * Firma `contenido` y devuelve el CMS entero en base64, listo para el campo in0 del
 * SOAP de WSAA.
 *
 * @param contenido Uint8Array — el XML del LoginTicketRequest
 * @param certPem   string     — el certificado, en PEM
 * @param clave     CryptoKey  — la privada ya importada, con permiso de firmar
 * @param ahora     Date       — la hora que va en signingTime
 */
export async function firmarCms(contenido, certPem, clave, ahora = new Date()) {
  const certDer = pemADer(certPem);
  const { emisor, serie } = emisorYSerie(certDer);

  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', contenido));

  // Los atributos firmados. En DER, un SET OF va ordenado por su codificacion; openssl
  // los ordena y los verificadores lo dan por sentado.
  const atributos = [
    atributo(OID.contentType,   oid(OID.data)),
    atributo(OID.signingTime,   utcTime(ahora)),
    atributo(OID.messageDigest, octeto(hash)),
  ].sort(comparar);

  // Lo que se firma es el SET OF (etiqueta 0x31), aunque adentro del SignerInfo los
  // mismos atributos viajen bajo [0] IMPLICIT (0xa0). Es asi por RFC 5652 §5.4.
  const paraFirmar = set(...atributos);
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, paraFirmar));

  const signerInfo = seq(
    entero(1),
    seq(emisor, serie),                                    // IssuerAndSerialNumber
    algoritmo(OID.sha256),
    implicito(0, unir(...atributos)),
    algoritmo(OID.rsa, true),
    octeto(firma),
  );

  const signedData = seq(
    entero(1),
    set(algoritmo(OID.sha256)),
    seq(oid(OID.data), explicito(0, octeto(contenido))),  // el contenido viaja adentro
    implicito(0, certDer),                                 // certificates [0] IMPLICIT
    set(signerInfo),
  );

  return aBase64(seq(oid(OID.signedData), explicito(0, signedData)));
}

/** Orden DER para un SET OF: byte a byte, y el mas corto primero si uno es prefijo. */
function comparar(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
