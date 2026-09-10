/** modulos/whatsapp: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { showToast } from '../core/interfaz.js';
import { updateDoc, doc } from 'firebase/firestore';

export
// ── WhatsApp ──────────────────────────────────────────
// Si un template guardado tiene caracteres corruptos (�), usar el default sano
function waTpl(guardado, defecto) {
  if (!guardado || guardado.includes('\uFFFD')) return defecto;
  return guardado;
}
export function waNumber(tel) {
  let d = (tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) return '549' + d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.startsWith('15')) d = d.slice(2);
  return '549' + d;
}
export function inicializarWhatsapp() {
  contextoApp.WA_DEFAULTS = {
    creado: 'Hola {cliente}! 👋 Tu orden de reparación *#{ticket}* fue creada y ya está en proceso de revisión.\n\n📱 Equipo: {equipo}\n🔧 Trabajo: {trabajo}\n🔢 IMEI: {imei}\n\nTe avisamos ante cualquier novedad. Gracias por elegirnos! — {local}',
    listo: 'Hola {cliente}! ✅ Tu equipo *{equipo}* ya está reparado y *listo para retirar*. {saldo}Horario de atención: {horario}. Te esperamos! — {local}',
    gracias: 'Gracias por confiar en {local}, {cliente}! 🙌 Te recomendamos cargar tu equipo siempre con cargador original para cuidar la reparación. Si quedaste conforme, nos ayuda muchísimo que nos dejes ⭐⭐⭐⭐⭐ en Google. Cualquier cosa, estamos acá!'
  };
  window.enviarWa = function (tipo) {
    const r = contextoApp.reps.find(x => x.id === contextoApp.repEditId);
    if (!r) return;
    if (!r.tel) {
      showToast('Este ticket no tiene teléfono cargado.', true);
      return;
    }
    const num = waNumber(r.tel);
    if (!num) {
      showToast('Teléfono inválido.', true);
      return;
    }
    const tpl = tipo === 'creado' ? waTpl(contextoApp.cfg.waCreado, contextoApp.WA_DEFAULTS.creado) : tipo === 'listo' ? waTpl(contextoApp.cfg.waListo, contextoApp.WA_DEFAULTS.listo) : waTpl(contextoApp.cfg.waGracias, contextoApp.WA_DEFAULTS.gracias);
    const saldoStr = (r.saldo || 0) > 0 ? 'Saldo a abonar: ' + (r.moneda === 'ARS' ? contextoApp.fmtARS(r.saldo) : 'u$s ' + r.saldo) + '. ' : '';
    const msg = tpl.replaceAll('{cliente}', (r.cliente || '').split(' ')[0]).replaceAll('{ticket}', String(r.num || '')).replaceAll('{equipo}', r.equipo || '').replaceAll('{imei}', r.imei || '—').replaceAll('{trabajo}', r.trabajo || '').replaceAll('{saldo}', saldoStr).replaceAll('{horario}', contextoApp.cfg.localHorario || 'consultar').replaceAll('{local}', contextoApp.cfg.localNombre || 'MarplaCity');
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
    // Dejar constancia en el historial
    const hist = [...(r.historial || []), {
      fecha: contextoApp.today(),
      texto: '📱 WhatsApp enviado: ' + (tipo === 'creado' ? 'orden creada' : tipo === 'listo' ? 'listo para retirar' : 'agradecimiento')
    }];
    updateDoc(doc(contextoApp.db, 'reparaciones', contextoApp.repEditId), {
      historial: hist
    }).catch(() => {});
  };

  // ── Reparaciones ──────────────────────────────────────
}
