import { resolve } from 'node:path';
import { crearApp } from '../server/app.js';
import { cargarConfig } from '../server/config.js';

// Este ejecutable sirve exclusivamente el paquete construido con el SDK ficticio.
const config = cargarConfig({ PORT: '3102', LOG_LEVEL: 'silent', NODE_ENV: 'test' });
const sistema = await crearApp(config, { directorioEstatico: resolve('.runtime/pruebas') });
const server = sistema.app.listen(config.PORT, config.HOST);
process.on('SIGTERM', () => server.close());
