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

## Fotos de los productos (Firebase Storage)

Desde el 12/10/2026 las fotos viven en Firebase Storage, en `fotos/` del bucket
`mis-gastos-21e7b.firebasestorage.app`, y se ven en
`https://storage.googleapis.com/mis-gastos-21e7b.firebasestorage.app/fotos/<archivo>`
(`FOTOS_BASE` en `src/shared/sitio.js`). El mapa de `catalogo/fotos` guarda esa base, y
las dos tiendas, el sistema y el bot arman las URLs con ella.

- **Subir desde el sistema**: la ficha del producto sube directo con el SDK de Storage y la
  sesión del dueño (`src/client/core/fotos.js`). No pasa por Node ni por ningún Worker.
- **Traer de un link o de Amazon**: el Worker tienda baja la imagen y la sube por la API
  REST de Storage con el token del dueño que vino en la solicitud (`subirAStorage` en
  `server/services/tienda/fotos.js`).
- **Quién escribe**: `storage.rules`. Lectura pública; escritura solo del dueño del local
  (el `userId` de `catalogo/publico`, igual que en `firestore.rules`), solo imágenes y
  hasta 8 MB. Publicar: `firebase deploy --only storage`. La primera vez que se publica,
  Firebase pide permiso para que Storage lea Firestore (`firestore.get` en las reglas):
  aceptarlo.
- **Lectura pública por URL fija**: las URLs `storage.googleapis.com/...` no pasan por las
  reglas de Firebase, sino por los permisos del bucket en Google Cloud. Una sola vez:
  Google Cloud Console → Cloud Storage → bucket `mis-gastos-21e7b.firebasestorage.app` →
  Permisos → Otorgar acceso → principal `allUsers`, rol **Visualizador de objetos de
  Storage** (`roles/storage.objectViewer`).

La carpeta `fotos/` del repositorio es el archivo histórico de antes de Storage: ya no
entra en el build.

## Dominio propio

Hoy no hay dominio: todo lo público está en `https://marplacityy.github.io/marplacity-sistema/`
(el VPS de Hostinger y `contify.tech` dejaron de usarse en octubre de 2026). Para volver a
tener uno, por ejemplo `tienda.ejemplo.com`:

1. **DNS**, en el registrador del dominio:
   - Subdominio (`tienda.ejemplo.com`): un `CNAME` a `marplacityy.github.io`.
   - Dominio raíz (`ejemplo.com`): cuatro registros `A` a `185.199.108.153`,
     `185.199.109.153`, `185.199.110.153` y `185.199.111.153` (y si se quiere `www`, un
     `CNAME` a `marplacityy.github.io`).
2. **El sitio**: en `src/shared/sitio.js`, `SITIO_PUBLICO = 'https://tienda.ejemplo.com/'`.
   Con eso solo ya cambian el `base` de Vite (pasa a `/`), los links de la tienda y los
   documentos, la vuelta de los pagos en Node, el link del bot y las pruebas de Pages.
3. **El archivo `CNAME`**: crear `public/CNAME` con una sola línea, `tienda.ejemplo.com`.
   Vite lo copia a `dist-pages/` y GitHub Pages lo toma de ahí.
4. **GitHub**: Settings → Pages → Custom domain → `tienda.ejemplo.com`, esperar a que valide
   el DNS y tildar **Enforce HTTPS**.
5. **Worker tienda**: en `workers/tienda/wrangler.toml`, `CATALOGO_URL` con la tienda nueva
   (`https://tienda.ejemplo.com/catalogo.html`) y `npx wrangler deploy` desde
   `workers/tienda/`. Tiene que ir en el archivo: con `keep_vars`, sacarla de ahí deja el
   valor viejo del panel.
6. **Worker ig-bot**: toma el link de la tienda de `sitio.js`, así que hay que volver a
   desplegarlo (`npx wrangler deploy` desde `workers/ig-bot/`).
7. **Firebase Auth**: Authentication → Configuración → Dominios autorizados → agregar el
   dominio nuevo, o el login con Google no abre desde ahí.
8. Subir el sello de versión, push, y desde el sistema **Publicar** el catálogo y
   **Sincronizar fotos** una vez.

Los links que ya se compartieron con la dirección de GitHub Pages siguen andando: GitHub
redirige al dominio propio.

## Publicación desde main

GitHub Pages se configura con **GitHub Actions**. El workflow
`.github/workflows/verificar.yml` verifica el proyecto y publica el resultado de
`npm run build:pages` desde `dist-pages/`. Cada publicación requiere incrementar
el sello `vAAAA.MM.DD-<letra>` de `index.html` y comprobar que la web lo muestra.

La web pública mantiene Firebase y los Workers existentes. El servidor Node
sigue ejecutándose en esta PC. Subir el código no despliega reglas de Firebase
(Firestore ni Storage), secretos, certificados fiscales ni Workers: consultar el
informe de seguridad.

Para alojar también el servidor Node fuera de esta PC, sigue siendo necesario
un hosting compatible, variables de entorno, HTTPS y webhooks públicos. El
`Dockerfile` prepara una imagen sin privilegios; Docker no fue validado en esta PC.
