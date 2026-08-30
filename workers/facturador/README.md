# Worker `facturador` — factura electrónica de ARCA

Emite comprobantes con CAE contra los webservices oficiales de ARCA (WSAA + WSFEv1),
sin intermediarios que cobren por comprobante.

Es un Worker **separado** de `ig-bot` a propósito: acá se manejan el certificado y la
clave privada fiscales, y un deploy del bot no tiene por qué poder tocar esto ni al
revés.

## Estado

| Punto | Qué es | Estado |
|---|---|---|
| 0 | Certificado de homologación, punto de venta y asociación al servicio | ✅ hecho por Juni |
| 1 | Worker separado, `keep_vars`, endpoint de salud | ✅ |
| 2 | Cifrado del certificado y subida sin pasar por el browser | ✅ |
| 3 | WSAA: login CMS y cache del ticket de 12 h | ✅ |
| 4 | WSFEv1: `FECompUltimoAutorizado` + `FECAESolicitar` | ✅ |
| 6 | Front: emitir desde una venta, ver CAE y estado | ✅ |
| 7 | PDF con el QR obligatorio | ✅ |

## El certificado (punto 0)

Ya está emitido, para **homologación**:

| dato | valor |
|---|---|
| alias | `marplacityy` |
| CUIT | 23943597669 |
| emisor | `CN=Computadores Test, O=AFIP, C=AR` (la CA de homologación) |
| vigencia | 30/08/2026 → 29/08/2028 |
| archivos | `~/arca-certs/marplacity.crt` y `.key`, **fuera del repo** |

El `.crt` y el `.key` son pareja (se comparó el módulo de los dos, no el contenido de la
clave). La clave privada **no se lee nunca**, ni para verificarla: para eso alcanza con
comparar hashes del módulo.

```bash
# lo único que hace falta correr sobre el par, y no imprime la clave
openssl x509 -in ~/arca-certs/marplacity.crt -noout -modulus | openssl md5
openssl rsa  -in ~/arca-certs/marplacity.key -noout -modulus | openssl md5
```

Dejá la clave en `chmod 600`: por defecto `openssl` la escribe en `644`, legible por
cualquier usuario de la máquina.

## WSAA: el login (punto 3)

Para hablar con WSFEv1 hace falta un **ticket de acceso**: un `token` y un `sign` que
van en cada pedido. Se sacan del WSAA firmando un XML con el certificado, y **duran
12 horas**.

### El CMS, escrito a mano

