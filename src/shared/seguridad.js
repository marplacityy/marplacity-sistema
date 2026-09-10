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
