import express from 'express';
import { resolve } from 'node:path';
import { SITIO_PUBLICO } from '../src/shared/sitio.js';

// Simula Pages sin /api/config ni backend: todas las rutas usan el prefijo del sitio, y
// como Pages, /tienda sirve tienda.html.
const app = express();
app.use(new URL(SITIO_PUBLICO).pathname.replace(/\/$/, '') || '/', express.static(resolve('dist-pages'), { dotfiles: 'deny', extensions: ['html'] }));
app.use((_req, res) => res.sendStatus(404));
const servidor = app.listen(3103, '127.0.0.1');
process.on('SIGTERM', () => servidor.close());
