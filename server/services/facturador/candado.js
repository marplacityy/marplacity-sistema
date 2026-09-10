/**
 * Un candado por punto de venta y tipo de comprobante.
 * ----------------------------------------------------
 * La numeracion es correlativa y la decide el que emite: se pregunta cual fue el ultimo
 * autorizado y se pide el siguiente. Si dos emisiones salen al mismo tiempo, las dos leen
 * el mismo ultimo numero y las dos piden el mismo siguiente.
 *
 * ARCA rechaza al segundo —el numero no seria correlativo— asi que un comprobante
 * duplicado no se cuela. Pero el usuario ve un error feo por algo que no hizo mal, y en
 * el peor momento: con el cliente en el mostrador. El candado lo evita.
 *
 * Se hace con Firestore y no con Durable Objects para no atarse a un plan pago ni sumar
 * otra pieza; alcanza porque la REST API tiene escritura condicional de verdad
 * (`currentDocument`), que es un compare-and-set y no un "leer y despues escribir".
 *
 * EL CANDADO NO ES LA GARANTIA, ES LA COMODIDAD. La garantia sigue siendo ARCA, que es
 * el unico que sabe cual fue el ultimo numero. Por eso vence solo: si un Worker se muere
 * con el candado tomado, a los 60 segundos el siguiente puede seguir trabajando.
 */

const VENCE_MS = 60 * 1000;

const nombreDoc = (env, path) =>
  `projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/${path}`;

const commitUrl = env =>
  `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents:commit`;

async function commit(env, idToken, writes) {
  const r = await fetch(commitUrl(env), {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  return { ok: r.ok, status: r.status, texto: r.ok ? null : await r.text() };
}

/**
 * Intenta tomar el candado. Devuelve true si lo consiguio.
 *
 * Dos caminos: si no existe el documento, se crea con la condicion de que no exista —si
 * otro lo creo un milisegundo antes, esta escritura falla y no hay empate posible. Si
 * existe pero esta vencido, se pisa con la condicion de que siga teniendo exactamente la
 * misma hora de modificacion que cuando lo leimos.
 */
export async function tomar(env, idToken, clave, quien) {
  const path = `fiscal_locks/${clave}`;
  const doc = {
    update: {
      name: nombreDoc(env, path),
      fields: {
        tomadoPor: { stringValue: String(quien) },
        vence: { stringValue: new Date(Date.now() + VENCE_MS).toISOString() },
      },
    },
  };

  const nuevo = await commit(env, idToken, [{ ...doc, currentDocument: { exists: false } }]);
  if (nuevo.ok) return true;

  // Ya existe: solo se puede tomar si esta vencido, y solo si nadie lo toco mientras
  // tanto.
  const r = await fetch(`https://firestore.googleapis.com/v1/${nombreDoc(env, path)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!r.ok) return false;
  const actual = await r.json();
  const vence = actual.fields?.vence?.stringValue;
  if (vence && new Date(vence).getTime() > Date.now()) return false;   // sigue vivo

  const pisado = await commit(env, idToken, [{ ...doc, currentDocument: { updateTime: actual.updateTime } }]);
  return pisado.ok;
}

export async function soltar(env, idToken, clave) {
  await commit(env, idToken, [{ delete: nombreDoc(env, `fiscal_locks/${clave}`) }]);
}

/**
 * Corre `fn` con el candado tomado. Si no lo consigue, espera y reintenta: la otra
 * emision dura menos que el candado, asi que esperar es lo correcto.
 *
 * El candado se suelta SIEMPRE, tambien si `fn` explota: quedarselo tomado por un error
 * dejaria el punto de venta trabado hasta que venza.
 */
export async function conCandado(env, idToken, clave, fn, { intentos = 12, esperaMs = 500 } = {}) {
  const quien = crypto.randomUUID();
  let tengo = false;
  for (let i = 0; i < intentos && !tengo; i++) {
    tengo = await tomar(env, idToken, clave, quien);
    if (!tengo) await new Promise(r => setTimeout(r, esperaMs));
  }
  if (!tengo) throw new Error('hay otra emision en curso para este punto de venta; probá de nuevo en unos segundos');

  try {
    return await fn();
  } finally {
    await soltar(env, idToken, clave).catch(() => {});
  }
}
