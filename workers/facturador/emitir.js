/**
 * Emitir un comprobante, de punta a punta.
 * ----------------------------------------
 * Junta todo: numero siguiente, armado, pedido del CAE y guardado. Los tres lugares
 * donde esto se rompe feo estan resueltos aca y cada uno esta comentado donde pasa.
 */

import { ultimoAutorizado, solicitarCae, consultarComprobante, parametros } from './wsfev1.js';
import { letraPara, calcularTotales, detalleXml, validar, aFechaArca, hoyAr, CONCEPTO, TIPO } from './comprobante.js';
import { conCandado } from './candado.js';
import { escribirDoc, leerDoc } from './firestore.js';

/** El numero de comprobante informado no es el siguiente. Manual v4.7, validacion 10016. */
const NO_CORRELATIVO = 10016;

const docComprobante = (cuit, entorno, ptoVta, cbteTipo, nro) =>
  `comprobantes/${cuit}_${entorno}_${ptoVta}_${cbteTipo}_${nro}`;

/** Las tablas del servicio que hacen falta para armar un comprobante. */
export async function tablasDe(ent, ta, cuit) {
  const [iva, condiciones, tipos] = await Promise.all([
    parametros(ent, ta, cuit, 'FEParamGetTiposIva'),
    parametros(ent, ta, cuit, 'FEParamGetCondicionIvaReceptor'),
    parametros(ent, ta, cuit, 'FEParamGetTiposCbte'),
  ]);
  return { iva, condiciones, tipos };
}

/**
 * @param pedido {
 *   ptoVta, concepto, fecha, cliente:{condicionIvaId, docTipo, docNro, nombre},
 *   items:[{descripcion, cantidad, precioUnitario, alicuotaIva}],
 *   precioIncluyeIva, ventaId, asociados
 * }
 */
