# MarplaCity — sistema de gestión

Sistema de gestión del local: gastos, ventas/POS, stock por IMEI, consignación,
reparaciones, inventario, caja, clientes y la base de conocimiento del bot de
Instagram.

Todo el frontend es un único archivo, `index.html`. No hay build: se abre
directo en el browser o se sirve con `python3 -m http.server 8000`.

Producción: **https://marplacityy.github.io/marplacity-sistema/** — todo push a
`main` se despliega solo.

## Reglas de seguridad de Firestore

`firestore.rules` es **la fuente de verdad** de las reglas de seguridad. La
config de Firebase viaja dentro de `index.html`, que es público, así que estas
reglas son la única barrera real que protege los datos.

Para publicarlas:

```bash
firebase deploy --only firestore:rules
```

Si alguna vez editás las reglas **desde la consola de Firebase**, ese cambio
queda solo allá: la consola no tiene historial ni te avisa que el repo quedó
viejo. Copiá el texto de la consola a este archivo y commiteálo, para que el
historial refleje lo que está realmente desplegado.

En la otra dirección vale lo mismo: si editás `firestore.rules` y no corrés el
deploy, el archivo dice una cosa y producción hace otra.
