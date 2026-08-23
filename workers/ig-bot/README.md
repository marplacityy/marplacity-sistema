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

Aparte del webhook corre un **cron cada hora** que sigue a los que quedaron en silencio
(ver más abajo).

## Archivos

| Archivo | Qué es |
|---|---|
| `worker-ig.js` | El Worker: webhook, firma HMAC, lectura de Firestore, llamada a la IA |
| `prompt.js` | El system prompt del bot, fuente única. Lo importa `worker-ig.js` |
| `cargar-mensajes.mjs` | Script suelto para cargar `config/mensajes` en Firestore |
| `wrangler.toml` | Config de deploy: nombre del Worker y el cron cada hora |
| `test-parseo.mjs` | Tests sin red: parseo de la respuesta del modelo, ventana del seguimiento y campos del doc contra `firestore.rules`. `node workers/ig-bot/test-parseo.mjs` |

`prompt-bot.md`, en la raíz del repo, es la versión legible del prompt para editar y
discutir. `prompt.js` es lo que realmente se manda. Si cambiás uno, cambiá el otro.

## Deploy

No hay deploy automático desde este repo. URL de producción:
https://ig-bot.fiwind702050.workers.dev/

**El Worker ya no se despliega desde el panel.** Son varios archivos y además tiene un
cron, que se declara en `wrangler.toml` y no se puede cargar pegando código:

```bash
cd workers/ig-bot && npx wrangler deploy
```

El orden importa, porque las tres partes están acopladas:

1. `firebase deploy --only firestore:rules` — sin esto el Worker guarda el primer DM de
   cada cliente y falla con permission-denied en todos los siguientes (el `PATCH` sobre
   un doc que ya existe es un *update*, y el bot recién ahora lo tiene permitido).
2. `firebase deploy --only firestore:indexes` — y esperar a que termine de construirse.
   Mientras tanto la query del cron falla con `FAILED_PRECONDITION`.
3. `npx wrangler deploy` — el Worker y el cron.

**Ojo con las variables.** Por defecto `wrangler` **borra del Worker toda variable que
no esté en `wrangler.toml`**, y los valores no pueden estar ahí porque el repo es
público. Por eso el archivo lleva `keep_vars = true`: sin ese flag, un deploy se lleva
puestas las cuatro `Text` del panel (`FIREBASE_PROJECT`, `FIREBASE_KEY`, `OWNER_UID`,
`BOT_EMAIL`) y el bot queda sin poder loguearse a Firebase — recibe los DM, no contesta
y no guarda nada. Pasó el 22/08/2026. Los `Secret` no se tocan.

Aun con el flag puesto, después de cada deploy abrí
https://ig-bot.fiwind702050.workers.dev/ y fijate que la lista de `vars` esté toda en
`true`; si alguna volvió `false`, recargala en Settings → Variables y tocá *Deploy*.

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
| `igUsuario` | string | el @usuario, para que la bandeja no muestre un id de 17 dígitos |
| `ultimoMensaje` | string | el texto del último DM que entró |
| `ultimoMensajeCliente` | timestamp | cuándo entró. Es el campo que filtra el cron |
| `fecha` | string ISO | el mismo instante, como lo venían guardando los docs |
| `estado` | string | la categoría del prompt (`indeciso`, `cerrado`, `curioso`…) |
| `confianza` | string | `alta` / `baja`. Las `baja` suben a la bandeja |
| `resumen` | string | una línea de qué se habló, para la bandeja |
| `ultimoProducto` | string | el equipo que consultó, para el seguimiento |
| `historial` | array | el ida y vuelta de la charla: `{de, texto, fecha}`, últimas 60 líneas |
| `mensajes` | array | lo que el bot contestó, un elemento por DM |
| `sugerencia` | string | lo mismo en texto plano |
| `respondido` | bool | si salió al menos un DM |
| `necesitaAtencion` | bool | si tiene que mirarlo Juni |
| `motivo` | string | por qué (ver la tabla de prioridades en `prompt-bot.md`) |
| `prioridad` | int | 1 a 8, o 99 si no necesita atención |
| `seguimientoEnviado` | bool | lo marca el cron cuando manda el seguimiento |
| `aprobadoPor`, `aprobadoEn` | string, timestamp | quién cerró la conversación desde la bandeja y cuándo. **Los escribe el sistema, no el bot** |
| `revisado` | bool | |
| `adjuntos`, `urlsAdjuntos`, `tieneImagen`, `tieneAudio` | | qué mandó el cliente |
| `userId` | string | el dueño, para las reglas de Firestore |

