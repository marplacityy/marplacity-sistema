/** Script autónomo de etiquetas y facturas. Se sirve como archivo para permitir una CSP sin scripts inline. */
window.addEventListener('load', () => {
  if (window.JsBarcode) document.querySelectorAll('svg[data-bc]').forEach(el => {
    try { window.JsBarcode(el, el.getAttribute('data-bc'), { format: 'CODE128', displayValue: false, margin: 0, height: 34, width: 1.4 }); }
    catch { /* Un código inválido no debe impedir imprimir el resto. */ }
  });
  if (window.QRious) document.querySelectorAll('canvas[data-qr]').forEach(el => {
    try { new window.QRious({ element: el, value: el.getAttribute('data-qr'), size: 160, level: 'M' }); }
    catch { /* Conservar los datos legibles aunque no se pueda dibujar el QR. */ }
  });
  setTimeout(() => window.print(), 450);
});
