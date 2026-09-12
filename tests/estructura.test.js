import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'parse5';
import { parse as parseJs } from '@babel/parser';
import traverse from '@babel/traverse';

test('las 23 pantallas conservan sus identificadores y no duplican controles', async () => {
  let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const marcas = [...html.matchAll(/<!-- @vista ([\w/.-]+) -->/g)];
  assert.equal(marcas.length, 23);
  for (const [marca, archivo] of marcas) html = html.replace(marca, await readFile(new URL('../' + archivo, import.meta.url), 'utf8'));
  const ids = new Set();
  const duplicados = [];
  function revisar(nodo) {
    const id = nodo.attrs?.find(a => a.name === 'id')?.value;
    if (id && ids.has(id)) duplicados.push(id);
    if (id) ids.add(id);
    for (const hijo of nodo.childNodes || []) revisar(hijo);
  }
  revisar(parse(html));
  assert.deepEqual(duplicados, []);
  assert.ok(ids.size > 400);
});

test('el estado de sesión no se copia a variables locales durante la inicialización modular', async () => {
  const archivos = await readdir(new URL('../src/client/modulos/', import.meta.url));
  assert.ok(archivos.length >= 25);
  for (const archivo of archivos) {
    const fuente = await readFile(new URL('../src/client/modulos/' + archivo, import.meta.url), 'utf8');
    const ast = parseJs(fuente, { sourceType: 'module' });
    traverse(ast, { VariableDeclarator(path) {
      // Desestructurar el contexto dejaría de ver las actualizaciones de Firebase.
      if (path.node.init?.type === 'Identifier' && path.node.init.name === 'contextoApp') {
        assert.fail(`Copia del estado compartido en ${archivo}`);
      }
    } });
  }
});

test('ningún handler inline: la CSP prohíbe script-src-attr', async () => {
  const raiz = new URL('../', import.meta.url);
  const html = ['index.html', 'catalogo.html', 'ver.html', ...(await readdir(new URL('src/client/vistas/', raiz))).map(v => 'src/client/vistas/' + v)];
  const js = (await readdir(new URL('src/client/', raiz), { recursive: true })).filter(f => f.endsWith('.js') && !f.endsWith('eventos.js')).map(f => 'src/client/' + f);
  for (const archivo of [...html, ...js]) {
    const fuente = await readFile(new URL(archivo, raiz), 'utf8');
    assert.doesNotMatch(fuente, /\bon(click|change|input|keydown|keyup|submit|blur|focus|load|error)=/, `handler inline en ${archivo}`);
  }
});
