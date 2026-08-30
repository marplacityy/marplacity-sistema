/**
 * Las reglas del comprobante: letra, IVA y totales.
 * -------------------------------------------------
 * Todo lo que decide QUE se le manda a ARCA vive aca, separado del transporte, para que
 * se pueda probar sin tocar la red.
 *
 * Juni es Responsable Inscripto. La letra NO la elige el usuario: sale de la condicion
 * frente al IVA del cliente, que ademas es el mismo dato que ARCA pide desde la RG 5616
 * en `CondicionIVAReceptorId`. Un dato, dos usos, imposible que queden contradiciendose.
 */

import { el } from './wsfev1.js';

/**
 * Codigos de tipo de comprobante, del manual del desarrollador v4.7.
 *
 * Estan escritos aca porque el codigo necesita saber cual es "la factura A" para poder
 * elegirla, pero NO se dan por buenos a ciegas: `verificarTablas()` los contrasta contra
 * FEParamGetTiposCbte, que es la tabla viva del servicio.
 */
export const TIPO = {
  facturaA: 1,
  notaDebitoA: 2,
  notaCreditoA: 3,
  facturaB: 6,
  notaDebitoB: 7,
  notaCreditoB: 8,
};

/** Comprobantes clase A: los que le discriminan el IVA a un Responsable Inscripto. */
export const esClaseA = tipo => [TIPO.facturaA, TIPO.notaDebitoA, TIPO.notaCreditoA].includes(Number(tipo));

/** Para revertir un comprobante se emite la nota de credito de su misma letra. */
export const NOTA_CREDITO_DE = {
  [TIPO.facturaA]: TIPO.notaCreditoA,
  [TIPO.facturaB]: TIPO.notaCreditoB,
};

/** Concepto: que se esta facturando. Define si hacen falta las fechas de servicio. */
export const CONCEPTO = { productos: 1, servicios: 2, ambos: 3 };

const redondear = n => Math.round((n + Number.EPSILON) * 100) / 100;

/** AAAAMMDD, que es como WSFEv1 quiere las fechas. */
export const aFechaArca = iso => String(iso).slice(0, 10).replace(/-/g, '');

