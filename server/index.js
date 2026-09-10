import { access } from 'node:fs/promises';
import { crearApp } from './app.js';
import { cargarConfig } from './config.js';
import { iniciarSeguimientos } from './seguimientos.js';

const config = cargarConfig();
const desarrollo = process.argv.includes('--dev');
if (!desarrollo) {
  try { await access(new URL('../dist/index.html', import.meta.url)); }
  catch { console.error('Primero ejecutá npm run build para preparar la aplicación.'); process.exit(1); }
}
const sistema = await crearApp(config, { desarrollo });
const servidor = sistema.app.listen(config.PORT, config.HOST, () => {
  sistema.logger.info(`MarplaCity listo en http://${config.HOST}:${servidor.address().port}`);
});
servidor.requestTimeout = 240_000;
servidor.on('error', error => {
  sistema.logger.error(error.code === 'EADDRINUSE' ? 'El puerto ya está ocupado. Revisá si MarplaCity está abierto.' : 'No se pudo iniciar el servidor.');
  process.exit(1);
});
const pararSeguimientos = iniciarSeguimientos(config, sistema);
let cerrando = false;
async function cerrar() {
  if (cerrando) return;
  cerrando = true;
  pararSeguimientos();
  const limite = setTimeout(() => process.exit(1), 30_000);
  limite.unref();
  await new Promise(resolve => servidor.close(resolve));
  await sistema.cerrar();
  clearTimeout(limite);
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
sistema.app.locals.detener = cerrar;
