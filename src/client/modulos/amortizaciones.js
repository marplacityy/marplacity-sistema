/** modulos/amortizaciones: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { on } from '../../shared/seguridad.js';
import { showToast, esc } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { addDoc, deleteDoc, doc } from 'firebase/firestore';

export function renderAmort() {
  if (!contextoApp.amorts.length) {
    document.getElementById('amort-list').innerHTML = '<div class="empty">Sin bienes registrados.</div>';
    return;
  }
  const now = new Date();
  document.getElementById('amort-list').innerHTML = contextoApp.amorts.map(a => {
    const aniosUso = (now - new Date(a.fecha)) / (1000 * 60 * 60 * 24 * 365.25);
    const amortMensual = a.valor / a.vidaAnios / 12;
    const valorResidual = Math.max(0, a.valor - a.valor / a.vidaAnios * aniosUso);
    const pct = Math.min(100, Math.round(aniosUso / a.vidaAnios * 100));
    return `<div class="amort-item">
      <div class="amort-info">
        <div class="amort-nombre">${esc(a.nombre)}</div>
        <div class="amort-meta">${a.fecha} · ${a.vidaAnios} años · ${pct}% depreciado${a.notas ? ' · ' + esc(a.notas) : ''}</div>
        <div style="margin-top:6px;height:4px;background:var(--bg);border-radius:2px;overflow:hidden;"><div style="height:4px;width:${pct}%;background:${pct >= 100 ? 'var(--neg)' : '#378ADD'};border-radius:2px;"></div></div>
      </div>
      <div class="amort-right">
        <div class="amort-val">u$s ${Math.round(valorResidual).toLocaleString('es-AR')}</div>
        <div class="amort-yr">u$s ${Math.round(amortMensual)}/mes</div>
      </div>
      <button class="ei-btn del" ${on('click', 'eliminarAmort', a.id)} style="font-size:18px;">×</button>
    </div>`;
  }).join('');
}
export function inicializarAmortizaciones() {
  // ── Amortizaciones ──
  window.guardarAmort = async function () {
    const nombre = document.getElementById('am-nombre').value.trim();
    const valor = parseFloat(document.getElementById('am-valor').value);
    if (!nombre) {
      showToast('Completá el nombre.', true);
      return;
    }
    if (!valor || valor <= 0) {
      showToast('Completá el valor.', true);
      return;
    }
    setSyncDot('syncing');
    try {
      await addDoc(contextoApp.amortsCol, contextoApp.withUser({
        nombre,
        valor,
        fecha: document.getElementById('am-fecha').value || contextoApp.today(),
        vidaAnios: parseInt(document.getElementById('am-vida').value) || 5,
        notas: document.getElementById('am-notas').value.trim()
      }));
      showToast('Bien agregado ✓');
      document.getElementById('am-nombre').value = '';
      document.getElementById('am-valor').value = '';
      document.getElementById('am-notas').value = '';
      document.getElementById('am-fecha').value = contextoApp.today();
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
  };
  window.eliminarAmort = async function (id) {
    if (!confirm('¿Eliminar este bien?')) return;
    setSyncDot('syncing');
    try {
      await deleteDoc(doc(contextoApp.db, 'amorts', id));
    } catch (e) {
      showToast('Error al eliminar', true);
      setSyncDot('error');
    }
  };

  // ── Config ──
}
