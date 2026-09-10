/** modulos/asistente: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, showToast } from '../core/interfaz.js';
import { posCatalog } from './pos.js';
import { buildDataContext, workerHeaders } from './reportes.js';
import { setSyncDot } from '../core/datos.js';
import { addDoc, serverTimestamp } from 'firebase/firestore';

export /** El sistema no le cuenta al modelo lo que puede averiguar solo: para eso están las herramientas. */
function agSystem() {
  return `Sos el asistente del sistema de gestión de ${contextoApp.cfg.localNombre || 'MarplaCity'}, un local de celulares en Mar del Plata.

Hablás en castellano rioplatense, directo y breve. Nada de "¡Claro! Con gusto te ayudo".

Hoy es ${contextoApp.today()}. Las categorías de gasto que existen son: ${(contextoApp.cats || []).join(', ')}.

QUÉ PODÉS Y QUÉ NO
- Podés buscar, resumir y proponer. NO podés guardar nada: las fichas que proponés las
  confirma el usuario a mano. Nunca digas que anotaste, guardaste o registraste algo:
  decí que se lo dejaste preparado para confirmar.
- Si algo es ambiguo —"el iPhone 15 negro" y hay tres— preguntá cuál antes de proponer.
  Preguntar es barato; proponer la ficha equivocada hace que el usuario cargue mal un dato.
- Si te falta un dato para armar la ficha, pedilo. No lo inventes.

Los importes en dólares se escriben "u$s 500" y en pesos "$ 500.000".`;
}
export function agPintar() {
  const c = document.getElementById('ag-chat');
  if (!c) return;
  c.innerHTML = contextoApp.agHistorial.map((m, i) => agBurbuja(m, i)).filter(Boolean).join('') || `
    <div class="home-empty">Contame qué pasó y te lo preparo.</div>`;
  c.scrollTop = c.scrollHeight;
}
export function agBurbuja(m) {
  const texto = typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!texto) return '';
  const mio = m.role === 'user';
  return `<div style="display:flex;justify-content:${mio ? 'flex-end' : 'flex-start'};margin-bottom:10px;">
    <div style="max-width:82%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;
      ${mio ? 'background:var(--accent);color:#fff;border-bottom-right-radius:4px;' : 'background:var(--surface);border:1px solid var(--border);border-bottom-left-radius:4px;'}">${esc(texto)}</div>
  </div>`;
}

