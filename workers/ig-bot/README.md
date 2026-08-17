# Worker `ig-bot`

Worker de Cloudflare que atiende los mensajes directos de la cuenta de Instagram
de MarplaCity.

## Qué hace

1. Recibe los webhooks de mensajes directos que le manda Meta.
2. Verifica la firma HMAC del pedido, para asegurarse de que viene de Meta y no
   de cualquiera que conozca la URL.
3. Consulta el stock y las listas de precios en Firestore.
4. Le pide a la IA que clasifique el mensaje y redacte una respuesta sugerida.
5. Guarda todo (mensaje, clasificación y respuesta sugerida) en la colección
   `conversaciones`.

**Está en fase 1: lee y sugiere, no responde.** El Worker nunca le manda un
mensaje al cliente por su cuenta; deja la sugerencia guardada para que la
apruebes vos. Por eso `IG_TOKEN` todavía no se usa en el código: está cargado y
verificado, esperando la fase que sí responde.

## Archivos

| Archivo | Qué es |
|---|---|
| `worker-ig.js` | El Worker: webhook, firma HMAC, lectura de Firestore, llamada a la IA |
| `prompt.js` | El system prompt del bot, fuente única. Lo importa `worker-ig.js` |
| `cargar-mensajes.mjs` | Script suelto para cargar `config/mensajes` en Firestore |

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
