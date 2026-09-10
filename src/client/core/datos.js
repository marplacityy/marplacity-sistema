/** core/datos: lógica preservada de la aplicación original. */
import { contextoApp } from './estado.js';
import { query, where, onSnapshot, getDocs, setDoc, collection, doc, getDoc } from 'firebase/firestore';
import { showToast, updateConceptosDL, renderCatTags, populateCatSelects, renderMedioTags, populateMedioSelects } from './interfaz.js';
import { buildMonthChips, refreshDropdowns, renderListado } from '../modulos/gastos.js';
import { renderReporte } from '../modulos/reportes.js';
import { renderIngresos } from '../modulos/ingresos.js';
import { renderHome } from '../modulos/inicio.js';
import { renderPosGrid } from '../modulos/pos.js';
import { renderReps } from '../modulos/reparaciones.js';
import { renderCaja } from '../modulos/caja.js';
import { renderRepInv, renderPreciosRef } from '../modulos/repuestos.js';
import { populateRepuestoSelects } from '../modulos/costos.js';
import { renderEncargues } from '../modulos/encargues.js';
import { renderInv, renderICatTags, populateICatSelects } from '../modulos/inventario.js';
import { renderCatalogo, pintarBadgePedidos, renderPedidos } from '../modulos/catalogo.js';
import { renderFijos } from '../modulos/gastos-fijos.js';
import { renderConsig, renderPagos } from '../modulos/consignacion.js';
import { renderStock } from '../modulos/stock.js';
import { renderAmort } from '../modulos/amortizaciones.js';
import { msDe, renderBandeja } from '../modulos/instagram.js';
import { renderConocimiento, pintarConocimiento, pintarPromptBot } from '../modulos/conocimiento.js';
import { waTpl } from '../modulos/whatsapp.js';

export function applySnap(name, snap) {
  const t = performance.now();
  const m = contextoApp._stores[name] || (contextoApp._stores[name] = new Map());
  let changed = false,
    nCh = 0;
  snap.docChanges().forEach(ch => {
    changed = true;
    nCh++;
    if (ch.type === 'removed') m.delete(ch.doc.id);else m.set(ch.doc.id, {
      id: ch.doc.id,
      ...ch.doc.data()
    });
  });
  const s = contextoApp._perf.snaps[name] || (contextoApp._perf.snaps[name] = {
    veces: 0,
    docs: 0,
    ms: 0,
    fromCache: 0
  });
  s.veces++;
  s.docs += nCh;
  s.ms += performance.now() - t;
  if (snap.metadata && snap.metadata.fromCache) s.fromCache++;
  return changed ? [...m.values()] : null;
}
export
// ── Presets de fecha (Hoy / Semana / Mes / Mes anterior) ──
function fechasPreset(k) {
  const now = new Date();
  const iso = d => {
    const x = new Date(d);
    x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    return x.toISOString().split('T')[0];
  };
  const hoy = iso(now);
  if (k === 'hoy') return {
    d: hoy,
    h: hoy
  };
  if (k === 'semana') {
    const lunes = new Date(now);
    const dow = (now.getDay() + 6) % 7;
    lunes.setDate(now.getDate() - dow);
    return {
      d: iso(lunes),
      h: hoy
    };
  }
  if (k === 'mes') return {
    d: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    h: hoy
  };
  if (k === 'mesant') {
    const y = now.getFullYear(),
      m = now.getMonth();
    return {
      d: iso(new Date(y, m - 1, 1)),
      h: iso(new Date(y, m, 0))
    };
  }
  return {
    d: '',
    h: ''
  };
}

// ── Instrumentación de performance ──
export function medir(name, fn) {
  const t = performance.now();
  fn();
  const ms = performance.now() - t;
  const r = contextoApp._perf.renders[name] || (contextoApp._perf.renders[name] = {
    n: 0,
    total: 0,
    max: 0
  });
  r.n++;
  r.total += ms;
  if (ms > r.max) r.max = ms;
}

// Debounce: colapsa ráfagas de renders cuando llegan snapshots en cascada
export function deb(name, fn) {
  clearTimeout(contextoApp._rdeb[name]);
  contextoApp._rdeb[name] = setTimeout(() => medir(name, fn), 150);
}

// Aviso claro si Firestore rechaza lecturas (cuota diaria agotada)
export function snapErr(e) {
  console.error('Firestore error:', e);
  setSyncDot('error');
  if (e && e.code === 'resource-exhausted' && !contextoApp.quotaAvisado) {
    contextoApp.quotaAvisado = true;
    alert('⚠️ Se alcanzó el límite diario gratuito de lecturas de Firebase.\n\nTus datos están intactos — vuelven a estar disponibles después de las ~4-5 AM (hora AR), cuando Google resetea la cuota.\n\nEl caché local ya está activado para que esto no se repita.');
  }
}

