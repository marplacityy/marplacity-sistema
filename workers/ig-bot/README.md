# Worker `ig-bot`

Worker de Cloudflare que atiende los mensajes directos de la cuenta de Instagram
de MarplaCity.

## Qué hace

1. Recibe los webhooks de mensajes directos que le manda Meta.
2. Verifica la firma HMAC del pedido, para asegurarse de que viene de Meta y no
   de cualquiera que conozca la URL.
3. Consulta el stock y las listas de precios en Firestore.
4. Le pide a la IA que clasifique el mensaje y redacte la respuesta. El modelo
   devuelve **un solo JSON** con la categoría, los campos de NEED ATTENTION y un
   array `mensajes`.
5. Manda cada elemento de `mensajes` como un DM aparte, en orden y con una pausa
   corta entre uno y otro.
6. Guarda todo (mensaje, clasificación, respuesta y campos de NEED ATTENTION) en la
   colección `conversaciones`.

**Nada de lo que devuelve el modelo se toma por bueno.** Si el JSON no parsea, si un
campo no es de los válidos, si el modelo dudó (`confianza: "baja"`) o si algún DM no
llegó a salir, el mensaje **no se descarta**: la conversación se guarda igual y sube a
la bandeja con `necesitaAtencion: true` para que la conteste Juni a mano.

**Sin `IG_TOKEN` cargado el Worker no le escribe a nadie**: clasifica, guarda y llena la
bandeja, nada más. Es la forma de tenerlo corriendo en modo "lee y sugiere".

## Archivos

| Archivo | Qué es |
|---|---|
| `worker-ig.js` | El Worker: webhook, firma HMAC, lectura de Firestore, llamada a la IA |
| `prompt.js` | El system prompt del bot, fuente única. Lo importa `worker-ig.js` |
| `cargar-mensajes.mjs` | Script suelto para cargar `config/mensajes` en Firestore |
| `test-parseo.mjs` | Tests del parseo de la respuesta del modelo: `node workers/ig-bot/test-parseo.mjs` |

`prompt-bot.md`, en la raíz del repo, es la versión legible del prompt para editar y
discutir. `prompt.js` es lo que realmente se manda. Si cambiás uno, cambiá el otro.

## Deploy

No hay deploy automático desde este repo. URL de producción:
https://ig-bot.fiwind702050.workers.dev/

**Desde que el prompt vive en `prompt.js`, el Worker son dos archivos**, así que ya no
alcanza con pegar uno solo en el panel. Dos opciones:

- En el panel de Cloudflare, *Edit code*, agregar `prompt.js` como archivo nuevo junto
  a `worker-ig.js` y pegar cada uno en el suyo.
- O pasar a `wrangler deploy`, que sube el directorio entero y es lo que va a hacer
  falta igual para el cron de seguimiento (necesita `wrangler.toml`).

Estos archivos son la copia versionada, para tener historial de los cambios. Si editás
el Worker desde el panel, traé el cambio también acá; si editás acá, no tiene efecto
hasta que lo despliegues.

## El doc de `conversaciones`

**Un doc por cliente, no por mensaje**: el id del doc es el id de Instagram del cliente.
El Worker guarda con un `PATCH` + `updateMask`, así que crea el doc con el primer DM y
después pisa solo los campos de la máscara. Un doc por mensaje no servía: el cron
mandaría un seguimiento por cada DM que escribió el cliente y la bandeja mostraría a la
misma persona repetida en cinco filas.

| campo | tipo | qué es |
|---|---|---|
| `igUserId` | string | id de Instagram del cliente (y el id del doc) |
| `ultimoMensaje` | string | el texto del último DM que entró |
| `ultimoMensajeCliente` | timestamp | cuándo entró. Es el campo que filtra el cron |
| `fecha` | string ISO | el mismo instante, como lo venían guardando los docs |
| `estado` | string | la categoría del prompt (`indeciso`, `cerrado`, `curioso`…) |
| `confianza` | string | `alta` / `baja`. Las `baja` suben a la bandeja |
| `resumen` | string | una línea de qué se habló, para la bandeja |
| `ultimoProducto` | string | el equipo que consultó, para el seguimiento |
| `mensajes` | array | lo que el bot contestó, un elemento por DM |
| `sugerencia` | string | lo mismo en texto plano |
| `respondido` | bool | si salió al menos un DM |
| `necesitaAtencion` | bool | si tiene que mirarlo Juni |
| `motivo` | string | por qué (ver la tabla de prioridades en `prompt-bot.md`) |
| `prioridad` | int | 1 a 8, o 99 si no necesita atención |
| `seguimientoEnviado` | bool | lo marca el cron cuando manda el seguimiento |
| `revisado` | bool | |
| `adjuntos`, `urlsAdjuntos`, `tieneImagen`, `tieneAudio` | | qué mandó el cliente |
| `userId` | string | el dueño, para las reglas de Firestore |

