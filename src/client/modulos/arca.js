import { configuracion } from '../core/config-publica.js';
/** modulos/arca: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { workerHeaders } from './reportes.js';
import { esc, showToast, escJs } from '../core/interfaz.js';
import { updateDoc, doc } from 'firebase/firestore';

export
/**
 * El freno de producción. El Worker no emite un comprobante real si el pedido no dice
 * explícitamente que sabe que lo es; acá esa confirmación la da el usuario, factura por
 * factura. Es a propósito que no sea un `true` fijo en el código: así el freno sigue
 * existiendo el día número cien y no solo el día que lo prendimos.
 */
function confirmarProduccion(que, detalle) {
  if (!contextoApp.arcaEnProduccion()) return true;
  return confirm(`⚠️ ESTÁS EN PRODUCCIÓN.\n\n${que} va a ser un comprobante FISCAL Y REAL ante ARCA.\n\n${detalle}\n\nNo se puede anular: si está mal, hay que emitir una nota de crédito.\n\n¿Emitir?`);
}

/** La FACTURA de una venta. La nota de crédito lleva el mismo ventaId, así que se
    filtra: si no, al revertir una venta el sistema mostraría la NC como si fuera la
    factura y el botón de emitir volvería a aparecer. */
export async function arcaPedir(ruta, opciones = {}) {
  const r = await fetch(contextoApp.FACTURADOR_URL + ruta, {
    ...opciones,
    headers: {
      ...(await workerHeaders()),
      ...(opciones.headers || {})
    }
  });
  const d = await r.json().catch(() => ({}));
  // Un comprobante rechazado por ARCA es una RESPUESTA, no una falla de conexión: viene
  // con 422 y con el detalle del rechazo adentro. Tratarlo como si el Worker no hubiera
  // contestado escondía justo el motivo que hay que leer.
  if (!r.ok && !d.error && !d.comprobante) throw new Error('El facturador no contestó (HTTP ' + r.status + ')');
  return d;
}

/**
 * El cartel de entorno. Es lo primero que se ve en Facturas y no un detalle escondido:
 * la diferencia entre una prueba y un comprobante fiscal real no puede depender de que
 * alguien se acuerde.
 */
/**
 * El certificado fiscal vence, y el día que vence el local deja de poder facturar sin
 * que nadie lo haya avisado. El Worker ya sabe cuántos días faltan; esto lo pone donde
 * se mira. Se consulta una vez por sesión: no cambia de un minuto al otro.
 */
export async function avisoCertificado() {
  try {
    if (!contextoApp.arcaCert) contextoApp.arcaCert = await arcaPedir('/certificado');
  } catch (e) {
    return '';
  }
  if (!contextoApp.arcaCert || !contextoApp.arcaCert.hay) return '';
  const d = contextoApp.arcaCert.diasParaVencer;
  if (d == null) return '';
  const vto = contextoApp.arcaCert.notAfter ? new Date(contextoApp.arcaCert.notAfter).toLocaleDateString('es-AR') : '';
  if (contextoApp.arcaCert.vencido) return `<div class="proveedor-alerta alerta-urgente" style="margin-bottom:12px;">
    ⛔ <b>El certificado fiscal venció</b> el ${vto}. No se puede emitir hasta que saques uno nuevo desde la clave fiscal y lo subas.</div>`;
  if (d <= 30) return `<div class="proveedor-alerta alerta-urgente" style="margin-bottom:12px;">
    ⚠️ <b>El certificado fiscal vence en ${d} día${d === 1 ? '' : 's'}</b> (${vto}). Sacá uno nuevo desde la clave fiscal antes de esa fecha: cuando venza, el sistema deja de poder facturar.</div>`;
  if (d <= 60) return `<div class="proveedor-alerta alerta-atencion" style="margin-bottom:12px;">
    🔔 El certificado fiscal vence en ${d} días (${vto}). Conviene ir renovándolo.</div>`;
  return '';
}
export async function renderArcaBanner(destino = 'arca-banner') {
  const el = document.getElementById(destino);
  if (!el) return;
  try {
    if (!contextoApp.arcaSalud) contextoApp.arcaSalud = await (await fetch(contextoApp.FACTURADOR_URL + '/salud')).json();
  } catch (e) {
    el.innerHTML = `<div class="proveedor-alerta" style="margin-bottom:12px;">🔌 No se pudo contactar al facturador. Las facturas electrónicas no están disponibles ahora.</div>`;
    return;
  }
  const prod = contextoApp.arcaSalud.entorno === 'PRODUCCION';
  el.innerHTML = `<div class="proveedor-alerta ${prod ? 'alerta-urgente' : 'alerta-atencion'}" style="margin-bottom:12px;">
    ${prod ? '🔴 <b>PRODUCCIÓN</b> — las facturas que emitas acá son fiscales y reales. No se anulan: se compensan con una nota de crédito.' : '🧪 <b>HOMOLOGACIÓN (pruebas)</b> — los comprobantes que salgan de acá <b>no tienen validez fiscal</b>. Sirven para probar.'}
  </div>`;
  // El aviso del certificado va después y por su cuenta: si el endpoint no contesta, el
  // cartel de entorno tiene que estar igual.
  el.insertAdjacentHTML('beforeend', await avisoCertificado());
}

