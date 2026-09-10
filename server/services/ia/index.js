import { verificarTokenDelDueño } from '../facturador/identidad.js';

const json = (valor, status = 200) => Response.json(valor, { status });

/** Proxy de IA ejecutable en Node.js. Verifica el ID token antes de consumir la API. */
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
    if (!env.ANTHROPIC_KEY || !env.OWNER_UID) return json({ error: 'IA local sin configurar.' }, 503);
    const uid = await verificarTokenDelDueño(env, request.headers.get('X-Firebase-Token'));
    if (!uid || uid !== env.OWNER_UID) return json({ error: 'No autorizado.' }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
    if (!body || typeof body.model !== 'string' || !Array.isArray(body.messages)) {
      return json({ error: 'Faltan el modelo o los mensajes.' }, 400);
    }
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  },
};
