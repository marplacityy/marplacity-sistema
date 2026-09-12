# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MarplaCity — sistema de gestión para un local de celulares (gastos, ventas/POS, stock por IMEI, consignación, reparaciones, inventario, caja, clientes, catálogo web, pedidos, bot de Instagram, facturación electrónica). Todo el código, la UI y los comentarios están en español (es-AR); mantené ese idioma al escribir código nuevo.

Node.js 24 + Express 5 en `server/`, frontend en módulos ES compilado con Vite, Firestore como única base de datos. Hasta septiembre de 2026 era un solo `index.html` de 9.600 líneas; `docs/mapa-modulos.json` registra cómo se repartió. `AGENTS.md` es la versión de este archivo para Codex y `docs/ARQUITECTURA.md` amplía la migración.

## Comandos

```bash
npm ci                    # instalar (versiones fijadas; Node 24.12+ dentro de la rama 24)
npm run dev               # servidor con Vite en http://127.0.0.1:3000
npm run abrir / detener   # arrancar o parar en segundo plano (logs en .runtime/servidor.log)
npm run lint              # eslint sobre src, server, scripts y tests
npm test                  # node --test tests/*.test.js (HTTP, estructura, seguridad, facturador)
npm run test:dominio      # tests puros sin red: catálogo, tienda, parseo del bot
npm run test:browser      # Playwright: levanta tres servidores solo (ver playwright.config.js)
npm run check             # lint + test + test:dominio + build + test:browser: lo mismo que corre CI
npm run test:reglas       # reglas de Firestore en el emulador (necesita Java 21)
npm run build:pages       # interfaz estática en dist-pages/ con base /marplacity-sistema/
```

Los tests de navegador compilan una variante con `--mode prueba`, que reemplaza `firebase/*` por `tests/fixtures/firebase.js`: no tocan datos reales. `tests/estructura.test.js` falla si una vista pierde un `id`, si dos vistas repiten uno, o si un módulo copia `contextoApp` a una variable local.

## Deploy

**Todo push a `main` publica a producción**: `.github/workflows/verificar.yml` corre `npm run check`, `test:reglas` y `npm audit`, y si todo pasa sube `dist-pages/` a GitHub Pages (source = GitHub Actions). Si un test falla, no se publica. URL:

**https://marplacityy.github.io/marplacity-sistema/**

**Antes de cada push hay que subir el sello de versión del sidebar**, en `index.html` dentro del `<div class="logo">`:

```html
<div style="...">v2026.09.10-D · Node.js</div>
```

Formato `vAAAA.MM.DD-<letra>`: fecha del deploy y una letra que incrementa con cada publicación del mismo día. Es la única forma de confirmar, desde el browser del local, que el deploy llegó y no se está viendo caché.

Después de pushear, verificar:

```bash
gh run list --limit 1                                    # el workflow tiene que terminar en success
curl -s 'https://marplacityy.github.io/marplacity-sistema/' | grep -o 'v20[0-9.]*-[A-Z]'
```

El workflow tarda unos minutos (instala Playwright y Java). Si el browser sigue mostrando el sello anterior, es caché local (`Cmd+Shift+R`). No hay service worker a propósito, para que esto siga siendo así.

**El push no despliega nada más.** Reglas e índices de Firestore, los Workers de Cloudflare y los secretos tienen cada uno su deploy propio (ver más abajo).

## Layout del repo

