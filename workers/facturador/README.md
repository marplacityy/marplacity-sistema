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
| 4 | WSFEv1: `FECompUltimoAutorizado` + `FECAESolicitar` | ⏳ |
| 6 | Front: emitir desde una venta, ver CAE y estado | ⏳ |
| 7 | PDF con el QR obligatorio | ⏳ |

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
