/**
 * Dónde vive todo lo público, en un solo lugar.
 *
 * Lo usan el build (`base` de Vite en modo pages), el sistema, la tienda, el bot y el
 * servidor Node. Para pasar a un dominio propio se cambia `SITIO_PUBLICO` acá (y
 * `CATALOGO_URL` en workers/tienda/wrangler.toml); los pasos completos están en
 * docs/LANZAMIENTO.md.
 */

/** La dirección del sistema y la tienda en GitHub Pages. Termina en "/". */
export const SITIO_PUBLICO = 'https://marplacityy.github.io/marplacity-sistema/';

/** La tienda pública: los links que se comparten con clientes y la vuelta de los pagos. */
export const TIENDA_PUBLICA = SITIO_PUBLICO + 'catalogo.html';

/** El bucket de Firebase Storage donde viven las fotos de los productos. */
export const FOTOS_BUCKET = 'mis-gastos-21e7b.firebasestorage.app';

/** La carpeta de las fotos dentro del bucket. */
export const FOTOS_CARPETA = 'fotos';

/**
 * La URL pública de las fotos: base + nombre de archivo. El bucket tiene lectura pública
 * (allUsers con "Lector de objetos de Storage"), así que es un prefijo puro, igual que
 * cuando vivían en el repo o en el VPS: el mapa de `catalogo/fotos`, la tienda y el bot
 * siguen armando las URLs igual.
 */
export const FOTOS_BASE = `https://storage.googleapis.com/${FOTOS_BUCKET}/${FOTOS_CARPETA}/`;
