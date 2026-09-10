/**
 * DER a mano: lo minimo para armar un CMS y leer un certificado.
 * --------------------------------------------------------------
 * Adentro de un Worker no hay OpenSSL ni nada parecido: WebCrypto firma, pero no sabe
 * armar un PKCS#7. Y el WSAA de ARCA no acepta otra cosa que un CMS firmado.
 *
 * Se escribe a mano en vez de traer pkijs por dos razones: el repo no tiene una sola
 * dependencia npm y no queremos empezar por la que maneja material fiscal, y porque
 * esto es verificable de verdad — el CMS que sale de aca se valida con `openssl cms
 * -verify`, que es un tercero que no comparte ni una linea de codigo con nosotros.
 *
 * DER, en dos lineas: todo es (etiqueta, longitud, valor). La longitud va en un byte si
 * entra en 127, y si no en un byte que dice cuantos bytes de longitud siguen.
 */

// ── Escribir ──────────────────────────────────────────────────

const bytes = a => a instanceof Uint8Array ? a : new Uint8Array(a);

export function unir(...partes) {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}

/** La longitud, en forma corta o larga segun cuanto mida el valor. */
function longitud(n) {
  if (n < 0x80) return new Uint8Array([n]);
  const b = [];
  for (let x = n; x > 0; x >>= 8) b.unshift(x & 0xff);
  return new Uint8Array([0x80 | b.length, ...b]);
}

/** Un elemento cualquiera: etiqueta + longitud + contenido. */
export function tlv(etiqueta, contenido) {
  const v = bytes(contenido);
  return unir(new Uint8Array([etiqueta]), longitud(v.length), v);
}

export const seq      = (...hijos) => tlv(0x30, unir(...hijos));
export const set      = (...hijos) => tlv(0x31, unir(...hijos));
export const octeto   = c => tlv(0x04, c);
export const nulo     = () => new Uint8Array([0x05, 0x00]);
export const entero   = n => tlv(0x02, enteroCrudo(n));
/** [n] EXPLICIT: envuelve. [n] IMPLICIT: reemplaza la etiqueta del contenido. */
export const explicito = (n, c) => tlv(0xa0 | n, c);
export const implicito = (n, c) => tlv(0xa0 | n, c);

function enteroCrudo(n) {
  const b = [];
  let x = BigInt(n);
  if (x === 0n) return new Uint8Array([0]);
  while (x > 0n) { b.unshift(Number(x & 0xffn)); x >>= 8n; }
  // Si el bit alto quedo prendido, DER lo lee como negativo: hay que anteponer 0x00.
  if (b[0] & 0x80) b.unshift(0);
  return new Uint8Array(b);
}

/** Un OID desde su notacion con puntos: "1.2.840.113549.1.7.2". */
export function oid(texto) {
  const n = texto.split('.').map(Number);
  const b = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) {
    if (v < 0x80) { b.push(v); continue; }
    const g = [];
    for (let x = v; x > 0; x >>= 7) g.unshift((x & 0x7f) | 0x80);
    g[g.length - 1] &= 0x7f;
    b.push(...g);
  }
  return tlv(0x06, new Uint8Array(b));
}

/**
 * UTCTime, que es como CMS escribe la hora de firma: AAMMDDhhmmssZ, siempre en UTC.
 * Ojo con el año: UTCTime solo tiene dos digitos y vale hasta 2049.
 */
export function utcTime(fecha) {
  const p = n => String(n).padStart(2, '0');
  const t = `${p(fecha.getUTCFullYear() % 100)}${p(fecha.getUTCMonth() + 1)}${p(fecha.getUTCDate())}` +
            `${p(fecha.getUTCHours())}${p(fecha.getUTCMinutes())}${p(fecha.getUTCSeconds())}Z`;
  return tlv(0x17, new TextEncoder().encode(t));
}

/** AlgorithmIdentifier. SHA-2 va sin parametros (RFC 5754); RSA va con NULL. */
export const algoritmo = (id, conNulo = false) => conNulo ? seq(oid(id), nulo()) : seq(oid(id));

// ── Leer ──────────────────────────────────────────────────────

/**
 * Lee un elemento en una posicion. Devuelve donde empieza el contenido, donde termina
 * el elemento entero, y el elemento completo (etiqueta incluida), que es lo que hace
 * falta para copiar un campo tal cual de un certificado.
 */
export function leer(buf, pos = 0) {
  const etiqueta = buf[pos];
  let i = pos + 1;
  let len = buf[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | buf[i++];
  }
  return { etiqueta, inicio: i, fin: i + len, largo: len, completo: buf.subarray(pos, i + len) };
}

/** Los elementos que estan adentro de otro. */
export function hijos(buf, pos = 0) {
  const padre = leer(buf, pos);
  const out = [];
  let i = padre.inicio;
  while (i < padre.fin) {
    const h = leer(buf, i);
    out.push({ ...h, pos: i });
    i = h.fin;
  }
  return out;
}

/**
 * El emisor y el numero de serie de un certificado X.509, tal cual estan escritos en el
 * DER. El CMS los usa para decir con que certificado se firmo, y tienen que ser
 * byte-a-byte los del certificado: por eso se copian, no se reconstruyen.
 *
 * Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
 * TBSCertificate ::= SEQUENCE { [0] version OPCIONAL, serialNumber, signature, issuer, ... }
 */
export function emisorYSerie(certDer) {
  const tbs = hijos(certDer, 0)[0];          // el primer hijo del certificado
  const campos = hijos(certDer, tbs.pos);
  let i = 0;
  if (campos[0].etiqueta === 0xa0) i = 1;    // la version es opcional
  const serie  = campos[i].completo;         // INTEGER
  const emisor = campos[i + 2].completo;     // SEQUENCE (salteando el AlgorithmIdentifier)
  return { serie, emisor };
}

// ── PEM ↔ DER ────────────────────────────────────────────────

export function pemADer(pem) {
  const b64 = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

export const aBase64 = u8 => btoa(String.fromCharCode(...u8));
