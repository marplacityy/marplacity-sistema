/**
 * shared/orden-tienda: en qué orden se muestran los productos de una sección de la tienda.
 *
 * Lo pidió Juni el 22/11/2026: primero los que tienen varias opciones de capacidad y
 * color (las tarjetas "desde"), y adentro de cada grupo el modelo más nuevo y más alto
 * arriba: en iPhone nuevos, el 18 Pro Max. La tienda arma las tarjetas; acá solo se
 * decide el rango de un modelo a partir de su nombre.
 */

// Las familias donde el número del nombre dice qué tan nuevo es el modelo.
const FAMILIAS = /iphone|ipad|macbook|airpods|watch|samsung|galaxy|xiaomi|redmi|poco|motorola|\bmoto\b|pixel/;

/**
 * El rango de un modelo: `[generación, nivel]`. La generación es el número del modelo
 * (iPhone 18 → 18, S26 → 26, chip M5 → 5, Watch Ultra 4 → 4) y el nivel, su escalón
 * dentro de la línea: Pro Max y Ultra arriba, después Pro, Plus/Air, el común, y abajo
 * los recortados (e, SE, FE, Lite, mini). Lo que no es de una familia conocida queda en
 * generación 0: ahí manda el precio.
 */
export function rangoDeModelo(nombre) {
  const t = String(nombre || '').toLowerCase();
  let generacion = 0;
  if (FAMILIAS.test(t)) {
    const m = /\biphone\s*(\d{1,2})/.exec(t)                    // iPhone 18, iPhone 17e
      || /\b[a-z](\d{2})\b/.exec(t)                             // S26, A16, G85
      || /\bm(\d)\b/.exec(t)                                    // el chip: M5
      || /\b(?:series?|ultra|se|note|pad|tab|pro|max|air|watch|airpods)\s+(\d{1,2})\b/.exec(t);   // Watch Ultra 4, AirPods Pro 3
    generacion = m ? Number(m[1]) : 0;
  }
  const nivel = /\bpro\s*max\b|\bultra\b/.test(t) ? 4
    : /\bpro\b/.test(t) ? 3
    : /\bplus\b|\bmax\b|\bair\b/.test(t) ? 2.5
    : /\bfe\b|\blite\b|\bmini\b|\bse\b|\b\d{2}e\b/.test(t) ? 1
    : 2;
  return [generacion, nivel];
}

/**
 * Compara dos tarjetas ya pesadas (de mayor a menor), número por número: con variantes
 * antes que sin, después lo que la tienda ponga en el medio (generación y nivel; en
 * Notebooks, la marca), cantidad de variantes y precio.
 */
export function compararPesos(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}
