# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MarplaCity — sistema de gestión para un local de celulares (gastos, ventas/POS, stock por IMEI, consignación, reparaciones, inventario, caja, clientes). Todo el código, la UI y los comentarios están en español (es-AR); mantené ese idioma al escribir código nuevo.

**El repositorio es un único archivo: `index.html`** (~9.600 líneas, ~530 KB). No hay `package.json`, bundler, tests, linter ni pipeline de CI.

## Comandos

No hay build. Para trabajar:

```bash
open index.html                    # abrir directo en el browser
python3 -m http.server 8000        # o servirlo (necesario si algo pide origin http)
```

Verificación = manual en el browser (DevTools console). No hay suite de tests.

## Deploy

**Todo push a `main` se despliega solo a producción.** GitHub Pages está configurado con source = rama `main`, carpeta raíz; no hay staging ni workflow intermedio. URL de producción:

**https://marplacityy.github.io/marplacity-sistema/**

Es decir: `git push` = publicar para el local. No pushees trabajo a medio terminar.

**Antes de cada push hay que subir el sello de versión del sidebar.** Está en `index.html` línea ~1137, dentro del `<div class="logo">`:

```html
<div class="logo">Mis Gastos <span>/ app</span>...<div style="...">v2026.08.10-A</div></div>
```

Formato `vAAAA.MM.DD-<letra>`: la fecha del deploy y una letra que incrementa (`A`, `B`, `C`…) con cada publicación del mismo día. Es la única forma de confirmar a simple vista, desde el browser del local, que el deploy llegó y que no se está viendo una versión cacheada.

Después de pushear, verificar que salió:

```bash
gh api repos/marplacityy/marplacity-sistema/pages --jq .status   # building → built
curl -s 'https://marplacityy.github.io/marplacity-sistema/' | grep -o 'v20[0-9.]*-[A-Z]'
```

El build tarda ~15–60 s. Si el número publicado coincide con el del archivo, el deploy está en producción; si en el browser se sigue viendo el anterior, es caché local (`Cmd+Shift+R`).

## Layout del archivo

| Líneas aprox. | Contenido |
|---|---|
| 1–8 | `<head>`, fuentes de Google |
| 9–536 | Todo el CSS (variables de tema en `:root`) |
| 538–2433 | Todo el HTML: un `<div class="page" id="page-X">` por pantalla + modales |
| 2434–2435 | jsPDF + jspdf-autotable desde cdnjs |
| 2436–9572 | Un solo `<script type="module">` con toda la lógica |

Las páginas son `page-cargar`, `listado`, `reportes`, `amort`, `config`, `ingresos`, `facturas`, `stock`, `consig`, `fijos`, `rep`, `inv`, `clientes`, `home`, `caja`, `encargues`, `repuestos`, `conocimiento`, `bandeja`.

## Arquitectura

### Handlers en `window`

El HTML usa `onclick="..."` inline, pero la lógica vive en un ES module (scope propio). Por eso **todo handler invocado desde el HTML se declara como `window.nombre = function(){...}`**. Si agregás un handler y no lo colgás de `window`, el onclick falla silenciosamente en runtime.

Esto vale también para las **variables**: `onclick="f(repEditId)"` no funciona, porque el atributo se evalúa en scope global y `repEditId` es del módulo. El handler tiene que ser un wrapper global que lea la variable por su cuenta (ver `labelReparacionActual`).

Al final del módulo hay un `Object.assign(window, {...})` para las funciones que se llaman desde el HTML pero se declaran como `function` sueltas. Para auditar que no falte ninguna:

```bash
grep -oE 'on(click|change|input|keydown)="[a-zA-Z_$][a-zA-Z0-9_$]*\(' index.html \
  | sed -E 's/.*"([a-zA-Z_$][a-zA-Z0-9_$]*)\(/\1/' | sort -u
```

Comparar esa lista contra lo expuesto en `window`; lo único que puede sobrar legítimamente es `if` (de algún `onclick="if(...)"`).

Como consecuencia, el HTML se genera con template strings + `innerHTML`: usá `esc()` para texto y `escJs()` para valores que entran dentro de un `onclick='...'`.

### Firestore como única fuente de datos

