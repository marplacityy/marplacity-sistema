/**
 * core/fotos: las fotos de los productos, en Firebase Storage (`fotos/` del bucket).
 *
 * El dueño sube y lista directo desde el navegador con su sesión de Firebase; las reglas
 * de Storage (storage.rules) dejan escribir solo a él y leer a cualquiera. Se ven en
 * `FOTOS_BASE + archivo` (src/shared/sitio.js), la misma base que guardan el mapa de
 * `catalogo/fotos`, la tienda y el bot.
 *
 * El SDK de Storage se carga recién cuando hace falta: solo lo usa la pantalla Catálogo.
 */
import { contextoApp } from './estado.js';
import { FOTOS_CARPETA } from '../../shared/sitio.js';

let sdk = null;
async function storage() {
  sdk ||= await import('firebase/storage');
  return { ...sdk, bucket: sdk.getStorage(contextoApp.app) };
}

/** Los nombres de archivo que hay en `fotos/`. */
export async function listarFotos() {
  const { bucket, ref, listAll } = await storage();
  const { items } = await listAll(ref(bucket, FOTOS_CARPETA));
  return items.map(item => item.name).sort();
}

/** Sube (o pisa) `fotos/<archivo>`. `blob` es la imagen ya achicada. */
export async function subirFoto(archivo, blob) {
  const { bucket, ref, uploadBytes } = await storage();
  await uploadBytes(ref(bucket, `${FOTOS_CARPETA}/${archivo}`), blob, {
    contentType: blob.type || 'image/jpeg',
    cacheControl: 'public, max-age=86400',
  });
  return archivo;
}