**El historial** guarda las últimas 60 líneas de la conversación, para que la bandeja
muestre el chat completo y no una frase suelta. Se arma leyendo el doc antes de
escribirlo, porque la REST API no tiene un *append* simple: si entran dos DM en el mismo
instante se puede perder una línea, y es un precio aceptable —es contexto, no el
registro contable— a cambio de no meter transacciones en el camino caliente del webhook.
Solo se anota lo que **realmente salió**: si el envío se cortó a la mitad, el historial
refleja lo que el cliente vio. Empezó a guardarse el 22/08/2026; lo anterior no se puede
recuperar, Instagram no lo devuelve.

Dos detalles del `PATCH` que importan:

- **`ultimoProducto` solo se manda si el modelo nombró un equipo.** Si el DM no habla de
  ninguno, el campo no entra en la máscara y el doc conserva el de la consulta anterior.
- **Un `null` se manda como `null`, no se saltea.** Si se salteara, una conversación ya
  resuelta seguiría arrastrando el `motivo` viejo y no se iría nunca de la bandeja.

Si agregás un campo, sumalo también a la lista de `soloCamposDelBot()` en
`firestore.rules`: el bot puede actualizar el doc, pero solo esos campos, y `hasOnly()`
es todo o nada — si escribe uno que no está en la lista, Firestore rechaza el `PATCH`
**entero** y esa conversación no se actualiza. Solo se ve en los logs del Worker, así
que `test-parseo.mjs` compara las dos listas y falla si se desincronizan.

## Cron de seguimiento

Corre **cada hora en punto** (`[triggers] crons` en `wrangler.toml`) y busca las
conversaciones que quedaron calladas. Es el `scheduled` del `export default`, en el mismo
`worker-ig.js` que atiende el webhook.

El mensaje sale a las **20 h de silencio**, salvo que ese momento caiga entre las 00:00
y las 08:00 de Argentina: ahí se **adelanta** a las 23:00 del día anterior. Nadie quiere
un *"seguís interesado?"* a las 3 de la mañana.

Adelantar es lo único que se puede hacer. Correrlo para adelante, hasta la mañana
siguiente, se comería el límite de 24 h de Meta, y pasada esa ventana el bot no puede
escribir: solo se responde con el tag `HUMAN_AGENT`, que es exclusivo para humanos y
usarlo desde un bot es de las formas más rápidas de perder el acceso a la API.

| silencio | qué pasa |
|---|---|
| las 20 h caen entre las 08:00 y las 23:59 AR | sale ahí, un mensaje corto: *"che seguís interesado en el {ultimoProducto}?"* |
| las 20 h caen entre las 00:00 y las 07:59 AR | sale a las 23:00 del día anterior — entre 11 y 19 h de silencio, nunca más de 20 |
| más de 24 h | el bot **no escribe**: la conversación va a la bandeja con motivo `visto` y prioridad 7 |

Como el horario solo se adelanta, nunca se atrasa, el límite de Meta no corre riesgo por
más que se mueva: `momentoDeSeguir()` siempre devuelve un instante anterior o igual a las
20 h de silencio, y eso está cubierto por tests (`test-parseo.mjs`), bordes de mes, de
año y de año bisiesto incluidos. Argentina es UTC-3 fijo desde 2009; si algún día volviera
el horario de verano, `AR` en `worker-ig.js` es la única constante a tocar.