| Ruta | Contenido |
|---|---|
| `index.html` | Cascarón del sistema: `<head>`, sidebar, modales y 23 marcas `<!-- @vista src/client/vistas/X.html -->` |
| `src/client/vistas/*.html` | Una plantilla por pantalla (`page-cargar`, `listado`, `reportes`, `amort`, `config`, `ingresos`, `facturas`, `stock`, `consig`, `fijos`, `rep`, `inv`, `clientes`, `home`, `caja`, `encargues`, `repuestos`, `bandeja`, `conocimiento`, `pedidos`, `catalogo`, `asistente`, `facturador`) |
| `src/client/core/` | `firebase.js` (config inline, caché persistente), `datos.js` (snapshots, `applySnap`, `deb`, `withUser`, `myQ`, ventana de datos), `interfaz.js` (`goTo`, `esc`, `today`, formato), `sesion.js`, `estado.js` (`contextoApp`), `config-publica.js`, `documentos.js` |
| `src/client/modulos/` | Un módulo por dominio, cada uno exporta `inicializarX()` |
| `src/client/main.js` | Llama a cada `inicializarX()` en orden y al final `inicializarSesion()` |
| `src/client/styles/` | CSS del sistema, del catálogo y del visor de documentos |
| `src/client/catalogo-publico.js`, `documento-publico.js` | Lógica de `catalogo.html` y `ver.html` (páginas sin login) |
| `src/shared/` | Funciones puras compartidas entre browser, server y Workers (`catalogo.js`, `seguridad.js`) |
| `server/app.js` | Express: helmet, rate limit, `/api/config`, `/api/salud`, adaptador `/api/<servicio>`, estáticos de `dist/` |
| `server/services/` | Implementación real de `tienda`, `ig-bot`, `facturador`, `ia`, `asistente` |
| `workers/*/` | Entradas de Cloudflare: reexportan `server/services/*` más su `wrangler.toml` y README |
| `firestore.rules`, `firestore.indexes.json` | Fuente versionada de reglas e índices |
| `fotos/` | Fotos del catálogo; se copian tal cual al build |
| `docs/` | `ARQUITECTURA.md`, `LANZAMIENTO.md`, `SEGURIDAD-OWASP.md` (pendientes de seguridad), `mapa-modulos.json` |

Vite inserta las vistas en `index.html` en build y en dev (`transformIndexHtml` en `vite.config.js`). Las vistas tienen que estar bajo `src/client/vistas/` o el build falla. Las entradas compiladas son `index`, `catalogo`, `ver`, `privacidad`, `condiciones` y `eliminacion-datos`.

## Arquitectura

### Handlers sin JS inline: `data-click` + `window`

No hay `onclick="..."` en el HTML (la CSP lo prohíbe: `script-src-attr 'none'`). Los controles declaran el handler por nombre y `core/eventos.js` lo despacha por delegación desde `document`:

```html
<button data-click="guardar">                              <!-- window.guardar() -->
<a data-click="goTo" data-args='["stock"]'>                <!-- window.goTo('stock') -->
<input data-change="setTab" data-args='["x","$this"]'>     <!-- window.setTab('x', el) -->
<input data-enter="agregarMedio">                          <!-- Enter sin Shift -->
```

Eventos: `data-click`, `data-change`, `data-input`, `data-submit`, `data-error`, `data-enter`. Comodines en `data-args`: `"$this"`, `"$value"`, `"$checked"`, `"$event"`, `"$fn:nombre"`. `data-stop` en un elemento sin handler corta el click (el viejo `event.stopPropagation()`). Se atiende solo el elemento más cercano: un handler anidado no dispara el del contenedor.

En HTML generado desde JS usá el helper `on()` de `shared/seguridad.js`, que arma los dos atributos y escapa los argumentos como JSON: `` `<button ${on('click', 'eliminarStock', s.id)}>` ``. No hace falta `escJs()` para los argumentos; `esc()` sigue siendo obligatorio para el texto.

**El handler tiene que existir en `window`**: cada módulo hace `window.nombre = ...` o un `Object.assign(window, {...})`. Si no está, el despachador loguea `Handler X no expuesto en window` en la consola. Un handler que hacía dos cosas (`cerrar(); abrir(id)`) pasa a ser un wrapper con nombre en el módulo.

`tests/estructura.test.js` falla si vuelve a aparecer un `on*=` inline en vistas, `index.html`, `catalogo.html` o en los módulos.

### Estado compartido: `contextoApp`

Los arrays de datos (`gastos`, `ingresos`, `stockItems`, `consigItems`, `reps`, `invItems`, …), `db`, `uid`, `cfg` y `currentPage` viven en `contextoApp` (`core/estado.js`). Se lee siempre como `contextoApp.gastos`, **nunca** `const { gastos } = contextoApp`: la copia deja de ver los snapshots nuevos, y `tests/estructura.test.js` lo rechaza.

### Firestore como única fuente de datos

- Config de Firebase inline en `core/firebase.js` (proyecto `mis-gastos-21e7b`). No hay backend de datos propio; Node solo sirve la interfaz y adapta integraciones.
- `initializeFirestore(app, { localCache: persistentLocalCache() })`: el caché persistente sostiene la app cuando se agota la cuota diaria de lecturas; `snapErr()` detecta `resource-exhausted` y avisa.
- **No se usa `localStorage`**. Estado de UI que deba sobrevivir va al doc `config/{uid}`.

