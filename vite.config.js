import { defineConfig } from 'vite';
import { readFile, cp, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { huellaFuentes } from './scripts/huella.mjs';

const raiz = import.meta.dirname;
export default defineConfig(({ mode }) => ({
  root: raiz,
  base: mode === 'pages' ? '/marplacity-sistema/' : '/',
  publicDir: 'public',
  resolve: {
    alias: mode === 'prueba' ? [{ find: /^firebase\/(app|auth|firestore)$/, replacement: resolve(raiz, 'tests/fixtures/firebase.js') }] : [],
  },
  plugins: [{
    name: 'vistas-marplacity',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        const marcas = [...html.matchAll(/<!-- @vista ([\w/.-]+) -->/g)];
        for (const [marca, archivo] of marcas) {
          const destino = resolve(raiz, archivo);
          if (!destino.startsWith(resolve(raiz, 'src/client/vistas') + sep)) throw new Error('Ruta de vista inválida.');
          html = html.replace(marca, await readFile(destino, 'utf8'));
        }
        return html;
      },
    },
    async closeBundle() {
      // Las fotos conservan su carpeta original, compartida con la integración de GitHub.
      if (mode !== 'prueba') {
        const salida = mode === 'pages' ? 'dist-pages' : 'dist';
        await cp(resolve(raiz, 'fotos'), resolve(raiz, salida, 'fotos'), { recursive: true });
        await writeFile(resolve(raiz, salida, 'compilacion.json'), JSON.stringify({ huella: await huellaFuentes(raiz), fecha: new Date().toISOString() }));
      }
    },
  }],
  build: {
    outDir: mode === 'pages' ? 'dist-pages' : 'dist',
    sourcemap: false,
    rollupOptions: {
      input: Object.fromEntries(['index', 'catalogo', 'ver', 'privacidad', 'condiciones', 'eliminacion-datos'].map(nombre => [nombre, resolve(raiz, nombre + '.html')])),
      output: {
        manualChunks(id) {
          if (id.includes('node_modules') && /@firebase\/firestore/.test(id)) return 'firebase-datos';
          if (id.includes('node_modules') && /@firebase\/auth/.test(id)) return 'firebase-auth';
          if (id.includes('node_modules') && /firebase|idb/.test(id)) return 'firebase-base';
          if (id.includes('node_modules') && /jspdf|autotable|qrious/.test(id)) return 'documentos';
        },
      },
    },
  },
}));