La query pide `estado == 'indeciso'`, `seguimientoEnviado == false`,
`necesitaAtencion == false` y `ultimoMensajeCliente` de hace más de **11 h** —el
adelanto más grande posible—, ordenadas de la más callada a la menos callada y hasta 50
por corrida. O sea que trae candidatas, no cosas para mandar ya: a cuáles les toca de
verdad lo decide `momentoDeSeguir()` dentro del loop, y las demás se dejan para una
corrida siguiente. El orden importa por el límite de 50: las que se caen son siempre las
más nuevas, que todavía tienen horas de margen antes de las 24 h. El filtro por `necesitaAtencion` no es de más: si la conversación ya está en la
bandeja el cliente está esperando algo puntual —una foto, por ejemplo— y un "seguís
interesado?" automático encima queda pésimo; de paso evita que el cron le pise el motivo
con `visto`/7 y le entierre un caso urgente al fondo de la cola.

Salga o no salga el mensaje, el doc queda con `seguimientoEnviado: true`: si el envío
falla, la conversación sube a la bandeja, pero el bot no reintenta el mismo mensaje cada
hora.

La bandeja del sistema pone `seguimientoEnviado: true` al aprobar una respuesta, por
esto mismo: si no, una conversación que Juni ya contestó vuelve a caer en la query del
cron y se marca `visto` de nuevo.

### El índice del cron

La query de arriba no la resuelve Firestore sola: necesita un índice compuesto con los
cuatro campos —`estado`, `seguimientoEnviado`, `necesitaAtencion` y `ultimoMensajeCliente`—
en ese orden. Está versionado en `firestore.indexes.json`, en la raíz del repo, para no
depender de crearlo a mano desde la consola:

```bash
firebase deploy --only firestore:indexes
```

El orden de los campos no es decorativo: primero los tres de igualdad, último el del
rango. Si la query cambia —se le agrega un filtro, se ordena al revés, se filtra también
por `userId`— el índice deja de servirle y hay que actualizarlo acá también. Cuando falta,
el error de Firestore trae un link para crear el que hace falta; copiá los campos de ahí
al archivo en vez de crearlo desde la consola, o el repo queda desincronizado.

Tarda un rato en construirse. Si el cron corre mientras tanto, la query falla con
`FAILED_PRECONDITION` hasta que el índice queda listo.

## Mensajes fijos (`config/mensajes`)

La invitación al canal de difusión se manda **textual**, sin pasar por el modelo: está
escrita en primera persona del plural y, si el modelo la tuviera en el prompt, le
contagiaría ese "nosotros" al resto de la conversación.

Vive en Firestore, en `config/mensajes` campo `invitacionCanal`. El modelo solo escribe
la marca `[[CANAL]]` donde va, y el Worker la reemplaza por el texto real. Si el doc no
está cargado, la marca se descarta en vez de mandarse literal al cliente.

**Se edita desde el sistema**, en Base de conocimiento → *Mensaje del canal de difusión*.
El script de abajo quedó solo para la carga inicial: editarlo desde la app evita pasar la
contraseña por la línea de comandos, que es exactamente cómo se termina filtrando.

**Sin links.** Instagram rechaza los mensajes que llevan un enlace de invitación
(`ig.me/j/...`) con *"Link can't be shared"* (error 508, subcode 2534122). Ese mensaje no
llega **y** corta el envío de los que venían atrás, así que la conversación cae en la
bandeja como si hubiera fallado otra cosa. Pasó el 22/08/2026 con un cliente real. El
texto ahora refiere al perfil en vez de linkear, y el campo del sistema avisa si detecta
un link.

Para la carga inicial (Node 18+, no instala nada):

```bash
MC_EMAIL='tu@mail.com' MC_PASSWORD='tu-clave' node workers/ig-bot/cargar-mensajes.mjs
MC_EMAIL='tu@mail.com' MC_PASSWORD='tu-clave' node workers/ig-bot/cargar-mensajes.mjs --ver
```

