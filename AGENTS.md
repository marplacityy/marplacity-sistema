# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Estado actual del proyecto (Node.js, septiembre de 2026)

MarplaCity — gestión de celulares, ventas, stock, caja, reparaciones y catálogo.
Mantené código, comentarios y UI en español es-AR.

El antiguo `index.html` monolítico se dividió en `src/client/core`,
`src/client/modulos` y `src/client/vistas`. Node.js 24 + Express están en
`server/`; Vite compila la interfaz. Las entradas de `workers/` reutilizan las
implementaciones de `server/services/`. Los detalles de dominio de abajo siguen
vigentes; los números de línea y el layout monolítico son referencias históricas.

## Comandos actuales

- `npm ci`: instalar versiones fijadas.
- `npm run abrir` / `npm run detener`: iniciar o detener en esta PC.
- `npm run dev`: desarrollo.
- `npm run check`: linter, pruebas Node/dominio, compilación y navegador.
- `npm run test:reglas`: pruebas Firestore con emulador demo y Java 21.
- `npm run build:pages`: interfaz estática en `dist-pages/` para GitHub Pages.

## Deploy actual

Todo push a `main` dispara `.github/workflows/verificar.yml`, que verifica y
publica la interfaz compilada mediante **GitHub Actions**. Settings → Pages debe
usar GitHub Actions; ya no se sirve el `index.html` fuente directamente.

Producción: **https://marplacityy.github.io/marplacity-sistema/**

**Antes de cada push, actualizar el sello del sidebar en `index.html`.**
Formato `vAAAA.MM.DD-<letra>`, incrementando la letra para cada publicación del día.
No pushear trabajo sin verificar. Esperar que el workflow termine y verificar
que el sello en la URL pública coincida con el archivo.

GitHub Pages no ejecuta Node. La web compilada usa los Workers remotos existentes;
Node sigue funcionando localmente. Reglas, índices y Workers requieren despliegues
independientes y credenciales administrativas. Los pendientes de seguridad están
en `docs/SEGURIDAD-OWASP.md`. Nunca subir `.env`, contraseñas ni certificados.

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

Colecciones: `gastos`, `ingresos`, `stock`, `consig`, `pagos_consig`, `gastos_fijos`, `pagos_fijos`, `reparaciones`, `inventario`, `repuestos`, `precios_repuestos`, `clientes`, `cierres`, `encargues`, `amorts`, `cola_impresion`, `conversaciones` (DMs de Instagram: la escribe el Worker `ig-bot`, un doc por cliente), `pedidos` (compras del catálogo web: las crea el Worker `tienda`, el dueño solo las cierra), más el doc singular `config/{uid}`.

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

`gastos`, `ingresos`, `cierres` y `reparaciones` **no se traen completas**: se acotan con `where('fecha','>=', ventanaDesde)` (default 12 meses, configurable en Configuración y guardado en `cfg.ventanaMeses`). Sin esto el arranque lee todo el histórico y agota la cuota diaria de Firebase. Sus listeners viven en `attachListenersVentana()` y se re-arman enteros desde `setVentanaDatos(meses)`.

Tres reglas que no se pueden violar acá:

- **Las escrituras a esas colecciones siempre deben poner `fecha`, nunca `''`.** Un documento sin ese campo queda fuera de toda consulta por rango y se vuelve invisible. `verificarFechasVacias()` detecta los que ya existían y avisa.
- **Al re-suscribir hay que limpiar `_stores`.** El listener nuevo no emite `removed` de lo que quedó afuera de la ventana, así que los docs viejos sobrevivirían en el `Map` incremental.
- **Toda vista que muestre totales de esas colecciones debe llamar `avisoVentana()`**, o los números de un período viejo salen incompletos sin que nada lo indique.

**El número de ticket no sale del array.** Como `reparaciones` está acotada, `nextRepNum()` toma el correlativo de `cfg.repUltimoNum` (y por las dudas el mayor entre eso y lo que haya en memoria) y lo persiste al usarlo. Nunca vuelvas a calcularlo desde `reps`.

**`clientes` no se suscribe al arrancar.** Son ~9.000 docs (importación de RepairDesk) y casi nunca hacen falta: `cargarClientes()` la suscribe una sola vez por sesión cuando una pantalla la necesita (Clientes, Facturas, Reparaciones, POS) o al escribir un nombre. Toda función que use `clientesItems` tiene que hacer `await cargarClientes()` antes, o va a operar sobre una lista vacía y, en el peor caso, crear un cliente duplicado.