// ── Las herramientas, ejecutadas acá ──
export /** Las fichas pendientes, dibujadas abajo del chat. */
function agPintarFichas() {
  const c = document.getElementById('ag-chat');
  if (!c) return;
  // Los ya anotados dejan un renglón: si algo se guardó dos veces, se ve acá y no
  // aparece como sorpresa en la lista de Gastos.
  const hechos = contextoApp.agFichas.filter(f => f.estado === 'confirmada' && f.tipo === 'gasto');
  if (hechos.length) c.insertAdjacentHTML('beforeend', hechos.map(f => `
    <div style="font-size:12.5px;color:#237A4B;margin:2px 0 8px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
      ✓ Anotado: ${esc(f.datos.concepto || '')} — ${f.datos.moneda === 'USD' ? contextoApp.fmtUSD(f.datos.monto) : contextoApp.fmtARS(f.datos.monto)}
    </div>`).join(''));
  const pend = contextoApp.agFichas.map((f, i) => ({
    f,
    i
  })).filter(({
    f
  }) => f.estado === 'pendiente' || f.estado === 'guardando');
  if (!pend.length) {
    c.scrollTop = c.scrollHeight;
    return;
  }
  c.insertAdjacentHTML('beforeend', pend.map(({
    f,
    i
  }) => f.tipo === 'gasto' ? `
    <div class="card" style="margin:4px 0 10px;border-color:var(--accent);">
      <div class="card-title" style="margin-bottom:10px;">Gasto para confirmar</div>
      <div class="grid2">
        <div class="field"><label>Concepto</label><input type="text" id="ag-f${i}-concepto" value="${esc(f.datos.concepto || '')}"></div>
        <div class="field"><label>Categoría</label><select id="ag-f${i}-categoria">${(contextoApp.cats || []).map(x => `<option ${x === f.datos.categoria ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Monto</label><input type="number" step="0.01" id="ag-f${i}-monto" value="${esc(f.datos.monto ?? '')}"></div>
        <div class="field"><label>Moneda</label><select id="ag-f${i}-moneda"><option value="ARS" ${f.datos.moneda !== 'USD' ? 'selected' : ''}>ARS $</option><option value="USD" ${f.datos.moneda === 'USD' ? 'selected' : ''}>USD u$s</option></select></div>
      </div>
      <div class="field"><label>Fecha</label><input type="date" id="ag-f${i}-fecha" value="${esc(f.datos.fecha || contextoApp.today())}"></div>
      <div class="pos-actions" style="margin-top:8px;">
        <button class="pos-btn-cancel" onclick="descartarFichaAgente(${i})" ${f.estado === 'guardando' ? 'disabled' : ''}>✕ Descartar</button>
        <button class="pos-btn-checkout" onclick="confirmarGastoAgente(${i})" ${f.estado === 'guardando' ? 'disabled' : ''}>${f.estado === 'guardando' ? 'Guardando…' : 'Anotar el gasto'}</button>
      </div>
    </div>` : `
    <div class="card" style="margin:4px 0 10px;border-color:var(--accent);">
      <div class="card-title" style="margin-bottom:6px;">Listo para cobrar</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:10px;">${esc(f.datos.nombre)} — te abro el punto de venta con esto cargado. La venta la cerrás vos con el botón de siempre.</p>
      <div class="pos-actions">
        <button class="pos-btn-cancel" onclick="descartarFichaAgente(${i})">✕ Descartar</button>
        <button class="pos-btn-checkout" onclick="abrirVentaAgente(${i})">Abrir el punto de venta</button>
      </div>
    </div>`).join(''));
  c.scrollTop = c.scrollHeight;
}
export function inicializarAsistente() {
  // ══ Asistente ════════════════════════════════════════════════
  //
  // Un chat que entiende lo que le contás y prepara el trabajo. La regla de oro está en el
  // diseño y no en el prompt: LAS HERRAMIENTAS QUE ESCRIBEN NO EXISTEN. El modelo solo
  // puede buscar, resumir y PROPONER; lo que propone se dibuja como una ficha que hay que
  // confirmar a mano. Aunque el modelo se equivoque o alguien le meta una instrucción rara
  // en el texto de una conversación, no hay forma de que un dato entre solo.
  //
  // Las herramientas corren en este navegador, con los permisos que ya tenés: el asistente
  // no accede a nada a lo que vos no accedas.
  contextoApp.agHistorial = []; // los mensajes tal cual se los mandamos a la API
  contextoApp.agFichas = []; // las propuestas pendientes de confirmar
  contextoApp.AG_HERRAMIENTAS = [{
    name: 'buscar',
    description: 'Busca productos en el stock propio, en consignación o en el inventario de accesorios. Usalo cuando el usuario nombre un producto ("el iPhone 15 negro") para saber si existe y cuál es.',
    input_schema: {
      type: 'object',
      properties: {
        texto: {
          type: 'string',
          description: 'Lo que se busca: modelo, color, IMEI o parte del nombre.'
        }
      },
      required: ['texto']
    }
  }, {
    name: 'resumen_del_periodo',
    description: 'Los números de un período: ventas, ingresos, gastos y ganancia. Para preguntas como "cómo me fue esta semana" o "cuánto vendí en agosto". Calculá vos las fechas del rango que pidió el usuario.',
    input_schema: {
      type: 'object',
      properties: {
        desde: {
          type: 'string',
          description: 'Fecha de inicio, AAAA-MM-DD.'
        },
        hasta: {
          type: 'string',
          description: 'Fecha de fin, AAAA-MM-DD.'
        }
      },
      required: ['desde', 'hasta']
    }
  }, {
    name: 'proponer_gasto',
    description: 'Muestra en pantalla una ficha de gasto para que el usuario la revise y confirme. NO guarda nada: el usuario tiene que apretar el botón. Usalo cuando cuente que gastó algo.',
    input_schema: {
      type: 'object',
      properties: {
        concepto: {
          type: 'string',
          description: 'Qué se compró o pagó, en pocas palabras.'
        },
        monto: {
          type: 'number',
          description: 'El importe, solo el número.'
        },
        moneda: {
          type: 'string',
          enum: ['ARS', 'USD'],
          description: 'La moneda del importe.'
        },
        categoria: {
          type: 'string',
          description: 'Una de las categorías existentes del sistema.'
        },
        fecha: {
          type: 'string',
          description: 'AAAA-MM-DD. Si no lo aclaró, poné la de hoy.'
        },
        notas: {
          type: 'string',
          description: 'Detalle extra, si lo dijo.'
        }
      },
      required: ['concepto', 'monto', 'moneda']
    }
  }, {
    name: 'preparar_venta',
    description: 'Deja el punto de venta cargado con un producto, listo para cobrar. NO vende: el usuario cierra la venta con el botón de siempre. Antes de usarlo, buscá el producto y asegurate de cuál es; si hay más de uno posible, preguntale al usuario cuál.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          description: 'El tipo que devolvió la búsqueda: eq, consig o inv.'
        },
        refId: {
          type: 'string',
          description: 'El id que devolvió la búsqueda.'
        }
      },
      required: ['tipo', 'refId']
    }
  }];
  contextoApp.agEjecutar = {
    buscar({
      texto
    }) {
      const q = String(texto || '').toLowerCase().trim();
      if (!q) return {
        resultados: []
      };
      const coincide = t => String(t || '').toLowerCase().includes(q);
      const r = posCatalog().filter(p => coincide(p.nombre) || coincide(p.imei) || coincide(p.color) || coincide(p.gb)).slice(0, 25).map(p => ({
        tipo: p.tipo,
        refId: p.refId,
        nombre: p.nombre,
        gb: p.gb || null,
        color: p.color || null,
        imei: p.imei || null,
        bateria: p.bateria ?? null,
        precioSugerido: p.sugerido || null,
        moneda: p.moneda
      }));
      return {
        encontrados: r.length,
        resultados: r
      };
    },
    resumen_del_periodo({
      desde,
      hasta
    }) {
      const d = buildDataContext(desde, hasta);
      return {
        desde,
        hasta,
        datos: d
      };
    },
    proponer_gasto(campos) {
      const datos = {
        ...campos,
        fecha: campos.fecha || contextoApp.today()
      };
      // Si el modelo propone dos veces lo mismo —pasa cuando pide la herramienta en
      // paralelo, o cuando reintenta— se muestra UNA ficha. Dos fichas iguales terminan
      // en dos gastos, y el usuario no tiene por qué darse cuenta de que eran la misma.
      const igual = contextoApp.agFichas.find(f => f.tipo === 'gasto' && f.estado === 'pendiente' && f.datos.concepto === datos.concepto && Number(f.datos.monto) === Number(datos.monto));
      if (igual) return {
        mostrada: true,
        aviso: 'Esa ficha ya está en pantalla, no se duplicó. Sigue esperando que el usuario la confirme.'
      };
      contextoApp.agFichas.push({
        tipo: 'gasto',
        datos,
        estado: 'pendiente'
      });
      return {
        mostrada: true,
        aviso: 'La ficha está en pantalla. El usuario tiene que revisarla y confirmarla; todavía no se guardó nada.'
      };
    },
    preparar_venta({
      tipo,
      refId
    }) {
      const p = posCatalog().find(x => x.tipo === tipo && String(x.refId) === String(refId));
      if (!p) return {
        error: 'No encontré ese producto. Volvé a buscarlo.'
      };
      contextoApp.agFichas.push({
        tipo: 'venta',
        datos: {
          tipo,
          refId,
          nombre: p.nombre,
          precio: p.sugerido || 0,
          moneda: p.moneda
        },
        estado: 'pendiente'
      });
      return {
        mostrada: true,
        producto: p.nombre,
        aviso: 'Le ofrecí al usuario abrir el punto de venta con ese producto cargado. La venta la cierra él.'
      };
    }
  };
  window.confirmarGastoAgente = async function (i) {
    const f = contextoApp.agFichas[i];
    if (!f || f.estado !== 'pendiente') return;
    const v = id => document.getElementById(`ag-f${i}-${id}`)?.value;
    const monto = parseFloat(v('monto'));
    if (!monto || monto <= 0) {
      showToast('Falta el monto.', true);
      return;
    }
    const moneda = v('moneda') || 'ARS';
    const tc = parseFloat(contextoApp.cfg.tc) || null;

    // El estado se marca ANTES de escribir, no después. Guardar tarda unas décimas y el
    // botón queda vivo todo ese rato: dos clicks seguidos entraban los dos, porque el
    // segundo encontraba la ficha todavía en 'pendiente'.
    f.estado = 'guardando';
    agPintar();
    agPintarFichas();
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.gastosCol, contextoApp.withUser({
        fecha: v('fecha') || contextoApp.today(),
        tipo: 'negocio',
        concepto: (v('concepto') || '').trim(),
        categoria: v('categoria') || '',
        monto,
        moneda,
        tc: moneda === 'ARS' ? tc : null,
        usd: moneda === 'USD' ? monto : tc ? Math.round(monto / tc * 100) / 100 : null,
        medio: '',
        notas: f.datos.notas || '',
        createdAt: serverTimestamp()
      }));
      f.estado = 'confirmada';
      f.datos = {
        ...f.datos,
        concepto: (v('concepto') || '').trim(),
        monto,
        moneda,
        fecha: v('fecha') || contextoApp.today()
      };
      showToast('Gasto anotado ✓');
    } catch (e) {
      // Vuelve a quedar pendiente: si falló, el usuario tiene que poder reintentar.
      f.estado = 'pendiente';
      showToast('Error al guardar: ' + e.message, true);
      setSyncDot('error');
    }
    agPintar();
    agPintarFichas();
  };
  window.abrirVentaAgente = function (i) {
    const f = contextoApp.agFichas[i];
    if (!f) return;
    f.estado = 'confirmada';
    window.addToCart(f.datos.tipo, f.datos.refId);
    window.goTo('ingresos');
    showToast('Cargado en el punto de venta ✓');
  };
  window.descartarFichaAgente = function (i) {
    if (contextoApp.agFichas[i]) contextoApp.agFichas[i].estado = 'descartada';
    agPintar();
    agPintarFichas();
  };
  window.ejemploAgente = function (t) {
    document.getElementById('ag-input').value = t;
    window.mandarAlAgente();
  };
  window.limpiarAgente = function () {
    contextoApp.agHistorial = [];
    contextoApp.agFichas = [];
    agPintar();
  };
  window.mandarAlAgente = async function () {
    const inp = document.getElementById('ag-input');
    const texto = (inp.value || '').trim();
    if (!texto) return;
    inp.value = '';
    contextoApp.agHistorial.push({
      role: 'user',
      content: texto
    });
    agPintar();
    agPintarFichas();
    const btn = document.getElementById('btn-ag-enviar');
    btn.disabled = true;
    btn.textContent = 'Pensando…';
    const chat = document.getElementById('ag-chat');
    chat.insertAdjacentHTML('beforeend', '<div id="ag-pensando" class="home-empty">Pensando…</div>');
    chat.scrollTop = chat.scrollHeight;
    try {
      // El bucle: mientras el modelo pida herramientas, se ejecutan y se le devuelve el
      // resultado. Se corta por vueltas por las dudas: un bucle infinito acá se paga.
      for (let vuelta = 0; vuelta < 6; vuelta++) {
        const r = await fetch(contextoApp.WORKER_URL, {
          method: 'POST',
          headers: await workerHeaders(),
          body: JSON.stringify({
            model: 'claude-opus-5',
            max_tokens: 8000,
            output_config: {
              effort: 'medium'
            },
            system: agSystem(),
            tools: contextoApp.AG_HERRAMIENTAS,
            messages: contextoApp.agHistorial
          })
        });
        const data = await r.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

        // El turno del modelo se guarda ENTERO, con sus bloques de razonamiento: si se
        // guardara solo el texto, la próxima vuelta perdería el hilo de lo que pensó.
        contextoApp.agHistorial.push({
          role: 'assistant',
          content: data.content
        });
        if (data.stop_reason !== 'tool_use') break;
        const usos = (data.content || []).filter(b => b.type === 'tool_use');
        const resultados = [];
        for (const u of usos) {
          let salida;
          try {
            salida = contextoApp.agEjecutar[u.name] ? contextoApp.agEjecutar[u.name](u.input || {}) : {
              error: 'no existe esa herramienta'
            };
          } catch (e) {
            salida = {
              error: e.message
            };
          }
          resultados.push({
            type: 'tool_result',
            tool_use_id: u.id,
            content: JSON.stringify(salida)
          });
        }
        // Todos los resultados van juntos en UN mensaje: partirlos hace que el modelo deje
        // de pedir herramientas en paralelo.
        contextoApp.agHistorial.push({
          role: 'user',
          content: resultados
        });
      }
    } catch (e) {
      contextoApp.agHistorial.push({
        role: 'assistant',
        content: [{
          type: 'text',
          text: '⚠️ ' + e.message
        }]
      });
    }
    document.getElementById('ag-pensando')?.remove();
    btn.disabled = false;
    btn.textContent = 'Enviar';
    agPintar();
    agPintarFichas();
  };

  // ══ Facturador: una factura suelta, sin venta detrás ═════════
  //
  // Comparte TODO con la factura de una venta: el mismo Worker, las mismas tablas de ARCA,
  // las mismas reglas de letra y alícuotas, el mismo render del resultado y el mismo PDF.
  // Lo único propio de esta pantalla es el formulario. Las reglas de negocio no se
  // duplican: el día que ARCA cambie algo, se toca en un solo lugar.
}
