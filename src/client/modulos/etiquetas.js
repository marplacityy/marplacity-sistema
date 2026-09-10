import imprimirDocumentoUrl from '../core/imprimir-documento.js?url&no-inline';
import codigoBarrasUrl from 'jsbarcode/dist/JsBarcode.all.min.js?url';
import codigoQrUrl from 'qrious/dist/qrious.min.js?url';
/** modulos/etiquetas: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { showToast, esc } from '../core/interfaz.js';

export
// ── Etiquetas Brother QL-800 (62 x 100 mm) ────────────
function labelDoc(inner) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <script defer src="${new URL(codigoBarrasUrl, location.href).href}"><\/script>
  <script defer src="${new URL(codigoQrUrl, location.href).href}"><\/script>
  <style>
    @page{size:100mm 62mm;margin:0;}
    html,body{margin:0;padding:0;background:#fff;}
    body{width:100mm;height:62mm;box-sizing:border-box;padding:2mm 3mm 2.5mm 3mm;
         font-family:Arial,Helvetica,sans-serif;color:#000;font-size:9pt;line-height:1.25;
         display:flex;flex-direction:column;}
    *{color:#000!important;}
    .lb-top{display:flex;justify-content:space-between;align-items:flex-start;gap:3mm;}
    .lb-meta{font-size:7.5pt;line-height:1.25;}
    .lb-marca{font-size:11pt;font-weight:700;letter-spacing:.5px;}
    .lb-bc{text-align:right;}
    .lb-bc svg{height:8mm;}
    .lb-imei{font-size:7.5pt;font-family:'Courier New',monospace;text-align:right;margin-top:.5mm;}
    /* Banda muerta: la impresora imprime mal esta franja, va vacía a propósito */
    .lb-gap{height:7mm;}
    .lb-titulo{border:1.2pt solid #000;border-bottom:none;text-align:center;font-size:10.5pt;
               font-weight:700;padding:1.2mm 1mm;}
    .lb-specs{display:flex;border:1.2pt solid #000;}
    .lb-specs div{flex:1;text-align:center;padding:.9mm .5mm;font-size:8.5pt;border-right:1pt solid #000;}
    .lb-specs div:last-child{border-right:none;}
    .lb-estado{display:flex;border:1.2pt solid #000;border-top:none;}
    .lb-estado div{flex:1;padding:.9mm .5mm;font-size:8.5pt;border-right:1pt solid #000;text-align:center;}
    .lb-estado div:last-child{border-right:none;}
    .lb-ok{font-weight:700;}
    .lb-bad{font-weight:700;text-decoration:underline;}
    .lb-pie{display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto;gap:2mm;}
    .lb-notas{font-size:7.5pt;flex:1;overflow:hidden;}
    .lb-precio{font-size:14pt;font-weight:700;}
    .lb-qr{width:14mm;height:14mm;}
  </style></head><body>${inner}
  <script defer src="${new URL(imprimirDocumentoUrl, location.href).href}"><\/script></body></html>`;
}
export function abrirLabel(html) {
  const w = window.open('', '_blank', 'width=520,height=380');
  if (!w) {
    showToast('El navegador bloqueó la ventana. Permití pop-ups.', true);
    return;
  }
  const url = URL.createObjectURL(new Blob([labelDoc(html)], { type: 'text/html;charset=utf-8' }));
  w.location.replace(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Etiqueta 62x100 de EQUIPO ──
// Compartida por stock y consignación: mismo diseño, solo cambia la línea de
// origen (PROPIO / PERMUTA / CONSIGNACIÓN) y de dónde salen los campos.
// Consignación no tiene chequeo de FMI ni blacklist: van como '—'.
export function etiquetaEquipo(s, origen) {
  const local = contextoApp.cfg.localNombre || 'MarplaCity';
  const imei = (s.imei || '').trim();
  const bat = s.bateria != null ? s.bateria + '%' + (s.ciclos != null ? ` · ${s.ciclos} cic` : '') : '—';
  const fmi = s.fmi != null ? String(s.fmi) : null;
  const bl = s.blacklist != null ? String(s.blacklist) : null;
  // El valor guardado es el canónico del sistema ('OFF'/'ON', 'LIMPIO'/'REPORTADO'),
  // pero puede venir crudo de la API de chequeo ('clean', 'no', 'blocked'…). Hay que
  // contemplar los dos: el regex de valores crudos NO matchea 'LIMPIO', y por eso un
  // equipo limpio salía impreso como REPORTADO.
  // Ante un valor desconocido se imprime el estado malo: en una etiqueta que mira un
  // cliente, errar hacia REPORTADO es recuperable; errar hacia LIMPIO no.
  const fmiTxt = fmi === null ? 'FMI: —' : /^off$/i.test(fmi.trim()) || /\b(off|no|clean|false)\b/i.test(fmi) ? '<span class="lb-ok">FMI: OFF</span>' : '<span class="lb-bad">FMI: ON</span>';
  const blTxt = bl === null ? 'BL: —' : /^limpio$/i.test(bl.trim()) || /\b(no|clean|whitelist|false)\b/i.test(bl) ? '<span class="lb-ok">BL: LIMPIO</span>' : '<span class="lb-bad">BL: REPORTADO</span>';
  // IMPORTANTE: la etiqueta muestra el PRECIO DE VENTA, nunca el costo.
  // En consignación eso es doblemente importante: `precio` es lo que se le debe
  // al proveedor y no puede terminar impreso en una etiqueta que ve el cliente.
  // El precio de venta puede haber quedado sin convertir a USD (se carga en ARS
  // sin TC y la conversión da null), así que antes de imprimir vacío se cae al
  // `precioVenta` en su propia moneda. NUNCA se usa `precio`/`precioUSD`: en
  // consignación eso es lo que se le debe al proveedor.
  const precio = s.precioVentaUSD ? 'u$s ' + Math.round(s.precioVentaUSD) : s.precioVenta ? s.moneda === 'ARS' ? contextoApp.fmtARS(s.precioVenta) : 'u$s ' + Math.round(s.precioVenta) : '';
  // stock usa `nombre`, consignación usa `producto`
  const titulo = [s.nombre || s.producto, s.gb, s.color].filter(Boolean).join(' · ');
  abrirLabel(`
    <div class="lb-top">
      <div class="lb-meta">
        <div class="lb-marca">${esc(local.toUpperCase())}</div>
        <div>${s.fechaEntrada || contextoApp.today()}</div>
        <div>${esc(origen)}${s.estadoProducto ? ' · ' + esc(s.estadoProducto) : ''}</div>
      </div>
      <div class="lb-bc">
        ${imei ? `<svg data-bc="${esc(imei)}"></svg><div class="lb-imei">IMEI: ${esc(imei)}</div>` : '<div class="lb-imei">SIN IMEI</div>'}
      </div>
    </div>
    <div class="lb-gap"></div>
    <div class="lb-titulo">${esc(titulo || 'Equipo')}</div>
    <div class="lb-specs">
      <div>${esc(s.gb || '—')}</div>
      <div>${esc(s.color || '—')}</div>
      <div>🔋 ${esc(bat)}</div>
    </div>
    <div class="lb-estado">
      <div>${fmiTxt}</div>
      <div>${blTxt}</div>
      <div>${esc(s.cosmetica || s.estadoProducto || '—')}</div>
    </div>
    <div class="lb-pie">
      <div class="lb-notas">${s.notas ? 'NOTAS: ' + esc(String(s.notas).slice(0, 110)) : ''}</div>
      <div class="lb-precio">${precio}</div>
      ${imei ? `<canvas class="lb-qr" data-qr="${esc(imei)}"></canvas>` : ''}
    </div>`);
}
export function inicializarEtiquetas() {
  window.labelEquipo = function (id) {
    const s = contextoApp.stockItems.find(x => x.id === id);
    if (!s) return;
    etiquetaEquipo(s, s.tipo === 'permuta' ? 'PERMUTA' : 'PROPIO');
  };
  window.labelConsig = function (id) {
    const g = contextoApp.consigItems.find(x => x.id === id);
    if (!g) return;
    etiquetaEquipo(g, 'CONSIGNACIÓN');
  };

  // ── Etiqueta de REPARACIÓN ──
  // Los onclick del HTML corren en scope global y NO ven las variables del módulo
  // (como repEditId), por eso el botón tiene que llamar a un wrapper global.
  window.labelReparacionActual = function () {
    if (!contextoApp.repEditId) {
      showToast('Abrí la reparación primero.', true);
      return;
    }
    window.labelReparacion(contextoApp.repEditId);
  };
  window.labelReparacion = function (id) {
    const r = contextoApp.reps.find(x => x.id === id);
    if (!r) return;
    const local = contextoApp.cfg.localNombre || 'MarplaCity';
    const imei = (r.imei || '').trim();
    const money = v => r.moneda === 'ARS' ? contextoApp.fmtARS(v) : 'u$s ' + v;
    const saldo = (r.saldo || 0) > 0 ? money(r.saldo) : 'PAGADO';
    const est = contextoApp.estInfo(r.estado);
    abrirLabel(`
    <div class="lb-top">
      <div class="lb-meta">
        <div class="lb-marca">${esc(local.toUpperCase())}</div>
        <div style="font-size:15pt;font-weight:700;">#${r.num}</div>
        <div>${r.fecha || contextoApp.today()}</div>
      </div>
      <div class="lb-bc">
        ${imei ? `<svg data-bc="${esc(imei)}"></svg><div class="lb-imei">IMEI: ${esc(imei)}</div>` : `<svg data-bc="${r.num}"></svg><div class="lb-imei">TICKET ${r.num}</div>`}
      </div>
    </div>
    <div class="lb-gap"></div>
    <div class="lb-titulo">${esc(r.equipo || 'Equipo')}</div>
    <div class="lb-specs">
      <div style="flex:2;text-align:left;padding-left:2mm;">${esc(r.cliente || '—')}</div>
      <div>${esc(r.tel || '—')}</div>
    </div>
    <div class="lb-estado">
      <div style="flex:3;text-align:left;padding-left:2mm;">🔧 ${esc(String(r.trabajo || '').slice(0, 60))}</div>
      <div>${esc(est.label)}</div>
    </div>
    <div class="lb-pie">
      <div class="lb-notas">${r.garantia ? 'GARANTÍA: ' + esc(r.garantia) : ''}${r.obs ? (r.garantia ? ' · ' : '') + esc(String(r.obs).slice(0, 70)) : ''}</div>
      <div class="lb-precio">${saldo}</div>
      <canvas class="lb-qr" data-qr="${esc('#' + r.num + (imei ? ' ' + imei : ''))}"></canvas>
    </div>`);
  };

  // ── Chequeo de IMEI (iFreeiCloud vía Worker) ──────────
}