- Config de Firebase inline en el módulo (proyecto `mis-gastos-21e7b`). No hay backend propio.
- `initializeFirestore(app, { localCache: persistentLocalCache() })` — el caché persistente es lo que sostiene la app cuando se agota la cuota diaria gratuita de lecturas; `snapErr()` detecta `resource-exhausted` y avisa al usuario.
- **No se usa `localStorage`**. Estado de UI que deba sobrevivir va al doc `config/{uid}`.

### Multi-tenancy: `withUser` / `myQ`

Cada documento lleva `userId`. Toda escritura pasa por `withUser(obj)` y toda lectura por `myQ(col)` (`query(col, where('userId','==',uid))`). Consultar una colección sin `myQ` filtra mal y puede violar las reglas de seguridad.

Colecciones: `gastos`, `ingresos`, `stock`, `consig`, `pagos_consig`, `gastos_fijos`, `pagos_fijos`, `reparaciones`, `inventario`, `repuestos`, `precios_repuestos`, `clientes`, `cierres`, `encargues`, `amorts`, `cola_impresion`, `conversaciones` (DMs de Instagram: la escribe el Worker `ig-bot`, un doc por cliente), más el doc singular `config/{uid}`.

Como la config de Firebase está en el HTML de un repo público, **las Security Rules son la única barrera real**. `firestore.rules` en la raíz es la fuente versionada; si agregás una colección hay que sumarla ahí también. Deploy: `firebase deploy --only firestore:rules`. `firebase-tools` está instalado y logueado; `firebase deploy --only firestore:rules --dry-run` compila el archivo y avisa los errores sin publicar nada.

### Ciclo de datos: snapshot → array → render debounced

```
onSnapshot(myQ(col))  →  applySnap('nombre', snap)  →  array global  →  deb('render', renderX)
```

- `applySnap` mantiene un `Map` por colección y aplica **solo los `docChanges()`**, en vez de re-deserializar miles de docs por update. Devuelve `null` si nada cambió — el patrón habitual es `const _g = applySnap(...); if(_g){ gastos = _g; ... }`.
- `deb(name, fn)` colapsa ráfagas de snapshots en cascada (150 ms). `medir(name, fn)` instrumenta en `_perf` (accesible desde la consola).
- El estado vive en arrays module-level: `gastos`, `ingresos`, `stockItems`, `consigItems`, `reps`, `invItems`, etc.

Agregar una colección son 4 pasos: `collection(db, ...)` → array global → `onSnapshot` en `init()` → función `renderX()` llamada vía `deb`.

### Ventana de datos (colecciones acotadas por fecha)

`gastos`, `ingresos` y `cierres` **no se traen completas**: se acotan con `where('fecha','>=', ventanaDesde)` (default 12 meses, configurable en Configuración y guardado en `cfg.ventanaMeses`). Sin esto el arranque lee todo el histórico y agota la cuota diaria de Firebase. Sus listeners viven en `attachListenersVentana()` y se re-arman enteros desde `setVentanaDatos(meses)`.

Tres reglas que no se pueden violar acá:

- **Las escrituras a esas colecciones siempre deben poner `fecha`, nunca `''`.** Un documento sin ese campo queda fuera de toda consulta por rango y se vuelve invisible. `verificarFechasVacias()` detecta los que ya existían y avisa.
- **Al re-suscribir hay que limpiar `_stores`.** El listener nuevo no emite `removed` de lo que quedó afuera de la ventana, así que los docs viejos sobrevivirían en el `Map` incremental.
- **Toda vista que muestre totales de esas colecciones debe llamar `avisoVentana()`**, o los números de un período viejo salen incompletos sin que nada lo indique.

**Por qué las demás no se acotan** (no es un olvido): `reparaciones` alimenta `nextRepNum()`, que saca el correlativo del array — acotarla duplicaría números de ticket. `consig`/`pagos_consig` alimentan el FIFO de deuda de `proveedorAging()`, que necesita el historial completo para no mostrar como impaga una deuda ya pagada. El resto son de estado actual (stock, inventario, repuestos, clientes) y no crecen igual.

Las consultas acotadas necesitan índices compuestos (`userId` + `fecha`), versionados en `firestore.indexes.json` y desplegados con `firebase deploy --only firestore:indexes`. `subVentana()` cae a la consulta sin acotar si el índice falta, para no dejar la pantalla vacía.

