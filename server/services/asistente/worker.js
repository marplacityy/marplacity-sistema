/**
 * Worker asistente — el sistema, por Telegram.
 * --------------------------------------------
 * Le contesta SOLO al dueño. Entiende lo que le escribe, consulta el sistema y le deja
 * las cargas listas con un botón de confirmar.
 *
 * POR QUE ESTE ES DISTINTO DE LOS OTROS DOS
 *
 * El chat que vive adentro del sistema ejecuta las herramientas en el navegador, con los
 * permisos del dueño: no gana ningún acceso nuevo. Acá no hay navegador, así que las
 * ejecuta el Worker, y para eso necesita su propio usuario con permiso de escritura.
 * Esa es una llave más dando vueltas, y por eso:
 *
 *   1. Solo escribe en `gastos`. Nada de stock, ventas ni caja: lo que toca plata en
 *      serio se sigue cerrando desde el sistema, donde estan todas las reglas.
 *   2. Solo le contesta a los IDs de TELEGRAM_PERMITIDOS. Un bot de Telegram le contesta
 *      a cualquiera que lo encuentre, y este puede gastar creditos y escribir datos.
 *   3. Nada se escribe sin que el dueño toque el boton de confirmar.
 */

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), {
  status: s, headers: { ...CORS, 'Content-Type': 'application/json' },
});

/** Quiénes pueden hablarle. Una lista de IDs numéricos de Telegram, separados por coma. */
const permitidos = env =>
  String(env.TELEGRAM_PERMITIDOS || '').split(',').map(s => s.trim()).filter(Boolean);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Salud: qué variables están cargadas. true/false, nunca el valor.
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/salud')) {
      return json({
        ok: true,
        vars: {
          TELEGRAM_TOKEN: !!env.TELEGRAM_TOKEN,
          TELEGRAM_SECRETO: !!env.TELEGRAM_SECRETO,
          TELEGRAM_PERMITIDOS: permitidos(env).length,
          ANTHROPIC_KEY: !!env.ANTHROPIC_KEY,
          FIREBASE_PROJECT: !!env.FIREBASE_PROJECT,
          FIREBASE_KEY: !!env.FIREBASE_KEY,
          OWNER_UID: !!env.OWNER_UID,
          ASIS_EMAIL: !!env.ASIS_EMAIL,
          ASIS_PASSWORD: !!env.ASIS_PASSWORD,
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/telegram') {
      // Telegram manda este header con el secreto que se le configuró al registrar el
      // webhook. Sin esto, cualquiera que descubra la URL puede hacerse pasar por
      // Telegram y hablarle al asistente.
      if (env.TELEGRAM_SECRETO &&
          request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_SECRETO) {
        return new Response('no', { status: 401 });
      }
      // Telegram reintenta si no contestamos rápido, y un reintento sería otra respuesta
      // (y otro cobro). Se contesta ya y se trabaja por atrás.
      return json({ ok: true });
    }

    return json({ ok: false, error: 'ruta no encontrada' }, 404);
  },
};
