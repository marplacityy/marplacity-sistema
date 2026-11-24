/**
 * shared/pausa-bot: cuándo el bot de Instagram se calla en un chat.
 *
 * Un chat queda en pausa (`botPausado`) por tres caminos:
 *
 *  - el dueño toca el semáforo de la bandeja: hasta que lo vuelva a tocar;
 *  - el bot le prometió algo al cliente ("ya te confirmo"): hasta que el dueño lo retome;
 *  - el dueño contestó a mano (desde Instagram o desde la bandeja): el bot se corre de esa
 *    charla, porque dos contestando lo mismo —o cosas distintas— es lo peor que puede
 *    pasar. Esta pausa se levanta sola: a las HORAS_EN_MANO de su último mensaje el bot
 *    vuelve a atender ese chat, con todo lo que se habló ya leído.
 *
 * La tercera la pidió Juni el 23/11/2026 ("entré a responder yo pero igual le contestó").
 * No lleva un campo de vencimiento propio —el bot solo puede escribir los campos que le
 * permite firestore.rules—: se reconoce por su motivo y vence según la fecha de la última
 * línea del dueño en el historial.
 *
 * Lo usan el Worker del bot, que decide si contesta, y la bandeja, que pinta el semáforo.
 */

export const HORAS_EN_MANO = 12;

/** El motivo con el que el bot marca la pausa que arranca cuando el dueño contesta a mano. */
export const PAUSA_EN_MANO = `le contestaste vos: el bot no se mete en este chat y vuelve solo a las ${HORAS_EN_MANO} h de tu último mensaje`;

// Una fecha del historial puede venir como texto (la API REST), como Date, o como el
// Timestamp del SDK de Firestore en el navegador.
const enMs = f => !f ? NaN : typeof f.toDate === 'function' ? f.toDate().getTime() : typeof f.seconds === 'number' ? f.seconds * 1000 : new Date(f).getTime();

/** Cuándo escribió el dueño por última vez en una charla, en milisegundos; NaN si nunca. */
export function ultimaVezDelDueno(historial) {
  const ultima = (Array.isArray(historial) ? historial : []).findLast(l => l && l.de === 'juni');
  return ultima ? enMs(ultima.fecha) : NaN;
}

/** Si el dueño escribió en la charla después de `desde` (una fecha): se metió él. */
export function seMetioElDueno(historial, desde) {
  const cuando = ultimaVezDelDueno(historial);
  return Number.isFinite(cuando) && cuando >= enMs(desde);
}

/** Si el bot tiene que quedarse callado en este chat ahora. */
export function chatPausado(doc, ahora = Date.now()) {
  if (!doc || doc.botPausado !== true) return false;
  // Pausado con el semáforo o porque el bot prometió algo: hasta que el dueño lo retome.
  if (doc.motivoPausa !== PAUSA_EN_MANO) return true;
  const cuando = ultimaVezDelDueno(doc.historial);
  // Sin una fecha para medir, queda en pausa: es el lado seguro.
  return !Number.isFinite(cuando) || ahora - cuando < HORAS_EN_MANO * 3600_000;
}
