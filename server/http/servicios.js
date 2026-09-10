import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const CABECERAS = ['content-type', 'x-firebase-token', 'x-hub-signature-256', 'x-signature', 'x-request-id', 'stripe-signature'];

/** Mantiene vivo el trabajo de webhooks después de responder, también durante el cierre. */
export function crearTareas(logger) {
  const pendientes = new Set();
  return {
    waitUntil(promesa) {
      const tarea = Promise.resolve(promesa).catch(() => logger.error('Falló una tarea en segundo plano.'));
      pendientes.add(tarea);
      void tarea.finally(() => pendientes.delete(tarea));
    },
    async terminar() { await Promise.allSettled([...pendientes]); },
    get cantidad() { return pendientes.size; },
  };
}

/** Request/Response estándar: la misma lógica de dominio funciona en Node y en Workers. */
export function adaptarServicio({ servicio, remoto, modo, config, tareas, faltantes = [], fetchImpl = fetch }) {
  return async (req, res) => {
    if (modo === 'local' && faltantes.length) {
      return res.status(503).json({ error: 'Falta configurar el servicio local.', campos: faltantes });
    }
    const ruta = req.url.startsWith('/') ? req.url : '/' + req.url;
    const destino = modo === 'remoto' ? remoto : 'http://servicio.local';
    // Concatenar el prefijo fijo impide que una ruta //host se vuelva un proxy abierto.
    const url = new URL(destino + ruta);
    const cabeceras = new Headers();
    for (const campo of CABECERAS) if (req.get(campo)) cabeceras.set(campo, req.get(campo));
    const opciones = { method: req.method, headers: cabeceras };
    if (!['GET', 'HEAD'].includes(req.method) && req.body?.length) opciones.body = req.body;

    let respuesta;
    try {
      if (modo === 'local') {
        respuesta = await servicio.fetch(new Request(url, opciones), { ...config, RUNTIME_NODE: true }, tareas);
      } else {
        respuesta = await fetchImpl(url, { ...opciones, signal: AbortSignal.timeout(180_000), redirect: 'manual' });
      }
    } catch (error) {
      req.log.warn({ tipo: error.name }, 'El servicio no respondió.');
      return res.status(502).json({ error: 'No se pudo conectar con el servicio. Volvé a intentar.' });
    }
    res.status(respuesta.status);
    for (const campo of ['content-type', 'retry-after']) {
      const valor = respuesta.headers.get(campo);
      if (valor) res.set(campo, valor);
    }
    res.set('Cache-Control', 'no-store');
    if (!respuesta.body || req.method === 'HEAD') return res.end();
    await pipeline(Readable.fromWeb(respuesta.body), res);
  };
}
