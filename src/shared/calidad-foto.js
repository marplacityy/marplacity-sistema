/**
 * shared/calidad-foto: cuáles de las fotos encontradas valen para la tienda.
 *
 * La búsqueda trae lo que Amazon muestra para el producto: la foto principal (fondo
 * blanco), pero también fotos de uso, infografías y la misma imagen repetida en varias
 * publicaciones. Acá se decide con los píxeles, no con el título:
 *
 *   - fondo blanco: el borde de la imagen es blanco (`fondoBlanco`);
 *   - resolución: el lado mayor, que se sabe al cargarla;
 *   - repetidas: dos imágenes casi iguales dejan una sola (`huellaDeFoto`).
 *
 * Las funciones reciben los píxeles ya achicados (el navegador los saca de un canvas de
 * 32 × 32): no dependen del DOM y se prueban con arreglos.
 */

/** El lado del canvas al que se achica cada foto para medirla. */
export const LADO_MEDICION = 32;

const BLANCO = 236;   // por canal: el blanco de un JPG nunca es 255 parejo

/** Qué parte del borde de la imagen (un píxel de marco) es blanca: de 0 a 1. */
export function fondoBlanco(rgba, ancho, alto) {
  let total = 0, blancos = 0;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (x > 0 && x < ancho - 1 && y > 0 && y < alto - 1) continue;
      const i = (y * ancho + x) * 4;
      total++;
      if (rgba[i] >= BLANCO && rgba[i + 1] >= BLANCO && rgba[i + 2] >= BLANCO) blancos++;
    }
  }
  return total ? blancos / total : 0;
}

/**
 * La huella de una imagen: 64 bits que dicen, en una grilla de 9 × 8, si cada zona es más
 * clara que la de su derecha. Dos fotos iguales con otro tamaño o compresión dan casi la
 * misma huella; dos ángulos distintos del producto, no.
 */
export function huellaDeFoto(rgba, ancho, alto) {
  const COLS = 9, FILAS = 8;
  const gris = [];
  for (let f = 0; f < FILAS; f++) {
    for (let c = 0; c < COLS; c++) {
      const x0 = Math.floor(c * ancho / COLS), x1 = Math.max(x0 + 1, Math.floor((c + 1) * ancho / COLS));
      const y0 = Math.floor(f * alto / FILAS), y1 = Math.max(y0 + 1, Math.floor((f + 1) * alto / FILAS));
      let suma = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * ancho + x) * 4;
        suma += rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
        n++;
      }
      gris.push(n ? suma / n : 0);
    }
  }
  let bits = '';
  // Con un margen de dos niveles de gris: en una zona pareja (el fondo blanco) el ruido del
  // JPG no tiene que cambiar ningún bit.
  for (let f = 0; f < FILAS; f++) for (let c = 0; c < COLS - 1; c++) bits += gris[f * COLS + c] > gris[f * COLS + c + 1] + 2 ? '1' : '0';
  return bits;
}

/** En cuántos bits difieren dos huellas. */
export function distanciaDeHuellas(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export const FOTOS_POR_PRODUCTO = 5;

/**
 * Ordena las candidatas y marca las que quedan elegidas.
 *
 * `candidatas`: [{ url, ancho, alto, blanco (0..1 o null si no se pudo medir), huella }].
 * Se eligen hasta `max`, solo de fondo blanco y con el lado mayor de al menos `minLado`,
 * primero las de más resolución (de 1500 px para arriba valen igual: ahí manda el orden
 * en que las devolvió la búsqueda, que es por parecido). Las demás quedan a la vista, sin
 * marcar y con el motivo en `nota`, por si el dueño quiere sumarlas a mano.
 */
export function elegirFotos(candidatas, { max = FOTOS_POR_PRODUCTO, minLado = 500, minBlanco = 0.9 } = {}) {
  const lista = (Array.isArray(candidatas) ? candidatas : []).map((c, orden) => ({ ...c, orden, elegida: false, nota: '' }));
  const lado = c => Math.max(Number(c.ancho) || 0, Number(c.alto) || 0);
  for (const c of lista) {
    if (c.blanco == null) c.nota = 'no se pudo medir';
    else if (c.blanco < minBlanco) c.nota = 'otro fondo';
    else if (lado(c) < minLado) c.nota = 'chica';
  }
  const aptas = lista.filter(c => !c.nota).sort((a, b) => Math.min(lado(b), 1500) - Math.min(lado(a), 1500) || a.orden - b.orden);
  const elegidas = [];
  for (const c of aptas) {
    if (elegidas.some(e => distanciaDeHuellas(e.huella, c.huella) <= 4)) { c.nota = 'repetida'; continue; }
    if (elegidas.length < max) { c.elegida = true; elegidas.push(c); }
  }
  const peso = c => c.elegida ? 0 : !c.nota ? 1 : c.nota === 'repetida' ? 3 : 2;
  return lista.sort((a, b) => peso(a) - peso(b) || Math.min(lado(b), 1500) - Math.min(lado(a), 1500) || a.orden - b.orden)
    .map(({ orden, ...c }) => c);
}