export async function emitirComprobante(env, ent, cuit, idToken, ta, pedido, tablas) {
  const ptoVta = Number(pedido.ptoVta);
  if (!Number.isInteger(ptoVta) || ptoVta < 1) throw new Error('falta el punto de venta');

  // La letra sale de la condicion de IVA del cliente, no de lo que elija nadie.
  const { cbteTipo, letra, condicion } = letraPara(pedido.cliente?.condicionIvaId, tablas.condiciones);
  const totales = calcularTotales(pedido.items, tablas.iva, { precioIncluyeIva: pedido.precioIncluyeIva !== false });

  const concepto = pedido.concepto || CONCEPTO.productos;
  const cbteFch = aFechaArca(pedido.fecha || hoyAr());
  const clave = `${cuit}_${ent.clave}_${ptoVta}_${cbteTipo}`;

  return conCandado(env, idToken, clave, async () => {
    let intento = 0;

    while (true) {
      intento++;
      const ultimo = await ultimoAutorizado(ent, ta, cuit, ptoVta, cbteTipo);
      const cbteNro = ultimo + 1;

      const c = {
        cbteTipo, ptoVta, cbteNro, cbteFch, concepto,
        docTipo: pedido.cliente?.docTipo,
        docNro: pedido.cliente?.docNro,
        condicionIvaId: pedido.cliente?.condicionIvaId,
        monId: 'PES', monCotiz: 1,
        fchServDesde: pedido.fchServDesde, fchServHasta: pedido.fchServHasta, fchVtoPago: pedido.fchVtoPago,
        asociados: pedido.asociados,
        ...totales,
      };

      const problemas = validar(c);
      if (problemas.length) {
        const e = new Error('El comprobante no pasa los controles: ' + problemas.join(' · '));
        e.problemas = problemas;
        throw e;
      }

      let r;
      try {
        r = await solicitarCae(ent, ta, cuit, { ptoVta, cbteTipo }, detalleXml(c));
      } catch (e) {
        // ── El caso peligroso ────────────────────────────────
        // ARCA no contesto, o la conexion se corto. El comprobante PUEDE haber quedado
        // autorizado igual. Reintentar a ciegas seria emitirlo dos veces, asi que se le
        // pregunta a ARCA por ese numero exacto antes de decidir nada.
        if (!e.sinRespuesta) throw e;
        console.log(`sin respuesta en ${ptoVta}-${cbteNro}; preguntando si quedo autorizado`);

        let consulta;
        try {
          consulta = await consultarComprobante(ent, ta, cuit, ptoVta, cbteTipo, cbteNro);
        } catch (e2) {
          const err = new Error(
            `No hubo respuesta de ARCA y tampoco se pudo consultar si el comprobante ${ptoVta}-${cbteNro} quedo autorizado. ` +
            'NO se volvio a emitir, a proposito: hay que revisarlo antes de reintentar.'
          );
          err.estadoDesconocido = { ptoVta, cbteTipo, cbteNro };
          throw err;
        }

        if (consulta.hay && consulta.cae) {
          // Estaba autorizado: se recupera en vez de emitir de nuevo.
          console.log(`recuperado: ${ptoVta}-${cbteNro} ya tenia CAE ${consulta.cae}`);
          r = {
            autorizado: true, resultado: consulta.resultado || 'A',
            cae: consulta.cae, caeVto: consulta.caeVto, cbteNro,
            errores: [], observaciones: consulta.observaciones || [], eventos: [],
            recuperado: true,
          };
        } else {
          // No quedo autorizado: recien ahora es seguro reintentar.
          if (intento >= 2) throw e;
          console.log(`${ptoVta}-${cbteNro} no quedo autorizado; reintentando`);
          continue;
        }
      }

      // Otro proceso se llevo el numero entre la consulta y el pedido. Se vuelve a
      // preguntar cual es el ultimo y se reintenta una vez.
      if (!r.autorizado && r.errores.some(e => e.code === NO_CORRELATIVO) && intento < 2) {
        console.log(`numero ${cbteNro} tomado por otra emision; reintentando con el siguiente`);
        continue;
      }

      const guardado = {
        userId: env.OWNER_UID,           // para que el sistema pueda leerlo
        cuit: String(cuit),
        entorno: ent.clave,
        estado: r.autorizado ? 'emitida' : 'rechazada',
        ptoVta, cbteTipo, letra, cbteNro: r.cbteNro || cbteNro, cbteFch,
        concepto,
        cliente: {
          nombre: pedido.cliente?.nombre || '',
          docTipo: pedido.cliente?.docTipo ?? null,
          docNro: String(pedido.cliente?.docNro ?? ''),
          condicionIvaId: pedido.cliente?.condicionIvaId ?? null,
          condicion,
        },
        impNeto: totales.impNeto,
        impIVA: totales.impIVA,
        impTotal: totales.impTotal,
        iva: totales.iva.map(i => ({ id: i.Id, alicuota: i.alicuota, baseImp: i.BaseImp, importe: i.Importe })),
        items: (pedido.items || []).map(i => ({
          descripcion: i.descripcion || '', cantidad: Number(i.cantidad ?? 1),
          precioUnitario: Number(i.precioUnitario), alicuotaIva: Number(i.alicuotaIva ?? 21),
        })),
        cae: r.cae || null,
        caeVto: r.caeVto || null,
        resultado: r.resultado || null,
        // Las dos cosas por separado, porque no son lo mismo: con observaciones el
        // comprobante ESTA autorizado y hay que mostrarlas igual.
        errores: r.errores || [],
        observaciones: r.observaciones || [],
        recuperado: !!r.recuperado,
        ventaId: pedido.ventaId || null,
        emitidoEn: new Date().toISOString(),
      };

      await escribirDoc(env, idToken, docComprobante(cuit, ent.clave, ptoVta, cbteTipo, guardado.cbteNro), guardado);

      if (r.autorizado) {
        console.log(`CAE ${r.cae} para ${letra} ${ptoVta}-${guardado.cbteNro}` +
          (guardado.observaciones.length ? ` (con ${guardado.observaciones.length} observacion/es)` : ''));
      } else {
        console.log(`RECHAZADO ${letra} ${ptoVta}-${cbteNro}: ` +
          (r.errores || []).map(e => `[${e.code}] ${e.msg}`).join(' · '));
      }

      return guardado;
    }
  });
}

export { docComprobante };
