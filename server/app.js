import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { configPublica } from './config.js';
import { adaptarServicio, crearTareas } from './http/servicios.js';
import tienda from './services/tienda/worker.js';
import instagram from './services/ig-bot/worker-ig.js';
import facturador from './services/facturador/worker.js';
import ia from './services/ia/index.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const requeridos = {
  tienda: ['OWNER_UID', 'TIENDA_EMAIL', 'TIENDA_PASSWORD'],
  instagram: ['OWNER_UID', 'BOT_EMAIL', 'BOT_PASSWORD', 'IG_APP_SECRET', 'IG_VERIFY_TOKEN', 'IG_ACCOUNT_ID'],
  facturador: ['OWNER_UID', 'FAC_EMAIL', 'FAC_PASSWORD', 'ARCA_CUIT', 'CERT_MASTER_KEY'],
  ia: ['OWNER_UID', 'ANTHROPIC_KEY'],
};

export async function crearApp(config, { desarrollo = false, fetchImpl = fetch, servicios = {}, directorioEstatico = resolve(raiz, 'dist') } = {}) {
  const app = express();
  const logger = pino({ level: config.LOG_LEVEL });
  const tareas = crearTareas(logger);
  app.disable('x-powered-by');
  app.use(pinoHttp({
    logger,
    // No registrar cuerpos, consultas, tokens ni datos de clientes.
    serializers: { req: req => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }) },
    autoLogging: { ignore: req => req.url === '/api/salud' },
  }));
  app.use(helmet({
    // Los onclick existentes se conservan durante la migración modular.
    contentSecurityPolicy: desarrollo ? false : {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
        connectSrc: ["'self'", 'https:'],
        frameSrc: ["'self'", 'blob:', 'https://mis-gastos-21e7b.firebaseapp.com'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"], baseUri: ["'none'"],
        frameAncestors: ["'none'"], formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  }));
  app.use((req, res, next) => {
    if (['127.0.0.1', 'localhost', '::1'].includes(config.HOST)) {
      const host = req.hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return res.sendStatus(403);
    }
    const origen = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site') return res.sendStatus(403);
    if (origen && origen !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Origen no permitido.' });
    }
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', rateLimit({
    windowMs: 60_000, limit: config.API_LIMITE_POR_MINUTO,
    standardHeaders: 'draft-8', legacyHeaders: false,
    skip: req => ['/salud', '/config', '/apagar'].includes(req.path),
    message: { error: 'Demasiadas solicitudes. Esperá un minuto y volvé a intentar.' },
  }));
  app.post('/api/tienda/pedido', rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Demasiados pedidos. Esperá un minuto y volvé a intentar.' },
  }));
  app.get('/api/salud', (_req, res) => res.json({
    ok: true, aplicacion: 'MarplaCity', version, runtime: 'Node.js',
    servicios: Object.fromEntries(Object.keys(requeridos).map(nombre => [nombre, {
      modo: config[`SERVICIO_${nombre.toUpperCase()}`],
      configurado: config[`SERVICIO_${nombre.toUpperCase()}`] === 'remoto' || requeridos[nombre].every(campo => !!config[campo]),
    }])),
  }));
  app.get('/api/config', (_req, res) => res.json(configPublica(config)));
  if (config.CONTROL_TOKEN) app.post('/api/apagar', (req, res) => {
    const esperado = Buffer.from(config.CONTROL_TOKEN);
    const recibido = Buffer.from(req.get('X-Marplacity-Control') || '');
    if (recibido.length !== esperado.length || !timingSafeEqual(recibido, esperado)) return res.sendStatus(403);
    if (!app.locals.detener) return res.sendStatus(503);
    res.once('finish', () => { void app.locals.detener(); });
    return res.json({ ok: true });
  });
  app.use('/api', express.raw({ type: () => true, limit: '20mb' }));
  for (const [nombre, servicio] of Object.entries({ tienda, instagram, facturador, ia, ...servicios })) {
    const clave = nombre.toUpperCase();
    app.use(`/api/${nombre}`, adaptarServicio({
      servicio, config, tareas, fetchImpl,
      remoto: config[`${clave}_REMOTE_URL`], modo: config[`SERVICIO_${clave}`],
      faltantes: requeridos[nombre].filter(campo => !config[campo]),
    }));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  let vite;
  if (desarrollo) {
    const { createServer } = await import('vite');
    vite = await createServer({ server: { middlewareMode: true }, appType: 'mpa' });
    app.use('/fotos', express.static(resolve(raiz, 'fotos'), { dotfiles: 'deny' }));
    app.use(vite.middlewares);
  } else {
    app.use(express.static(directorioEstatico, {
      dotfiles: 'deny', index: 'index.html',
      setHeaders(res, ruta) {
        res.set('Cache-Control', /[/\\]assets[/\\]/.test(ruta) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
  }
  app.use((_req, res) => res.status(404).type('text').send('No encontramos esta página.'));
  app.use((error, req, res, _next) => {
    req.log.error({ tipo: error.type || error.name }, 'No se pudo atender la solicitud.');
    if (res.headersSent) return res.end();
    const status = error.type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({ error: status === 413 ? 'El archivo o mensaje es demasiado grande.' : 'Ocurrió un error en el servidor.' });
  });
  return { app, logger, tareas, cerrar: async () => { await tareas.terminar(); await vite?.close(); } };
}