/** Un renglón de la venta, en pesos: ARCA factura en moneda local. */
export function feaRenglones(v) {
  const tc = v.tc || parseFloat(contextoApp.cfg.tc) || null;
  return (v.items && v.items.length ? v.items : [{
    nombre: v.nombre,
    qty: 1,
    precio: v.totalARS,
    moneda: 'ARS'
  }]).map(it => {
    const precio = it.moneda === 'USD' ? tc ? it.precio * tc : null : it.precio;
    return {
      descripcion: it.nombre || '',
      cantidad: Number(it.qty || 1),
      precioUnitario: precio == null ? null : Math.round(precio),
      alicuotaIva: 21
    };
  });
}
export
/**
 * El comprobante, pintado. Es UNO solo para las dos pantallas: el modal de la venta y el
 * Facturador muestran exactamente lo mismo, y los tres estados —emitida, rechazada con
 * el motivo de ARCA, y observada pero autorizada— se leen igual en los dos lados.
 */
function htmlComprobante(c, {
  conNotaCredito = true,
  conReintento = false
} = {}) {
  contextoApp.comprobanteMostrado = c;
  const num = `${String(c.ptoVta).padStart(4, '0')}-${String(c.cbteNro).padStart(8, '0')}`;
  const vto = c.caeVto ? `${c.caeVto.slice(6, 8)}/${c.caeVto.slice(4, 6)}/${c.caeVto.slice(0, 4)}` : '—';
  const emitida = c.estado === 'emitida';
  const nombreTipo = c.esNotaCredito ? 'Nota de crédito' : 'Factura';
  return `
    <div class="proveedor-alerta ${emitida ? '' : 'alerta-urgente'}" style="margin-bottom:12px;">
      ${emitida ? `✅ <b>${nombreTipo} ${c.letra} ${num}</b> autorizada por ARCA.${c.revierte ? ` Revierte la factura ${String(c.revierte.ptoVta).padStart(4, '0')}-${String(c.revierte.cbteNro).padStart(8, '0')}.` : ''}` : `❌ <b>Rechazada</b> — no tiene CAE y no es un comprobante válido.`}
      ${c.entorno === 'homo' ? ' <span style="opacity:.8">(homologación: sin validez fiscal)</span>' : ''}
    </div>
    <div class="permuta-box">
      <div class="profit-row"><span class="profit-label">Comprobante</span><span class="profit-val">${nombreTipo} ${c.letra} ${num}</span></div>
      <div class="profit-row"><span class="profit-label">Cliente</span><span class="profit-val">${esc(c.cliente?.nombre || '')}${c.cliente?.condicion ? ` · ${esc(c.cliente.condicion)}` : ''}</span></div>
      <div class="profit-row"><span class="profit-label">Neto / IVA</span><span class="profit-val">${contextoApp.fmtARS(c.impNeto || 0)} + ${contextoApp.fmtARS(c.impIVA || 0)}</span></div>
      <div class="profit-row"><span class="profit-label" style="font-weight:700">TOTAL</span><span class="profit-val tk-b">${contextoApp.fmtARS(c.impTotal || 0)}</span></div>
      ${emitida ? `
      <div class="profit-row"><span class="profit-label" style="font-weight:700">CAE</span><span class="profit-val tk-b" style="font-family:'DM Mono',monospace;">${esc(c.cae || '')}</span></div>
      <div class="profit-row"><span class="profit-label">Vence el</span><span class="profit-val">${vto}</span></div>` : ''}
    </div>
    ${c.errores?.length ? `<div class="proveedor-alerta alerta-urgente" style="margin-top:10px;"><b>Por qué lo rechazó ARCA:</b><ul style="margin:6px 0 0 18px;">${c.errores.map(e => `<li>[${e.code}] ${esc(e.msg || '')}</li>`).join('')}</ul></div>` : ''}
    ${c.observaciones?.length ? `<div class="proveedor-alerta alerta-atencion" style="margin-top:10px;"><b>Observaciones de ARCA</b> — la factura está autorizada igual:<ul style="margin:6px 0 0 18px;">${c.observaciones.map(o => `<li>[${o.code}] ${esc(o.msg || '')}</li>`).join('')}</ul></div>` : ''}
    ${c.recuperado ? `<div style="font-size:11.5px;color:var(--text3);margin-top:8px;">Se recuperó de ARCA: la conexión se había cortado, pero el comprobante ya estaba autorizado. No se emitió dos veces.</div>` : ''}
    ${c.notaCredito ? `<div class="proveedor-alerta alerta-atencion" style="margin-top:10px;">
      ↩️ Esta factura fue revertida con la <b>nota de crédito ${String(c.notaCredito.ptoVta).padStart(4, '0')}-${String(c.notaCredito.cbteNro).padStart(8, '0')}</b>.
      La factura sigue existiendo y sigue siendo válida: lo que la deja sin efecto es la nota de crédito.
    </div>` : ''}
    ${c.manual ? `<div style="font-size:11.5px;color:var(--text3);margin-top:8px;">Emitido a mano desde el Facturador, sin una venta asociada.</div>` : ''}
    ${emitida ? `<div class="pos-actions" style="margin-top:12px;">
           ${conNotaCredito && !c.notaCredito && !c.esNotaCredito ? `<button class="pos-btn-cancel" onclick="emitirNotaCreditoArca('${escJs(c.id || '')}')">↩️ Nota de crédito</button>` : ''}
           <button class="pos-btn-checkout" onclick="pdfComprobanteArcaActual()">📄 Descargar el PDF con el QR</button>
         </div>` : conReintento ? `<div class="pos-actions" style="margin-top:12px;"><button class="pos-btn-checkout" onclick="reintentarFacturaArca()">Corregir y volver a intentar</button></div>` : ''}`;
}