**Por qué las demás no se acotan** (no es un olvido): `consig`/`pagos_consig` alimentan el FIFO de deuda de `proveedorAging()`, que necesita el historial completo para no mostrar como impaga una deuda ya pagada. El resto son de estado actual (stock, inventario, repuestos) y no crecen igual.

Estas dos reglas salieron de la factura de Google de agosto de 2026 (10,50 USD bajo "App Engine", que es como factura las operaciones de Firestore): el arranque leía ~18.000 documentos, y quedó en ~1.500.

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

### Catálogo web (`catalogo.html`)

Página pública sin login que lee un solo doc, `catalogo/publico`, que el dueño publica desde la pantalla Catálogo (`publicarCatalogo`). `catalogoCandidatos()` es el único lugar que decide qué sale: equipos en stock (propios y consignación), artículos de inventario con cantidad y precio sugerido, y los ítems de la última lista de precios de cada origen (`kbUltimaLista`) como `tipo:'pedido'`. Las descripciones por producto viven en `cfg.catalogoNotas[id]`.

Las fotos están en `fotos/` del repo y el mapa producto → archivos en `catalogo/fotos` (lo usa también el bot de Instagram para `[[FOTO:clave]]`). La clave es `slugFoto(nombre)` + `-slugFoto(color)`. `armarMapaFotos()` la saca del nombre del archivo, salvo que `clasificacion[archivo]` diga otra cosa: eso lo escribe la IA (`clasificarFotos`, vía el proxy de Anthropic) o el dueño a mano desde la grilla. `node test-catalogo.mjs` chequea esa función sin red.

### Tienda (`workers/tienda`)

El cobro del catálogo. La página manda el pedido a `POST /pedido` del Worker; este lee el precio de `catalogo/publico` (nunca del cliente), guarda el doc en `pedidos` y devuelve a dónde ir a pagar: Mercado Pago (pesos, `precioUSD × tc × (1 + recargoMpPct)`, solo hasta `mpMaxUSD`) o Stripe (dólares, `× (1 + recargoTarjetaPct)`). Efectivo = reserva sin pagar. Las tres reglas viajan en `cobro` dentro del catálogo publicado: cambiar una constante en `index.html` no hace nada hasta volver a publicar.

Al volver del pago la página consulta `GET /pedido/:id`, y si sigue `creado` el Worker le pregunta a la pasarela y lo actualiza ahí mismo; los webhooks (`/mp/webhook`, `/stripe/webhook`) son respaldo. Secretos con `wrangler secret put`, ver `workers/tienda/README.md`. `node workers/tienda/test-tienda.mjs` chequea validación, montos y firmas sin red.

### Servicios externos

- `WORKER_URL` (`anthropic-proxy.fiwind702050.workers.dev`) — proxy Cloudflare hacia la API de Anthropic para los reportes y el chat con IA. Autenticado con `X-Firebase-Token` (ID token de Firebase) vía `workerHeaders()`. El Worker es **transparente**: valida el token y reenvía el body tal cual, así que el modelo y todos los parámetros se definen acá en el HTML.
  - **Para leer la respuesta usá `textoDeIA(data)`, nunca `data.content[0].text`.** Los modelos actuales piensan por defecto y el primer bloque de `content` es de tipo `thinking` (sin campo `.text`), así que indexar el primero devuelve `undefined`. El helper junta los bloques `text` y traduce `refusal` y `max_tokens` a errores legibles.
- `cfg.imeiWorker` — URL configurable por el usuario en Configuración, para chequeo de IMEI. Los service IDs son `0` (modelo, gratis), `81` (modelo+color+capacidad), `4` (FMI/iCloud), `55` (blacklist); `correrCheck` los consulta en serie y `guardarEstadoCheck` persiste el resultado.
- Dependencias por CDN (cdnjs + gstatic): sin red no arranca ni Firebase ni la generación de PDFs/etiquetas.

## Otras notas

- `window.borrarTodo()` borra **todas** las colecciones del usuario en batches de 400. No lo llames ni lo uses como referencia para operaciones masivas sin confirmación explícita.
- Al editar, preferí `Edit` con contexto único: hay muchísimos fragmentos repetidos (opciones de select, clases de botones) en el archivo.
