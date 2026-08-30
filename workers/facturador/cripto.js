/**
 * Cifrado del material fiscal en reposo.
 * --------------------------------------
 * La clave privada del certificado es lo mas sensible del sistema entero: con ella
 * cualquiera emite comprobantes a nombre del CUIT. No puede quedar en texto plano en
 * Firestore, donde la ve cualquiera que consiga una credencial de lectura.
 *
 * COMO ESTA PENSADO, y por que asi:
 *
 * Hay UNA clave maestra, que vive como Secret del Worker (`CERT_MASTER_KEY`) y no toca
 * Firestore nunca. De ella se DERIVA una clave distinta por cada CUIT y entorno, con
 * HKDF-SHA256. Eso es lo que pide el punto 2 de la tarea: cuando el sistema se revenda
 * vamos a estar guardando el certificado fiscal de otras empresas, y que se filtre el
 * material de una no puede alcanzar para descifrar el de otra.
 *
 * HKDF es de una sola via: teniendo la clave derivada de un CUIT no se puede volver a
 * la maestra, y por lo tanto tampoco llegar a las de los demas. Al reves si: el que
 * tenga la maestra las tiene todas. Por eso la maestra es Secret y nunca se loguea.
 *
 * El cifrado es AES-256-GCM, que ademas de cifrar autentica: si alguien edita el
 * documento en Firestore a mano, el descifrado falla en vez de devolver basura.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

// Etiqueta de version del esquema. Si algun dia cambia la derivacion, cambia esto y los
// documentos viejos siguen descifrandose con su propia etiqueta, guardada en `alg`.
const ESQUEMA = 'marplacity-facturador-v1';

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/**
 * La clave de un CUIT en un entorno. Dos CUIT distintos, o el mismo CUIT en
 * homologacion y en produccion, dan claves distintas y sin relacion entre si.
 */
async function claveDe(masterB64, cuit, entorno) {
  if (!masterB64) throw new Error('falta CERT_MASTER_KEY');
  const master = deB64(masterB64);
  if (master.length < 32) throw new Error('CERT_MASTER_KEY tiene que ser de 32 bytes');

  const base = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // El CUIT va de salt y ademas de info: es lo que separa una empresa de otra.
      salt: enc.encode(String(cuit)),
      info: enc.encode(`${ESQUEMA}:${cuit}:${entorno}`),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Devuelve un objeto listo para guardar en Firestore. El IV es nuevo en cada cifrado
 * —reusarlo con la misma clave rompe GCM— y va al lado del texto cifrado: no es
 * secreto, solo tiene que ser distinto cada vez.
 */
export async function cifrar(env, cuit, entorno, texto) {
  const clave = await claveDe(env.CERT_MASTER_KEY, cuit, entorno);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, enc.encode(texto));
  return { alg: ESQUEMA, iv: b64(iv), datos: b64(datos) };
}

/**
 * Al reves. Si el documento fue tocado a mano, o si la clave maestra no es la que lo
 * cifro, esto tira error en vez de devolver algo incorrecto.
 */
export async function descifrar(env, cuit, entorno, sobre) {
  if (!sobre || !sobre.iv || !sobre.datos) throw new Error('el sobre cifrado esta incompleto');
  if (sobre.alg && sobre.alg !== ESQUEMA) throw new Error(`esquema desconocido: ${sobre.alg}`);
  const clave = await claveDe(env.CERT_MASTER_KEY, cuit, entorno);
  try {
    const plano = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deB64(sobre.iv) }, clave, deB64(sobre.datos)
    );
    return dec.decode(plano);
  } catch {
    // El error de WebCrypto no dice nada util y no conviene que diga: no hay que
    // filtrar si fallo por la clave o por el contenido.
    throw new Error('no se pudo descifrar: clave maestra distinta o documento alterado');
  }
}

export { ESQUEMA };
