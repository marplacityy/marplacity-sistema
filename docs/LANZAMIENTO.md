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

## VPS (Hostinger, Debian 13)

Instalado el 12/09/2026 en `srv1976120.hstgr.cloud`; desde ese día responde también en
`https://contify.tech` (dominio registrado en Hostinger, `www` redirige al apex). Node 24 en `/usr/local`, Caddy para
HTTPS y proxy, ufw con 22, 80 y 443. La app vive en `/opt/marplacity/app` como usuario de
sistema `marplacity`, con `.env` (`HOST=0.0.0.0`, `TRUST_PROXY=loopback`, servicios en
`remoto`) y el servicio systemd `marplacity`.

Actualizar a lo último de `main`:

```sh
cd /opt/marplacity/app
sudo -u marplacity git pull
sudo -u marplacity HOME=/opt/marplacity npm ci
sudo -u marplacity HOME=/opt/marplacity npm run build
systemctl restart marplacity
```

Logs: `journalctl -u marplacity -f`. Para un dominio propio, cambiar el nombre en
`/etc/caddy/Caddyfile` y `systemctl reload caddy`: el certificado se emite solo.

## Publicación desde main

GitHub Pages se configura con **GitHub Actions**. El workflow
`.github/workflows/verificar.yml` verifica el proyecto y publica el resultado de
`npm run build:pages` desde `dist-pages/`. Cada publicación requiere incrementar
el sello `vAAAA.MM.DD-<letra>` de `index.html` y comprobar que la web lo muestra.

La web pública mantiene Firebase y los Workers existentes. El servidor Node
sigue ejecutándose en esta PC. Subir el código no despliega reglas de Firebase,
secretos, certificados fiscales ni Workers: consultar el informe de seguridad.

Para alojar también el servidor Node fuera de esta PC, sigue siendo necesario
un hosting compatible, variables de entorno, HTTPS y webhooks públicos. El
`Dockerfile` prepara una imagen sin privilegios; Docker no fue validado en esta PC.
