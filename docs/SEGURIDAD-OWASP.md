# Revisión de seguridad — 10 de septiembre de 2026

Versión local: **v2026.09.10-B · Node.js**. Revisión de código, pruebas HTTP, navegador y reglas en un emulador con datos ficticios. No es una certificación ni una garantía de ausencia de vulnerabilidades.

## Problemas encontrados y corregidos

| Hallazgo | Impacto | Corrección | Dónde entra en vigor |
| --- | --- | --- | --- |
| Cualquier cuenta autenticada podía sobrescribir `catalogo/publico` y `catalogo/fotos` atribuyéndose el documento. | Alto: alterar productos, precios y contenido público de otro local. | Las escrituras exigen ser el dueño vigente; no se puede reasignar ni eliminar el documento que identifica al dueño. | Archivo `firestore.rules`; **requiere publicación en Firebase**. |
| Una cuenta nueva podía ocupar los documentos globales del bot si todavía no existían. Las cuentas de servicio tenían acceso a otras cuentas del mismo proyecto. | Alto: cambios de configuración y acceso entre negocios. | Creación de configuración global restringida y cuentas de servicio acotadas a los datos del dueño del catálogo. | Reglas; **requiere publicación en Firebase**. |
| Los propietarios podían modificar cualquier campo del pedido, incluido el importe o su estado de pago. | Alto: falsear el registro de cobro. | Desde el cliente solo se permite cerrar el pedido como entregado/cancelado, con fecha y autor del cierre. La pasarela sigue siendo quien informa el pago. | Reglas; **requiere publicación en Firebase**. |
| `esc()` no escapaba comillas; `escJs()` no protegía ambos contextos HTML/JavaScript. Algunos handlers usaban escape HTML en un literal JS. | Alto: XSS persistente por datos importados, nombres, categorías o contenido externo. | Helpers compartidos para cada contexto; corrección de atributos, campos de IA, catálogo, IMEI y proveedores. | Compilación local. |
| Mercado Pago aceptaba notificaciones con firma inválida; Instagram aceptaba notificaciones si faltaba su secreto. | Alto: activar operaciones y consumir recursos sin autenticidad comprobada. | Rechazo antes de consultar servicios o encolar tareas. Sin secreto se devuelve 503; firma inválida, 401. | Servicios nativos y código de Workers; **los Workers remotos deben desplegarse aparte**. |
| Se aceptaba el estado del pago sin comparar importe, moneda y vínculo con el pedido. | Alto: asociar un pago incorrecto al pedido. | Validación de dueño, método, importe, moneda y sesión/identificador; las notificaciones tardías no reabren pedidos cerrados. | Servicio de tienda; **requiere despliegue si se usa el Worker remoto**. |
| La descarga de fotos confiaba en cualquier URL devuelta por un proveedor externo y seguía redirecciones. | Alto en un servidor con red interna: SSRF; también consumo excesivo de memoria. | Lista explícita de hosts de imágenes de Amazon, HTTPS, sin credenciales/puertos alternativos, sin redirecciones, tiempo máximo y 8 MiB por imagen. | Servicio de tienda; **requiere despliegue remoto si corresponde**. |
| Faltaban límites de frecuencia y una política CSP. | Medio: abuso de recursos y menor contención de inyecciones. | Límites por IP, bloqueo de origen/host cruzados, CSP, bloqueo de scripts inline y externos no propios, protección contra embebido y tipos MIME. | Servidor local. |
| La validación JWT no comprobaba todos los tipos/fechas; Stripe aceptaba un timestamp no numérico al evaluar su antigüedad. | Medio: validación incompleta de identidad/integridad. | Fechas numéricas, emisor, proyecto, sujeto, firma y vencimiento; comparación de HMAC mediante Web Crypto. | Servicios nativos y código de Workers. |

La carga de etiquetas se cambió a un documento Blob autónomo con scripts externos del propio servidor. La prueba confirma dibujo de códigos de barras y QR y llamada a impresión; no imprime papel ni valida una impresora física.

## Cobertura OWASP Top 10:2025

