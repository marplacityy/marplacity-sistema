/**
 * Emitir un comprobante, de punta a punta.
 * ----------------------------------------
 * Junta todo: numero siguiente, armado, pedido del CAE y guardado. Los tres lugares
 * donde esto se rompe feo estan resueltos aca y cada uno esta comentado donde pasa.
 */

import { ultimoAutorizado, solicitarCae, consultarComprobante, parametros } from './wsfev1.js';
import { letraPara, calcularTotales, detalleXml, validar, aFechaArca, hoyAr, CONCEPTO, TIPO, NOTA_CREDITO_DE } from './comprobante.js';
import { conCandado } from './candado.js';
import { escribirDoc, leerDoc } from './firestore.js';

/** El numero de comprobante informado no es el siguiente. Manual v4.7, validacion 10016. */
const NO_CORRELATIVO = 10016;

const docComprobante = (cuit, entorno, ptoVta, cbteTipo, nro) =>
  `comprobantes/${cuit}_${entorno}_${ptoVta}_${cbteTipo}_${nro}`;

/** Las tablas del servicio que hacen falta para armar un comprobante. */
export async function tablasDe(ent, ta, cuit) {
  const [iva, condiciones, tipos, documentos] = await Promise.all([
    parametros(ent, ta, cuit, 'FEParamGetTiposIva'),
    parametros(ent, ta, cuit, 'FEParamGetCondicionIvaReceptor'),
    parametros(ent, ta, cuit, 'FEParamGetTiposCbte'),
    parametros(ent, ta, cuit, 'FEParamGetTiposDoc'),
  ]);
  return { iva, condiciones, tipos, documentos };
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
  const { cbteTipo: tipoPorCliente, letra, condicion } = letraPara(pedido.cliente?.condicionIvaId, tablas.condiciones);

  // Una nota de credito lleva su propio tipo, que NO se deriva del cliente: es el que le
  // corresponde a la factura que revierte. La letra sigue siendo la misma —una NC de una
  // factura A es una NC A— asi que el control de arriba se mantiene igual de valido.
  const cbteTipo = pedido.cbteTipo || tipoPorCliente;
  if (pedido.cbteTipo && pedido.cbteTipo !== NOTA_CREDITO_DE[tipoPorCliente]) {
    throw new Error(`el tipo ${pedido.cbteTipo} no es la nota de credito que le corresponde a este cliente`);
  }
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

      // ARCA exige correlatividad de numero Y DE FECHA: un comprobante no puede llevar
      // fecha anterior a la del ultimo autorizado. Preguntarlo aca cuesta una llamada y
      // convierte el 10016 —que dice "el numero o fecha", sin aclarar cual— en un
      // mensaje que dice que hacer. Sin esto, facturar una venta de la semana pasada
      // despues de haber emitido una de hoy falla sin explicacion util.
      if (ultimo > 0) {
        const previo = await consultarComprobante(ent, ta, cuit, ptoVta, cbteTipo, ultimo);
        if (previo.hay && previo.cbteFch && cbteFch < previo.cbteFch) {
          const f = d => `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`;
          const e = new Error(
            `ARCA no acepta un comprobante con fecha anterior a la del ultimo emitido. ` +
            `El ultimo en este punto de venta es el ${ptoVta}-${ultimo}, del ${f(previo.cbteFch)}, ` +
            `y esta factura tiene fecha ${f(cbteFch)}. Emitila con una fecha igual o posterior.`
          );
          e.problemas = [`la fecha ${f(cbteFch)} es anterior al ultimo comprobante autorizado (${f(previo.cbteFch)})`];
          throw e;
        }
      }

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

      // El 10016 puede ser por el numero o por la fecha. Solo tiene sentido reintentar
      // si otro proceso se llevo el numero mientras tanto, y eso se sabe de una manera:
      // volviendo a preguntar cual es el ultimo. Si no cambio, reintentar da exactamente
      // el mismo rechazo, que es lo que pasaba antes y ademas loguabamos como si fuera
      // una carrera entre emisiones.
      if (!r.autorizado && r.errores.some(e => e.code === NO_CORRELATIVO) && intento < 2) {
        const ahora = await ultimoAutorizado(ent, ta, cuit, ptoVta, cbteTipo);
        if (ahora !== ultimo) {
          console.log(`numero ${cbteNro} tomado por otra emision (ahora el ultimo es ${ahora}); reintentando`);
          continue;
        }
        console.log(`10016 con el numero correcto (${cbteNro}): es por la fecha, no se reintenta`);
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
        esNotaCredito: !!pedido.cbteTipo,
        revierte: pedido.asociados?.length
          ? { ptoVta: pedido.asociados[0].ptoVta, cbteTipo: pedido.asociados[0].tipo, cbteNro: pedido.asociados[0].nro }
          : null,
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

/**
 * Emite la nota de credito que revierte una factura.
 *
 * UNA FACTURA CON CAE NO SE ANULA. Lo unico que ARCA acepta para dejarla sin efecto es
 * otro comprobante que la compense, de la misma letra, apuntando a ella. Por eso esto no
 * borra ni toca la factura original: emite un comprobante nuevo y los deja vinculados en
 * las dos direcciones.
 *
 * El cliente, los renglones y los importes salen de la factura original: una nota de
 * credito que no coincide con lo que revierte no sirve para nada.
 */
export async function emitirNotaCredito(env, ent, cuit, idToken, ta, { comprobanteId, motivo }, tablas) {
  if (!comprobanteId) throw new Error('falta el comprobante a revertir');

  const orig = await leerDoc(env, idToken, `comprobantes/${comprobanteId}`);
  if (!orig) throw new Error('no encontre esa factura');
  if (orig.estado !== 'emitida') throw new Error('esa factura no llego a autorizarse: no hay nada que revertir');
  if (orig.esNotaCredito) throw new Error('eso ya es una nota de credito');
  if (orig.entorno !== ent.clave) throw new Error(`esa factura es de ${orig.entorno} y el facturador esta en ${ent.clave}`);
  if (orig.notaCredito) {
    throw new Error(`esa factura ya fue revertida con la nota de credito ${orig.notaCredito.ptoVta}-${orig.notaCredito.cbteNro}`);
  }

  const cbteTipo = NOTA_CREDITO_DE[orig.cbteTipo];
  if (!cbteTipo) throw new Error(`no se que nota de credito le corresponde al tipo ${orig.cbteTipo}`);

  const nc = await emitirComprobante(env, ent, cuit, idToken, ta, {
    ptoVta: orig.ptoVta,
    cbteTipo,
    cliente: orig.cliente,
    items: orig.items,
    ventaId: orig.ventaId,
    // Va con fecha de hoy y no con la de la factura: la fecha tiene que ser correlativa
    // con el ultimo comprobante de ESTE tipo, y ademas la reversion pasa hoy.
    fecha: hoyAr(),
    asociados: [{ tipo: orig.cbteTipo, ptoVta: orig.ptoVta, nro: orig.cbteNro, cuit: String(cuit) }],
    motivo: motivo || '',
  }, tablas);

  // La factura queda marcada, para que no se pueda revertir dos veces y para que el
  // sistema lo muestre sin tener que salir a buscar.
  if (nc.estado === 'emitida') {
    await escribirDoc(env, idToken, `comprobantes/${comprobanteId}`, {
      notaCredito: { ptoVta: nc.ptoVta, cbteTipo: nc.cbteTipo, cbteNro: nc.cbteNro, cae: nc.cae, emitidaEn: nc.emitidoEn },
    });
  }
  return nc;
}

export { docComprobante };
