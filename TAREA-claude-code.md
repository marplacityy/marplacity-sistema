# Tarea para Claude Code — bot de Instagram MarplaCity

Contexto: el Worker `ig-bot` ya funciona de punta a punta. Recibe el DM por webhook,
verifica firma HMAC, lee el stock de Firestore, llama a la API de Anthropic y guarda
en la colección `conversaciones`. No hay que rehacer nada de eso.

Lo que hay que hacer es cambiar el prompt, ampliar el doc que se guarda, agregar un
cron de seguimiento y armar la bandeja NEED ATTENTION en el sistema.

Antes de empezar: leé `workers/ig-bot/` y `firestore.rules` para no romper lo que ya
anda. No hagas `git push` ni `wrangler deploy` sin avisarme primero.

---

## 1. Reemplazar el system prompt

El prompt nuevo está en `prompt-bot.md` (lo dejo en la raíz del repo).

- Sacalo del código y ponelo en `workers/ig-bot/prompt.js` exportando un string, para
  que se lea de una sola fuente.
- Dejá afuera del prompt el mensaje fijo del canal de difusión: guardalo aparte, en un
  doc de Firestore `config/mensajes` campo `invitacionCanal`, y que el Worker lo lea y
  lo concatene como mensaje separado. Si el modelo lo genera él, arrastra el "nosotros"
  al resto de la conversación.
- Si el doc `config/mensajes` no existe todavía, creá el script para cargarlo.

## 2. Cambiar el parseo de la respuesta del modelo

El modelo ahora devuelve SOLO un JSON con esta forma:

```json
{
  "categoria": "indeciso",
  "confianza": "alta",
  "necesita_atencion": true,
  "motivo": "pidio_foto",
  "prioridad": 1,
  "resumen": "pregunta por iphone 14, le pase 15 a 500 usd, pidio foto",
  "mensajes": ["hola tengo 15 en precio", "500 usd", "ahora te mando la foto"]
}
```

- Parsealo con try/catch y sacando backticks por las dudas.
- Si el parseo falla, no tires el mensaje: guardá la conversación con
  `necesitaAtencion: true`, `motivo: "no_supe_responder"`, `prioridad: 8`.
- `mensajes` es un array: cada elemento se manda como un DM separado, en orden, con
  una pausa corta entre uno y otro.

## 3. Ampliar el doc de `conversaciones`

Campos nuevos que hoy no se escriben y el cron necesita:

| campo | tipo | nota |
|---|---|---|
| `ultimoMensajeCliente` | timestamp | se pisa con cada DM entrante |
| `seguimientoEnviado` | bool | arranca en `false` |
| `ultimoProducto` | string | el modelo que consultó, ej "iphone 14" |
| `igUserId` | string | para poder responder desde el cron |
| `necesitaAtencion` | bool | |
| `motivo` | string | ver tabla de prioridades en `prompt-bot.md` |
| `prioridad` | int | 1 a 8, 99 si no necesita atención |

## 4. Cron de seguimiento

El código está en `cron-seguimiento.js`. Integralo al Worker `ig-bot` como
`export default { fetch, scheduled }` y agregá en `wrangler.toml`:

```toml
[triggers]
crons = ["0 * * * *"]
```

Ojo con esto, que es un límite duro de Meta y condiciona el diseño: se puede responder
libre solo dentro de las 24 h desde el último mensaje del cliente. El tag HUMAN_AGENT
estira eso a 7 días pero es exclusivo para humanos — usarlo desde el bot hace que Meta
te saque el acceso a la API. Por eso el seguimiento automático sale a las 20 h y lo que
pasa las 24 h se marca `visto` para que lo mande Juni a mano.

No cambies esas ventanas.

## 5. Reglas de Firestore — ESTO HAY QUE TOCARLO SÍ O SÍ

Hoy el usuario `bot@marplacity.com` solo puede **crear** en `conversaciones`. El cron
necesita **actualizar** (`seguimientoEnviado`, `necesitaAtencion`, `motivo`,
`prioridad`) y **leer** para poder correr la query.

Ampliá la regla para ese UID a `read, create, update` sobre `conversaciones`, pero
**sin darle `delete`** y sin tocar el resto de la lista blanca. Si podés restringir el
update a ese conjunto de campos con `request.resource.data.diff()`, mejor.

## 6. Índice compuesto

La query del cron filtra por `estado` + `seguimientoEnviado` + `ultimoMensajeCliente`.
Agregá el índice a `firestore.indexes.json` y dejalo versionado, así no depende de
crearlo a mano desde la consola.

## 7. Bandeja NEED ATTENTION en el sistema

En el front de `marplacity-sistema`, una vista nueva:

- Lista las conversaciones con `necesitaAtencion == true`.
- Ordenadas por `prioridad` ascendente y, dentro de cada nivel, por
  `ultimoMensajeCliente` ascendente (la más vieja arriba).
- Cada fila muestra: usuario de IG, motivo, resumen, hace cuánto fue el último mensaje
  del cliente, y un cartel bien visible si ya pasaron las 24 h (ahí Juni tiene que
  responder a mano, el bot no puede).
- Las respuestas sugeridas se muestran editables, con un botón para aprobar y mandar.
  Nada sale sin que Juni le dé aprobar.
- Al aprobar: manda los mensajes, pone `necesitaAtencion: false` y guarda quién y cuándo.

Mantené el estilo visual que ya tiene el sistema, no inventes uno nuevo.

---

## Orden sugerido

1, 2, 3 y 5 primero (sin eso el bot queda peor que ahora). Después 4 y 6. La bandeja (7)
al final, que es la más larga y no bloquea nada.

Andá commiteando por punto, no todo junto.
