/** Escapa texto y valores de atributos HTML, incluidas ambas comillas. */
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, caracter => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[caracter]);
}

/** Literal JS dentro de un atributo HTML: no debe poder cerrar ninguno de los dos. */
export function escJs(valor) {
  return String(valor ?? '').replace(/[\\&<>"'\r\n\u2028\u2029]/g, caracter => ({
    '\\': '\\\\', '&': '\\x26', '<': '\\x3c', '>': '\\x3e',
    '"': '\\x22', "'": '\\x27', '\r': '\\r', '\n': '\\n',
    '\u2028': '\\u2028', '\u2029': '\\u2029',
  })[caracter]);
}

/** Atributos para un handler declarado sin JS inline: on('click','fn', a, b) →
 * data-click="fn" data-args='["a","b"]'. Los comodines "$this", "$value",
 * "$checked", "$event" y "$fn:nombre" los resuelve el despachador de core/eventos.js.
 * Como los args viajan en JSON y se escapan como atributo, acá no hace falta escJs. */
export function on(evento, fn, ...args) {
  if (!/^[a-zA-Z_$][\w$]*$/.test(fn)) throw new Error('Nombre de handler inválido: ' + fn);
  return `data-${evento}="${fn}"` + (args.length ? ` data-args='${esc(JSON.stringify(args))}'` : '');
}
