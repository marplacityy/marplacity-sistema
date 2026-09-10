/** modulos/importaciones: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { setDoc, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { showToast } from '../core/interfaz.js';
import { cargarClientes } from './clientes.js';
import { setSyncDot } from '../core/datos.js';

export
// ── Importador RepairDesk ─────────────────────────────
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase no responde — probablemente se alcanzó el límite diario de escrituras (20.000). Reintentá mañana: lo ya importado no se duplica.')), ms))]);
}
export function inicializarImportaciones() {
  // ── Diagnóstico ──
  window.setPrintMode = async function (v) {
    contextoApp.cfg.printMode = v;
    try {
      await setDoc(doc(contextoApp.db, 'config', contextoApp.auth.currentUser.uid), {
        printMode: v
      }, {
        merge: true
      });
      showToast(v === 'local' ? '🖨 Tickets → ticketera del local' : '📄 Tickets → este dispositivo');
    } catch (e) {
      showToast('Error guardando', true);
    }
  };
  window.verDiagnostico = function () {
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : 'n/d';
    const lineas = [];
    lineas.push('═══ DIAGNÓSTICO ═══');
    lineas.push('Uptime: ' + Math.round((Date.now() - contextoApp._perf.t0) / 1000) + 's · Heap JS: ' + mem);
    lineas.push('Caché persistente: ' + (window._cachePersistente ? 'ACTIVO ✓' : '❌ CAÍDO (usa memoria — cada carga baja todo del server)'));
    lineas.push('Docs en memoria: gastos ' + contextoApp.gastos.length + ' · ingresos ' + contextoApp.ingresos.length + ' · reps ' + contextoApp.reps.length + ' · clientes ' + contextoApp.clientesItems.length);
    lineas.push('');
    lineas.push('— Snapshots (veces · docs procesados · ms total · desde caché) —');
    Object.entries(contextoApp._perf.snaps).forEach(([k, v]) => {
      lineas.push(`${k}: ${v.veces}× · ${v.docs} docs · ${Math.round(v.ms)}ms · cache ${v.fromCache}×`);
    });
    lineas.push('');
    lineas.push('— Renders (veces · ms promedio · ms máx) —');
    Object.entries(contextoApp._perf.renders).sort((a, b) => b[1].total - a[1].total).forEach(([k, v]) => {
      lineas.push(`${k}: ${v.n}× · prom ${Math.round(v.total / v.n)}ms · máx ${Math.round(v.max)}ms · total ${Math.round(v.total)}ms`);
    });
    const out = document.getElementById('diag-out');
    out.textContent = lineas.join('\n');
    out.style.display = 'block';
    console.log(lineas.join('\n'));
  };

  // ── Fusión de clientes duplicados ─────────────────────
  window.dedupClientes = async function () {
    await cargarClientes();
    const grupos = new Map();
    contextoApp.clientesItems.forEach(x => {
      const k = (x.nombre || '').toLowerCase().trim();
      if (!k) return;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(x);
    });
    const dups = [...grupos.values()].filter(g => g.length > 1);
    if (!dups.length) {
      showToast('No hay clientes duplicados ✓');
      return;
    }
    const totalBorrar = dups.reduce((s, g) => s + g.length - 1, 0);
    if (!confirm(`Se encontraron ${dups.length} nombres repetidos (${totalBorrar} registros de más).\n\nSe fusionan conservando teléfono y reasignando sus operaciones. ¿Continuar?`)) return;
    const btn = document.getElementById('btn-dedup');
    const prog = document.getElementById('dedup-progress');
    btn.disabled = true;
    setSyncDot('syncing');
    try {
      // keeper por grupo + mapa de reasignación
      const reasignar = new Map(); // loserId -> keeperId
      const borrar = [];
      dups.forEach(g => {
        g.sort((a, b) => {
          if (!!b.tel !== !!a.tel) return (b.tel ? 1 : 0) - (a.tel ? 1 : 0); // con tel primero
          return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0); // más viejo primero
        });
        const keeper = g[0];
        // si el keeper no tiene tel pero un duplicado sí, heredarlo
        const conTel = g.find(x => x.tel);
        if (conTel && !keeper.tel) keeper._nuevoTel = conTel.tel;
        g.slice(1).forEach(x => {
          reasignar.set(x.id, keeper.id);
          borrar.push(x.id);
        });
      });

      // Reasignar referencias en reparaciones y facturas
      const repsAfectadas = contextoApp.reps.filter(r => r.clienteId && reasignar.has(r.clienteId));
      const ventasAfectadas = contextoApp.ingresos.filter(v => v.clienteId && reasignar.has(v.clienteId));
      const ops = [];
      repsAfectadas.forEach(r => ops.push({
        col: 'reparaciones',
        id: r.id,
        data: {
          clienteId: reasignar.get(r.clienteId)
        }
      }));
      ventasAfectadas.forEach(v => ops.push({
        col: 'ingresos',
        id: v.id,
        data: {
          clienteId: reasignar.get(v.clienteId)
        }
      }));
      // teléfonos heredados
      dups.forEach(g => {
        if (g[0]._nuevoTel) ops.push({
          col: 'clientes',
          id: g[0].id,
          data: {
            tel: g[0]._nuevoTel
          }
        });
      });
      const total = ops.length + borrar.length;
      let done = 0;
      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(contextoApp.db);
        ops.slice(i, i + 400).forEach(o => batch.update(doc(contextoApp.db, o.col, o.id), o.data));
        await withTimeout(batch.commit(), 45000);
        done += Math.min(400, ops.length - i);
        prog.textContent = `Reasignando operaciones... ${done} / ${total}`;
      }
      for (let i = 0; i < borrar.length; i += 400) {
        const batch = writeBatch(contextoApp.db);
        borrar.slice(i, i + 400).forEach(id => batch.delete(doc(contextoApp.db, 'clientes', id)));
        await withTimeout(batch.commit(), 45000);
        done += Math.min(400, borrar.length - i);
        prog.textContent = `Borrando duplicados... ${done} / ${total}`;
      }
      prog.textContent = `✓ Fusión completa: ${dups.length} clientes unificados, ${borrar.length} duplicados eliminados, ${ops.length} operaciones reasignadas.`;
      showToast('Clientes fusionados ✓');
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      prog.textContent = '⚠ Error: ' + e.message + ' — podés reintentar, es seguro.';
      showToast('Error: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
  };
  window.importarRD = async function () {
    const fi = document.getElementById('rd-file');
    const file = fi.files[0];
    if (!file) return;
    const prog = document.getElementById('rd-progress');
    const btn = document.getElementById('btn-rd');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      showToast('Archivo inválido.', true);
      fi.value = '';
      return;
    }
    if (!data.clientes || !data.reps && !data.facturas) {
      showToast('El archivo no tiene el formato esperado.', true);
      fi.value = '';
      return;
    }
    await cargarClientes(); // para no duplicar los que ya existen
    data.reps = data.reps || [];
    data.facturas = data.facturas || [];

    // Protección contra doble import
    const yaReps = contextoApp.reps.filter(r => r.origen === 'repairdesk').length;
    const yaFact = contextoApp.ingresos.filter(v => v.origen === 'repairdesk').length;
    if ((data.reps.length && yaReps > 0 || data.facturas.length && yaFact > 0) && !confirm(`Ya hay datos importados de RepairDesk (${yaReps} órdenes, ${yaFact} facturas). ¿Importar igual? (puede duplicar)`)) {
      fi.value = '';
      return;
    }
    if (!confirm(`Se van a importar:\n• ${data.clientes.length} clientes\n${data.reps.length ? '• ' + data.reps.length + ' órdenes históricas\n' : ''}${data.facturas.length ? '• ' + data.facturas.length + ' facturas históricas\n' : ''}\nEsto tarda unos minutos. ¿Continuar?`)) {
      fi.value = '';
      return;
    }
    btn.disabled = true;
    setSyncDot('syncing');
    let done = 0;
    const totalOps = data.clientes.length + data.reps.length + data.facturas.length;
    const upd = () => {
      prog.textContent = `Importando... ${done} / ${totalOps}`;
    };
    try {
      // 1. Clientes (dedup contra existentes por nombre)
      const existentes = new Map(contextoApp.clientesItems.map(x => [(x.nombre || '').toLowerCase().trim(), x.id]));
      const idPorNombre = new Map(existentes);
      for (let i = 0; i < data.clientes.length; i += 400) {
        const chunk = data.clientes.slice(i, i + 400);
        const batch = writeBatch(contextoApp.db);
        for (const cl of chunk) {
          const k = cl.nombre.toLowerCase().trim();
          if (idPorNombre.has(k)) {
            done++;
            continue;
          }
          const ref = doc(contextoApp.clientesCol);
          batch.set(ref, contextoApp.withUser({
            nombre: cl.nombre,
            tel: cl.tel || '',
            notas: '',
            origen: 'repairdesk',
            createdAt: serverTimestamp()
          }));
          idPorNombre.set(k, ref.id);
          done++;
        }
        await withTimeout(batch.commit(), 45000);
        upd();
      }

      // 2. Órdenes
      for (let i = 0; i < data.reps.length; i += 400) {
        const chunk = data.reps.slice(i, i + 400);
        const batch = writeBatch(contextoApp.db);
        for (const r of chunk) {
          const ref = doc(contextoApp.repCol);
          batch.set(ref, contextoApp.withUser({
            num: r.num,
            fecha: r.fecha || '',
            cliente: r.cliente || '',
            clienteId: idPorNombre.get((r.cliente || '').toLowerCase().trim()) || null,
            tel: r.tel || '',
            equipo: r.equipo || '',
            imei: r.imei || '',
            clave: r.clave || '',
            trabajo: r.trabajo || '',
            precio: 0,
            sena: 0,
            saldo: 0,
            moneda: 'ARS',
            tc: null,
            checklist: {},
            obs: '',
            garantia: '',
            entrega: null,
            repuestos: [],
            stockDescontado: false,
            estado: 'importado_rd',
            origen: 'repairdesk',
            historial: [{
              fecha: contextoApp.today(),
              texto: 'Importado desde RepairDesk'
            }],
            createdAt: serverTimestamp()
          }));
          done++;
        }
        await batch.commit();
        upd();
      }
      // 3. Facturas históricas (salteando las ya importadas)
      const numsExistentes = new Set(contextoApp.ingresos.filter(v => v.origen === 'repairdesk' && v.numVenta).map(v => v.numVenta));
      for (let i = 0; i < data.facturas.length; i += 400) {
        const chunk = data.facturas.slice(i, i + 400);
        const batch = writeBatch(contextoApp.db);
        let enBatch = 0;
        for (const f of chunk) {
          if (f.numVenta && numsExistentes.has(f.numVenta)) {
            done++;
            continue;
          }
          enBatch++;
          const ref = doc(contextoApp.ingresosCol);
          batch.set(ref, contextoApp.withUser({
            // Nunca vacía: un doc con fecha '' queda fuera de toda consulta por
            // rango y sería invisible mientras la ventana de datos esté activa.
            fecha: f.fecha || contextoApp.today(),
            numVenta: f.numVenta || null,
            nombre: f.nombre || 'Venta',
            categoria: 'Venta producto',
            clienteNombre: f.clienteNombre || 'Consumidor final',
            clienteId: idPorNombre.get((f.clienteNombre || '').toLowerCase().trim()) || null,
            items: (f.items || []).map(it => ({
              tipo: 'imp',
              refId: null,
              nombre: it.nombre,
              qty: it.qty || 1,
              precio: it.precio || 0,
              moneda: it.moneda || 'USD',
              costo: 0,
              imei: it.imei || '',
              garantia: it.garantia || ''
            })),
            medios: [],
            totalARS: f.totalARS || null,
            totalUSD: f.totalUSD || null,
            gananciaARS: null,
            gananciaUSD: null,
            tc: null,
            notas: f.metodo ? 'Pago: ' + f.metodo : '',
            imei: (f.items || []).find(it => it.imei)?.imei || '',
            origen: 'repairdesk',
            createdAt: serverTimestamp()
          }));
          done++;
        }
        if (enBatch > 0) await withTimeout(batch.commit(), 45000);
        upd();
      }
      prog.textContent = `✓ Importación completa: ${totalOps} registros.`;
      showToast('Importación completa ✓');
      setSyncDot('ok');
    } catch (e) {
      console.error(e);
      prog.textContent = `⚠ Error en ${done}/${totalOps}: ${e.message}. Podés reintentarlo — los clientes ya creados no se duplican.`;
      showToast('Error al importar: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    fi.value = '';
  };

  // ── Edición de facturas con items ─────────────────────
}
