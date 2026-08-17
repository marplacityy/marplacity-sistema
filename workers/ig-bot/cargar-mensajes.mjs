/**
 * Carga (o actualiza) el doc `config/mensajes` de Firestore.
 *
 * Ahí vive el mensaje fijo de invitación al canal de difusión: el que el bot manda
 * textual, carácter por carácter, sin que lo redacte el modelo. Está escrito en
 * primera persona del plural, así que si el modelo lo tuviera en el prompt le
 * contagiaría ese "nosotros" al resto de la conversación.
 *
 * USO
 *
 *   MC_EMAIL='tu@mail.com' MC_PASSWORD='tu-contraseña' node workers/ig-bot/cargar-mensajes.mjs
 *
 * Las credenciales son las tuyas del sistema (las mismas del login), y se pasan por
 * variable de entorno a propósito: no van en este archivo ni en el repo. Firestore
 * exige que escriba el dueño — el bot sobre este doc solo tiene permiso de lectura.
 *
 * Para ver qué hay cargado sin escribir nada:
 *
 *   MC_EMAIL=... MC_PASSWORD=... node workers/ig-bot/cargar-mensajes.mjs --ver
 *
 * Necesita Node 18 o superior (usa fetch nativo). No instala nada.
 */

const PROJECT  = process.env.FIREBASE_PROJECT || 'mis-gastos-21e7b';
// API key web de Firebase: es pública (viaja dentro de index.html), lo que protege
// los datos son las Security Rules.
const API_KEY  = process.env.FIREBASE_KEY || 'AIzaSyCxT-g9yMRhrRcjwI5uz3ITTWUB8ddeZCg';
const EMAIL    = process.env.MC_EMAIL;
const PASSWORD = process.env.MC_PASSWORD;
const SOLO_VER = process.argv.includes('--ver');

// TEXTUAL. No lo reformatees: los espacios raros (" ." / " ,c" / los espacios antes
// del link) son los del mensaje original y se mandan tal cual.
const INVITACION_CANAL =
  'Para ver los precios de todo, te invito a nuestro canal de difusión haciendo click en el enlace! Acá mandamos todo lo q va ingresando y podes ver q tenemos deslizando hacia arriba en la conversación . Todos los precios q veas son en dólar billete y son válidos solo pagando en efectivo. Por otro medios de pago ,consultas y permutas comunícate con nosotros o pasa directamente por el local en Avellaneda 1239 de 10.00 a 18.00 corrido.     https://ig.me/j/AbYnJMBiH5crJae0/';

function salir(msg) { console.error(msg); process.exit(1); }

if (!EMAIL || !PASSWORD) {
  salir('Faltan credenciales.\n\n  MC_EMAIL=tu@mail.com MC_PASSWORD=tu-clave node workers/ig-bot/cargar-mensajes.mjs\n');
}

const login = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
  },
);

if (!login.ok) {
  salir(`No se pudo iniciar sesión (${login.status}). Revisá el mail y la contraseña.`);
}

const { idToken, localId: uid } = await login.json();
const docUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/config/mensajes`;
const auth   = { 'Authorization': `Bearer ${idToken}` };

if (SOLO_VER) {
  const r = await fetch(docUrl, { headers: auth });
  if (r.status === 404) { console.log('El doc config/mensajes no existe todavía.'); process.exit(0); }
  if (!r.ok) salir(`No se pudo leer (${r.status}).`);
  const d = await r.json();
  const texto = d.fields?.invitacionCanal?.stringValue;
  console.log(texto ? `invitacionCanal (${texto.length} caracteres):\n\n${texto}\n` : 'El doc existe pero no tiene invitacionCanal.');
  process.exit(0);
}

// updateMask: toca solo estos dos campos y deja intacto cualquier otro mensaje fijo
// que se agregue más adelante.
const escribir = await fetch(
  `${docUrl}?updateMask.fieldPaths=invitacionCanal&updateMask.fieldPaths=userId`,
  {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        invitacionCanal: { stringValue: INVITACION_CANAL },
        userId: { stringValue: uid },   // las reglas exigen que el doc sea tuyo
      },
    }),
  },
);

if (!escribir.ok) {
  salir(`No se pudo escribir (${escribir.status}): ${(await escribir.text()).slice(0, 300)}`);
}

console.log(`✓ config/mensajes actualizado (${INVITACION_CANAL.length} caracteres en invitacionCanal)`);
console.log('  Verificalo con: --ver');
