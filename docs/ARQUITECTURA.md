# Arquitectura Node.js de MarplaCity

La aplicación usa Node.js 24, Express 5 y módulos ES. Vite compila las pantallas y
sus dependencias. Firestore continúa siendo la fuente de datos y Firebase Auth
conserva las cuentas existentes. La migración no copia ni transforma datos reales.

## Organización

| Carpeta | Responsabilidad |
| --- | --- |
| `src/client/core` | Arranque, sesión, configuración pública, estado y suscripciones |
| `src/client/modulos` | Ventas, reparaciones, caja, stock y los demás dominios |
| `src/client/vistas` | Una plantilla HTML por pantalla: 23 en total |
| `src/client/styles` | Estilos del sistema, catálogo y visor de documentos |
| `src/shared/catalogo.js` | Funciones puras de fotos y categorías, importables sin Firebase |
| `server/app.js` | Servidor HTTP, rutas, límites, registro de solicitudes y archivos públicos |
| `server/services` | Implementaciones de tienda, Instagram, facturador e IA |
| `workers` | Entradas de compatibilidad para los despliegues existentes en Cloudflare |
| `tests` | Pruebas HTTP, estructura y navegador con datos ficticios |
| `public` y `fotos` | Recursos que se incluyen en la compilación |
| `dist` | Resultado compilado; es lo único que Express publica como archivos |
| `.runtime` | Registros y control del servidor local; queda fuera de Git |

## Arranque y estado

`src/client/main.js` carga `/api/config`, inicializa los módulos en orden y registra
la sesión al final. Las funciones de dominio se importan explícitamente. Los
valores mutables compartidos están en `contextoApp`: cambiar un array desde un
snapshot actualiza la referencia que utilizan todas las pantallas.

Se conservan los identificadores del HTML y los handlers de `window`, porque los
controles existentes los invocan. Las plantillas se incorporan al HTML durante la
compilación; el servidor no concatena JavaScript ni evalúa código dinámicamente.

Se conservan `withUser`, `myQ`, la ventana de datos históricos, la carga diferida
de clientes y el caché persistente. Las reglas e índices de Firestore no se
modificaron ni desplegaron durante esta migración.

## Integraciones: ejecución remota y ejecución en Node

La primera puesta en marcha local utiliza `SERVICIO_*=remoto`: el navegador llama
a `/api/tienda`, `/api/instagram`, `/api/facturador` o `/api/ia`, y Node comunica
esas solicitudes a los servicios ya publicados. Esto permite usar las
integraciones existentes sin copiar sus secretos a esta PC ni cambiar webhooks.

El código de las integraciones también está disponible para ejecución **nativa
en Node.js**, seleccionando `local` y configurando sus credenciales en `.env`.
No se mantienen dos implementaciones: los archivos de `workers` reexportan
los módulos de `server/services`.

El adaptador usa `Request` y `Response` de Node, conserva el cuerpo crudo de los
webhooks para validar firmas y espera las tareas pendientes durante el cierre.
La nueva implementación local de IA verifica el token de Firebase y el dueño
antes de llamar a Anthropic.

Telegram estaba incompleto en la versión original. Su código se trasladó, pero
no se presenta como una integración terminada ni se habilita una ruta que
finja procesar mensajes.

## Datos, archivos y permisos

- Las operaciones del navegador siguen sujetas a las reglas de Firestore.
- `/api/config` expone únicamente direcciones públicas, nunca `.env` ni tokens.
- Por defecto el servidor escucha en `127.0.0.1`, solamente en esta PC.
- Los archivos de configuración, certificados y fuentes del servidor no se sirven.
- El acceso de cierre utiliza una clave aleatoria local; no basta conocer la URL.
- Los PDF y etiquetas usan dependencias de npm incluidas en la compilación.
- Los links enviados a clientes mantienen la URL pública existente. Un link de
  `localhost` no sería accesible desde el teléfono del cliente.

## Validación

`npm run check` ejecuta análisis estático, pruebas HTTP y de estructura, las
pruebas existentes de dominio, compilación y pruebas de navegador.

La suite de navegador prueba tanto el paquete real sin sesión como una compilación
separada con Firebase ficticio. Esa compilación solo existe en `.runtime/pruebas`.
Las pruebas bloquean servicios externos y cubren pantallas, ventas, permutas,
gastos, caja, repuestos, encargues y generación de PDF. No emiten facturas reales,
no cobran dinero y no envían mensajes a clientes.

Se corrigieron dos fallos previos encontrados al activar las comprobaciones:
las notas de reparaciones referenciaban una variable inexistente, y los reportes
de más de 300 operaciones reasignaban una constante. Las pruebas originales que
dependían de saltos de línea de Unix ahora también funcionan en Windows.

La migración no transforma los pedidos web en ventas automáticas, ni cambia las
reglas de consignación, ganancias, reservas o cierre de caja.