WSAA no acepta el pedido en limpio: tiene que ir adentro de un CMS (PKCS#7) firmado, que
es lo que produce `openssl cms -sign`. Adentro de un Worker no hay OpenSSL, y WebCrypto
firma pero no sabe armar un PKCS#7.

Está escrito a mano en `asn1.js` (codificador DER) y `cms.js` (SignedData), sin traer
`pkijs`: el repo no tiene una sola dependencia npm y no íbamos a empezar por la que
maneja material fiscal. Se puede hacer porque es verificable de verdad — el CMS que sale
de acá se valida con un tercero que no comparte una línea de código con nosotros:

```bash
openssl cms -verify -inform DER -in cms.der -noverify -out contenido.txt
# Verification successful
```

Va con **atributos firmados** (`contentType`, `signingTime`, `messageDigest`), que es lo
que produce openssl por defecto y por lo tanto lo que ARCA viene recibiendo de todo el
mundo desde siempre. Cuando hay atributos firmados **la firma no va sobre el contenido**:
va sobre el DER del conjunto de atributos, y uno de esos atributos es el hash del
contenido. Confundir eso da un CMS que parece bien armado y no valida.

### Las 12 horas no son una optimización

Si se pide un TA nuevo por cada factura, WSAA contesta con un 500 y este texto:

```
El CEE ya posee un TA valido para el acceso al WSN solicitado
```

O sea que **el segundo comprobante del día ya falla**. Por eso el TA se guarda cifrado en
`fiscal_ta/{cuit}_{entorno}_{servicio}` y se reusa hasta 10 minutos antes de vencer.

Ese error además tiene un uso: si dos pedidos salen al mismo tiempo, el que pierde lo
recibe, vuelve a leer el documento —que el otro ya escribió— y sigue con ese ticket en
vez de darse por vencido.

El `generationTime` del pedido va 10 minutos **para atrás**, no en la hora exacta: cubre
que el reloj del Worker y el de ARCA no sean el mismo, que es un rechazo clásico y
difícil de diagnosticar.

### Probado contra homologación

```
TA nuevo para wsfe (HOMOLOGACION), vence 2026-08-31T01:05:20.613-03:00
token: 764 chars · sign: 172 chars · dura 12.0 horas
```

Y el segundo pedido seguido devuelve el rechazo esperado, detectado y marcado para que
el llamador reuse el guardado.

## WSFEv1: la emisión (punto 4)

`POST /emitir` recibe la venta y devuelve el comprobante con su CAE. El circuito es:
ticket de acceso → tablas del servicio → letra y totales → candado → último autorizado →
`FECAESolicitar` → guardar.

### La letra no la elige nadie

Sale de la condición frente al IVA del cliente, leyendo la **descripción** de la tabla
oficial (`FEParamGetCondicionIvaReceptor`) en vez de comparar contra un número escrito a
mano: si ARCA agrega una condición, esto sigue funcionando.

| cliente | comprobante |
|---|---|
| IVA Responsable Inscripto | Factura **A** (tipo 1) |
| Consumidor Final, Monotributo, Exento, … | Factura **B** (tipo 6) |

Ese mismo dato es el `CondicionIVAReceptorId` que ARCA exige desde la RG 5616. Un dato,
dos usos: no pueden quedar contradiciéndose.

### IVA

Las alícuotas salen de `FEParamGetTiposIva`, no hay un 21% escrito en el código. Los
precios del sistema son finales al público, así que se desarma el precio para sacar el
neto; con `precioIncluyeIva: false` entran precios sin IVA sin tocar nada más.

El redondeo es **por alícuota y después se suma**, no al revés: ARCA valida que `ImpNeto`
sea la suma de los `BaseImp` y `ImpIVA` la de los `Importe`, y redondeando el total por un
lado y los renglones por otro se cae por un centavo.

### Los tres lugares donde esto se rompe feo

**Numeración y concurrencia.** Dos emisiones a la vez leen el mismo "último autorizado" y
piden el mismo número. Hay un candado por (punto de venta, tipo) en `fiscal_locks`, hecho
con escritura condicional de Firestore, que es un compare-and-set de verdad. Pero el
candado es la comodidad, no la garantía: la garantía es ARCA, que rechaza el duplicado con
el código **10016**. Si aparece, se vuelve a preguntar el último y se reintenta una vez.

**Timeout con CAE ya otorgado.** Si ARCA no contesta, el comprobante puede haber quedado
autorizado igual. El error de red sale marcado con `sinRespuesta`, y ante esa marca **no
se reintenta**: se llama a `FECompConsultar` por ese número exacto. Si ya tenía CAE, se
recupera; si no existe, recién ahí es seguro volver a emitir. Y si la consulta también
falla, se corta con `estadoDesconocido` y el número a revisar, sin emitir nada.

**Errores vs. observaciones.** No son lo mismo y se guardan en campos distintos: con
`Errors` no hay CAE; con `Observaciones` **sí lo hay** y el comprobante está autorizado.
Confundirlos lleva a re-emitir algo que ya salió.

### Anulación: no existe

Un comprobante con CAE **no se anula**. Lo único que ARCA acepta para dejarlo sin efecto
es otro comprobante que lo compense: una nota de crédito de la misma letra, que apunta a
la factura con `CbtesAsoc`.

`POST /nota-credito` con `{comprobanteId}` lo hace: lee la factura original, deriva el
tipo (`NOTA_CREDITO_DE`), y emite por el total con **el mismo cliente y los mismos
renglones** — una nota de crédito que no coincide con lo que revierte no sirve para nada.
La factura original no se toca: queda marcada con `notaCredito` para que no se pueda
revertir dos veces y para que el sistema lo muestre sin salir a buscar.

Va con fecha de hoy, no con la de la factura: la fecha tiene que ser correlativa con el
último comprobante de **ese** tipo, que lleva su propia numeración.

Probado en homologación: NC B (tipo 8) nro 1, CAE 86350827392446, revirtiendo la factura
B 0001-00000001.

### Probado contra homologación

```
Factura B · Consumidor Final · PV 1 Nro 1 · neto 100000 + iva 21000 = 121000
  → A (autorizado) · CAE 86350827380462 · vence 20260909 · sin errores ni observaciones

Factura A · Responsable Inscripto · dos alícuotas (21% y 10,5%)
  → A (autorizado) · CAE 86350827380475
  → observación 10217: "El credito fiscal discriminado en el presente comprobante solo
    podra ser computado a efectos del Procedimiento permanente de transicion..."

FECompConsultar de la B nro 1 → existe, CAE 86350827380462, total 121000
Pedir un número ya usado → R, error [10016] "El numero o fecha del comprobante no se
    corresponde con el proximo a autorizar"
```

La factura A es el mejor ejemplo de por qué errores y observaciones van separados: salió
**autorizada y con CAE**, y además con una observación. Tratarla como rechazada habría
significado emitirla de nuevo.

## El front (punto 6)

En la sección **Facturas** del sistema, cada venta tiene un botón 🧾:

- Abre un modal con **todo precargado desde la venta**: renglones, cantidades, precios y
  cliente. Lo único que hay que completar es la condición frente al IVA y el documento, y
  eso queda guardado en la ficha del cliente para la próxima.
- Los selectores (condición de IVA, alícuotas, tipos de documento) se llenan con las
  **tablas vivas de ARCA**, no con listas escritas en el HTML.
- Muestra la letra que va a salir **antes** de emitir, y avisa si la combinación no va a
  pasar (Responsable Inscripto sin CUIT, por ejemplo).
- Los totales se calculan igual que en el Worker, para que no haya sorpresas.
- Ya emitida, la fila de la venta muestra `🧾 Factura B 0001-00000012` en verde, y el
  modal muestra CAE, vencimiento, tipo, número, y las observaciones de ARCA si las hubo.
- Si ARCA rechazó, muestra el motivo con su código y ofrece corregir y reintentar.

El cartel de entorno está arriba de todo en la pantalla de Facturas, y otra vez adentro
del modal antes de emitir. En homologación dice que los comprobantes **no tienen validez
fiscal**; en producción, que son reales y que no se anulan.

El sistema **no habla con ARCA**: habla con el Worker, que es el único que tiene el
certificado. El punto de venta se configura en Configuración → `arcaPtoVta`.

## El PDF con QR (punto 7)

`pdfComprobanteArca()` genera el comprobante fiscal: recuadro con la letra y el código de
tipo, datos del emisor, del receptor y su condición frente al IVA, renglones, totales
—con el IVA discriminado por alícuota solo en la **A**, que es donde corresponde—, el
**CAE con su vencimiento** y el **QR obligatorio** (RG 4892).

No reemplaza a `generarFacturaPDF`, que es el remito interno del local. Este es el que
tiene CAE y vale ante ARCA.

El contenido del QR sale de la especificación oficial, no se inventa: la URL fija
`https://www.arca.gob.ar/fe/qr/` y como parámetro `p` el JSON del comprobante en Base64,
con estos campos y en este orden:

```json
{"ver":1,"fecha":"2026-08-30","cuit":23943597669,"ptoVta":1,"tipoCmp":6,"nroCmp":2,
 "importe":9000,"moneda":"PES","ctz":1,"tipoDocRec":99,"nroDocRec":0,
 "tipoCodAut":"E","codAut":86350827386997}
```

`tipoCodAut` es `"E"` porque autorizamos con CAE; la `"A"` es para CAEA, que no se usa.

Los comprobantes de homologación salen con una leyenda roja al pie que dice que **no
tienen validez fiscal**, para que un PDF de prueba no se confunda nunca con uno real.

## Reglas que no se negocian

1. **El certificado y la clave privada nunca pasan por el navegador.** El front no los
   ve, no los sube y no los guarda. Se suben con un script local que corre en la máquina
   de Juni y van cifrados a Firestore. Si un cambio hace que la clave privada viaje al
   browser, el diseño está mal: frenar y avisar.
2. **Nunca al repo**, ni de ejemplo, ni en un test, ni en un `.example`. El `.gitignore`
   de la raíz bloquea `*.key`, `*.crt`, `*.csr`, `*.p12`, `*.pfx` y `*.pem` en todo el
   árbol, pero el `.gitignore` es la segunda barrera, no la primera: los archivos viven
   fuera del repo.
3. **Cifrados en reposo**, nunca en texto plano en Firestore.
4. **Una clave por CUIT, aisladas entre sí.** Cuando el sistema se revenda vamos a estar
   guardando el certificado fiscal de otras empresas: que se filtre uno no puede
   comprometer a los demás.

## Entornos

Los cuatro endpoints salen del manual del desarrollador v4.7 y del WSDL publicado:

| | WSAA | WSFEv1 |
|---|---|---|
| homologación | `wsaahomo.afip.gov.ar/ws/services/LoginCms` | `wswhomo.afip.gov.ar/wsfev1/service.asmx` |
| producción | `wsaa.afip.gov.ar/ws/services/LoginCms` | `servicios1.afip.gov.ar/wsfev1/service.asmx` |

Se elige con la variable `ARCA_ENTORNO` (`homo` | `prod`). **Sin variable, homologación**:
el default nunca puede ser el que emite comprobantes fiscales de verdad. Si la variable
trae cualquier otra cosa, también cae a homologación y el endpoint de salud lo denuncia
en `entornoInvalido`.

El pase a producción lo aprueba Juni explícitamente, y la UI del sistema tiene que
mostrar en qué entorno está parada con un cartel, no con un detalle escondido.

## Variables

Ninguna va en este repo. Las Text se cargan en el panel de Cloudflare; los Secret con
`npx wrangler secret put NOMBRE`.

| variable | tipo | para qué |
|---|---|---|
| `ARCA_ENTORNO` | Text | `homo` o `prod` |
| `ARCA_CUIT` | Text | CUIT emisor, el del certificado |
| `FIREBASE_PROJECT` | Text | proyecto de Firestore |
| `FIREBASE_KEY` | Text | Web API key, para el login del Worker |
| `OWNER_UID` | Text | uid de Juni: el único que puede subir un certificado |
| `FAC_EMAIL` | Text | usuario propio del facturador en Firebase Auth |
| `FAC_PASSWORD` | **Secret** | su contraseña |
| `CERT_MASTER_KEY` | **Secret** | 32 bytes en base64; de acá se derivan las claves por CUIT |

## Salud

```bash
curl -s https://facturador.fiwind702050.workers.dev/ | jq
```

Devuelve el entorno, los endpoints que va a usar y qué variables están cargadas
(`true`/`false`, nunca el valor: es una URL pública).

## Fuentes

Nada de lo que hay acá está inventado ni copiado de un blog:

- Manual del desarrollador WSFEv1 v4.7 (RG 4291) — https://www.afip.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf
- WSDL de WSFEv1 en homologación — https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL
- Especificaciones del QR — https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
