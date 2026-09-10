import { z } from 'zod';

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  API_LIMITE_POR_MINUTO: z.coerce.number().int().min(1).max(10000).default(120),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  PUBLIC_BASE_URL: z.url().default('https://marplacityy.github.io/marplacity-sistema/'),
  SERVICIO_TIENDA: z.enum(['remoto', 'local']).default('remoto'),
  SERVICIO_INSTAGRAM: z.enum(['remoto', 'local']).default('remoto'),
  SERVICIO_FACTURADOR: z.enum(['remoto', 'local']).default('remoto'),
  SERVICIO_IA: z.enum(['remoto', 'local']).default('remoto'),
  TIENDA_REMOTE_URL: z.url().default('https://tienda.fiwind702050.workers.dev'),
  INSTAGRAM_REMOTE_URL: z.url().default('https://ig-bot.fiwind702050.workers.dev'),
  FACTURADOR_REMOTE_URL: z.url().default('https://facturador.fiwind702050.workers.dev'),
  IA_REMOTE_URL: z.url().default('https://anthropic-proxy.fiwind702050.workers.dev'),
  FIREBASE_PROJECT: z.string().default('mis-gastos-21e7b'),
  FIREBASE_KEY: z.string().default('AIzaSyCxT-g9yMRhrRcjwI5uz3ITTWUB8ddeZCg'),
  SEGUIMIENTOS_ACTIVOS: z.enum(['true', 'false']).default('false'),
});

/** Las credenciales quedan exclusivamente en el proceso del servidor. */
export function cargarConfig(entorno = process.env) {
  const resultado = esquema.safeParse(entorno);
  if (!resultado.success) {
    const campos = resultado.error.issues.map(error => error.path.join('.')).join(', ');
    throw new Error(`Configuración inválida. Revisá: ${campos}`);
  }
  const config = { ...entorno, ...resultado.data };
  for (const campo of ['TIENDA_REMOTE_URL', 'INSTAGRAM_REMOTE_URL', 'FACTURADOR_REMOTE_URL', 'IA_REMOTE_URL']) {
    const url = new URL(config[campo]);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error(`${campo} debe ser una URL HTTPS sin credenciales.`);
    }
    config[campo] = config[campo].replace(/\/$/, '');
  }
  return Object.freeze(config);
}

export function configPublica(config) {
  return {
    basePublica: config.PUBLIC_BASE_URL.replace(/\/?$/, '/'),
    api: { ia: '/api/ia', tienda: '/api/tienda', instagram: '/api/instagram', facturador: '/api/facturador' },
  };
}
