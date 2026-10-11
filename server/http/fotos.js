/**
 * Las fotos de los productos, en este servidor.
 *
 * Antes iban al repositorio de GitHub (token que vence, minutos hasta que Pages las
 * publica, una verificación completa por cada foto). Ahora el dueño las sube acá y
 * quedan en `FOTOS_DIR`, servidas en `/fotos/<archivo>`; la tienda de GitHub Pages y
 * el bot las leen por la URL pública (`FOTOS_PUBLIC_URL`). Las fotos viejas siguen
 * en `fotos/` del repositorio y se sirven desde `dist/fotos` como siempre.
 *
 *   GET  /api/fotos/lista   los archivos que hay (subidos y del repositorio)
 *   POST /api/fotos/subir   {archivo, datos} en base64; solo el dueño (X-Firebase-Token)
 *
 * El sistema en GitHub Pages llama desde otro origen: solo para estas rutas se admiten
 * los orígenes de `FOTOS_ORIGENES`.
 */
import { Router } from 'express';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { validarSubida } from '../services/tienda/fotos.js';

const IMAGEN = /\.(jpe?g|png|webp)$/i;
const CACHE_UID_MS = 5 * 60_000;

/** Los orígenes que pueden llamar a estas rutas desde el navegador. */
export function origenesFotos(config) {
  return String(config.FOTOS_ORIGENES || '').split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
}

/** Los archivos de imagen de una carpeta; vacío si no existe. */
async function imagenesDe(dir) {
  try { return (await readdir(dir)).filter(n => IMAGEN.test(n)); } catch { return []; }
}

export function crearRutasFotos(config, { fetchImpl = fetch, directorioEstatico } = {}) {
  const router = Router();
  const dir = resolve(config.FOTOS_DIR);
  const permitidos = origenesFotos(config);
  const uids = new Map();   // token → { uid, hasta }: un token vale minutos, no hace falta preguntar cada vez

  router.use((req, res, next) => {
    const origen = req.get('origin');
    if (origen && permitidos.includes(origen)) {
      res.set('Access-Control-Allow-Origin', origen);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-Token');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  /** El uid de un ID token de Firebase, validado contra Google. Null si no vale. */
  async function uidDelToken(token) {
    if (!token) return null;
    const guardado = uids.get(token);
    if (guardado && guardado.hasta > Date.now()) return guardado.uid;
    try {
      const r = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${config.FIREBASE_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
      });
      if (!r.ok) return null;
      const uid = (await r.json()).users?.[0]?.localId || null;
      if (uid) uids.set(token, { uid, hasta: Date.now() + CACHE_UID_MS });
      return uid;
    } catch { return null; }
  }

  router.get('/lista', async (_req, res) => {
    const subidas = await imagenesDe(dir);
    const repo = directorioEstatico ? await imagenesDe(join(directorioEstatico, 'fotos')) : [];
    res.json({ archivos: [...new Set([...subidas, ...repo])].sort() });
  });

  router.post('/subir', async (req, res) => {
    if (!config.OWNER_UID) return res.status(503).json({ error: 'Falta OWNER_UID en el servidor.' });
    const uid = await uidDelToken(req.get('x-firebase-token'));
    if (!uid || uid !== config.OWNER_UID) return res.status(401).json({ error: 'no autorizado' });
    let body;
    try { body = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body || ''); } catch { return res.status(400).json({ error: 'json inválido' }); }
    const v = validarSubida(body);
    if (v.error) return res.status(400).json({ error: v.error });
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, v.archivo), v.bytes);
    } catch (error) {
      req.log?.error({ tipo: error.code || error.name }, 'No se pudo guardar la foto.');
      return res.status(500).json({ error: 'No se pudo guardar la foto en el servidor.' });
    }
    res.json({ ok: true, archivo: v.archivo, url: config.FOTOS_PUBLIC_URL + v.archivo });
  });

  return router;
}