| Categoría | Revisión y resultado |
| --- | --- |
| A01 — Control de acceso | Reglas entre cuentas, catálogo, pedidos y cuentas de servicio corregidas, probadas en emulador y desplegadas en Firebase el 12/09/2026. |
| A02 — Configuración de seguridad | Servidor enlazado a loopback, origen/host, cabeceras, CSP y archivos privados revisados. |
| A03 — Cadena de suministro | Dependencias fijadas y lockfile; auditoría npm; verificación agregada a CI. No se inspeccionó manualmente el código de cada dependencia. |
| A04 — Criptografía | AES-GCM fiscal y separación por identidad/entorno probados; TLS hacia proveedores; firmas HMAC/JWT revisadas. |
| A05 — Inyección | Correcciones de HTML/JS, pruebas de XSS en navegador y restricciones SSRF. No existe SQL en esta arquitectura. |
| A06 — Diseño inseguro | Revisión de cobros, comparación contra importes confiables y restricciones de cambios de pedidos. No constituye una auditoría contable completa. |
| A07 — Autenticación | Firebase Auth conservado; rechazo de tokens inválidos y validación de claims. MFA, recuperación de cuentas y revocación operativa requieren gestión en Firebase. |
| A08 — Integridad de datos/software | Firmas obligatorias, pago vinculado al pedido y estado terminal protegido frente a notificaciones tardías. |
| A09 — Registro y alertas | El servidor omite tokens, cuerpos y consultas en su log HTTP; no se registran firmas inválidas ni se devuelven errores internos crudos de tienda. No hay un servicio externo de alertas configurado. |
| A10 — Condiciones excepcionales | Fallos de red/configuración, límites de cuerpo existentes, respuestas sanitizadas y cierre de tareas verificados. |

La verificación con la cuenta nueva detectó suscripciones a configuración privada del dueño anterior. Se corrigió el arranque: solo el dueño escucha esos documentos; las demás cuentas ven un aviso y no pueden publicar el catálogo compartido ni cambiar el bot desde la interfaz. La protección de servidor continúa siendo responsabilidad de las reglas.

Resultado final: **21 pruebas Node, 15 pruebas de navegador y 6 pruebas de reglas aprobadas**, además de los chequeos de dominio. `npm audit` reportó **0 vulnerabilidades conocidas**. Se verificó el ingreso real con la cuenta nueva y la sincronización terminó en `ok`, sin errores en consola, después de corregir las suscripciones privadas.

## Verificación reproducible

```powershell
npm ci
npm run check
npm run test:reglas
npm audit --audit-level=high
```

`check` ejecuta linter, pruebas Node, pruebas de dominio, compilación y navegador. `test:reglas` usa Java 21 y Firebase CLI fijado a 15.30.0, con proyecto **demo-marplacity** y emulador **127.0.0.1:8085**. El archivo de pruebas rechaza ejecutarse sin ese emulador. Las pruebas de navegador de operaciones sustituyen Firebase por datos ficticios y bloquean las APIs externas.

## Pendientes para proteger también los servicios publicados

La aplicación local sigue conectada a Firebase y, por configuración, utiliza los Workers remotos existentes. Reiniciar Node **no publica las reglas ni actualiza esos Workers**.

Las reglas se desplegaron el 12/09/2026 desde una sesión autorizada, tras verificar que `catalogo/publico` y `catalogo/fotos` llevan el `userId` del dueño. El catálogo existente debe tener el `userId` del dueño legítimo; una instalación sin catálogo necesita inicialización administrativa. La cuenta nueva creada para esta PC administra sus propios registros, no el catálogo compartido del dueño anterior.

Con una sesión autorizada del proyecto:

```powershell
npx --yes firebase-tools@15.30.0 login
npx --yes firebase-tools@15.30.0 deploy --only firestore:rules --dry-run --project mis-gastos-21e7b
npx --yes firebase-tools@15.30.0 deploy --only firestore:rules --project mis-gastos-21e7b
```

Los cambios de `server/services` también deben desplegarse mediante las entradas de `workers/tienda`, `workers/ig-bot` y `workers/facturador`, o activarse en Node con sus credenciales y URLs de webhook públicas. Antes de activar tienda, configurar **MP_WEBHOOK_SECRET**, **STRIPE_WEBHOOK_SECRET** y los endpoints de notificación correspondientes. No se realizaron cobros, mensajes de Instagram, emisiones fiscales, cambios al catálogo publicado ni pushes a `main` durante esta revisión.

Quedan por verificar con credenciales y entorno de pruebas del proveedor: checkout completo, reembolsos, ARCA, IMEI, mensajes de Instagram y agente de impresión remota. La concurrencia entre varias cajas, recuperación tras cortes de red y todos los escenarios de importación histórica no quedan garantizados por esta suite. El asistente de Telegram ya era un esqueleto incompleto y no se presenta como una integración funcional.

La CSP bloquea scripts inline y, desde el 12/09/2026, también los atributos (`script-src-attr 'none'`): los handlers del HTML pasaron a `data-click`/`data-args` despachados por `src/client/core/eventos.js`, y `tests/estructura.test.js` impide que vuelvan. Permite conexiones HTTPS para Firebase y proveedores configurables. En un despliegue público, configurar HTTPS, IP del cliente/proxy y almacenamiento compartido del limitador antes de usar varias instancias.

Referencias: [OWASP Top 10:2025](https://owasp.org/Top10/2025/), [prevención SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [pruebas de reglas Firebase](https://firebase.google.com/docs/rules/unit-tests).
