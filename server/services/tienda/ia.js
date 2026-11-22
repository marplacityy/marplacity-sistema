/**
 * IA de texto con el proveedor que esté cargado.
 * ------------------------------------------------
 * Como en Ecommodo: el script no depende de una IA en particular. Usa la clave que haya
 * (DeepSeek, OpenAI, Gemini o Claude), prueba una tras otra y, si ninguna contesta, el
 * que llama se arregla sin IA. Solo texto: un mensaje de sistema, uno del dueño y una
 * respuesta.
 *
 * Variables del Worker (alcanza con UNA clave):
 *   DEEPSEEK_KEY, OPENAI_KEY, GEMINI_KEY, ANTHROPIC_KEY   (Secret)  la clave de cada proveedor
 *   IA_PROVEEDOR      (Text)  cuál probar primero: deepseek | openai | gemini | anthropic
 *   DEEPSEEK_MODELO, OPENAI_MODELO, GEMINI_MODELO, ANTHROPIC_MODELO   (Text)  para cambiar el modelo
 *
 * Hoy el sistema usa la clave de Anthropic del dueño, a través de su proxy de siempre;
 * esto es lo que permite que cada local trabaje con la IA que tenga, cuando el sistema
 * se use en otros locales.
 *
 * Los modelos por defecto son los vigentes en noviembre de 2026. Si un proveedor retira
 * el suyo, la respuesta dice cuál falló y por qué (`intentos`) y se corrige con la
 * variable *_MODELO, sin tocar código.
 */

import { SISTEMA_MEJORAR, productosParaMejorar, categoriasParaMejorar, mensajeParaMejorar, limpiarMejoras, jsonDeTexto } from '../../../src/shared/mejorar-producto.js';

export const PROVEEDORES_IA = {
  deepseek: { nombre: 'DeepSeek', clave: 'DEEPSEEK_KEY', modelo: 'deepseek-chat' },
  openai: { nombre: 'OpenAI', clave: 'OPENAI_KEY', modelo: 'gpt-6.2-sol' },
  gemini: { nombre: 'Gemini', clave: 'GEMINI_KEY', modelo: 'gemini-3.8-flash' },
  anthropic: { nombre: 'Claude', clave: 'ANTHROPIC_KEY', modelo: 'claude-opus-5-5' },
};

const ESPERA_MS = 90_000;
// Los modelos de Claude que aceptan que, si se niegan a contestar, responda otro en la misma llamada.
const CON_RESPALDO = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/;

const modeloDe = (proveedor, env) => String(env[proveedor.toUpperCase() + '_MODELO'] || PROVEEDORES_IA[proveedor].modelo).trim();

/** Los proveedores que tienen clave, en el orden en que se prueban: primero IA_PROVEEDOR. */
export function proveedoresCargados(env) {
  const con = Object.keys(PROVEEDORES_IA).filter(p => String(env?.[PROVEEDORES_IA[p].clave] || '').trim());
  const primero = String(env?.IA_PROVEEDOR || '').toLowerCase().trim();
  return con.includes(primero) ? [primero, ...con.filter(p => p !== primero)] : con;
}

/**
 * El pedido HTTP para un proveedor: `{ url, init }`. Exportado para el test.
 * `json`: se espera un objeto JSON como respuesta (el pedido ya lo aclara en el texto).
 */
