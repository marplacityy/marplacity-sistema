/** IMEI o número de serie de un item interpretado por la IA.
 * La IA a veces deja el número de serie en las notas (sobre todo el de Apple, que es
 * alfanumérico y no tiene los 15 dígitos de un IMEI). Esto lo pasa al campo `imei`,
 * que es donde la consignación guarda el IMEI o N° de serie. */

// "S/N: F2LXK3ABCD", "Serie F2LX...", "IMEI 3567...", "N° de serie: ..."
const CON_ETIQUETA = /\b(?:imei|s\/?n|sn|serial|serie|n[°º.]?\s*(?:de\s*)?serie)\b\s*[:#-]?\s*([A-Z0-9]{8,17})\b/i;
// IMEI suelto: 15 dígitos
const IMEI = /\b\d{15}\b/;
// Serie de Apple y similares: 10 a 12 caracteres en mayúsculas, con letras y números
const SERIE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10,12}\b/;

export function rescatarSerie(item) {
  if (!item || item.imei || !item.notas) return item;
  const notas = String(item.notas);
  const m = notas.match(CON_ETIQUETA) || notas.match(IMEI) || notas.match(SERIE);
  if (!m) return item;
  const serie = (m[1] || m[0]).toUpperCase();
  const resto = notas.replace(m[0], ' ').replace(/\s*([,;·|-]\s*)+/g, ', ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
  return { ...item, imei: serie, notas: resto || null };
}