Dos detalles del `PATCH` que importan:

- **`ultimoProducto` solo se manda si el modelo nombró un equipo.** Si el DM no habla de
  ninguno, el campo no entra en la máscara y el doc conserva el de la consulta anterior.
- **Un `null` se manda como `null`, no se saltea.** Si se salteara, una conversación ya
  resuelta seguiría arrastrando el `motivo` viejo y no se iría nunca de la bandeja.

Si agregás un campo, sumalo también a la lista de `soloCamposDelBot()` en
`firestore.rules`: el bot puede actualizar el doc, pero solo esos campos.

## Mensajes fijos (`config/mensajes`)

La invitación al canal de difusión se manda **textual**, sin pasar por el modelo: está
escrita en primera persona del plural y, si el modelo la tuviera en el prompt, le
contagiaría ese "nosotros" al resto de la conversación.

Vive en Firestore, en `config/mensajes` campo `invitacionCanal`. El modelo solo escribe
la marca `[[CANAL]]` donde va, y el Worker la reemplaza por el texto real. Si el doc no
está cargado, la marca se descarta en vez de mandarse literal al cliente.

Para cargarlo o actualizarlo (Node 18+, no instala nada):

```bash
MC_EMAIL='tu@mail.com' MC_PASSWORD='tu-clave' node workers/ig-bot/cargar-mensajes.mjs
MC_EMAIL='tu@mail.com' MC_PASSWORD='tu-clave' node workers/ig-bot/cargar-mensajes.mjs --ver
```

Las credenciales son las tuyas del sistema y se pasan por variable de entorno a
propósito: no van en el repo. Escribe el dueño; el bot sobre ese doc solo lee.

## Variables de entorno

Se configuran en el panel de Cloudflare, en Settings → Variables. La columna
Tipo importa: **Secret** encripta el valor y no lo vuelve a mostrar, **Text**
queda a la vista de cualquiera con acceso al panel.

| Variable           | Tipo   | Para qué |
|--------------------|--------|----------|
| `IG_VERIFY_TOKEN`  | Secret | Token que Meta usa para validar la suscripción al webhook |
| `IG_APP_SECRET`    | Secret | Secreto de la app de Meta, con el que se verifica la firma HMAC |
| `IG_TOKEN`         | Secret | Token de acceso a la API de Instagram |
| `FIREBASE_PROJECT` | Text   | ID del proyecto de Firebase |
| `FIREBASE_KEY`     | Text   | API key pública de Firebase |
| `OWNER_UID`        | Text   | UID del dueño, para atribuirle los documentos que se crean |
| `BOT_EMAIL`        | Text   | Usuario de servicio con el que el Worker se loguea a Firebase |
| `BOT_PASSWORD`     | Secret | Contraseña de ese usuario de servicio |
| `ANTHROPIC_KEY`    | Secret | API key de Anthropic — el Worker llama directo a `api.anthropic.com` |

`FIREBASE_KEY` va como Text porque la API key web de Firebase no es un secreto:
ya viaja pública dentro de `index.html`. Lo que protege los datos son las
Security Rules (ver `firestore.rules` en la raíz). El comentario de cabecera de
`worker-ig.js` la lista como Secret — cargarla así también funciona, es solo más
incómodo de revisar después.

### ⚠️ Nunca pongas los valores reales en el repo

**Este repositorio es público.** Los valores de estas variables no van nunca en
`worker-ig.js`, ni en este README, ni en ningún otro archivo del repo — ni
siquiera "por un rato" o comentados. Viven únicamente en el panel de Cloudflare.

Cualquier secreto que llegue a commitearse hay que darlo por comprometido y
rotarlo, aunque después se borre: queda en el historial de git y en los forks.

Para probar en local, `wrangler` lee los valores de `.dev.vars`, que está
ignorado por git junto con `.env` — no saques esos archivos del ignore.

### Después de cambiar una variable

Los cambios de variables **no toman efecto solos**. Hay que tocar **Deploy** en
el panel para que el Worker levante con los valores nuevos.