Las credenciales son las tuyas del sistema y se pasan por variable de entorno a
propósito: no van en el repo. Escribe el dueño; el bot sobre ese doc solo lee.

## `POST /responder` — las respuestas de la bandeja

La bandeja del sistema no puede mandar el DM por su cuenta: el `IG_TOKEN` vive en el
Worker y no puede bajar a un HTML público. Así que manda acá los mensajes que Juni ya
editó y aprobó:

```
POST https://ig-bot.fiwind702050.workers.dev/responder
X-Firebase-Token: <ID token del usuario>
{ "igUserId": "178414...", "mensajes": ["che, te espero", "estamos hasta las 18"] }
```

El token se valida contra Firebase (`accounts:lookup`) y tiene que ser el del `OWNER_UID`;
cualquier otro se va con un 401. El Worker no decide nada más ni toca Firestore: el texto
viene resuelto y el doc lo actualiza el sistema, que es el que sabe quién aprobó.

Devuelve `{ enviados, total }`. Si salieron algunos y otros no, el status es 502 a
propósito: la bandeja deja la conversación abierta en vez de darla por contestada, porque
el cliente vio media respuesta.

## El modelo y el JSON

Corre con **`claude-sonnet-5`** y **structured outputs**: se le pasa el esquema de la
respuesta en `output_config.format` y la API garantiza que lo que vuelve es JSON válido.

Eso no es un lujo. Antes se le pedía el JSON por prompt y a veces contestaba en prosa
—`IA fallo: Unexpected token 'l', "las Air 13"...`— y esa respuesta se tiraba entera: el
cliente quedaba sin contestar aunque el modelo supiera perfectamente qué decirle. Pasó
dos veces el 22/08/2026. `claude-sonnet-4-6`, el modelo anterior, no soporta structured
outputs; ese fue el motivo del cambio (mismo precio de lista, y más nuevo).

`normalizar()` sigue validando igual: el esquema garantiza la **forma**, no que la
categoría o el motivo estén dentro de lo que el negocio espera.

Dos parámetros que conviene entender antes de tocarlos:

- **`max_tokens: 4000`.** Sonnet 5 piensa por defecto y ese pensamiento se descuenta de
  `max_tokens`. Si se corta a la mitad, el JSON queda truncado y volvemos al problema que
  esto arregla. Solo se paga lo que genera, así que el aire no cuesta nada.
- **`effort: 'medium'`.** Contestar un DM no necesita que piense de más: encarece cada
  mensaje y hace esperar al cliente. Si se lo nota flojo en las situaciones difíciles
  (regateo, permutas, cerrar una venta), esto es lo primero a subir.

Si aun así algo vuelve mal formado, solo puede ser una respuesta cortada o un rechazo del
modelo, y las dos se ven en `stop_reason` — que se loguea, porque no se notan mirando el
texto.

## El interruptor (`config/bot`)

Arriba de la bandeja, en el sistema, hay un control con tres posiciones. El estado vive
en Firestore, en `config/bot`, y no en una variable de Cloudflare: cambiarlo tiene que
ser un click, sin deploys, en el momento en que el bot está diciendo algo que no
corresponde.

| posición | `config/bot` | qué hace |
|---|---|---|
| ⏸ Apagado | `activo: false` | no manda nada solo |
| 🧪 Prueba | `modo: 'prueba'` + `cuentasPrueba: [ids]` | solo le contesta a esas cuentas; el cron no corre |
| ▶ Todos | `modo: 'todos'` | le contesta a cualquiera |

**Modo prueba** es para afinar el prompt y la base de conocimiento sin que el bot le
hable a un cliente real. Las cuentas se autorizan desde la propia bandeja, con el botón
*"Probar con esta cuenta"* de una conversación: el id de Instagram no es algo que se
pueda tipear de memoria. Mientras está en prueba el cron de seguimiento **no corre**, para
que no se dispare nada de fondo mientras estás tocando.

