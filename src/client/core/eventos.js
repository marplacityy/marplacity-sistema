/** Eventos declarados en el HTML sin scripts inline, para una CSP sin 'unsafe-inline'.
 *
 *   <button data-click="fn" data-args='["x","$this"]'>   →  window.fn('x', el)
 *
 * Eventos: data-click, data-change, data-input, data-submit, data-error y data-enter
 * (Enter sin Shift, con preventDefault). Comodines dentro de data-args: "$this" (el elemento),
 * "$value", "$checked", "$event" y "$fn:nombre" (otra función de window).
 * data-stop en un elemento sin handler corta el click, como el viejo
 * onclick="event.stopPropagation()". Se atiende solo el elemento más cercano al
 * click: un handler anidado no dispara también el del contenedor. */
const COMODINES = {
  $this: (el) => el,
  $value: (el) => el.value,
  $checked: (el) => el.checked,
  $event: (_el, e) => e,
};

function argumentos(el, e) {
  if (!el.dataset.args) return [];
  return JSON.parse(el.dataset.args).map(a => {
    if (typeof a !== 'string' || !a.startsWith('$')) return a;
    if (a.startsWith('$fn:')) return window[a.slice(4)];
    return COMODINES[a](el, e);
  });
}

function despachar(tipo, e) {
  const el = e.target.closest(`[data-${tipo}],[data-stop]`);
  if (!el) return;
  const nombre = el.dataset[tipo];
  if (!nombre) { e.stopPropagation(); return; }
  const fn = window[nombre];
  if (typeof fn !== 'function') { console.error(`Handler ${nombre} no expuesto en window`); return; }
  return fn.apply(el, argumentos(el, e));
}

export function activarEventos(raiz = document) {
  for (const tipo of ['click', 'change', 'input', 'submit']) raiz.addEventListener(tipo, e => despachar(tipo, e));
  // error no burbujea (imagen que no carga): se captura en la fase de captura.
  raiz.addEventListener('error', e => despachar('error', e), true);
  raiz.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || !e.target.closest('[data-enter]')) return;
    e.preventDefault();
    despachar('enter', e);
  });
}
