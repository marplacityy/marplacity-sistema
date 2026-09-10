import { readFile, unlink } from 'node:fs/promises';

const archivo = new URL('../.runtime/servidor.json', import.meta.url);
let instancia;
try { instancia = JSON.parse(await readFile(archivo, 'utf8')); }
catch { console.log('No hay un servidor iniciado desde el acceso de MarplaCity.'); process.exit(0); }
const destino = new URL(instancia.url);
if (destino.hostname !== '127.0.0.1' || destino.protocol !== 'http:') throw new Error('Dirección de servidor inválida.');
try {
  const r = await fetch(new URL('/api/apagar', destino), { method: 'POST', headers: { 'X-Marplacity-Control': instancia.control }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('El servidor no corresponde a esta instancia.');
  await unlink(archivo);
  console.log('MarplaCity se está cerrando.');
} catch (error) {
  console.error('No se pudo cerrar MarplaCity:', error.message);
  process.exitCode = 1;
}