/** Hoy en Argentina, sin depender de la zona horaria del que corre esto. */
export function hoyAr() {
  const t = new Date(Date.now() - 3 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/**
 * La letra, a partir de la condicion frente al IVA del cliente.
 *
 * Se resuelve leyendo la descripcion de la tabla oficial y no comparando contra un
 * numero escrito a mano: si ARCA agrega una condicion nueva, esto sigue funcionando.
 *
 *   cliente Responsable Inscripto           → factura A
 *   consumidor final, monotributo, exento…  → factura B
 */
export function letraPara(condicionIvaId, tablaCondiciones) {
  const fila = (tablaCondiciones || []).find(f => f.id === Number(condicionIvaId));
  if (!fila) {
    throw new Error(`la condicion de IVA ${condicionIvaId} no esta en la tabla de ARCA (FEParamGetCondicionIvaReceptor)`);
  }
  const esRI = /responsable\s+inscripto/i.test(fila.desc);
  return {
    cbteTipo: esRI ? TIPO.facturaA : TIPO.facturaB,
    letra: esRI ? 'A' : 'B',
    condicion: fila.desc,
  };
}

/**
 * El Id de alicuota que le corresponde a un porcentaje, sacado de FEParamGetTiposIva.
 * No se hardcodea 21%: las alicuotas son varias y el 21 no es la unica que se usa.
 */
export function idDeAlicuota(porcentaje, tablaIva) {
  const p = Number(porcentaje);
  const fila = (tablaIva || []).find(f => {
    const n = parseFloat(String(f.desc).replace('%', '').replace(',', '.'));
    return Number.isFinite(n) && Math.abs(n - p) < 0.001;
  });
  if (!fila) {
    const hay = (tablaIva || []).map(f => f.desc).join(', ');
    throw new Error(`ARCA no tiene una alicuota de ${p}%. Las que hay: ${hay}`);
  }
  return fila.id;
}

/**
 * Agrupa los items por alicuota y saca los totales.
 *
 * Los precios del sistema son finales al publico (con IVA adentro), asi que por defecto
 * se desarma el precio para sacar el neto. Si alguna vez entran precios sin IVA, se
 * manda `precioIncluyeIva: false` y no se toca nada mas.
 *
 * El redondeo se hace POR ALICUOTA y despues se suma, no al reves: ARCA valida que
 * ImpNeto sea la suma de los BaseImp y que ImpIVA sea la suma de los Importe, y si se
 * redondea el total por un lado y los renglones por otro, se cae por un centavo.
 */
export function calcularTotales(items, tablaIva, { precioIncluyeIva = true } = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('el comprobante no tiene items');

  const porAlicuota = new Map();
  for (const it of items) {
    const cant = Number(it.cantidad ?? 1);
    const precio = Number(it.precioUnitario);
    if (!Number.isFinite(precio) || precio < 0) throw new Error(`precio invalido en "${it.descripcion || '?'}"`);
    const alic = Number(it.alicuotaIva ?? 21);

    const bruto = precio * cant;
    const neto = precioIncluyeIva ? bruto / (1 + alic / 100) : bruto;

    const acum = porAlicuota.get(alic) || { neto: 0 };
    acum.neto += neto;
    porAlicuota.set(alic, acum);
  }

  const iva = [];
  let impNeto = 0, impIVA = 0;
  for (const [alic, acum] of [...porAlicuota.entries()].sort((a, b) => a[0] - b[0])) {
    const baseImp = redondear(acum.neto);
    const importe = redondear(baseImp * alic / 100);
    iva.push({ Id: idDeAlicuota(alic, tablaIva), BaseImp: baseImp, Importe: importe, alicuota: alic });
    impNeto += baseImp;
    impIVA += importe;
  }

  impNeto = redondear(impNeto);
  impIVA = redondear(impIVA);
  return { iva, impNeto, impIVA, impTotal: redondear(impNeto + impIVA) };
}

/**
 * Arma el XML del detalle. El ORDEN DE LOS CAMPOS NO ES DECORATIVO: el WSDL los define
 * como una secuencia, asi que uno fuera de lugar hace que ARCA rechace el comprobante
 * con un mensaje que no dice cual es el problema. Este es el orden del WSDL.
 */
export function detalleXml(c) {
  const esServicio = c.concepto === CONCEPTO.servicios || c.concepto === CONCEPTO.ambos;
  return [
    el('Concepto', c.concepto),
    el('DocTipo', c.docTipo),
    el('DocNro', c.docNro),
    el('CbteDesde', c.cbteNro),
    el('CbteHasta', c.cbteNro),
    el('CbteFch', c.cbteFch),
    el('ImpTotal', c.impTotal.toFixed(2)),
    el('ImpTotConc', (c.impTotConc ?? 0).toFixed(2)),
    el('ImpNeto', c.impNeto.toFixed(2)),
    el('ImpOpEx', (c.impOpEx ?? 0).toFixed(2)),
    el('ImpTrib', (c.impTrib ?? 0).toFixed(2)),
    el('ImpIVA', c.impIVA.toFixed(2)),
    esServicio ? el('FchServDesde', c.fchServDesde) : '',
    esServicio ? el('FchServHasta', c.fchServHasta) : '',
    esServicio ? el('FchVtoPago', c.fchVtoPago) : '',
    el('MonId', c.monId || 'PES'),
    el('MonCotiz', (c.monCotiz ?? 1).toFixed(6)),
    el('CondicionIVAReceptorId', c.condicionIvaId),
    // Los comprobantes asociados solo van en las notas de credito y debito: son la
    // factura que se esta revirtiendo.
    c.asociados?.length
      ? `<ar:CbtesAsoc>${c.asociados.map(a =>
          `<ar:CbteAsoc>${el('Tipo', a.tipo)}${el('PtoVta', a.ptoVta)}${el('Nro', a.nro)}${el('Cuit', a.cuit)}</ar:CbteAsoc>`
        ).join('')}</ar:CbtesAsoc>`
      : '',
    c.iva?.length
      ? `<ar:Iva>${c.iva.map(i =>
          `<ar:AlicIva>${el('Id', i.Id)}${el('BaseImp', i.BaseImp.toFixed(2))}${el('Importe', i.Importe.toFixed(2))}</ar:AlicIva>`
        ).join('')}</ar:Iva>`
      : '',
  ].join('');
}

/**
 * Los controles que conviene hacer ACA y no descubrir en el rechazo de ARCA, porque el
 * mensaje de ARCA no siempre dice cual de los numeros esta mal.
 */
export function validar(c) {
  const problemas = [];

  const suma = redondear((c.impTotConc ?? 0) + c.impNeto + (c.impOpEx ?? 0) + (c.impTrib ?? 0) + c.impIVA);
  if (Math.abs(suma - c.impTotal) > 0.01) {
    problemas.push(`ImpTotal (${c.impTotal}) no es la suma de los importes (${suma})`);
  }

  const sumaBases = redondear((c.iva || []).reduce((s, i) => s + i.BaseImp, 0));
  const sumaIva = redondear((c.iva || []).reduce((s, i) => s + i.Importe, 0));
  if (Math.abs(sumaBases - c.impNeto) > 0.01) problemas.push(`ImpNeto (${c.impNeto}) no es la suma de las bases (${sumaBases})`);
  if (Math.abs(sumaIva - c.impIVA) > 0.01) problemas.push(`ImpIVA (${c.impIVA}) no es la suma de las alicuotas (${sumaIva})`);

  // A un Responsable Inscripto se le factura con CUIT: la clase A no admite otro
  // documento, y eso vale para la factura y para su nota de credito (manual, 10013).
  if (esClaseA(c.cbteTipo) && Number(c.docTipo) !== 80) {
    problemas.push('los comprobantes clase A necesitan el CUIT del cliente (DocTipo 80)');
  }
  if (Number(c.docTipo) !== 99 && !c.docNro) problemas.push('falta el numero de documento del cliente');

  if (!c.condicionIvaId) problemas.push('falta CondicionIVAReceptorId, obligatorio desde la RG 5616');

  // Ventana de fechas del manual: 5 dias para productos, 10 para servicios.
  const dias = c.concepto === CONCEPTO.productos ? 5 : 10;
  const f = c.cbteFch;
  if (f && /^\d{8}$/.test(f)) {
    const d = new Date(`${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}T00:00:00-03:00`);
    const diff = Math.abs((d - new Date(`${hoyAr()}T00:00:00-03:00`)) / 86400000);
    if (diff > dias) problemas.push(`la fecha ${f} esta a mas de ${dias} dias de hoy: ARCA no la acepta`);
  } else {
    problemas.push('CbteFch tiene que ser AAAAMMDD');
  }

  return problemas;
}

/**
 * Contrasta los codigos que usamos contra las tablas vivas del servicio. Si ARCA cambia
 * algo, esto lo dice en vez de que nos enteremos por un rechazo raro.
 */
export function verificarTablas(tablaCbte) {
  const problemas = [];
  const espera = [
    [TIPO.facturaA, /factura\s*a/i],
    [TIPO.facturaB, /factura\s*b/i],
    [TIPO.notaCreditoA, /nota\s*de\s*cr[eé]dito\s*a/i],
    [TIPO.notaCreditoB, /nota\s*de\s*cr[eé]dito\s*b/i],
  ];
  for (const [id, rx] of espera) {
    const fila = (tablaCbte || []).find(f => f.id === id);
    if (!fila) problemas.push(`el tipo ${id} no esta en la tabla de ARCA`);
    else if (!rx.test(fila.desc)) problemas.push(`el tipo ${id} ahora es "${fila.desc}"`);
  }
  return problemas;
}
