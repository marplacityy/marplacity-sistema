/** modulos/imei: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { showToast, esc } from '../core/interfaz.js';
import { workerHeaders } from './reportes.js';
import { updateDoc, doc } from 'firebase/firestore';

export function textoDe(d) {
  // la respuesta puede venir como string HTML o como objeto
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (typeof d === 'object') {
    if (typeof d.response === 'string') return d.response;
    if (d.object && typeof d.object === 'object') return JSON.stringify(d.object);
    return JSON.stringify(d);
  }
  return String(d);
}
export function mostrarResultadoCheck(imei, resultados) {
  let html = '';
  const extraido = {
    modelo: null,
    color: null,
    gb: null
  };
  let fmi = null,
    black = null;
  resultados.forEach(({
    sid,
    ok,
    data
  }) => {
    const nombre = contextoApp.IC_SERVICIOS[sid] ? contextoApp.IC_SERVICIOS[sid].n : 'Servicio ' + sid;
    if (!ok) {
      html += `<div class="proveedor-alerta alerta-urgente" style="margin-bottom:8px;">${esc(nombre)}: ${esc(data.error || data.response || 'sin respuesta')}</div>`;
      return;
    }
    const obj = data.object && typeof data.object === 'object' ? data.object : null;
    const txt = textoDe(data);
    const limpio = txt.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

    // extraer datos útiles
    const buscar = re => {
      const m = limpio.match(re);
      return m ? m[1].trim() : null;
    };
    if (obj) {
      extraido.modelo = extraido.modelo || obj.model || obj.modelName || obj.marketingName || obj.deviceName || null;
      extraido.color = extraido.color || obj.color || obj.colour || null;
      extraido.gb = extraido.gb || obj.capacity || obj.storage || obj.memory || null;
      if (obj.fmiON != null) fmi = String(obj.fmiON);
      if (obj.fmi != null) fmi = String(obj.fmi);
      if (obj.blacklistStatus != null) black = String(obj.blacklistStatus);
      if (obj.blockliststatus != null) black = String(obj.blockliststatus);
    }
    extraido.modelo = extraido.modelo || buscar(/(?:Model Name|Model|Device)\s*[:\-]\s*(.+)/i);
    extraido.color = extraido.color || buscar(/(?:Colou?r)\s*[:\-]\s*(.+)/i);
    extraido.gb = extraido.gb || buscar(/(?:Capacity|Storage|Memory)\s*[:\-]\s*(.+)/i);
    if (fmi === null) {
      const m = limpio.match(/(?:Find My iPhone|FMI|iCloud (?:Lock|Status))\s*[:\-]\s*(\w+)/i);
      if (m) fmi = m[1];
    }
    if (black === null) {
      const m = limpio.match(/(?:Blacklist|Blocklist|Black List)[^:\-]*[:\-]\s*(\w+)/i);
      if (m) black = m[1];
    }
    html += `<div class="card" style="margin-bottom:8px;padding:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:6px;">${esc(nombre)}</div>
      <div style="font-size:13px;white-space:pre-wrap;line-height:1.5;">${esc(limpio).slice(0, 900) || '—'}</div>
    </div>`;
  });

  // semáforo arriba
  let semaforo = '';
  if (fmi !== null) {
    const on = /on|yes|lock|true|1/i.test(fmi) && !/off|no|clean|false/i.test(fmi);
    semaforo += on ? '<div class="proveedor-alerta alerta-urgente">🔒 <b>FMI / iCloud: ON</b> — el equipo está bloqueado a una cuenta. Ojo antes de tomarlo.</div>' : '<div class="proveedor-alerta" style="background:#EAF5EE;color:#237A4B;">🔓 <b>FMI / iCloud: OFF</b> — libre de cuenta.</div>';
  }
  if (black !== null) {
    const malo = /yes|blocked|listed|barred|true|1/i.test(black) && !/no|clean|false/i.test(black);
    semaforo += malo ? '<div class="proveedor-alerta alerta-urgente">🚨 <b>BLACKLIST: reportado</b> — no lo tomes.</div>' : '<div class="proveedor-alerta" style="background:#EAF5EE;color:#237A4B;">✅ <b>Blacklist: limpio</b></div>';
  }
  document.getElementById('ic-body').innerHTML = semaforo + html;
  guardarEstadoCheck(contextoApp.icTargetField, fmi, black);

  // botón para autocompletar el formulario
  const hayDatos = extraido.modelo || extraido.color || extraido.gb;
  document.getElementById('ic-actions').innerHTML = hayDatos ? `<button class="btn-secondary" onclick="document.getElementById('ic-modal').classList.remove('open')">Cerrar</button>
       <button class="btn-save" onclick='aplicarDatosCheck(${JSON.stringify(extraido).replace(/'/g, "&#39;")})'>✓ Completar formulario</button>` : `<button class="btn-secondary" onclick="document.getElementById('ic-modal').classList.remove('open')">Cerrar</button>`;
}

// Guarda el resultado del check en el equipo del stock (para que salga en la etiqueta)
export async function guardarEstadoCheck(fieldId, fmi, black) {
  if (fmi === null && black === null) return;
  // solo aplica cuando el check se hizo desde la ficha de un equipo del stock
  if (fieldId !== 'sm-imei' || !contextoApp.stockEditingId) return;
  const upd = {};
  if (fmi !== null) upd.fmi = /off|no|clean|false/i.test(fmi) ? 'OFF' : 'ON';
  if (black !== null) upd.blacklist = /no|clean|whitelist|false/i.test(black) ? 'LIMPIO' : 'REPORTADO';
  upd.fechaCheck = contextoApp.today();
  try {
    await updateDoc(doc(contextoApp.db, 'stock', contextoApp.stockEditingId), upd);
  } catch (e) {
    console.warn('no se pudo guardar el check', e);
  }
}
export function inicializarImei() {
  // ── Chequeo de IMEI (iFreeiCloud vía Worker) ──────────
  contextoApp.IC_SERVICIOS = {
    0: {
      n: 'Modelo (gratis)',
      precio: 0,
      campos: ['modelo']
    },
    81: {
      n: 'Modelo + Color + Capacidad',
      precio: 0.02,
      campos: ['modelo', 'color', 'gb']
    },
    4: {
      n: 'iCloud / FMI On-Off',
      precio: 0.01,
      campos: ['fmi']
    },
    55: {
      n: 'Blacklist',
      precio: 0.02,
      campos: ['blacklist']
    }
  };
  contextoApp.icTargetField = null;
  window.checkImei = function (fieldId) {
    const inp = document.getElementById(fieldId);
    if (!inp) return;
    const imei = (inp.value || '').trim();
    if (!imei) {
      showToast('Escribí el IMEI o serial primero.', true);
      return;
    }
    if (!contextoApp.cfg.imeiWorker) {
      showToast('Configurá la URL del Worker de chequeo en Configuración.', true);
      return;
    }
    contextoApp.icTargetField = fieldId;
    document.getElementById('ic-title').textContent = '🔍 ' + imei;
    document.getElementById('ic-body').innerHTML = `
    <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">¿Qué querés consultar?</p>
    <div style="display:grid;gap:8px;">
      <button class="btn-secondary" style="text-align:left;" onclick="correrCheck('${esc(imei)}',[0])">🆓 Solo modelo — <b>gratis</b></button>
      <button class="btn-secondary" style="text-align:left;" onclick="correrCheck('${esc(imei)}',[81])">📱 Modelo + color + capacidad — u$s 0,02</button>
      <button class="btn-secondary" style="text-align:left;" onclick="correrCheck('${esc(imei)}',[4])">🔒 iCloud / FMI on-off — u$s 0,01</button>
      <button class="btn-secondary" style="text-align:left;" onclick="correrCheck('${esc(imei)}',[55])">🚨 Blacklist — u$s 0,02</button>
      <button class="btn-save" style="text-align:left;" onclick="correrCheck('${esc(imei)}',[81,4,55])">⚡ CHECK COMPLETO (todo) — u$s 0,05</button>
    </div>`;
    document.getElementById('ic-actions').innerHTML = '';
    document.getElementById('ic-modal').classList.add('open');
  };
  window.correrCheck = async function (imei, servicios) {
    const body = document.getElementById('ic-body');
    body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text2);">⏳ Consultando...</div>';
    document.getElementById('ic-actions').innerHTML = '';
    const resultados = [];
    try {
      for (const sid of servicios) {
        const r = await fetch(contextoApp.cfg.imeiWorker, {
          method: 'POST',
          headers: await workerHeaders(),
          body: JSON.stringify({
            imei,
            service: sid
          })
        });
        const d = await r.json();
        resultados.push({
          sid,
          ok: r.ok && d.success !== false,
          data: d
        });
      }
      mostrarResultadoCheck(imei, resultados);
    } catch (e) {
      body.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`;
    }
  };
  window.aplicarDatosCheck = function (d) {
    // mapea el campo de IMEI al resto de campos de ese formulario
    const mapa = {
      'r-imei': {
        modelo: 'r-equipo'
      },
      'red-imei': {
        modelo: 'red-equipo'
      },
      'st-imei': {
        modelo: 'st-nombre',
        color: 'st-color',
        gb: 'st-gb'
      },
      'sm-imei': {
        modelo: 'sm-nombre',
        color: 'sm-color',
        gb: 'sm-gb'
      },
      'cp-imei': {
        modelo: 'cp-producto',
        color: 'cp-color',
        gb: 'cp-gb'
      },
      'im-imei': {
        modelo: 'im-nombre2'
      },
      'inc-imei': {
        modelo: 'inc-nombre'
      },
      'pos-permuta-imei': {
        modelo: 'pos-permuta-nombre',
        color: 'pos-permuta-color',
        gb: 'pos-permuta-gb'
      },
      'inc-permuta-imei': {
        modelo: 'inc-permuta-nombre'
      },
      'im-permuta-imei': {
        modelo: 'im-permuta-nombre'
      }
    };
    const m = mapa[contextoApp.icTargetField] || {};
    let puestos = 0;
    Object.entries(m).forEach(([k, destino]) => {
      const el = document.getElementById(destino);
      if (el && d[k]) {
        el.value = d[k];
        puestos++;
      }
    });
    document.getElementById('ic-modal').classList.remove('open');
    showToast(puestos ? `${puestos} campo(s) completado(s) ✓` : 'No había campos para completar en este formulario');
  };

  // ── Repuestos (OEM pull) ──────────────────────────────
}
