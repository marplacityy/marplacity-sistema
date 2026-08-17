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

## Deploy

No hay deploy automático desde este repo: **`worker-ig.js` se despliega pegando
el contenido en el panel de Cloudflare**, en el Worker llamado `ig-bot`.

URL de producción: https://ig-bot.fiwind702050.workers.dev/

Este archivo es la copia versionada, para tener historial de los cambios. Si
editás el Worker desde el panel, traé el cambio también acá; si editás acá, no
tiene efecto hasta que lo pegues en Cloudflare.

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