### Multi-tenancy: `withUser` / `myQ`

Cada documento lleva `userId`. Toda escritura pasa por `withUser(obj)` y toda lectura por `myQ(col)`. Consultar sin `myQ` filtra mal y viola las reglas.

Colecciones: `gastos`, `ingresos`, `stock`, `consig`, `pagos_consig`, `gastos_fijos`, `pagos_fijos`, `reparaciones`, `inventario`, `repuestos`, `precios_repuestos`, `listas_precios`, `clientes`, `cierres`, `encargues`, `amorts`, `cola_impresion`, `conversaciones` (las escribe el bot de Instagram), `pedidos` (las crea la tienda, el dueño solo las cierra), `comprobantes` (las escribe el facturador, nadie borra), `docs_publicos`, `conocimiento/{uid}`, más los docs singulares `config/{uid}`, `config/mensajes`, `config/prompt`, `config/bot`, `catalogo/publico` y `catalogo/fotos`.

**Las reglas son la única barrera real**, porque la config de Firebase está en un repo público. `firestore.rules` es la fuente; si agregás una colección hay que sumarla ahí y a `tests/reglas/`. Las reglas identifican al "dueño del local" como el `userId` de `catalogo/publico`: los usuarios de servicio (bot, tienda, facturador) solo pueden leer y escribir documentos con ese `userId`, y sus Workers lo toman de la variable `OWNER_UID` del panel de Cloudflare.

```bash
firebase deploy --only firestore:rules --dry-run   # compila sin publicar
firebase deploy --only firestore:rules             # publica (firebase-tools está logueado en esta PC)
firebase deploy --only firestore:indexes
```

### Ciclo de datos: snapshot → contextoApp → render debounced

```
onSnapshot(myQ(col))  →  applySnap('nombre', snap)  →  contextoApp.X  →  deb('render', renderX)
```

- `applySnap` mantiene un `Map` por colección y aplica solo los `docChanges()`. Devuelve `null` si nada cambió: `const _g = applySnap(...); if(_g){ contextoApp.gastos = _g; ... }`.
- `deb(name, fn)` colapsa ráfagas de snapshots (150 ms). `medir(name, fn)` instrumenta en `_perf`.
- Agregar una colección: `collection(db, ...)` → campo en `contextoApp` → `onSnapshot` en `core/datos.js` → `renderX()` en su módulo, llamada vía `deb`.

### Ventana de datos (colecciones acotadas por fecha)

`gastos`, `ingresos`, `cierres` y `reparaciones` se acotan con `where('fecha','>=', ventanaDesde)` (default 12 meses, `cfg.ventanaMeses`). Sin esto el arranque lee todo el histórico y agota la cuota. Sus listeners viven en `attachListenersVentana()` y se re-arman desde `setVentanaDatos(meses)`.

- **Las escrituras a esas colecciones siempre ponen `fecha`, nunca `''`.** Un doc sin fecha queda fuera de toda consulta. `verificarFechasVacias()` detecta los que ya existían.
- **Al re-suscribir hay que limpiar `_stores`**: el listener nuevo no emite `removed` de lo que quedó afuera.
- **Toda vista con totales de esas colecciones llama `avisoVentana()`**.

**El número de ticket no sale del array.** `nextRepNum()` usa `cfg.repUltimoNum` (y el mayor entre eso y memoria) y lo persiste. Nunca recalcularlo desde `reps`.

**`clientes` no se suscribe al arrancar** (~9.000 docs). `cargarClientes()` la suscribe una vez por sesión cuando hace falta. Toda función que use `clientesItems` hace `await cargarClientes()` antes, o crea duplicados.

`consig`/`pagos_consig` no se acotan porque el FIFO de deuda de `proveedorAging()` necesita el historial completo. Las acotadas necesitan índices compuestos `userId` + `fecha` en `firestore.indexes.json`; `subVentana()` cae a la consulta sin acotar si el índice falta.

### Arranque y routing

`main.js` → `cargarConfiguracion()` (`/api/config` en Node; en modo `pages` las URLs de los Workers están fijas en `config-publica.js`) → `inicializarFirebase()` → cada `inicializarX()` → `inicializarSesion()`, que engancha `onAuthStateChanged` → `init()` → `goTo('home')`.

`window.goTo(page)` togglea `.page.active` y hace la init perezosa. **El resaltado del nav matchea el texto del onclick** (`nav a[onclick*="'${page}'"]`), así que sidebar y tabs mobile tienen que contener literalmente `goTo('x')`.

