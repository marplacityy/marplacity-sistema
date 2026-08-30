/**
 * Firestore por REST, con la identidad del facturador.
 * ----------------------------------------------------
 * Mismo enfoque que ig-bot: no hay SDK adentro del Worker, se habla la REST API a mano.
 * Los valores vienen y van envueltos por tipo ({stringValue: "x"}), asi que hay que
 * traducir en las dos direcciones.
 */

const base = env => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;

// ── De Firestore a JS ──
function valor(v) {
  if (v == null) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue'      in v) return null;
  if ('mapValue'       in v) return campos(v.mapValue.fields);
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(valor);
  return null;
}

export function campos(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) o[k] = valor(v);
  return o;
}

// ── De JS a Firestore ──
function envolver(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(envolver) } };
  if (typeof v === 'object')  return { mapValue: { fields: aCampos(v) } };
  return { stringValue: String(v) };
}

export function aCampos(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj || {})) f[k] = envolver(v);
  return f;
}

/**
 * Devuelve null cuando el documento NO EXISTE, y explota cuando no se pudo leer por otro
 * motivo. La distincion importa: un 403 es siempre un error de reglas, y devolverlo como
 * null hace que el llamador diga "no lo encontre" y mande a buscar donde no hay nada.
 * Paso con la primera nota de credito, que fallo con "no encontre esa factura" cuando en
 * realidad al Worker le faltaba permiso de lectura.
 */
export async function leerDoc(env, idToken, path) {
  let r;
  try {
    r = await fetch(`${base(env)}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
  } catch (e) {
    throw new Error(`no se pudo consultar ${path}: ${e.message}`);
  }
  if (r.status === 404) return null;
  if (r.status === 403) {
    console.log('SIN PERMISO para leer', path);
    throw new Error(`el Worker no tiene permiso para leer ${path} — revisar firestore.rules`);
  }
  if (!r.ok) {
    console.log('no se pudo leer', path, r.status);
    throw new Error(`Firestore devolvio ${r.status} al leer ${path}`);
  }
  return campos((await r.json()).fields);
}

/**
 * Escribe (o pisa) un documento entero. Se usa PATCH con updateMask para no borrar
 * campos que no vengan en el objeto: en un doc fiscal, perder un campo por descuido es
 * peor que dejarlo viejo.
 */
export async function escribirDoc(env, idToken, path, obj) {
  const mask = Object.keys(obj).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const r = await fetch(`${base(env)}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: aCampos(obj) }),
  });
  if (!r.ok) {
    const detalle = await r.text();
    console.log('no se pudo escribir', path, r.status, detalle);
    throw new Error(`Firestore rechazo la escritura (${r.status})`);
  }
  return campos((await r.json()).fields);
}
