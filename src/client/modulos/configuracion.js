/** modulos/configuracion: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { setSyncDot, deb } from '../core/datos.js';
import { setDoc, getDocs, getDoc, writeBatch } from 'firebase/firestore';
import { showToast } from '../core/interfaz.js';
import { renderListado } from './gastos.js';
import { renderIngresos } from './ingresos.js';
import { renderStock } from './stock.js';
import { renderReps } from './reparaciones.js';
import { renderInv } from './inventario.js';
import { renderPosGrid } from './pos.js';
import { renderClientes } from './clientes.js';
import { renderConsig, renderPagos } from './consignacion.js';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

export function descargarJSON(nombre, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Descarga TODO lo del usuario en un JSON. Devuelve la cantidad de registros, o null si falló.
export function inicializarConfiguracion() {
  // ── Config ──
  window.guardarConfig = async function () {
    const tc = document.getElementById('cfg-tc').value;
    const nombre = document.getElementById('cfg-nombre').value.trim();
    contextoApp.cfg = {
      ...contextoApp.cfg,
      tc,
      nombre,
      localNombre: document.getElementById('cfg-local-nombre').value.trim(),
      localDir: document.getElementById('cfg-local-dir').value.trim(),
      localTel: document.getElementById('cfg-local-tel').value.trim(),
      localWeb: document.getElementById('cfg-local-web').value.trim(),
      terms: document.getElementById('cfg-terms').value.trim(),
      termsVenta: document.getElementById('cfg-terms-venta').value.trim(),
      localHorario: document.getElementById('cfg-local-horario').value.trim(),
      waCreado: document.getElementById('cfg-wa-creado').value.trim(),
      waListo: document.getElementById('cfg-wa-listo').value.trim(),
      waGracias: document.getElementById('cfg-wa-gracias').value.trim(),
      cortVidrio: document.getElementById('cfg-cort-vidrio').value || null,
      printMode: document.getElementById('cfg-print-mode').value,
      imeiWorker: document.getElementById('cfg-imei-worker').value.trim() || null,
      arcaPtoVta: parseInt(document.getElementById('cfg-arca-ptovta').value) || null,
      cortFunda: document.getElementById('cfg-cort-funda').value || null
    };
    setSyncDot('syncing');
    try {
      await setDoc(contextoApp.cfgDoc, contextoApp.withUser({
        ...contextoApp.cfg,
        cats: contextoApp.cats,
        medios: contextoApp.medios,
        icats: contextoApp.icats
      }), {
        merge: true
      });
      showToast('Configuración guardada ✓');
    } catch (e) {
      showToast('Error al guardar', true);
      setSyncDot('error');
    }
  };

  // Fuente única de las colecciones del usuario: la usan el backup y el borrado.
  // Si agregás una colección al sistema, sumala acá o va a quedar fuera del backup.
  contextoApp.TODAS_LAS_COLS = [['gastos', contextoApp.gastosCol], ['ingresos', contextoApp.ingresosCol], ['amorts', contextoApp.amortsCol], ['stock', contextoApp.stockCol], ['consig', contextoApp.consigCol], ['pagos_consig', contextoApp.pagosCol], ['gastos_fijos', contextoApp.fijosCol], ['pagos_fijos', contextoApp.pagosFijosCol], ['reparaciones', contextoApp.repCol], ['inventario', contextoApp.invCol], ['clientes', contextoApp.clientesCol], ['cierres', contextoApp.cierresCol], ['cola_impresion', contextoApp.colaCol], ['encargues', contextoApp.encarguesCol], ['repuestos', contextoApp.repuestosCol], ['precios_repuestos', contextoApp.preciosRepCol]];
  window.exportarBackup = async function () {
    const btn = document.getElementById('btn-export');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generando…';
    }
    setSyncDot('syncing');
    try {
      const data = {
        sistema: 'MarplaCity',
        exportadoEl: new Date().toISOString(),
        uid: contextoApp.uid,
        email: contextoApp.auth.currentUser && contextoApp.auth.currentUser.email || null,
        colecciones: {}
      };
      for (const [nombre, col] of contextoApp.TODAS_LAS_COLS) {
        const snap = await getDocs(contextoApp.myQ(col));
        data.colecciones[nombre] = snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }));
      }
      const cfgSnap = await getDoc(contextoApp.cfgDoc);
      data.config = cfgSnap.exists() ? cfgSnap.data() : null;
      const total = Object.values(data.colecciones).reduce((s, a) => s + a.length, 0);
      descargarJSON(`marplacity-backup-${contextoApp.today()}.json`, data);
      showToast(`Backup descargado ✓ — ${total} registros`);
      setSyncDot('ok');
      return total;
    } catch (e) {
      console.error(e);
      showToast('Error al exportar: ' + e.message, true);
      setSyncDot('error');
      return null;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '⬇ Descargar backup (JSON)';
      }
    }
  };
  window.borrarTodo = async function () {
    const FRASE = 'BORRAR TODO';
    if (!confirm('⚠️ Esto borra TODOS tus datos: gastos, ingresos, ventas, stock, consignación, reparaciones, repuestos, clientes y cierres.\n\nPrimero se va a descargar un backup en JSON. Guardalo antes de seguir.')) return;
    const total = await window.exportarBackup();
    if (total === null && !confirm('No se pudo generar el backup.\n\n¿Borrar igual, sin respaldo?')) return;
    const escrito = prompt(`Último paso — esto no se puede deshacer.\n\nSe van a borrar ${total != null ? total + ' registros' : 'todos tus datos'}.\n\nEscribí  ${FRASE}  para confirmar:`);
    if ((escrito || '').trim().toUpperCase() !== FRASE) {
      showToast('Cancelado — no se borró nada.');
      return;
    }
    setSyncDot('syncing');
    try {
      const cols = contextoApp.TODAS_LAS_COLS.map(([, col]) => col);
      for (const col of cols) {
        const snap = await getDocs(contextoApp.myQ(col));
        if (snap.empty) continue;
        const chunks = [];
        for (let i = 0; i < snap.docs.length; i += 400) chunks.push(snap.docs.slice(i, i + 400));
        for (const chunk of chunks) {
          const batch = writeBatch(contextoApp.db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      showToast('Todos los datos borrados ✓');
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      showToast('Error al borrar: ' + e.message, true);
      setSyncDot('error');
    }
  };

  // Listeners de filtros — un solo lugar, sin riesgo de doble disparo
  ['fl-tipo', 'fl-cat', 'fl-medio', 'fl-estado'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderListado);
  });
  document.getElementById('fl-buscar').addEventListener('input', () => deb('glB', renderListado));
  ['inc-fl-cat', 'inc-fl-mes'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderIngresos);
  });
  document.getElementById('inc-fl-buscar').addEventListener('input', () => deb('incB', renderIngresos));
  document.getElementById('st-fl-estado').addEventListener('change', renderStock);
  document.getElementById('rep-fl-estado').addEventListener('change', renderReps);
  document.getElementById('rep-fl-buscar').addEventListener('input', () => deb('repB', renderReps));
  ['inv-fl-cat', 'inv-fl-stock'].forEach(i => document.getElementById(i).addEventListener('change', renderInv));
  document.getElementById('inv-fl-buscar').addEventListener('input', () => deb('invB', renderInv));
  document.getElementById('pos-buscar').addEventListener('input', () => deb('posB', renderPosGrid));
  document.getElementById('cl-buscar').addEventListener('input', () => deb('clB', renderClientes));
  document.getElementById('cl-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeClModal();
  });
  document.getElementById('inv-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeInvModal();
  });
  ['inv-fl-cat', 'inv-fl-stock'].forEach(i => document.getElementById(i).addEventListener('change', renderInv));
  document.getElementById('rep-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeRepModal();
  });
  document.getElementById('rep-edit-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeRepEditModal();
  });
  document.getElementById('cr-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeCR();
  });
  document.getElementById('tkh-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeTkH();
  });
  document.getElementById('fkh-modal').addEventListener('click', function (e) {
    if (e.target === this) window.closeFkH();
  });
  document.getElementById('pl-modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('open');
  });
  document.getElementById('cc-modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('open');
  });
  document.getElementById('ic-modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('open');
  });
  ['cp-fl-proveedor', 'cp-fl-estado-stock'].forEach(id => document.getElementById(id).addEventListener('change', renderConsig));
  document.getElementById('cp-fl-buscar').addEventListener('input', () => deb('cpB', renderConsig));
  document.getElementById('inc-fl-desde').addEventListener('change', renderIngresos);
  document.getElementById('inc-fl-desde').addEventListener('input', () => deb('inc', renderIngresos));
  document.getElementById('inc-fl-hasta').addEventListener('change', renderIngresos);
  document.getElementById('inc-fl-hasta').addEventListener('input', () => deb('inc', renderIngresos));
  document.getElementById('pago-fl-proveedor').addEventListener('change', renderPagos);
  ['fl-desde', 'fl-hasta'].forEach(id => document.getElementById(id).addEventListener('change', window.onGastosRangeChange));
  document.getElementById('st-fl-buscar').addEventListener('input', () => deb('stB', renderStock));

  // ── Auth ──────────────────────────────────────────────
  window.doLogin = async function () {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    const err = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    err.classList.remove('show');
    if (!email || !pass) {
      err.textContent = 'Completá email y contraseña.';
      err.classList.add('show');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      await signInWithEmailAndPassword(contextoApp.auth, email, pass);
    } catch (e) {
      const msgs = {
        'auth/invalid-email': 'Email inválido.',
        'auth/user-not-found': 'No existe ese usuario.',
        'auth/wrong-password': 'Contraseña incorrecta.',
        'auth/invalid-credential': 'Email o contraseña incorrectos.',
        'auth/too-many-requests': 'Demasiados intentos. Esperá un rato.'
      };
      err.textContent = msgs[e.code] || e.message;
      err.classList.add('show');
    }
    btn.disabled = false;
    btn.textContent = 'Entrar';
  };
  window.doLogout = async function () {
    if (!confirm('¿Cerrar sesión?')) return;
    await signOut(contextoApp.auth);
    location.reload();
  };

  // ── Migración: adoptar datos viejos sin userId ──
  window.migrarDatos = async function () {
    if (!contextoApp.uid) {
      showToast('Iniciá sesión primero.', true);
      return;
    }
    if (!confirm('Esto asigna todos los datos existentes que no tengan dueño a tu usuario. Ejecutalo UNA sola vez. ¿Continuar?')) return;
    const btn = document.getElementById('btn-migrar');
    btn.disabled = true;
    btn.textContent = 'Migrando...';
    setSyncDot('syncing');
    let total = 0;
    try {
      const cols = [contextoApp.gastosCol, contextoApp.ingresosCol, contextoApp.amortsCol, contextoApp.stockCol, contextoApp.consigCol, contextoApp.pagosCol, contextoApp.fijosCol, contextoApp.pagosFijosCol];
      for (const col of cols) {
        const snap = await getDocs(col); // sin filtro: trae todo
        const huerfanos = snap.docs.filter(d => !d.data().userId);
        for (let i = 0; i < huerfanos.length; i += 400) {
          const chunk = huerfanos.slice(i, i + 400);
          const batch = writeBatch(contextoApp.db);
          chunk.forEach(d => batch.update(d.ref, {
            userId: contextoApp.uid
          }));
          await batch.commit();
          total += chunk.length;
        }
      }
      showToast(`${total} registros migrados ✓`);
      setSyncDot('ok');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      console.error(e);
      showToast('Error al migrar: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = 'Migrar datos existentes';
  };

  // ── Bandeja del bot de Instagram ─────────────────────────
  //
  // Las conversaciones que el bot no pudo cerrar solo. El orden es el del trabajo: la
  // prioridad primero (1 = pidió una foto, 8 = el bot no supo qué contestar) y dentro de
  // cada nivel la más vieja arriba, que es la que hace más rato que está esperando.
  //
  // Nada sale de acá sin aprobar. El DM lo manda el Worker de ig-bot, no el navegador:
  // el token de Instagram no puede vivir en un HTML público.
}
