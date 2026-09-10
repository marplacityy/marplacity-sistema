# Puesta en marcha

## En esta PC

Abrí el acceso **MarplaCity Node** del escritorio, o ejecutá:

```sh
npm run abrir
```

El lanzador prepara una compilación si el código cambió, arranca Node en segundo
plano y abre `http://127.0.0.1:3000`. Si ya está iniciado, abre la misma instancia.
Ingresá con la cuenta habitual del sistema. Los datos siguen siendo los del local
en Firebase, no una copia de prueba.

Para cerrarlo, usá **Detener MarplaCity Node** o `npm run detener`.
Los registros quedan en `.runtime/servidor.log`.

## Instalación en otra máquina

Requiere Node.js 24.12 o superior dentro de la rama 24 y conexión a internet.

```sh
npm ci
npm run build
npm start
```

Para trabajar en el código con recarga: `npm run dev`.
La configuración opcional se carga desde `.env`; usá `.env.example` como guía.

## Trasladar las integraciones a Node

La ejecución local inicial reutiliza las integraciones remotas actuales. Para
trasladar una integración, hay que cargar sus credenciales y cambiar solo su modo:

| Servicio | Modo | Credenciales y configuración |
| --- | --- | --- |
| Tienda | `SERVICIO_TIENDA=local` | `OWNER_UID`, `TIENDA_EMAIL`, `TIENDA_PASSWORD`; claves de Mercado Pago/Stripe según los medios usados |
| Instagram | `SERVICIO_INSTAGRAM=local` | `OWNER_UID`, `BOT_EMAIL`, `BOT_PASSWORD`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `IG_ACCOUNT_ID`, `IG_TOKEN`, `ANTHROPIC_KEY` |
| Facturador | `SERVICIO_FACTURADOR=local` | `OWNER_UID`, `FAC_EMAIL`, `FAC_PASSWORD`, `ARCA_CUIT`, `CERT_MASTER_KEY`, entorno fiscal |
| IA | `SERVICIO_IA=local` | `OWNER_UID`, `ANTHROPIC_KEY` |

Las credenciales deben corresponder a los usuarios de servicio que ya autorizan
las reglas de Firestore. Las claves cifradas del facturador requieren **la misma
clave maestra** utilizada originalmente. No generar una nueva para leerlas.

Las APIs entrantes necesitan un servidor con URL HTTPS pública:

- Instagram: `/api/instagram`.
- Mercado Pago: `/api/tienda/mp/webhook`; configurar también `TIENDA_WEBHOOK_URL`
  con esa URL completa.
- Stripe: `/api/tienda/stripe/webhook`.
- `CATALOGO_URL`: URL del catálogo al que vuelve el cliente después del pago.

Los seguimientos permanecen desactivados en Node durante el lanzamiento local.
Al trasladarlos, desactivar primero el cron de Cloudflare y después usar
`SEGUIMIENTOS_ACTIVOS=true` con Instagram en modo local. Debe existir una única
instancia encargada de estos seguimientos.

## Publicación posterior

Esta rama no publica automáticamente ni reemplaza la web actual. GitHub Pages
no puede ejecutar el servidor Node.js. Para publicar esta versión se necesita un
hosting compatible con Node o contenedores y configurar sus variables, dominio,
HTTPS y webhooks. El `Dockerfile` prepara una imagen que ejecuta el servidor con
un usuario sin privilegios; no incluye `.env`, certificados ni material de prueba.

No mezclar esta rama con `main` conservando el despliegue directo de GitHub Pages:
primero hay que definir el nuevo destino. La versión publicada actual permanece
en la revisión anterior y los Workers conservan entradas compatibles.

El contenedor está preparado como opción de despliegue; la validación realizada
en esta PC corresponde a Node ejecutado directamente, no a Docker.