### Arranque y routing

`onAuthStateChanged` (email/password) → setea `uid` y `cfgDoc` → `init()` (lee config, engancha todos los `onSnapshot`, oculta `#loading`) → `goTo('home')`.

`window.goTo(page)` togglea `.page.active` y hace la init perezosa de cada pantalla. **El resaltado del nav se resuelve matcheando el texto del atributo onclick** (`nav a[onclick*="'${page}'"]`), así que los links del sidebar y los tabs mobile tienen que contener literalmente `goTo('x')`.

### Dinero y fechas

- Todo es bimonetario ARS/USD. Cada registro guarda su `tc` (tipo de cambio) del momento; el default vive en `cfg.tc`. Helpers: `fmtARS`, `fmtUSD`, `fmtDual`.
- Los costos se guardan congelados en la venta (`ci.costo`), pero `gananciaVentaUSD()` prefiere el **costo actual** del producto en stock/consig/inventario, y en inventario usa `costoHist` para tomar el costo vigente a la fecha de la venta. El congelado es fallback.
- **Fechas: usá siempre `today()` / `isoLocal(d)`**, nunca `toISOString()` directo. Corrigen el offset local; sin eso, después de las 21:00 (AR) las operaciones se fechan al día siguiente.

### Flujos de dominio que cruzan pantallas

- **Venta → stock (`handleStockFromIngreso`)**: si el ingreso trae `permuta`, el equipo entra a `stock` (matcheando por IMEI si ya existía); si el ingreso trae `imei`, el item de stock con ese IMEI pasa a `status:'vendido'`. El IMEI es la clave de correlación.
- **POS**: la página `ingresos` es el carrito. Los items llevan `tipo` (`eq` = stock, `consig`, `inv`, `rep`, `imp`) + `refId` hacia la colección de origen — de ahí sale el costo.
- **3uTools**: `import3uTools` / `parse3uReport` parsean un reporte de verificación exportado como texto para autocompletar el alta de equipos.

### Impresión (tres caminos distintos)

1. **PDF A4** — `generarFacturaPDF` con jsPDF + autotable.
2. **Documento HTML autónomo + `window.print()`** — etiquetas (`labelDoc`/`abrirLabel`, con JsBarcode y QRious cargados dentro del doc generado) y tickets 80 mm (`tkDocAutonomo`).
3. **Cola remota** — si `cfg.printMode === 'local'`, `printTicket80` no imprime: hace `addDoc(cola_impresion, {html, estado:'pendiente'})` y un agente externo en el local levanta la cola. Si el encolado falla, cae a `window.print()`.

### Servicios externos

- `WORKER_URL` (`anthropic-proxy.fiwind702050.workers.dev`) — proxy Cloudflare hacia la API de Anthropic para los reportes y el chat con IA. Autenticado con `X-Firebase-Token` (ID token de Firebase) vía `workerHeaders()`. El Worker es **transparente**: valida el token y reenvía el body tal cual, así que el modelo y todos los parámetros se definen acá en el HTML.
  - **Para leer la respuesta usá `textoDeIA(data)`, nunca `data.content[0].text`.** Los modelos actuales piensan por defecto y el primer bloque de `content` es de tipo `thinking` (sin campo `.text`), así que indexar el primero devuelve `undefined`. El helper junta los bloques `text` y traduce `refusal` y `max_tokens` a errores legibles.
- `cfg.imeiWorker` — URL configurable por el usuario en Configuración, para chequeo de IMEI. Los service IDs son `0` (modelo, gratis), `81` (modelo+color+capacidad), `4` (FMI/iCloud), `55` (blacklist); `correrCheck` los consulta en serie y `guardarEstadoCheck` persiste el resultado.
- Dependencias por CDN (cdnjs + gstatic): sin red no arranca ni Firebase ni la generación de PDFs/etiquetas.

## Otras notas

- `window.borrarTodo()` borra **todas** las colecciones del usuario en batches de 400. No lo llames ni lo uses como referencia para operaciones masivas sin confirmación explícita.
- Al editar, preferí `Edit` con contexto único: hay muchísimos fragmentos repetidos (opciones de select, clases de botones) en el archivo.
