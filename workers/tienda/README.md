# Worker `tienda`

Cobra los pedidos del catálogo web (`catalogo.html`). La página le manda el pedido; el
Worker lo guarda en la colección `pedidos`, arma el link de pago de Mercado Pago y
recibe el aviso cuando el pago se aprueba.

URL de producción: https://tienda.fiwind702050.workers.dev/

## Qué hace

| ruta | qué |
|---|---|
| `GET /` | diagnóstico: qué variables están cargadas |
| `POST /pedido` | crea el pedido. Devuelve `{id, estado, url}`; si hay `url`, la página manda al cliente ahí a pagar |
| `GET /pedido/:id` | el estado del pedido, para la pantalla de vuelta del pago |
| `POST /mp/webhook` | Mercado Pago avisa que un pago cambió |
| `POST /stripe/webhook` | Stripe avisa que un pago cambió (`checkout.session.*`, `charge.refunded`) |

**El precio no viene de la página.** Se lee de `catalogo/publico` (lo que publicó el
dueño) y las reglas de cobro (`cobro`: tipo de cambio, recargo de tarjeta, tope de MP)
vienen de ahí también. Un cliente que edite el HTML no paga menos.

Formas de pago:

- `mp` — en pesos, `precioUSD × tc`. Solo hasta `cobro.mpMaxUSD` (u$s 200): cobrar un
  teléfono por Mercado Pago dispara impuestos que se comen el margen.
- `efectivo` — reserva sin pagar; el pedido nace `reservado`.
- `tarjeta` — dólares con tarjeta por Stripe Checkout, `precioUSD × (1 + recargoTarjetaPct)`.
  Sin tope: es la forma de pagar un teléfono a distancia.

## El doc de `pedidos`

Un doc por pedido, id al azar (UUID). Estados: `creado` (esperando el pago) →
`pagado` / `pendiente` / `rechazado` / `devuelto`, o `reservado` (efectivo).

Campos: `producto` (id, nombre, gb, color, tipo, precioUSD), `pago`, `entrega`, `direccion`,
`cliente` (nombre, whatsapp, email), `montoUSD`, `montoARS`, `tc`, `creado`, `fecha`,
`actualizado`, `pagadoEn`, `mp` (preferenceId, paymentId, status, statusDetail, monto,
medio), `userId`.

## Deploy

```bash
cd workers/tienda && npx wrangler deploy
node workers/tienda/test-tienda.mjs     # chequeo sin red: validación, montos y firma
```

Orden la primera vez:

1. Crear el usuario `tienda@marplacity.com` en Firebase Auth y poner su uid en
   `esTienda()` de `firestore.rules`; `firebase deploy --only firestore:rules`.
2. `npx wrangler deploy`.
3. Cargar los secretos (parado en `workers/tienda/`):

   ```bash
   npx wrangler secret put TIENDA_PASSWORD
   npx wrangler secret put MP_ACCESS_TOKEN      # el de prueba primero
   npx wrangler secret put MP_WEBHOOK_SECRET    # la "clave secreta" de Webhooks de la app de MP
   npx wrangler secret put STRIPE_SECRET_KEY    # sk_test_... primero, sk_live_... después
   npx wrangler secret put STRIPE_WEBHOOK_SECRET # el signing secret (whsec_...) del endpoint
   ```

   Y en el panel (Settings → Variables), las Text: `OWNER_UID` (el uid del dueño, el mismo
   que tiene ig-bot) y `TIENDA_EMAIL`. Las que ya son públicas van en `wrangler.toml`.
4. En la app de Mercado Pago → Webhooks: URL `https://tienda.fiwind702050.workers.dev/mp/webhook`,
   evento **Pagos**.
5. En Stripe → Developers → Webhooks → Add endpoint: URL
   `https://tienda.fiwind702050.workers.dev/stripe/webhook`, eventos `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired` y `charge.refunded`.

Después del deploy abrir https://tienda.fiwind702050.workers.dev/ y confirmar que la
lista de `vars` esté toda en `true`.

## Probar en modo prueba

Con el Access Token **de prueba** cargado, el link de pago es real pero se paga con la
cuenta de prueba de tipo comprador (creada en la app de MP → Cuentas de prueba), desde
una ventana de incógnito. El pedido tiene que pasar a `pagado` solo, por el webhook.