// ── Multi-tenancy ──
export function calcVentanaDesde(meses) {
  if (!meses) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  d.setDate(1);
  return contextoApp.isoLocal(d);
}
export function textoVentana() {
  return contextoApp.ventanaDesde ? `Datos desde ${contextoApp.ventanaDesde}` : 'Histórico completo';
}
// Aviso visible: sin esto, los totales de un período viejo saldrían incompletos
// sin que nada lo indique, que es peor que salir lentos.
export function avisoVentana() {
  return contextoApp.ventanaDesde ? `<div class="empty" style="padding:.5rem;">📅 ${textoVentana()} — lo anterior no está cargado. Ampliá el rango en Configuración.</div>` : '';
}
// Suscribe acotando por fecha. Si falta el índice compuesto en Firebase, cae a
// la consulta sin acotar en vez de dejar la pantalla vacía.
export function subVentana(col, cb) {
  const q = contextoApp.ventanaDesde ? query(col, where('userId', '==', contextoApp.uid), where('fecha', '>=', contextoApp.ventanaDesde)) : contextoApp.myQ(col);
  return onSnapshot(q, cb, err => {
    if (err && err.code === 'failed-precondition' && contextoApp.ventanaDesde) {
      console.warn('Falta el índice compuesto en Firestore; cargando sin acotar.', err);
      showToast('Falta un índice en Firebase — se carga todo el histórico.', true);
      contextoApp.unsubVentana.push(onSnapshot(contextoApp.myQ(col), cb, snapErr));
    } else snapErr(err);
  });
}

