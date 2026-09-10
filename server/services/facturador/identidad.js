/**
 * Quien es quien.
 * ---------------
 * Dos identidades distintas, y no hay que confundirlas:
 *
 * 1. La del Worker (`loginFacturador`): un usuario propio en Firebase Auth
 *    (facturador@marplacity.com) con el que lee y escribe Firestore. Es el unico que
 *    las reglas dejan tocar el certificado cifrado.
 *
 * 2. La del dueño (`verificarTokenDelDueño`): cuando Juni sube el certificado desde su
 *    maquina, manda el ID token de SU sesion de Firebase. El Worker lo verifica de
 *    verdad —firma, emisor, destinatario y vencimiento— y ademas exige que el uid sea
 *    el de OWNER_UID. Sin esto, cualquiera que descubra la URL del Worker sube su
 *    propio certificado y factura a nombre nuestro.
 */

let tokenCache = { idToken: null, vence: 0 };

/** El Worker se loguea con su propio usuario. Igual patron que ig-bot. */
export async function loginFacturador(env) {
  const ahora = Date.now();
  if (tokenCache.idToken && ahora < tokenCache.vence) return tokenCache.idToken;

  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.FAC_EMAIL, password: env.FAC_PASSWORD, returnSecureToken: true }),
    }
  );
  if (!r.ok) {
    console.log('login del facturador FALLO', r.status, await r.text());
    return null;
  }
  const d = await r.json();
  // duran 1 h; se renueva a los 50 min
  tokenCache = { idToken: d.idToken, vence: ahora + 50 * 60 * 1000 };
  return d.idToken;
}

// Las claves publicas con las que Google firma los ID token. Rotan, asi que se cachean
// por un rato y se vuelven a pedir; no se hardcodean.
let jwksCache = { claves: null, vence: 0 };

async function clavesDeGoogle() {
  if (jwksCache.claves && Date.now() < jwksCache.vence) return jwksCache.claves;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('no se pudieron leer las claves publicas de Google');
  const d = await r.json();
  jwksCache = { claves: d.keys || [], vence: Date.now() + 60 * 60 * 1000 };
  return jwksCache.claves;
}

const deB64Url = s => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b), c => c.charCodeAt(0));
};

/**
 * Verifica un ID token de Firebase y devuelve su uid, o null si no es valido.
 *
 * Se verifica TODO, no solo la firma: un token legitimo de otro proyecto tiene firma
 * buena y no sirve, y uno vencido tambien. El orden importa poco, que esten todos si.
 */
export async function verificarTokenDelDueño(env, token) {
  try {
    if (!token || token.split('.').length !== 3) return null;
    const [cab64, cuerpo64, firma64] = token.split('.');
    const cab = JSON.parse(new TextDecoder().decode(deB64Url(cab64)));
    const cuerpo = JSON.parse(new TextDecoder().decode(deB64Url(cuerpo64)));

    if (cab.alg !== 'RS256') return null;

    const jwk = (await clavesDeGoogle()).find(k => k.kid === cab.kid);
    if (!jwk) return null;

    const clave = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const firmaOk = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', clave, deB64Url(firma64),
      new TextEncoder().encode(`${cab64}.${cuerpo64}`)
    );
    if (!firmaOk) return null;

    const proj = env.FIREBASE_PROJECT;
    const ahora = Math.floor(Date.now() / 1000);
    if (cuerpo.aud !== proj) return null;
    if (cuerpo.iss !== `https://securetoken.google.com/${proj}`) return null;
    if (!cuerpo.exp || cuerpo.exp < ahora) return null;
    if (!cuerpo.sub) return null;

    return cuerpo.sub;
  } catch (e) {
    console.log('token invalido:', e.message);
    return null;
  }
}

/** Atajo: ¿el que manda este pedido es el dueño? */
export async function esElDueño(env, request) {
  const token = request.headers.get('X-Firebase-Token');
  const uid = await verificarTokenDelDueño(env, token);
  return !!uid && uid === env.OWNER_UID;
}