**Ninguna de las tres es sorda.** El Worker sigue recibiendo, clasificando y guardando
todo en `conversaciones`. Lo único que cambia es a quién le sale un DM solo. Como los
mensajes que no se mandan quedan sin mandar, cada conversación sube a la bandeja y se
contesta a mano desde el sistema — así no se pierde ningún cliente.

Lo que **no** apaga es el botón *Aprobar y mandar* de la bandeja: ahí el que manda es el
dueño, no el bot. Un interruptor que también bloqueara eso dejaría a la bandeja sin
salida, que es justo lo que hace falta cuando el bot está apagado.

Todo envío automático pasa por `mandarAutomatico()` en `worker-ig.js`, que es donde
viven el apagado y el filtro de cuentas — los dos caminos, el del webhook y el del cron,
llaman ahí y a ningún otro lado. Hay un test que lo verifica leyendo el código, porque
ya se coló una vez: el chequeo estaba adentro de `mandarMensajes()` y el cron se lo
salteaba llamando a `mandarDM()` directo.

Si el doc no existe o no se puede leer, el bot queda **encendido y para todos**: es el
estado inicial de cualquier instalación. El respaldo duro, si hiciera falta cortar de raíz sin depender
de Firestore, sigue siendo sacar `IG_TOKEN` del panel de Cloudflare.

## Lo que se afina desde el sistema

Tres campos de la Base de conocimiento entran al prompt y se leen en cada mensaje, así
que se tocan y el próximo DM ya sale distinto, sin deploys:

| campo | para qué |
|---|---|
| `tono` | cómo escribe: voseo, emojis, largo de los mensajes. **Pisa** la sección CÓMO ESCRIBÍS del prompt |
| `entrenamiento` | ejemplos y situaciones: cómo encarar una permuta, cómo cerrar, qué hacer si regatean |
| el resto | datos duros: horarios, dirección, medios de pago, garantía |

Los dos primeros los escribe el dueño en lenguaje suelto, así que cada bloque lleva su
candado: el de tono aclara que solo cambia la forma de escribir, y el de entrenamiento
que **los precios de los ejemplos son inventados** y que los reales salen siempre del
stock y las listas. Sin ese aviso el modelo cotiza con el número del ejemplo, que es el
error más caro que puede cometer.

## Una sola cuenta de Instagram

Si hay más de una cuenta de Instagram conectada a la misma app de Meta, **el webhook
recibe los mensajes de todas**, y `IG_TOKEN` es de una sola. Sin filtro, el Worker
intenta contestar con el token del local un mensaje que era para otra cuenta: Meta lo
rechaza con *"The requested user cannot be found"* y, peor, la conversación igual queda
guardada en `conversaciones` como si fuera del local.

Por eso `IG_ACCOUNT_ID` tiene que estar cargada con el id de la cuenta del local — la
misma de la que salió `IG_TOKEN`. El Worker descarta todo evento cuyo `recipient.id` no
sea ese.

Si la variable no está, el Worker procesa todo igual (para no dejar de contestar de
golpe) pero loguea `OJO: sin IG_ACCOUNT_ID no se filtra por cuenta` en cada mensaje.

El id se lee del propio log: es el `recipient.id` (o el `entry.id`) de un mensaje que sí
haya llegado bien al local. Pasó el 22/08/2026, con dos cuentas conectadas a la app.

## Variables de entorno

Se configuran en el panel de Cloudflare, en Settings → Variables. La columna
Tipo importa: **Secret** encripta el valor y no lo vuelve a mostrar, **Text**
queda a la vista de cualquiera con acceso al panel.

| Variable           | Tipo   | Para qué |
|--------------------|--------|----------|
| `IG_VERIFY_TOKEN`  | Secret | Token que Meta usa para validar la suscripción al webhook |
| `IG_APP_SECRET`    | Secret | Secreto de la app de Meta, con el que se verifica la firma HMAC |
| `IG_TOKEN`         | Secret | Token de acceso a la API de Instagram |
| `IG_ACCOUNT_ID`    | Text   | Id de la cuenta de Instagram del local — **ver abajo, no es opcional** |
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
