import { spawn, execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import { cargarConfig } from '../server/config.js';
import { huellaFuentes } from './huella.mjs';

const raiz = resolve(import.meta.dirname, '..');
if (existsSync(resolve(raiz, '.env'))) process.loadEnvFile(resolve(raiz, '.env'));
const config = cargarConfig();
const url = `http://127.0.0.1:${config.PORT || 3000}`;
const runtime = resolve(raiz, '.runtime');
await mkdir(runtime, { recursive: true });

async function salud() {
  try {
    const r = await fetch(url + '/api/salud', { signal: AbortSignal.timeout(1200) });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}
async function abrir() {
  if (process.argv.includes('--sin-abrir')) return;
  if (process.platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { windowsHide: true });
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

const existente = await salud();
if (existente?.aplicacion === 'MarplaCity' && existente.runtime === 'Node.js') {
  console.log(`MarplaCity ya está funcionando: ${url}`);
  await abrir();
} else {
  const huella = await huellaFuentes(raiz);
  let compilacion;
  try { compilacion = JSON.parse(await readFile(resolve(raiz, 'dist/compilacion.json'), 'utf8')); } catch { /* Primera ejecución. */ }
  if (compilacion?.huella !== huella) {
    console.log('Preparando la versión actual de MarplaCity…');
    await new Promise((resolvePromesa, reject) => {
      const build = spawn(process.execPath, [resolve(raiz, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: raiz, stdio: 'inherit', windowsHide: true });
      build.on('error', reject);
      build.on('exit', codigo => codigo === 0 ? resolvePromesa() : reject(new Error('No se pudo compilar MarplaCity.')));
    });
  }
  const control = randomBytes(32).toString('hex');
  const log = openSync(resolve(runtime, 'servidor.log'), 'a');
  const hijo = spawn(process.execPath, ['--env-file-if-exists=.env', resolve(raiz, 'server/index.js')], {
    cwd: raiz, detached: true, windowsHide: true,
    stdio: ['ignore', log, log], env: { ...process.env, CONTROL_TOKEN: control },
  });
  closeSync(log);
  hijo.unref();
  await writeFile(resolve(runtime, 'servidor.json'), JSON.stringify({ pid: hijo.pid, url, control }), { mode: 0o600 });
  let listo = false;
  for (let n = 0; n < 40; n++) {
    await esperar(250);
    const estado = await salud();
    if (estado?.aplicacion === 'MarplaCity' && estado.runtime === 'Node.js') { listo = true; break; }
  }
  if (!listo) throw new Error('No se pudo iniciar. Revisá .runtime/servidor.log o si el puerto está ocupado.');
  console.log(`MarplaCity funcionando: ${url}`);
  await abrir();
}