/** El comprobante de una venta, adentro de su modal. */
export function feaMostrarComprobante(c) {
  document.getElementById('fea-form').style.display = 'none';
  document.getElementById('fea-entorno').innerHTML = '';
  document.getElementById('fea-resultado').innerHTML = htmlComprobante(c, {
    conReintento: true
  });
}

/**
 * El contenido del QR obligatorio (RG 4892). El formato lo define ARCA y no se inventa:
 * la URL fija, y como parametro `p` el JSON del comprobante en Base64. Los nombres de
 * los campos son los de la especificacion oficial, tal cual.
 */
export function qrDeComprobante(c) {
  const datos = {
    ver: 1,
    fecha: `${c.cbteFch.slice(0, 4)}-${c.cbteFch.slice(4, 6)}-${c.cbteFch.slice(6, 8)}`,
    cuit: Number(c.cuit),
    ptoVta: Number(c.ptoVta),
    tipoCmp: Number(c.cbteTipo),
    nroCmp: Number(c.cbteNro),
    importe: Number(c.impTotal),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: Number(c.cliente?.docTipo ?? 99),
    nroDocRec: Number(c.cliente?.docNro || 0),
    tipoCodAut: 'E',
    // E = CAE. La A es para CAEA, que no usamos.
    codAut: Number(c.cae)
  };
  return 'https://www.arca.gob.ar/fe/qr/?p=' + btoa(JSON.stringify(datos));
}

/**
 * El PDF del comprobante fiscal. No reemplaza a generarFacturaPDF, que es el remito
 * interno del local: este es el que tiene CAE y QR y vale ante ARCA.
 */