// Los tres listeners acotados. Se re-arman enteros cuando cambia la ventana.
export function attachListenersVentana() {
  contextoApp.unsubVentana.push(subVentana(contextoApp.gastosCol, snap => {
    const _g = applySnap('gastos', snap);
    if (_g) {
      contextoApp.gastos = _g;
      contextoApp.gastos.sort((a, b) => {
        const fd = (b.fecha || '').localeCompare(a.fecha || '');
        if (fd !== 0) return fd;
        const at = (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        return at;
      });
    }
    updateConceptosDL();
    buildMonthChips();
    if (contextoApp.currentPage === 'listado') {
      refreshDropdowns();
      renderListado();
    }
    if (contextoApp.currentPage === 'reportes') renderReporte();
    setSyncDot('ok');
  }));
  contextoApp.unsubVentana.push(subVentana(contextoApp.ingresosCol, snap => {
    const _i = applySnap('ingresos', snap);
    if (_i) {
      contextoApp.ingresos = _i;
      contextoApp.ingresos.sort((a, b) => {
        const fd = (b.fecha || '').localeCompare(a.fecha || '');
        if (fd !== 0) return fd;
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      });
    }
    if (contextoApp.currentPage === 'facturas') deb('inc', renderIngresos);
    if (contextoApp.currentPage === 'home') deb('home', renderHome);
    if (contextoApp.currentPage === 'ingresos') {
      deb('grid', renderPosGrid);
    }
    if (contextoApp.currentPage === 'reportes') renderReporte();
    setSyncDot('ok');
  }));
  contextoApp.unsubVentana.push(subVentana(contextoApp.repCol, snap => {
    const _r = applySnap('reps', snap);
    if (_r) {
      contextoApp.reps = _r;
      contextoApp.reps.sort((a, b) => (b.num || 0) - (a.num || 0));
    }
    if (contextoApp.currentPage === 'rep') deb('reps', renderReps);
    if (contextoApp.currentPage === 'home') deb('home', renderHome);
    setSyncDot('ok');
  }));
  contextoApp.unsubVentana.push(subVentana(contextoApp.cierresCol, snap => {
    contextoApp.cierresItems = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
    contextoApp.cierresItems.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    if (contextoApp.currentPage === 'caja') deb('caja', renderCaja);
    setSyncDot('ok');
  }));
}

// Un documento sin `fecha` (o con fecha '') queda FUERA de cualquier consulta por
// rango, así que sería invisible mientras la ventana esté activa. Avisamos en vez
// de dejar que desaparezca en silencio.
export async function verificarFechasVacias() {
  if (!contextoApp.ventanaDesde) return;
  try {
    const snap = await getDocs(query(contextoApp.ingresosCol, where('userId', '==', contextoApp.uid), where('fecha', '==', '')));
    if (!snap.empty) {
      console.warn(`${snap.size} ingresos sin fecha quedan fuera de la ventana de datos.`);
      showToast(`⚠️ Hay ${snap.size} ingresos sin fecha que no se ven con el rango acotado. Poné "Todo el histórico" en Configuración.`, true);
    }
  } catch (e) {
    console.warn('No se pudo verificar fechas vacías', e);
  }
}
export
// ── Sync dot ──
function setSyncDot(s) {
  const d = document.getElementById('sync-dot');
  d.className = 'sync-dot ' + s;
}

// ── Init (corre despues del login) ──
export async function init() {
  try {
    setSyncDot('syncing');
    const cfgSnap = await getDoc(contextoApp.cfgDoc);
    if (cfgSnap.exists()) {
      const d = cfgSnap.data();
      if (d.cats) contextoApp.cats = d.cats;
      if (d.medios) contextoApp.medios = d.medios;
      if (d.ventanaMeses !== undefined) contextoApp.ventanaMeses = d.ventanaMeses || null;
    } else {
      await setDoc(contextoApp.cfgDoc, contextoApp.withUser({
        tc: '1410',
        nombre: 'Mi negocio',
        cats: contextoApp.cats,
        medios: contextoApp.medios,
        icats: contextoApp.icats
      }));
    }
    contextoApp.ventanaDesde = calcVentanaDesde(contextoApp.ventanaMeses); // antes de enganchar los listeners

    if (contextoApp.listenersReady) {
      document.getElementById('loading').classList.add('hidden');
      return;
    }
    contextoApp.listenersReady = true;
    attachListenersVentana(); // gastos, ingresos y cierres: acotados por fecha
    verificarFechasVacias(); // avisa si hay registros viejos sin fecha
    onSnapshot(contextoApp.myQ(contextoApp.repuestosCol), snap => {
      contextoApp.repuestosItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      if (contextoApp.currentPage === 'repuestos') deb('rp', renderRepInv);
      if (contextoApp.currentPage === 'rep') populateRepuestoSelects(); // el selector de la orden ofrece estas piezas
      if (contextoApp.currentPage === 'home') deb('home', renderHome);
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.preciosRepCol), snap => {
      contextoApp.preciosRepItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      if (contextoApp.currentPage === 'repuestos') {
        deb('rpp', renderPreciosRef);
        deb('rp', renderRepInv);
      }
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.encarguesCol), snap => {
      contextoApp.encarguesItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      contextoApp.encarguesItems.sort((a, b) => (b.fechaEncargue || '').localeCompare(a.fechaEncargue || ''));
      if (contextoApp.currentPage === 'encargues') deb('enc', renderEncargues);
      if (contextoApp.currentPage === 'home') deb('home', renderHome);
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.comprobantesCol), snap => {
      const _cp = applySnap('comprobantes', snap);
      if (_cp) {
        contextoApp.comprobantes = _cp;
        contextoApp.comprobantes.sort((a, b) => (b.emitidoEn || '').localeCompare(a.emitidoEn || ''));
      }
      if (contextoApp.currentPage === 'facturas') deb('inc', renderIngresos);
      setSyncDot('ok');
    }, snapErr);
    // clientes: no se trae al arrancar. Se suscribe al entrar a la pantalla (ver goTo).
    onSnapshot(contextoApp.myQ(contextoApp.invCol), snap => {
      contextoApp.invItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      contextoApp.invItems.sort((a, b) => contextoApp.COLL.compare(a.nombre || '', b.nombre || ''));
      if (contextoApp.currentPage === 'inv') deb('inv', renderInv);
      if (contextoApp.currentPage === 'catalogo') deb('catalogo', renderCatalogo);
      setSyncDot('ok');
    }, snapErr);
    // reparaciones: acotada por fecha, ver attachListenersVentana().
    onSnapshot(contextoApp.myQ(contextoApp.fijosCol), snap => {
      contextoApp.fijosItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      contextoApp.fijosItems.sort((a, b) => contextoApp.COLL.compare(a.nombre || '', b.nombre || ''));
      if (contextoApp.currentPage === 'fijos') deb('gf', renderFijos);
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.pagosFijosCol), snap => {
      contextoApp.pagosFijosItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      if (contextoApp.currentPage === 'fijos') deb('gf', renderFijos);
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.consigCol), snap => {
      contextoApp.consigItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      contextoApp.consigItems.sort((a, b) => (b.fechaEntrada || '').localeCompare(a.fechaEntrada || ''));
      if (contextoApp.currentPage === 'consig') renderConsig();
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.pagosCol), snap => {
      contextoApp.pagosItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      contextoApp.pagosItems.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
      if (contextoApp.currentPage === 'consig') renderPagos();
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.stockCol), snap => {
      contextoApp.stockItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      contextoApp.stockItems.sort((a, b) => (b.fechaEntrada || '').localeCompare(a.fechaEntrada || ''));
      if (contextoApp.currentPage === 'stock') renderStock();
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.amortsCol), snap => {
      contextoApp.amorts = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      if (contextoApp.currentPage === 'amort') renderAmort();
    });
    onSnapshot(contextoApp.myQ(contextoApp.listasCol), snap => {
      contextoApp.listasItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      // Desempate por createdAt: `fecha` es solo el día, y desde que las listas se
      // actualizan sumando productos hay varios guardados por día. Sin esto, cuál queda
      // como "la última" lo decide el orden en que Firestore devolvió los docs.
      contextoApp.listasItems.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || msDe(b.createdAt) - msDe(a.createdAt));
      if (contextoApp.currentPage === 'conocimiento') deb('kb', renderConocimiento);
      if (contextoApp.currentPage === 'catalogo') deb('catalogo', renderCatalogo);
      setSyncDot('ok');
    }, snapErr);
    // El tablero del bot necesita TODAS las conversaciones, no solo las que piden
    // atención: también las que van a pasar, las indecisas y las dormidas. Se acota por
    // fecha, como gastos e ingresos, o el arranque se trae el historial entero y agota
    // la cuota de lecturas cuando se acumulan meses de clientes.
    onSnapshot(query(contextoApp.convsCol, where('userId', '==', contextoApp.uid), where('ultimoMensajeCliente', '>=', contextoApp.desdeConvs())), snap => {
      const _b = applySnap('bandeja', snap);
      if (_b) contextoApp.convsItems = _b;
      if (contextoApp.currentPage === 'bandeja') deb('bd', renderBandeja);
      setSyncDot('ok');
    }, snapErr);
    // El interruptor del bot. Sin doc = encendido, que es el estado inicial.
    onSnapshot(contextoApp.botDoc, snap => {
      const d = snap.exists() ? snap.data() : {};
      contextoApp.botCfg = {
        activo: d.activo !== false,
        modo: d.modo === 'prueba' ? 'prueba' : 'todos',
        cuentasPrueba: Array.isArray(d.cuentasPrueba) ? d.cuentasPrueba.map(String) : []
      };
      if (contextoApp.currentPage === 'bandeja') deb('bd', renderBandeja);
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.mensajesDoc, snap => {
      contextoApp.mensajesFijos = snap.exists() ? snap.data() : {};
      if (contextoApp.currentPage === 'conocimiento') pintarConocimiento();
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.conocDoc, snap => {
      contextoApp.conoc = snap.exists() ? snap.data() : {};
      if (contextoApp.currentPage === 'conocimiento') pintarConocimiento();
    }, snapErr);
    onSnapshot(contextoApp.fotosDoc, snap => {
      const d = snap.exists() ? snap.data() : null;
      contextoApp.FOTOS = d?.mapa || {};
      contextoApp.FOTOS_CLAS = d?.clasificacion || {};
      // Se guarda la URL completa: el bot necesita una dirección absoluta para mandarla
      // por Instagram, y la página del catálogo funciona igual con las dos.
      contextoApp.FOTOS_BASE = d?.base || 'fotos/';
      if (contextoApp.currentPage === 'catalogo') renderCatalogo();
    }, snapErr);
    onSnapshot(contextoApp.catalogoDoc, snap => {
      contextoApp.catPublicado = snap.exists() ? snap.data() : null;
      if (contextoApp.currentPage === 'catalogo') renderCatalogo();
    }, snapErr);
    onSnapshot(contextoApp.myQ(contextoApp.pedidosCol), snap => {
      contextoApp.pedidosItems = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      contextoApp.pedidosItems.sort((a, b) => String(b.creado || '').localeCompare(String(a.creado || '')));
      pintarBadgePedidos();
      if (contextoApp.currentPage === 'pedidos') deb('pedidos', renderPedidos);
      setSyncDot('ok');
    }, snapErr);
    onSnapshot(contextoApp.promptDoc, snap => {
      contextoApp.promptBot = snap.exists() ? snap.data() : {};
      if (contextoApp.currentPage === 'conocimiento') pintarPromptBot();
    }, snapErr);
    onSnapshot(contextoApp.cfgDoc, snap => {
      if (snap.exists()) {
        const d = snap.data();
        contextoApp.cfg = d;
        if (d.cats) {
          contextoApp.cats = d.cats;
          renderCatTags();
          populateCatSelects();
        }
        if (d.medios) {
          contextoApp.medios = d.medios;
          renderMedioTags();
          populateMedioSelects();
        }
        if (d.icats) {
          contextoApp.icats = d.icats;
          renderICatTags();
          populateICatSelects();
        }
        if (d.tc) {
          document.getElementById('tc').value = d.tc;
          document.getElementById('cfg-tc').value = d.tc;
        }
        if (d.nombre) document.getElementById('cfg-nombre').value = d.nombre;
        document.getElementById('cfg-local-nombre').value = d.localNombre || '';
        document.getElementById('cfg-local-dir').value = d.localDir || '';
        document.getElementById('cfg-local-tel').value = d.localTel || '';
        document.getElementById('cfg-local-web').value = d.localWeb || '';
        document.getElementById('cfg-terms').value = d.terms || contextoApp.TERMS_DEFAULT;
        document.getElementById('cfg-terms-venta').value = d.termsVenta || contextoApp.TERMS_VENTA_DEFAULT;
        document.getElementById('cfg-local-horario').value = d.localHorario || '';
        document.getElementById('cfg-wa-creado').value = waTpl(d.waCreado, contextoApp.WA_DEFAULTS.creado);
        document.getElementById('cfg-wa-listo').value = waTpl(d.waListo, contextoApp.WA_DEFAULTS.listo);
        document.getElementById('cfg-wa-gracias').value = waTpl(d.waGracias, contextoApp.WA_DEFAULTS.gracias);
        document.getElementById('cfg-cort-vidrio').value = d.cortVidrio || '';
        document.getElementById('cfg-print-mode').value = d.printMode || 'pantalla';
        document.getElementById('cfg-imei-worker').value = d.imeiWorker || '';
        document.getElementById('cfg-arca-ptovta').value = d.arcaPtoVta || '';
        document.getElementById('cfg-ventana').value = String(d.ventanaMeses ?? 12);
        document.getElementById('cfg-ventana-info').textContent = textoVentana();
        document.getElementById('cfg-cort-funda').value = d.cortFunda || '';
      }
    });
    populateCatSelects();
    populateMedioSelects();
    renderCatTags();
    renderMedioTags();
    renderICatTags();
    populateICatSelects();
    document.getElementById('loading').classList.add('hidden');
    setSyncDot('ok');
  } catch (e) {
    console.error(e);
    setSyncDot('error');
    document.getElementById('loading').classList.add('hidden');
    showToast('Error conectando con Firebase', true);
  }
}

// ── Helpers ──
// Fecha LOCAL (no UTC): evita que después de las 21:00 (AR) las operaciones se fechen "mañana"
export function inicializarDatos() {
  // Snapshots incrementales: mantiene un Map por colección y aplica solo los cambios,
  // en vez de re-deserializar miles de documentos ante cada update
  contextoApp._stores = {};
  contextoApp.COLL = new Intl.Collator('es');
  contextoApp._perf = {
    renders: {},
    snaps: {},
    cacheOk: null,
    t0: Date.now()
  };
  contextoApp._rdeb = {};
  contextoApp.quotaAvisado = false;
  contextoApp.currentUser = null;
  contextoApp.uid = null; // Inyecta userId en todo lo que se escribe
  contextoApp.withUser = obj => ({
    ...obj,
    userId: contextoApp.uid
  }); // Query filtrada por usuario
  contextoApp.myQ = col => query(col, where('userId', '==', contextoApp.uid)); // ── Ventana de datos ─────────────────────────────────────────────────────
  // Sin esto el sistema se trae TODOS los documentos de cada colección en cada
  // arranque, para siempre: es lo que agota la cuota diaria de lecturas cuando
  // se acumulan años. Solo se acotan las colecciones históricas de alto volumen
  // (gastos, ingresos, cierres, reparaciones). NO se acotan consignación/pagos (el
  // FIFO de deuda necesita el historial completo), ni las de estado actual.
  //
  // Reparaciones se acotó el 07/09/2026: la importación de RepairDesk trajo 8.000
  // tickets desde 2019 que se leían enteros en cada arranque, y era lo que se pagaba
  // como "App Engine" en la factura de Google. El correlativo del ticket ya no sale
  // del array: vive en cfg.repUltimoNum (ver nextRepNum).
  //
  // Clientes (9.000 docs, casi todos de esa importación) no se trae al arrancar: se
  // carga una sola vez por sesión, recién cuando una pantalla la necesita (Clientes,
  // Facturas, Reparaciones, POS) o al escribir un nombre (ver cargarClientes).
  // ventanaMeses = 0/null → sin límite.
  contextoApp.ventanaMeses = 12;
  contextoApp.ventanaDesde = null;
  contextoApp.unsubVentana = [];
  window.setVentanaDatos = async function (meses) {
    const m = parseInt(meses);
    contextoApp.ventanaMeses = isNaN(m) || m <= 0 ? null : m;
    contextoApp.ventanaDesde = calcVentanaDesde(contextoApp.ventanaMeses);
    // Cortar los listeners viejos y limpiar los Map incrementales: al angostar la
    // ventana el listener nuevo no emite 'removed' de lo que quedó afuera, así que
    // sin esto los documentos viejos sobrevivirían en memoria.
    contextoApp.unsubVentana.forEach(u => {
      try {
        u();
      } catch (e) {}
    });
    contextoApp.unsubVentana = [];
    delete contextoApp._stores.gastos;
    delete contextoApp._stores.ingresos;
    delete contextoApp._stores.reps;
    contextoApp.gastos = [];
    contextoApp.ingresos = [];
    contextoApp.cierresItems = [];
    contextoApp.reps = [];
    setSyncDot('syncing');
    attachListenersVentana();
    const info = document.getElementById('cfg-ventana-info');
    if (info) info.textContent = textoVentana();
    try {
      await setDoc(contextoApp.cfgDoc, {
        ventanaMeses: contextoApp.ventanaMeses || 0
      }, {
        merge: true
      });
    } catch (e) {
      console.warn(e);
    }
    showToast(contextoApp.ventanaDesde ? `Cargando desde ${contextoApp.ventanaDesde} ✓` : 'Cargando histórico completo ✓');
  };
  contextoApp.gastosCol = collection(contextoApp.db, 'gastos');
  contextoApp.ingresosCol = collection(contextoApp.db, 'ingresos');
  contextoApp.stockCol = collection(contextoApp.db, 'stock');
  contextoApp.consigCol = collection(contextoApp.db, 'consig');
  contextoApp.pagosCol = collection(contextoApp.db, 'pagos_consig');
  contextoApp.fijosCol = collection(contextoApp.db, 'gastos_fijos');
  contextoApp.repCol = collection(contextoApp.db, 'reparaciones');
  contextoApp.invCol = collection(contextoApp.db, 'inventario');
  contextoApp.clientesCol = collection(contextoApp.db, 'clientes'); // Comprobantes fiscales con CAE. Los escribe el Worker facturador; acá solo se leen:
  // una factura autorizada no se edita ni se borra, se compensa con una nota de crédito.
  contextoApp.comprobantesCol = collection(contextoApp.db, 'comprobantes');
  contextoApp.cierresCol = collection(contextoApp.db, 'cierres');
  contextoApp.colaCol = collection(contextoApp.db, 'cola_impresion');
  contextoApp.encarguesCol = collection(contextoApp.db, 'encargues');
  contextoApp.repuestosCol = collection(contextoApp.db, 'repuestos');
  contextoApp.preciosRepCol = collection(contextoApp.db, 'precios_repuestos');
  contextoApp.pagosFijosCol = collection(contextoApp.db, 'pagos_fijos');
  contextoApp.amortsCol = collection(contextoApp.db, 'amorts');
  contextoApp.listasCol = collection(contextoApp.db, 'listas_precios');
  contextoApp.convsCol = collection(contextoApp.db, 'conversaciones'); // DMs de Instagram, un doc por cliente
  contextoApp.pedidosCol = collection(contextoApp.db, 'pedidos'); // compras del catálogo web (las escribe el Worker tienda)
  contextoApp.botDoc = doc(contextoApp.db, 'config', 'bot'); // el interruptor del bot de IG
  contextoApp.mensajesDoc = doc(contextoApp.db, 'config', 'mensajes'); // mensajes que el bot manda textuales
  contextoApp.promptDoc = doc(contextoApp.db, 'config', 'prompt'); // las reglas del bot, editables desde acá
  contextoApp.cfgDoc = null; // se setea al loguear: doc(db,'config',uid)
  contextoApp.conocDoc = null; // idem: doc(db,'conocimiento',uid)
  // ── State ──
  contextoApp.gastos = [];
  contextoApp.amorts = [];
  contextoApp.cfg = {
    tc: '1410',
    nombre: 'Mi negocio'
  };
  contextoApp.cats = ['Sueldos', 'Impuestos', 'Servicios', 'Alquiler', 'Seguros', 'Software / Sistemas', 'Honorarios', 'Logística / Depósito', 'Expensas', 'Salud', 'Suscripciones', 'Sueldos adicionales', 'Extraordinarios / Pérdidas', 'Otros'];
  contextoApp.medios = ['Efectivo', 'Brubank Junior', 'Brubank Mika', 'Mercury Debit', 'Mercado Pago', 'Transferencia', 'Déb. Automático', 'Otro'];
  contextoApp.tipoActual = 'negocio';
  contextoApp.ingresos = [];
  contextoApp.incMediosActuales = []; // [{medio, valor, moneda}]
  contextoApp.stockItems = [];
  contextoApp.consigItems = [];
  contextoApp.pagosItems = [];
  contextoApp.fijosItems = [];
  contextoApp.reps = [];
  contextoApp.invItems = [];
  contextoApp.clientesItems = [];
  contextoApp.cierresItems = [];
  contextoApp.encarguesItems = [];
  contextoApp.repuestosItems = [];
  contextoApp.preciosRepItems = [];
  contextoApp.listasItems = []; // listas_precios: una lista de precios al público por doc
  contextoApp.comprobantes = []; // comprobantes/{...}: facturas fiscales con CAE
  contextoApp.conoc = {}; // conocimiento/{uid}: datos del local para el bot de IG
  contextoApp.promptBot = {}; // config/prompt: las reglas del bot, si el dueño las reescribió
  contextoApp.convsItems = []; // conversaciones que necesitan atención (la bandeja del bot)
  contextoApp.pedidosItems = []; // pedidos del catálogo web, del más nuevo al más viejo
  contextoApp.pedidosFiltro = 'abiertos';
  contextoApp.botCfg = {
    activo: true,
    modo: 'todos',
    cuentasPrueba: []
  }; // config/bot: el interruptor
  contextoApp.mensajesFijos = {}; // config/mensajes: lo que el bot manda textual, sin pasar por la IA
  contextoApp.icats = ['Accesorios', 'Repuestos', 'Fundas', 'Vidrios', 'Cargadores', 'Cables', 'Insumos', 'Otros'];
  contextoApp.repTab = 'activas';
  contextoApp.pagosFijosItems = [];
  contextoApp.gfTipoActual = 'negocio';
  contextoApp.gfTabActual = 'negocio';
  contextoApp.currentPeriod = 'hoy';
  contextoApp.currentPage = 'cargar';
  contextoApp.activeMonth = ''; // '' = todos
  contextoApp.modalMode = null; // 'edit' | 'new'
  contextoApp.editingId = null;
  contextoApp.modalTipo = 'negocio'; // ── Seed data ──
  contextoApp.SEED_GASTOS = [{
    "fecha": "2026-04-07",
    "tipo": "negocio",
    "concepto": "Alquiler local",
    "categoria": "Alquiler",
    "monto": 850,
    "moneda": "USD",
    "tc": null,
    "usd": 850,
    "medio": "Efectivo",
    "notas": "850 USD/mes, paga Monica entre el 1 y 10"
  }, {
    "fecha": "2026-04-01",
    "tipo": "negocio",
    "concepto": "Luz",
    "categoria": "Servicios",
    "monto": 120831,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": "Cuenta EDEA 73-372400"
  }, {
    "fecha": "2026-04-19",
    "tipo": "negocio",
    "concepto": "Agua",
    "categoria": "Servicios",
    "monto": 231405.5,
    "moneda": "ARS",
    "tc": 1410,
    "usd": 164.12,
    "medio": "Brubank Junior",
    "notas": "Cuenta OSSE 7356/004"
  }, {
    "fecha": "2026-04-06",
    "tipo": "negocio",
    "concepto": "Seguro Sancor",
    "categoria": "Seguros",
    "monto": 51640,
    "moneda": "ARS",
    "tc": 1400,
    "usd": 36.89,
    "medio": "Brubank Junior",
    "notas": ""
  }, {
    "fecha": "2025-07-28",
    "tipo": "negocio",
    "concepto": "Sistema de gestión",
    "categoria": "Software / Sistemas",
    "monto": 907.2,
    "moneda": "USD",
    "tc": null,
    "usd": 907.2,
    "medio": "Mercury Debit",
    "notas": "RepairDesk, pago anual. Próx. facturación 21 jul 2026"
  }, {
    "fecha": "2026-04-17",
    "tipo": "negocio",
    "concepto": "Honorarios contador",
    "categoria": "Honorarios",
    "monto": 238600,
    "moneda": "ARS",
    "tc": 1410,
    "usd": 169.22,
    "medio": "Brubank Mika",
    "notas": "Alias: yamila.contable.mp"
  }, {
    "fecha": "2026-04-01",
    "tipo": "negocio",
    "concepto": "IVA",
    "categoria": "Impuestos",
    "monto": 251897.12,
    "moneda": "ARS",
    "tc": 1405,
    "usd": 179.29,
    "medio": "Brubank Junior",
    "notas": "VEP enviado por contador"
  }, {
    "fecha": "2026-04-17",
    "tipo": "negocio",
    "concepto": "Sonetel LLC",
    "categoria": "Software / Sistemas",
    "monto": 1.99,
    "moneda": "USD",
    "tc": null,
    "usd": 1.99,
    "medio": "Déb. Automático",
    "notas": "Débito automático tarjeta"
  }, {
    "fecha": "2026-04-17",
    "tipo": "negocio",
    "concepto": "Stable LLC",
    "categoria": "Software / Sistemas",
    "monto": 29.5,
    "moneda": "USD",
    "tc": null,
    "usd": 29.5,
    "medio": "Déb. Automático",
    "notas": "Débito automático tarjeta"
  }, {
    "fecha": "2026-03-18",
    "tipo": "negocio",
    "concepto": "Contador LLC",
    "categoria": "Honorarios",
    "monto": 155,
    "moneda": "USD",
    "tc": null,
    "usd": 155,
    "medio": "",
    "notas": "Federal income return 2026 + sales tax"
  }, {
    "fecha": "2026-04-01",
    "tipo": "negocio",
    "concepto": "Sueldo Juani",
    "categoria": "Sueldos",
    "monto": 1500000,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-04-01",
    "tipo": "negocio",
    "concepto": "Sueldo Mika",
    "categoria": "Sueldos",
    "monto": 1200000,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-04-01",
    "tipo": "negocio",
    "concepto": "Sueldo Valen",
    "categoria": "Sueldos",
    "monto": 1200000,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-04-15",
    "tipo": "negocio",
    "concepto": "Adicionales Juani - Sancor Salud",
    "categoria": "Sueldos adicionales",
    "monto": 248842.1,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": "Sancor Salud"
  }, {
    "fecha": "2026-04-12",
    "tipo": "negocio",
    "concepto": "Camarita server",
    "categoria": "Software / Sistemas",
    "monto": 6,
    "moneda": "USD",
    "tc": null,
    "usd": 6,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-04-13",
    "tipo": "negocio",
    "concepto": "Depósito / Warehouse",
    "categoria": "Logística / Depósito",
    "monto": 150000,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": "Bien Guardado"
  }, {
    "fecha": "2026-04-16",
    "tipo": "negocio",
    "concepto": "Verificado IG",
    "categoria": "Suscripciones",
    "monto": 15,
    "moneda": "USD",
    "tc": null,
    "usd": 15,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-03-29",
    "tipo": "negocio",
    "concepto": "Verificado WPP",
    "categoria": "Suscripciones",
    "monto": 15,
    "moneda": "USD",
    "tc": null,
    "usd": 15,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-04-01",
    "tipo": "personal",
    "concepto": "Alquiler Doblas",
    "categoria": "Alquiler",
    "monto": 500,
    "moneda": "USD",
    "tc": null,
    "usd": 500,
    "medio": "Transferencia",
    "notas": "Chat Romina"
  }, {
    "fecha": "2026-04-18",
    "tipo": "personal",
    "concepto": "Expensa Doblas dpto",
    "categoria": "Expensas",
    "monto": 195185.55,
    "moneda": "ARS",
    "tc": 1410,
    "usd": 138.43,
    "medio": "Transferencia",
    "notas": "Chat Romina"
  }, {
    "fecha": "2026-04-19",
    "tipo": "personal",
    "concepto": "ABL Doblas",
    "categoria": "Servicios",
    "monto": 26998.03,
    "moneda": "ARS",
    "tc": 1410,
    "usd": 19.15,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-03-03",
    "tipo": "personal",
    "concepto": "Luz Doblas",
    "categoria": "Servicios",
    "monto": 14101.78,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-04-01",
    "tipo": "personal",
    "concepto": "Luz Cabo",
    "categoria": "Servicios",
    "monto": 29081.94,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-04-15",
    "tipo": "personal",
    "concepto": "Gas Cabo",
    "categoria": "Servicios",
    "monto": 10677.87,
    "moneda": "ARS",
    "tc": null,
    "usd": null,
    "medio": "",
    "notas": ""
  }, {
    "fecha": "2026-04-19",
    "tipo": "personal",
    "concepto": "Hosp. Priv. Comunidad",
    "categoria": "Salud",
    "monto": 218073,
    "moneda": "ARS",
    "tc": 1410,
    "usd": 154.66,
    "medio": "Déb. Automático",
    "notas": ""
  }, {
    "fecha": "2026-04-19",
    "tipo": "personal",
    "concepto": "Hosp. Priv. Comunidad",
    "categoria": "Salud",
    "monto": 80045,
    "moneda": "ARS",
    "tc": 1410,
    "usd": 56.77,
    "medio": "Déb. Automático",
    "notas": ""
  }, {
    "fecha": "2026-04-16",
    "tipo": "personal",
    "concepto": "CapCut",
    "categoria": "Suscripciones",
    "monto": 10,
    "moneda": "USD",
    "tc": null,
    "usd": 10,
    "medio": "",
    "notas": ""
  }];
  contextoApp.SEED_AMORTS = [{
    "nombre": "Mostrador 1",
    "valor": 1500,
    "fecha": "2023-01-01",
    "vidaAnios": 10,
    "notas": ""
  }, {
    "nombre": "Mostrador 2",
    "valor": 1500,
    "fecha": "2023-01-02",
    "vidaAnios": 10,
    "notas": ""
  }, {
    "nombre": "x3 Estantería fundas",
    "valor": 400,
    "fecha": "2023-01-03",
    "vidaAnios": 10,
    "notas": ""
  }, {
    "nombre": "x3 Estantería accesorios",
    "valor": 700,
    "fecha": "2023-01-04",
    "vidaAnios": 10,
    "notas": ""
  }, {
    "nombre": "x2 Ventilador",
    "valor": 20,
    "fecha": "2024-01-05",
    "vidaAnios": 5,
    "notas": ""
  }, {
    "nombre": "Mueble atrás durlock",
    "valor": 500,
    "fecha": "2022-03-01",
    "vidaAnios": 10,
    "notas": ""
  }, {
    "nombre": "Notebook Acer",
    "valor": 500,
    "fecha": "2022-03-02",
    "vidaAnios": 5,
    "notas": ""
  }, {
    "nombre": "Printer Q800",
    "valor": 100,
    "fecha": "2020-01-01",
    "vidaAnios": 5,
    "notas": ""
  }, {
    "nombre": "Printer Aclas",
    "valor": 50,
    "fecha": "2020-01-02",
    "vidaAnios": 5,
    "notas": ""
  }, {
    "nombre": "Printer HP",
    "valor": 100,
    "fecha": "2020-01-03",
    "vidaAnios": 5,
    "notas": ""
  }, {
    "nombre": "x2 Teles RCA",
    "valor": 600,
    "fecha": "2020-01-04",
    "vidaAnios": 7,
    "notas": ""
  }, {
    "nombre": "Máquina contar billetes",
    "valor": 50,
    "fecha": "2020-01-05",
    "vidaAnios": 7,
    "notas": ""
  }];
  contextoApp.listenersReady = false;
}