export function pedidoDeIA(proveedor, env, { sistema = '', mensaje = '', json = false, maxTokens = 4000 } = {}) {
  const modelo = modeloDe(proveedor, env);
  const clave = String(env[PROVEEDORES_IA[proveedor].clave] || '').trim();
  const cuerpo = (url, headers, body) => ({ url, init: { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ESPERA_MS) } });
  const turnos = [...(sistema ? [{ role: 'system', content: sistema }] : []), { role: 'user', content: mensaje }];
  if (proveedor === 'deepseek') {
    return cuerpo('https://api.deepseek.com/chat/completions', { Authorization: `Bearer ${clave}` },
      { model: modelo, messages: turnos, max_tokens: Math.min(maxTokens, 8000), ...(json ? { response_format: { type: 'json_object' } } : {}) });
  }
  if (proveedor === 'openai') {
    // Sin temperature: los modelos nuevos solo aceptan la de fábrica.
    return cuerpo('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${clave}` },
      { model: modelo, messages: turnos, max_completion_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) });
  }
  if (proveedor === 'gemini') {
    return cuerpo(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, { 'x-goog-api-key': clave }, {
      ...(sistema ? { systemInstruction: { parts: [{ text: sistema }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: mensaje }] }],
      generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
    });
  }
  if (proveedor === 'anthropic') {
    // Claude piensa antes de contestar y eso también cuenta como salida: se le deja lugar.
    // Esfuerzo bajo: son textos cortos. Sin temperature ni prefill, que estos modelos rechazan.
    const respaldo = CON_RESPALDO.test(modelo);
    return cuerpo('https://api.anthropic.com/v1/messages',
      { 'x-api-key': clave, 'anthropic-version': '2026-10-21', ...(respaldo ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}) },
      { model: modelo, max_tokens: Math.max(maxTokens, 16000), output_config: { effort: 'low' }, ...(respaldo ? { fallbacks: 'default' } : {}), ...(sistema ? { system: sistema } : {}), messages: [{ role: 'user', content: mensaje }] });
  }
  throw new Error(`proveedor de IA desconocido: ${proveedor}`);
}

/** El texto de la respuesta de un proveedor, o '' si no trajo. Exportado para el test. */
export function textoDeIA(proveedor, data) {
  if (proveedor === 'gemini') {
    return (data?.candidates?.[0]?.content?.parts || []).filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
  }
  if (proveedor === 'anthropic') {
    // El primer bloque suele ser `thinking`: se juntan solo los de texto. Una negativa no es una respuesta.
    if (data?.stop_reason === 'refusal') return '';
    return (Array.isArray(data?.content) ? data.content : []).filter(b => b?.type === 'text').map(b => b.text).join('').trim();
  }
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

/**
 * Pide un texto a la primera IA que conteste. Devuelve `{ texto, proveedor, intentos }`;
 * `intentos` cuenta qué pasó con cada una que falló. Si ninguna contesta (o no hay
 * ninguna clave) lanza un error con `intentos` adentro.
 */
export async function textoConIA(env, opciones, fetchImpl = fetch) {
  const intentos = [];
  for (const proveedor of proveedoresCargados(env)) {
    try {
      const { url, init } = pedidoDeIA(proveedor, env, opciones);
      const r = await fetchImpl(url, init);
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`${r.status}: ${String(data?.error?.message || data?.error || data?.message || 'sin detalle').slice(0, 160)}`);
      const texto = textoDeIA(proveedor, data);
      if (!texto) throw new Error('contestó vacío');
      return { texto, proveedor, intentos };
    } catch (e) {
      intentos.push({ proveedor, error: e.name === 'TimeoutError' ? 'no contestó a tiempo' : String(e.message).slice(0, 200) });
    }
  }
  const error = new Error(intentos.length ? 'ninguna IA contestó: ' + intentos.map(i => `${PROVEEDORES_IA[i.proveedor].nombre} (${i.error})`).join('; ') : 'no hay ninguna IA cargada en el Worker');
  error.intentos = intentos;
  error.sinIA = !intentos.length;
  throw error;
}

/**
 * Mejora una tanda de productos: título, categoría, descripción y etiquetas SEO (el
 * pedido y la revisión de la respuesta están en src/shared/mejorar-producto.js, los
 * mismos que usa el sistema). Devuelve `{ proveedor, productos, intentos }`.
 */
export async function mejorarProductos(env, { productos, categorias }, fetchImpl = fetch) {
  const lista = productosParaMejorar(productos);
  if (!lista.length) return { proveedor: null, productos: [], intentos: [] };
  const cats = categoriasParaMejorar(categorias);
  const r = await textoConIA(env, { sistema: SISTEMA_MEJORAR, mensaje: mensajeParaMejorar(lista, cats), json: true, maxTokens: 6000 }, fetchImpl);
  const mejoras = limpiarMejoras(jsonDeTexto(r.texto), lista, cats);
  if (!mejoras.length) {
    const error = new Error(`${PROVEEDORES_IA[r.proveedor].nombre} contestó algo que no se pudo leer`);
    error.intentos = [...r.intentos, { proveedor: r.proveedor, error: 'respuesta ilegible' }];
    throw error;
  }
  return { proveedor: r.proveedor, productos: mejoras, intentos: r.intentos };
}