export function inicializarArca() {
  // ── Arranque: espera el estado de auth ──
  // ── Funciones invocadas desde atributos del HTML ─────────────────────────────
  // Los onclick/onchange/oninput corren en scope GLOBAL y no ven nada declarado
  // dentro de este módulo. Estas se llamaban desde el HTML sin estar expuestas:
  // tiraban ReferenceError y el control quedaba muerto sin ningún síntoma visible.
  // Si agregás un handler inline que llame a una función del módulo, sumala acá.
  // ══ Factura electrónica de ARCA ══════════════════════════════
  //
  // El sistema NO habla con ARCA: habla con el Worker facturador, que es el único que
  // tiene el certificado. Acá solo se arma el pedido y se muestra el resultado.
  contextoApp.FACTURADOR_URL = configuracion.api.facturador;
  contextoApp.arcaSalud = null; // en qué entorno está parado el facturador
  contextoApp.arcaTablas = null; // condiciones de IVA, alícuotas y tipos de documento, de ARCA
  contextoApp.feaVenta = null; // la venta que se está facturando en este momento
  /**
   * ¿El facturador está en producción? De esto depende que el comprobante sea real.
   * Ante la duda devuelve true: si no sabemos en qué entorno estamos, que pida confirmación
   * de más y no de menos.
   */
  contextoApp.arcaEnProduccion = () => (contextoApp.arcaTablas?.entorno || contextoApp.arcaSalud?.entorno || 'PRODUCCION') === 'PRODUCCION';
  contextoApp.comprobanteDe = ventaId => contextoApp.comprobantes.find(c => c.ventaId === ventaId && !c.esNotaCredito);
  contextoApp.notaCreditoDe = ventaId => contextoApp.comprobantes.find(c => c.ventaId === ventaId && c.esNotaCredito && c.estado === 'emitida');
  contextoApp.arcaCert = null;
  window.abrirFacturaArca = async function (ventaId) {
    const v = contextoApp.ingresos.find(x => x.id === ventaId);
    if (!v) return;
    contextoApp.feaVenta = v;
    const modal = document.getElementById('fea-modal');
    document.getElementById('fea-title').textContent = 'Factura electrónica' + (v.numVenta ? ' — venta #V-' + v.numVenta : '');
    document.getElementById('fea-resultado').innerHTML = '';
    document.getElementById('fea-form').style.display = '';
    modal.classList.add('open');
    const ya = contextoApp.comprobanteDe(ventaId);
    if (ya) {
      feaMostrarComprobante(ya);
      return;
    }
    document.getElementById('fea-entorno').innerHTML = '<div class="home-empty">Consultando al facturador…</div>';
    document.getElementById('fea-venta').innerHTML = '';
    try {
      if (!contextoApp.arcaTablas || !contextoApp.arcaTablas.condiciones) {
        const t = await arcaPedir('/tablas');
        if (t.error) throw new Error(t.error);
        contextoApp.arcaTablas = t;
      }
    } catch (e) {
      document.getElementById('fea-entorno').innerHTML = `<div class="proveedor-alerta alerta-urgente">No se pudieron leer las tablas de ARCA: ${esc(e.message)}</div>`;
      document.getElementById('fea-form').style.display = 'none';
      return;
    }
    const prod = (contextoApp.arcaTablas.entorno || contextoApp.arcaSalud?.entorno) === 'PRODUCCION';
    document.getElementById('fea-entorno').innerHTML = `<div class="proveedor-alerta ${prod ? 'alerta-urgente' : 'alerta-atencion'}" style="margin-bottom:12px;">
    ${prod ? '🔴 <b>PRODUCCIÓN</b> — esta factura va a ser fiscal y real.' : '🧪 <b>HOMOLOGACIÓN</b> — esta factura es de prueba, sin validez fiscal.'}
  </div>`;

    // Los selectores se llenan con las tablas vivas de ARCA, no con listas escritas acá.
    const sel = (id, filas, valor) => {
      document.getElementById(id).innerHTML = filas.map(f => `<option value="${f.id}" ${String(f.id) === String(valor) ? 'selected' : ''}>${esc(f.desc)}</option>`).join('');
    };
    const cli = contextoApp.clientesItems.find(c => c.id === v.clienteId);
    sel('fea-cond', contextoApp.arcaTablas.condiciones, cli?.condicionIvaId ?? 5);
    sel('fea-doctipo', contextoApp.arcaTablas.documentos, cli?.docTipo ?? 99);
    document.getElementById('fea-nombre').value = v.clienteNombre || 'Consumidor Final';
    document.getElementById('fea-docnro').value = cli?.docNro || '';
    const renglones = feaRenglones(v);
    document.getElementById('fea-venta').innerHTML = `
    <div class="profit-row"><span class="profit-label">Venta</span><span class="profit-val">${esc(v.nombre || '')}</span></div>
    <div class="profit-row"><span class="profit-label">Fecha</span><span class="profit-val">${v.fecha || ''}</span></div>
    <div class="profit-row"><span class="profit-label" style="font-weight:600">Total cobrado</span><span class="profit-val tk-b">${contextoApp.fmtARS(v.totalARS || 0)}${v.totalUSD ? ' / ' + contextoApp.fmtUSD(v.totalUSD) : ''}</span></div>`;
    document.getElementById('fea-items').innerHTML = renglones.map((r, i) => `
    <tr>
      <td>${esc(r.descripcion)}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;">${r.cantidad}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;">
        <input type="number" class="fea-precio" data-i="${i}" value="${r.precioUnitario ?? ''}" step="0.01" oninput="feaTotales()"
               style="width:110px;text-align:right;padding:5px 7px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-family:'DM Mono',monospace;font-size:12.5px;color:var(--text);">
      </td>
      <td>
        <select class="fea-alic" data-i="${i}" onchange="feaTotales()" style="width:100px;padding:5px 7px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12.5px;color:var(--text);">
          ${contextoApp.arcaTablas.iva.map(a => `<option value="${parseFloat(a.desc)}" ${parseFloat(a.desc) === 21 ? 'selected' : ''}>${esc(a.desc)}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('');
    window.feaPintarLetra();
    window.feaTotales();
  };

  /** La letra, calculada igual que en el Worker: leyendo la descripción de la tabla. */
  window.feaPintarLetra = function () {
    const id = Number(document.getElementById('fea-cond').value);
    const fila = (contextoApp.arcaTablas?.condiciones || []).find(f => f.id === id);
    const esRI = /responsable\s+inscripto/i.test(fila?.desc || '');
    const docTipo = Number(document.getElementById('fea-doctipo').value);
    const avisa = esRI && docTipo !== 80;
    document.getElementById('fea-letra-aviso').innerHTML = `
    <div class="proveedor-alerta ${avisa ? 'alerta-urgente' : ''}">
      Va a salir una <b>factura ${esRI ? 'A' : 'B'}</b> (${esc(fila?.desc || '—')})${avisa ? ' — pero a un Responsable Inscripto hay que facturarle con <b>CUIT</b>, y está elegido otro tipo de documento. ARCA la va a rechazar.' : '.'}
    </div>`;
  };

  /** Los mismos totales que va a calcular el Worker, para que no haya sorpresas. */
  window.feaTotales = function () {
    const precios = [...document.querySelectorAll('.fea-precio')];
    const alics = [...document.querySelectorAll('.fea-alic')];
    const filas = [...document.querySelectorAll('#fea-items tr')];
    const porAlic = new Map();
    filas.forEach((_, i) => {
      const cant = Number(filas[i].children[1].textContent.trim()) || 1;
      const precio = parseFloat(precios[i].value) || 0;
      const alic = parseFloat(alics[i].value) || 0;
      const neto = precio * cant / (1 + alic / 100);
      porAlic.set(alic, (porAlic.get(alic) || 0) + neto);
    });
    let neto = 0,
      iva = 0;
    const detalle = [...porAlic.entries()].sort((a, b) => a[0] - b[0]).map(([a, n]) => {
      const base = Math.round(n * 100) / 100,
        imp = Math.round(base * a) / 100;
      neto += base;
      iva += imp;
      return `<div class="profit-row"><span class="profit-label">IVA ${a}% sobre ${contextoApp.fmtARS(base)}</span><span class="profit-val">${contextoApp.fmtARS(imp)}</span></div>`;
    }).join('');
    neto = Math.round(neto * 100) / 100;
    iva = Math.round(iva * 100) / 100;
    document.getElementById('fea-totales').innerHTML = `
    <div class="profit-row"><span class="profit-label">Neto gravado</span><span class="profit-val">${contextoApp.fmtARS(neto)}</span></div>
    ${detalle}
    <div class="profit-row"><span class="profit-label" style="font-weight:700">TOTAL</span><span class="profit-val tk-b">${contextoApp.fmtARS(neto + iva)}</span></div>
    <div style="font-size:11px;color:var(--text3);margin-top:6px;">Los precios son finales, con IVA adentro: el neto se calcula desagregándolos.</div>`;
  };
  window.emitirFacturaArca = async function () {
    const v = contextoApp.feaVenta;
    if (!v) return;
    const btn = document.getElementById('btn-fea-emitir');
    const precios = [...document.querySelectorAll('.fea-precio')];
    const alics = [...document.querySelectorAll('.fea-alic')];
    const base = feaRenglones(v);
    const items = base.map((r, i) => ({
      ...r,
      precioUnitario: parseFloat(precios[i].value) || 0,
      alicuotaIva: parseFloat(alics[i].value) || 0
    }));
    if (items.some(i => !i.precioUnitario)) {
      showToast('Hay un renglón sin precio.', true);
      return;
    }
    const cliente = {
      nombre: document.getElementById('fea-nombre').value.trim() || 'Consumidor Final',
      condicionIvaId: Number(document.getElementById('fea-cond').value),
      docTipo: Number(document.getElementById('fea-doctipo').value),
      docNro: (document.getElementById('fea-docnro').value || '').replace(/\D/g, '') || 0
    };
    const total = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0);
    if (!confirmarProduccion('Esta factura', `Cliente: ${cliente.nombre}\nTotal: ${contextoApp.fmtARS(total)}`)) return;
    btn.disabled = true;
    btn.textContent = 'Pidiendo el CAE…';
    try {
      const r = await arcaPedir('/emitir', {
        method: 'POST',
        body: JSON.stringify({
          ptoVta: Number(contextoApp.cfg.arcaPtoVta) || 1,
          cliente,
          items,
          ventaId: v.id,
          fecha: v.fecha,
          confirmoProduccion: contextoApp.arcaEnProduccion()
        })
      });
      if (r.comprobante) {
        feaMostrarComprobante(r.comprobante);
        // Para la próxima factura de este cliente, ya queda cargado.
        if (v.clienteId) {
          updateDoc(doc(contextoApp.db, 'clientes', v.clienteId), {
            condicionIvaId: cliente.condicionIvaId,
            docTipo: cliente.docTipo,
            docNro: String(cliente.docNro)
          }).catch(() => {});
        }
        showToast(r.ok ? 'Factura emitida ✓' : 'ARCA rechazó el comprobante', !r.ok);
      } else {
        document.getElementById('fea-resultado').innerHTML = `
        <div class="proveedor-alerta alerta-urgente" style="margin-top:12px;">
          <b>No se pudo emitir.</b><br>${esc(r.error || 'error desconocido')}
          ${r.problemas?.length ? '<ul style="margin:6px 0 0 18px;">' + r.problemas.map(p => `<li>${esc(p)}</li>`).join('') + '</ul>' : ''}
          ${r.estadoDesconocido ? `<div style="margin-top:6px;">⚠️ Revisá a mano el comprobante ${r.estadoDesconocido.ptoVta}-${r.estadoDesconocido.cbteNro} antes de volver a intentar.</div>` : ''}
        </div>`;
        showToast('No se pudo emitir', true);
      }
    } catch (e) {
      document.getElementById('fea-resultado').innerHTML = `<div class="proveedor-alerta alerta-urgente" style="margin-top:12px;">${esc(e.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '🧾 Emitir y pedir el CAE';
  };

  /** El comprobante ya emitido: CAE, vencimiento, tipo y número, y lo que ARCA observó. */
  /**
   * El último comprobante que se está mostrando en pantalla, sea en el modal de una venta
   * o en el Facturador. El PDF se pide desde un onclick del HTML, que no ve el scope del
   * módulo, así que el handler lo lee de acá en vez de recibirlo por parámetro.
   */
  contextoApp.comprobanteMostrado = null;
  window.pdfComprobanteArcaActual = function () {
    const c = contextoApp.comprobanteMostrado;
    if (!c || c.estado !== 'emitida') {
      showToast('No hay un comprobante autorizado para imprimir.', true);
      return;
    }
    const {
      jsPDF
    } = window.jspdf;
    const d = new jsPDF({
      unit: 'mm',
      format: 'a4'
    });
    const pesos = n => '$ ' + Number(n || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const fecha = f => `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(0, 4)}`;
    const num = `${String(c.ptoVta).padStart(4, '0')}-${String(c.cbteNro).padStart(8, '0')}`;

    // ── Cabecera, con el recuadro de la letra en el medio, como manda el formato ──
    d.setDrawColor(0);
    d.setLineWidth(0.4);
    d.rect(10, 10, 190, 32);
    d.line(105, 10, 105, 42);
    d.rect(98, 10, 14, 14);
    d.setFontSize(22);
    d.setFont(undefined, 'bold');
    d.text(c.letra, 105, 21, {
      align: 'center'
    });
    d.setFontSize(7);
    d.setFont(undefined, 'normal');
    d.text('COD. ' + String(c.cbteTipo).padStart(2, '0'), 105, 27, {
      align: 'center'
    });
    d.setFontSize(14);
    d.setFont(undefined, 'bold');
    d.text(contextoApp.cfg.localNombre || 'MarplaCity', 14, 19);
    d.setFontSize(8);
    d.setFont(undefined, 'normal');
    let y = 25;
    if (contextoApp.cfg.localDir) {
      d.text(contextoApp.cfg.localDir, 14, y);
      y += 4;
    }
    if (contextoApp.cfg.localTel) {
      d.text('Tel: ' + contextoApp.cfg.localTel, 14, y);
      y += 4;
    }
    d.text('IVA Responsable Inscripto', 14, y);
    d.setFontSize(13);
    d.setFont(undefined, 'bold');
    d.text('FACTURA ' + c.letra, 196, 19, {
      align: 'right'
    });
    d.setFontSize(9);
    d.setFont(undefined, 'normal');
    d.text('Nro. ' + num, 196, 25, {
      align: 'right'
    });
    d.text('Fecha: ' + fecha(c.cbteFch), 196, 30, {
      align: 'right'
    });
    d.text('CUIT: ' + c.cuit, 196, 35, {
      align: 'right'
    });

    // ── Cliente ──
    d.rect(10, 45, 190, 16);
    d.setFontSize(8);
    const docTipoDesc = (contextoApp.arcaTablas?.documentos || []).find(f => f.id === Number(c.cliente?.docTipo))?.desc || 'Doc';
    d.text(`${docTipoDesc}: ${c.cliente?.docNro || '—'}`, 14, 51);
    d.text(`Nombre: ${c.cliente?.nombre || 'Consumidor Final'}`, 14, 56);
    d.text(`Condición frente al IVA: ${c.cliente?.condicion || '—'}`, 105, 51);

    // ── Renglones ──
    d.autoTable({
      startY: 65,
      head: [['Detalle', 'Cant.', 'Precio unit.', 'Subtotal']],
      body: (c.items || []).map(i => [i.descripcion || '', String(i.cantidad || 1), pesos(i.precioUnitario), pesos((i.precioUnitario || 0) * (i.cantidad || 1))]),
      theme: 'plain',
      styles: {
        fontSize: 8.5,
        cellPadding: 2.5,
        lineColor: [200, 200, 200],
        lineWidth: {
          bottom: 0.2
        }
      },
      headStyles: {
        fontStyle: 'bold',
        fillColor: [240, 240, 240]
      },
      columnStyles: {
        1: {
          halign: 'center',
          cellWidth: 18
        },
        2: {
          halign: 'right',
          cellWidth: 32
        },
        3: {
          halign: 'right',
          cellWidth: 32
        }
      },
      margin: {
        left: 10,
        right: 10
      }
    });

    // ── Totales. En la B el IVA no se discrimina al cliente, pero el neto y el total si ──
    let ty = d.lastAutoTable.finalY + 6;
    const fila = (etq, val, negrita) => {
      d.setFont(undefined, negrita ? 'bold' : 'normal');
      d.text(etq, 150, ty, {
        align: 'right'
      });
      d.text(val, 196, ty, {
        align: 'right'
      });
      ty += 5;
    };
    d.setFontSize(9);
    if (c.letra === 'A') {
      fila('Neto gravado:', pesos(c.impNeto));
      (c.iva || []).forEach(i => fila(`IVA ${i.alicuota}%:`, pesos(i.importe)));
    }
    fila('TOTAL:', pesos(c.impTotal), true);

    // ── CAE y QR: sin esto no es un comprobante ──
    const qy = Math.max(ty + 6, 235);
    const canvas = document.createElement('canvas');
    new QRious({
      element: canvas,
      value: qrDeComprobante(c),
      size: 300,
      level: 'M'
    });
    d.addImage(canvas.toDataURL('image/png'), 'PNG', 12, qy, 32, 32);
    d.setFontSize(9);
    d.setFont(undefined, 'bold');
    d.text('CAE Nº: ' + c.cae, 196, qy + 10, {
      align: 'right'
    });
    d.text('Fecha de Vto. de CAE: ' + fecha(c.caeVto), 196, qy + 16, {
      align: 'right'
    });
    d.setFontSize(7);
    d.setFont(undefined, 'normal');
    if (c.entorno === 'homo') {
      d.setTextColor(180, 0, 0);
      d.text('COMPROBANTE DE PRUEBA (HOMOLOGACIÓN) — SIN VALIDEZ FISCAL', 105, qy + 36, {
        align: 'center'
      });
      d.setTextColor(0, 0, 0);
    }
    d.save(`Factura_${c.letra}_${num}.pdf`);
  };

  /**
   * Revertir una factura. No la borra ni la edita: ARCA no anula comprobantes, los compensa
   * con otro que apunta al primero. Los dos quedan y los dos son válidos.
   */
  window.emitirNotaCreditoArca = async function (comprobanteId) {
    const c = contextoApp.comprobantes.find(x => x.id === comprobanteId);
    if (!c) return;
    const num = `${String(c.ptoVta).padStart(4, '0')}-${String(c.cbteNro).padStart(8, '0')}`;
    if (!confirm(`Emitir una nota de crédito que revierte la factura ${c.letra} ${num} por ${contextoApp.fmtARS(c.impTotal || 0)}.\n\n` + `La factura NO se borra ni se edita: ARCA no anula comprobantes. Lo que la deja sin efecto es este comprobante nuevo, que queda apuntando a ella.\n\n` + `Se emite por el total, con los mismos renglones y el mismo cliente.\n\n¿Seguimos?`)) return;
    if (!confirmarProduccion('Esta nota de crédito', `Revierte la factura ${c.letra} ${num} por ${contextoApp.fmtARS(c.impTotal || 0)}`)) return;
    const res = document.getElementById('fea-resultado');
    res.insertAdjacentHTML('beforeend', '<div class="home-empty" id="fea-nc-esperando">Emitiendo la nota de crédito…</div>');
    try {
      const r = await arcaPedir('/nota-credito', {
        method: 'POST',
        body: JSON.stringify({
          comprobanteId,
          confirmoProduccion: contextoApp.arcaEnProduccion()
        })
      });
      document.getElementById('fea-nc-esperando')?.remove();
      if (r.comprobante) {
        feaMostrarComprobante(r.comprobante);
        showToast(r.ok ? 'Nota de crédito emitida ✓' : 'ARCA rechazó la nota de crédito', !r.ok);
      } else {
        res.insertAdjacentHTML('beforeend', `<div class="proveedor-alerta alerta-urgente" style="margin-top:10px;"><b>No se pudo emitir la nota de crédito.</b><br>${esc(r.error || 'error desconocido')}</div>`);
      }
    } catch (e) {
      document.getElementById('fea-nc-esperando')?.remove();
      res.insertAdjacentHTML('beforeend', `<div class="proveedor-alerta alerta-urgente" style="margin-top:10px;">${esc(e.message)}</div>`);
    }
  };

  // ══ Catálogo web ═════════════════════════════════════════════
  //
  // Una página pública con los equipos que hay. Lo importante no es la página: es QUÉ SE
  // ESCRIBE en el documento que la alimenta.
  //
  // La regla de Firestore deja que ese doc lo lea cualquiera, sin estar logueado, porque
  // es para clientes. O sea que no hay forma de "mostrar solo algunos campos" del lado del
  // que lee: lo que esté adentro, se ve. Por eso el filtrado pasa acá, al escribir, y hay
  // una sola función que arma el producto público. Si algún día hay que sumar un dato, se
  // agrega ahí y en ningún otro lado.
  //
  // NUNCA entran: el costo (`valorUSD` en stock, `precioUSD` en consignación, que es lo
  // que se le debe al proveedor), el IMEI, el proveedor, las notas internas, ni los
  // chequeos de FMI y blacklist.

  // ══ Pedidos del catálogo web ═════════════════════════════════
  //
  // Los escribe el Worker `tienda`; acá solo se miran y se cierran. Un pedido está
  // "abierto" mientras haya alguien esperando algo: pagó o reservó y todavía no se le
  // entregó. Lo demás (creado sin pagar, rechazado, entregado, cancelado) es historial.
}
