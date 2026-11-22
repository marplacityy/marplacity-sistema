/** modulos/asistente: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { on } from '../../shared/seguridad.js';
import { esc, showToast } from '../core/interfaz.js';
import { posCatalog } from './pos.js';
import { catalogoCandidatos } from './catalogo.js';
import { buildDataContext, workerHeaders } from './reportes.js';
import { setSyncDot } from '../core/datos.js';
import { addDoc, serverTimestamp, writeBatch, doc, increment } from 'firebase/firestore';

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

FACTURAS DE COMPRA
Si el usuario te pasa una factura o remito (PDF o foto), leé cada renglón y cargalo con
proponer_inventario. Antes, buscá cada producto con buscar: si ya existe en el inventario
(tipo inv) y es el mismo artículo, pasá su refId para que se sume la cantidad en vez de
crear uno repetido. El costo es el unitario de la factura, no el total del renglón. Lo que
no se lea bien (cantidad, precio), dejalo vacío y avisale; no lo adivines.
Las categorías de inventario que existen son: ${(contextoApp.icats || []).join(', ')}.

PROVEEDORES
Si pregunta a quién pedirle un producto, quién lo tiene más barato o en qué lista está,
usá proveedores_de_producto: decile el proveedor más barato, a cuánto, y la diferencia
con los demás. Esos precios son los de cada lista de proveedor ya con el margen sumado,
no el costo. Si hay más de un producto que coincide (otra capacidad u otro color),
nombralos por separado.

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
  const hechos = contextoApp.agFichas.filter(f => f.estado === 'confirmada' && (f.tipo === 'gasto' || f.tipo === 'inventario'));
  if (hechos.length) c.insertAdjacentHTML('beforeend', hechos.map(f => `
    <div style="font-size:12.5px;color:#237A4B;margin:2px 0 8px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
      ${f.tipo === 'inventario' ? `✓ Cargado al inventario: ${esc(f.resumen || '')}` : `✓ Anotado: ${esc(f.datos.concepto || '')} — ${f.datos.moneda === 'USD' ? contextoApp.fmtUSD(f.datos.monto) : contextoApp.fmtARS(f.datos.monto)}`}
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
  }) => f.tipo === 'inventario' ? agFichaInventario(f, i) : f.tipo === 'gasto' ? `
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
        <button class="pos-btn-cancel" ${on('click', 'descartarFichaAgente', i)} ${f.estado === 'guardando' ? 'disabled' : ''}>✕ Descartar</button>
        <button class="pos-btn-checkout" ${on('click', 'confirmarGastoAgente', i)} ${f.estado === 'guardando' ? 'disabled' : ''}>${f.estado === 'guardando' ? 'Guardando…' : 'Anotar el gasto'}</button>
      </div>
    </div>` : `
    <div class="card" style="margin:4px 0 10px;border-color:var(--accent);">
      <div class="card-title" style="margin-bottom:6px;">Listo para cobrar</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:10px;">${esc(f.datos.nombre)} — te abro el punto de venta con esto cargado. La venta la cerrás vos con el botón de siempre.</p>
      <div class="pos-actions">
        <button class="pos-btn-cancel" ${on('click', 'descartarFichaAgente', i)}>✕ Descartar</button>
        <button class="pos-btn-checkout" ${on('click', 'abrirVentaAgente', i)}>Abrir el punto de venta</button>
      </div>
    </div>`).join(''));
  c.scrollTop = c.scrollHeight;
}
/** La ficha de una factura: un renglón por producto, todo editable antes de guardar. */
function agFichaInventario(f, i) {
  const ocupado = f.estado === 'guardando' ? 'disabled' : '';
  const inv = id => contextoApp.invItems.find(p => p.id === id);
  const filas = f.datos.items.map((it, j) => {
    const existente = it.refId ? inv(it.refId) : null;
    const cats = [...new Set([...(contextoApp.icats || []), it.categoria].filter(Boolean))];
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:6px 4px;"><input type="checkbox" id="ag-f${i}-r${j}-ok" checked></td>
      <td style="padding:6px 4px;min-width:160px;"><input type="text" id="ag-f${i}-r${j}-nombre" value="${esc(it.nombre || '')}">
        <select id="ag-f${i}-r${j}-destino" style="margin-top:4px;font-size:12px;">
          <option value="">Producto nuevo</option>
          ${existente ? `<option value="${esc(existente.id)}" selected>Sumar a: ${esc(existente.nombre)} (hay ${existente.qty || 0})</option>` : ''}
        </select></td>
      <td style="padding:6px 4px;width:70px;"><input type="number" min="0" step="1" id="ag-f${i}-r${j}-qty" value="${esc(it.cantidad ?? '')}"></td>
      <td style="padding:6px 4px;width:95px;"><input type="number" min="0" step="0.01" id="ag-f${i}-r${j}-costo" value="${esc(it.costo ?? '')}"></td>
      <td style="padding:6px 4px;min-width:110px;"><select id="ag-f${i}-r${j}-cat">${cats.map(x => `<option ${x === it.categoria ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td>
    </tr>`;
  }).join('');
  return `
    <div class="card" style="margin:4px 0 10px;border-color:var(--accent);">
      <div class="card-title" style="margin-bottom:10px;">Factura para cargar al inventario</div>
      <div class="grid3">
        <div class="field"><label>Proveedor</label><input type="text" id="ag-f${i}-proveedor" value="${esc(f.datos.proveedor || '')}"></div>
        <div class="field"><label>N° de factura</label><input type="text" id="ag-f${i}-numero" value="${esc(f.datos.numero_factura || '')}"></div>
        <div class="field"><label>Moneda de los costos</label><select id="ag-f${i}-moneda"><option value="USD" ${f.datos.moneda !== 'ARS' ? 'selected' : ''}>USD u$s</option><option value="ARS" ${f.datos.moneda === 'ARS' ? 'selected' : ''}>ARS $</option></select></div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="text-align:left;color:var(--text3);font-size:11px;"><th></th><th>Producto</th><th>Cant.</th><th>Costo unit.</th><th>Categoría</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <p style="font-size:11.5px;color:var(--text3);margin-top:8px;">Destetildá lo que no quieras cargar. "Sumar a" agrega la cantidad al producto que ya tenés; si el costo cambió, queda como precio nuevo desde hoy.</p>
      <div class="pos-actions" style="margin-top:8px;">
        <button class="pos-btn-cancel" ${on('click', 'descartarFichaAgente', i)} ${ocupado}>✕ Descartar</button>
        <button class="pos-btn-checkout" ${on('click', 'confirmarInventarioAgente', i)} ${ocupado}>${f.estado === 'guardando' ? 'Guardando…' : 'Cargar al inventario'}</button>
      </div>
    </div>`;
}

// Hasta 10 MB: una factura escaneada pesa mucho menos, y más que eso no entra en el pedido a la IA.
const AG_MAX_ADJUNTO = 10 * 1024 * 1024;
function agPintarAdjunto() {
  const el = document.getElementById('ag-adjunto');
  if (!el) return;
  const a = contextoApp.agAdjunto;
  el.style.display = a ? 'block' : 'none';
  el.innerHTML = a ? `<div class="tag" style="display:inline-flex;"><span>📎 ${esc(a.nombre)}</span><button ${on('click', 'quitarAdjuntoAgente')} title="Quitar">×</button></div>` : '';
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
  contextoApp.agAdjunto = null; // la factura que va con el próximo mensaje
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
    name: 'proveedores_de_producto',
    description: 'Qué proveedores tienen un producto en sus listas de precios y a cuánto, del más barato al más caro. Usalo cuando el usuario pregunte a quién pedirle un producto, quién lo tiene más barato o en qué lista está ("¿a quién le pido el iPhone 17 negro de 256?"). No sirve para lo que está en el local: para eso está buscar.',
    input_schema: {
      type: 'object',
      properties: {
        texto: {
          type: 'string',
          description: 'Modelo y, si se sabe, capacidad y color: "iphone 17 256 black".'
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
    name: 'proponer_inventario',
    description: 'Muestra en pantalla los productos de una factura de compra para cargarlos al inventario. NO guarda nada: el usuario revisa cada renglón y confirma. Usalo cuando te pasen una factura o remito. Antes, buscá cada producto: si ya está en el inventario (tipo inv), pasá su refId.',
    input_schema: {
      type: 'object',
      properties: {
        proveedor: {
          type: 'string',
          description: 'Quién emitió la factura.'
        },
        numero_factura: {
          type: 'string',
          description: 'El número de la factura, si se lee.'
        },
        moneda: {
          type: 'string',
          enum: ['ARS', 'USD'],
          description: 'La moneda de los precios de la factura.'
        },
        items: {
          type: 'array',
          description: 'Un elemento por renglón de la factura.',
          items: {
            type: 'object',
            properties: {
              nombre: {
                type: 'string',
                description: 'El producto, como para reconocerlo en el local: "Funda silicone iPhone 15".'
              },
              cantidad: {
                type: 'number',
                description: 'Unidades compradas.'
              },
              costo: {
                type: 'number',
                description: 'Precio UNITARIO de la factura, solo el número.'
              },
              categoria: {
                type: 'string',
                description: 'Una de las categorías de inventario existentes.'
              },
              sku: {
                type: 'string',
                description: 'Código del artículo, si figura.'
              },
              refId: {
                type: 'string',
                description: 'El refId que devolvió buscar si el producto ya está en el inventario (tipo inv). Vacío si es nuevo.'
              }
            },
            required: ['nombre']
          }
        }
      },
      required: ['items']
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
      // Todas las palabras, en cualquier orden: "funda iphone 15 silicona" encuentra
      // "Funda silicona iPhone 15".
      const palabras = q.split(/\s+/);
      const coincide = p => {
        const t = [p.nombre, p.imei, p.color, p.gb].map(x => String(x || '').toLowerCase()).join(' ');
        return palabras.every(w => t.includes(w));
      };
      const r = posCatalog().filter(coincide).slice(0, 25).map(p => ({
        tipo: p.tipo,
        refId: p.refId,
        nombre: p.nombre,
        gb: p.gb || null,
        color: p.color || null,
        imei: p.imei || null,
        bateria: p.bateria ?? null,
        precioSugerido: p.sugerido || null,
        moneda: p.moneda,
        ...(p.tipo === 'inv' ? { cantidadEnStock: p.qty } : {})
      }));
      return {
        encontrados: r.length,
        resultados: r
      };
    },
    proveedores_de_producto({
      texto
    }) {
      const palabras = String(texto || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (!palabras.length) return {
        resultados: []
      };
      // Se busca en el nombre del producto y en cómo lo escribe cada proveedor.
      const coincide = p => {
        const t = [p.nombre, p.gb, p.color, ...p._ofertas.flatMap(o => [o.producto, o.gb, o.color])].map(x => String(x || '').toLowerCase()).join(' ');
        return palabras.every(w => t.includes(w));
      };
      const r = catalogoCandidatos().filter(p => p._ofertas?.length && coincide(p)).slice(0, 25).map(p => {
        const ofertas = [...p._ofertas].sort((a, b) => (a.precioUSD || Infinity) - (b.precioUSD || Infinity));
        return {
          producto: [p.nombre, p.gb, p.color].filter(Boolean).join(' '),
          precioEnLaTiendaUSD: p.precioUSD || null,
          estaEnLaTienda: !!p._sale,
          masBarato: ofertas[0].proveedor,
          ofertas: ofertas.map(o => ({
            proveedor: o.proveedor,
            precioUSD: o.precioUSD || null
          }))
        };
      });
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
    proponer_inventario({
      proveedor,
      numero_factura,
      moneda,
      items
    }) {
      const lista = (Array.isArray(items) ? items : []).filter(it => it && String(it.nombre || '').trim()).map(it => ({
        ...it,
        // Un refId que no es del inventario se descarta: la ficha lo ofrece como producto nuevo.
        refId: it.refId && contextoApp.invItems.some(p => p.id === String(it.refId)) ? String(it.refId) : null
      }));
      if (!lista.length) return {
        error: 'No vino ningún producto. Revisá la factura.'
      };
      // Una sola ficha por factura: si la vuelve a proponer, reemplaza a la pendiente.
      contextoApp.agFichas.forEach(f => {
        if (f.tipo === 'inventario' && f.estado === 'pendiente') f.estado = 'descartada';
      });
      contextoApp.agFichas.push({
        tipo: 'inventario',
        datos: {
          proveedor: proveedor || '',
          numero_factura: numero_factura || '',
          moneda: moneda === 'ARS' ? 'ARS' : 'USD',
          items: lista
        },
        estado: 'pendiente'
      });
      return {
        mostrada: true,
        productos: lista.length,
        aviso: 'La ficha está en pantalla. El usuario tiene que revisarla y confirmarla; todavía no se cargó nada al inventario.'
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
  window.confirmarInventarioAgente = async function (i) {
    const f = contextoApp.agFichas[i];
    if (!f || f.estado !== 'pendiente') return;
    const v = id => document.getElementById(`ag-f${i}-${id}`);
    const proveedor = (v('proveedor')?.value || '').trim();
    const numero = (v('numero')?.value || '').trim();
    const moneda = v('moneda')?.value || 'USD';
    const filas = f.datos.items.map((_, j) => ({
      ok: v(`r${j}-ok`)?.checked,
      destino: v(`r${j}-destino`)?.value || '',
      nombre: (v(`r${j}-nombre`)?.value || '').trim(),
      qty: parseInt(v(`r${j}-qty`)?.value) || 0,
      costo: parseFloat(v(`r${j}-costo`)?.value) || 0,
      categoria: v(`r${j}-cat`)?.value || '',
      sku: f.datos.items[j].sku || ''
    })).filter(r => r.ok);
    if (!filas.length) {
      showToast('No hay ningún producto tildado.', true);
      return;
    }
    if (filas.some(r => !r.nombre)) {
      showToast('Hay un producto sin nombre.', true);
      return;
    }
    if (filas.some(r => r.qty <= 0)) {
      showToast('Hay un producto sin cantidad.', true);
      return;
    }
    // Igual que el gasto: se marca antes de escribir para que un doble click no cargue dos veces.
    f.estado = 'guardando';
    agPintar();
    agPintarFichas();
    setSyncDot('syncing');
    try {
      const batch = writeBatch(contextoApp.db);
      const nota = numero ? `Factura ${numero}` : 'Cargado desde una factura';
      for (const r of filas) {
        const p = r.destino ? contextoApp.invItems.find(x => x.id === r.destino) : null;
        if (p) {
          const cambios = { qty: increment(r.qty) };
          // Un costo distinto en una factura nueva es reposición: precio nuevo desde hoy,
          // las ventas pasadas conservan el anterior (igual que al editar el producto).
          if (r.costo > 0 && (r.costo !== p.costo || moneda !== (p.moneda || 'USD'))) {
            const hist = [...(p.costoHist || [])];
            if (!hist.length && p.costo != null) hist.push({ desde: '0000-01-01', costo: p.costo, moneda: p.moneda || 'USD' });
            hist.push({ desde: contextoApp.today(), costo: r.costo, moneda });
            Object.assign(cambios, { costo: r.costo, moneda, costoHist: hist });
          }
          batch.update(doc(contextoApp.db, 'inventario', p.id), cambios);
        } else {
          batch.set(doc(contextoApp.invCol), contextoApp.withUser({
            nombre: r.nombre,
            categoria: r.categoria,
            sku: r.sku,
            qty: r.qty,
            costo: r.costo,
            moneda,
            sugerido: 0,
            minimo: 3,
            proveedor,
            notas: nota,
            createdAt: serverTimestamp()
          }));
        }
      }
      await batch.commit();
      const sumados = filas.filter(r => r.destino).length;
      f.estado = 'confirmada';
      f.resumen = `${filas.length} producto(s)${sumados ? `, ${sumados} sumado(s) a los que ya había` : ''}${numero ? ` — factura ${numero}` : ''}`;
      showToast('Cargado al inventario ✓');
      setSyncDot('ok');
    } catch (e) {
      f.estado = 'pendiente';
      showToast('Error al guardar: ' + e.message, true);
      setSyncDot('error');
    }
    agPintar();
    agPintarFichas();
  };
  window.adjuntarAgente = function (input) {
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    const tipo = archivo.type === 'application/pdf' ? 'document' : /^image\/(jpeg|png|webp|gif)$/.test(archivo.type) ? 'image' : null;
    if (!tipo) {
      showToast('Mandá la factura en PDF o como foto (JPG o PNG).', true);
      return;
    }
    if (archivo.size > AG_MAX_ADJUNTO) {
      showToast('El archivo pesa más de 10 MB.', true);
      return;
    }
    const lector = new FileReader();
    lector.onload = () => {
      contextoApp.agAdjunto = {
        nombre: archivo.name,
        tipo,
        mediaType: archivo.type,
        datos: String(lector.result).split(',')[1]
      };
      agPintarAdjunto();
      const inp = document.getElementById('ag-input');
      if (!inp.value.trim()) inp.value = 'Cargá al inventario los productos de esta factura';
      inp.focus();
    };
    lector.onerror = () => showToast('No se pudo leer el archivo.', true);
    lector.readAsDataURL(archivo);
  };
  window.quitarAdjuntoAgente = function () {
    contextoApp.agAdjunto = null;
    agPintarAdjunto();
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
    contextoApp.agAdjunto = null;
    agPintarAdjunto();
    agPintar();
  };
  window.mandarAlAgente = async function () {
    const inp = document.getElementById('ag-input');
    const adjunto = contextoApp.agAdjunto;
    const texto = (inp.value || '').trim() || (adjunto ? 'Cargá al inventario los productos de esta factura' : '');
    if (!texto) return;
    inp.value = '';
    contextoApp.agAdjunto = null;
    agPintarAdjunto();
    // La factura va como bloque aparte, antes del texto; el nombre va en el texto para
    // que quede a la vista en el chat.
    contextoApp.agHistorial.push({
      role: 'user',
      content: adjunto ? [{
        type: adjunto.tipo,
        source: {
          type: 'base64',
          media_type: adjunto.mediaType,
          data: adjunto.datos
        }
      }, {
        type: 'text',
        text: `📎 ${adjunto.nombre}\n${texto}`
      }] : texto
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
            max_tokens: 16000,
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