### Dinero y fechas

- Bimonetario ARS/USD. Cada registro guarda su `tc`; el default es `cfg.tc`. Helpers `fmtARS`, `fmtUSD`, `fmtDual`.
- Costos congelados en la venta (`ci.costo`), pero `gananciaVentaUSD()` (`modulos/costos.js`) prefiere el costo actual del producto; en inventario usa `costoHist`.
- **Fechas: siempre `today()` / `isoLocal(d)`**, nunca `toISOString()`. Sin eso, después de las 21:00 (AR) las operaciones se fechan al día siguiente. Playwright corre en zona horaria de Buenos Aires por lo mismo.

### Flujos de dominio que cruzan pantallas

- **Venta → stock (`handleStockFromIngreso`, `modulos/stock.js`)**: `permuta` mete el equipo en `stock` (matcheando IMEI); `imei` pasa el item a `status:'vendido'`.
- **POS** (`modulos/pos.js`): la página `ingresos` es el carrito. Items con `tipo` (`eq`, `consig`, `inv`, `rep`, `imp`) + `refId` hacia la colección de origen.
- **3uTools**: `import3uTools` / `parse3uReport` en `modulos/stock.js`.

### Impresión (tres caminos)

1. **PDF A4**: jsPDF + autotable desde npm (`core/documentos.js`).
2. **Documento HTML autónomo + `window.print()`**: etiquetas (JsBarcode y QRious se inyectan por `?url`) y tickets 80 mm.
3. **Cola remota**: con `cfg.printMode === 'local'`, `printTicket80` encola en `cola_impresion` y un agente en el local imprime. Si falla, cae a `window.print()`.

### Catálogo web, tienda y bot

- `catalogo.html` lee solo `catalogo/publico` (y `catalogo/fotos`); el dueño lo publica desde la pantalla Catálogo (`publicarCatalogo`). `catalogoCandidatos()` decide qué sale. Las reglas de cobro viajan en `cobro` dentro del doc publicado: cambiar una constante no hace nada hasta republicar. Fotos en `fotos/`, mapa en `catalogo/fotos`, clave `slugFoto(nombre)-slugFoto(color)`; `node test-catalogo.mjs` lo chequea.
- **Tienda** (`server/services/tienda`, deploy en `workers/tienda`): `POST /pedido` lee el precio del catálogo publicado, guarda en `pedidos` y devuelve Mercado Pago (ARS) o Stripe (USD). Webhooks de respaldo; `GET /pedido/:id` consulta la pasarela si sigue `creado`.
- **Bot de Instagram** (`server/services/ig-bot`, deploy en `workers/ig-bot`): prompt en `prompt.js`, guarda en `conversaciones`, cron de seguimiento cada hora. Ventana de 24 h de Meta: no cambiar.
- **Facturador ARCA** (`server/services/facturador`): certificados cifrados con `CERT_MASTER_KEY`; leer `workers/facturador/README.md` antes de tocar.

Cada Worker se despliega con `wrangler deploy` desde su carpeta. Sus `wrangler.toml` llevan `keep_vars = true` porque las variables viven en el panel; sin eso un deploy las borra. **No hagas `wrangler deploy` sin avisar.**

### Servicios externos

- **IA**: el browser llama a `configuracion.api.ia` (Worker `anthropic-proxy`, o `/api/ia` en Node) con `X-Firebase-Token` vía `workerHeaders()`. El proxy es transparente: modelo y parámetros se definen acá. **Leer la respuesta con `textoDeIA(data)`** (`modulos/reportes.js`), nunca `data.content[0].text`: el primer bloque suele ser `thinking`.
- `cfg.imeiWorker`: URL configurable para chequeo de IMEI (service IDs `0`, `81`, `4`, `55`).
- Sin red no arranca Firebase; las fuentes de Google son lo único que sigue viniendo por CDN.

## Otras notas

- `window.borrarTodo()` borra **todas** las colecciones del usuario. No lo llames ni lo uses de referencia para operaciones masivas.
- Al editar, preferí `Edit` con contexto único: hay muchos fragmentos repetidos entre vistas.
- Antes de un push, corré `npm run check` en local: es lo mismo que CI, y CI bloqueando el deploy es la única red de seguridad.
- Nunca subir `.env`, contraseñas ni certificados. `.env.example` documenta las variables.
