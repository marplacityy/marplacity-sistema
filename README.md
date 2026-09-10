# MarplaCity — Node.js

Sistema de gestión del local con servidor **Node.js 24 + Express 5**, frontend
modular compilado con **Vite** y datos sincronizados en **Firebase**.

Incluye ventas/POS, stock por IMEI, consignación, reparaciones, repuestos,
inventario, clientes, encargues, gastos, caja, reportes, catálogo, pedidos,
Instagram, asistente y facturación electrónica.

## Abrir en esta PC

Usá el acceso **MarplaCity Node** del escritorio o ejecutá `npm run abrir`.
La aplicación se abre en **http://127.0.0.1:3000**. Ingresá con tu cuenta habitual.
Para detener el servidor: **Detener MarplaCity Node** o `npm run detener`.

## Desarrollo

```sh
npm ci
npm run dev
```

## Compilar y ejecutar

```sh
npm run build
npm start
```

## Comprobar los cambios

```sh
npm run check
```

La verificación incluye análisis estático, pruebas HTTP y de estructura, pruebas
de dominio, compilación y navegador en escritorio y celular. Las operaciones de
prueba usan datos ficticios y bloquean conexiones externas. En Windows las
pruebas usan Chrome instalado; en Linux: `npx playwright install --with-deps chromium`.

## Documentación

- [Arquitectura y módulos](docs/ARQUITECTURA.md).
- [Instalación, integraciones y publicación](docs/LANZAMIENTO.md).
- [Mapa de las 23 pantallas y 32 módulos](docs/mapa-modulos.json).
- [Variables de configuración](.env.example).

La primera ejecución local utiliza las integraciones remotas existentes para
conservar sus credenciales y webhooks. Sus implementaciones también pueden
correr dentro de Node configurando el modo `local`. Firebase y las cuentas
actuales se mantienen. No se migraron ni modificaron datos del negocio.

**Esta migración se prepara en una rama local.** No se debe mezclar con `main`
hasta cambiar el destino de publicación: GitHub Pages no ejecuta Node.js y
actualmente todo push a `main` publica la raíz directamente.

`firestore.rules` y `firestore.indexes.json` siguen siendo las fuentes
versionadas de permisos e índices. Sus despliegues son independientes del
servidor y no forman parte de `npm run build` ni de `npm start`.

Revisión y pendientes de seguridad: [informe OWASP](docs/SEGURIDAD-OWASP.md).
