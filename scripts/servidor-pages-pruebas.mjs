import express from 'express';
import { resolve } from 'node:path';

// Simula Pages sin /api/config ni backend: todas las rutas usan el prefijo del repo.
const app = express();
app.use('/marplacity-sistema', express.static(resolve('dist-pages'), { dotfiles: 'deny' }));
app.use((_req, res) => res.sendStatus(404));
const servidor = app.listen(3103, '127.0.0.1');
process.on('SIGTERM', () => servidor.close());
