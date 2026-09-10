import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

/** Permite detectar cambios de código y fotos antes de abrir una compilación vieja. */
export async function huellaFuentes(raiz = resolve(import.meta.dirname, '..')) {
  const archivos = ['index.html', 'catalogo.html', 'ver.html', 'privacidad.html', 'condiciones.html', 'eliminacion-datos.html', 'package-lock.json', 'vite.config.js'];
  async function recorrer(carpeta) {
    for (const entrada of await readdir(resolve(raiz, carpeta), { withFileTypes: true })) {
      const ruta = resolve(raiz, carpeta, entrada.name);
      const nombre = relative(raiz, ruta).replaceAll('\\', '/');
      if (entrada.isDirectory()) await recorrer(nombre);
      else archivos.push(nombre);
    }
  }
  for (const carpeta of ['src', 'public', 'fotos', 'server/services/ig-bot']) await recorrer(carpeta);
  const hash = createHash('sha256');
  for (const archivo of archivos.sort()) hash.update(archivo).update(await readFile(resolve(raiz, archivo)));
  return hash.digest('hex');
}
