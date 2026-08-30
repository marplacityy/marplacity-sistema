/**
 * WSFEv1 — pedir el CAE.
 * ----------------------
 * SOAP con XML, no REST. Namespace y SOAPAction salen del WSDL publicado:
 *   targetNamespace  http://ar.gov.afip.dif.FEV1/
 *   SOAPAction       http://ar.gov.afip.dif.FEV1/{metodo}
 *
 * DOS COSAS QUE ARCA DEVUELVE Y NO SON LO MISMO, y por eso se guardan por separado:
 *
 *   Errors        el comprobante NO se autorizo. No hay CAE.
 *   Observaciones el comprobante SI se autorizo, con reparos. Hay CAE y hay que
 *                 mostrarle al usuario lo que ARCA observo.
 *
 * Tratarlas igual lleva a los dos errores caros: dar por rechazado algo que quedo
 * autorizado (y volver a emitirlo, duplicando), o dar por limpio algo observado.
 */

// ── XML, lo minimo ────────────────────────────────────────────
// Adentro de un Worker no hay DOMParser. Las respuestas de WSFEv1 son planas y
// conocidas, asi que alcanza con leer por nombre de etiqueta, ignorando el prefijo de
// namespace, que ARCA cambia segun el metodo.

const rxTag = t => new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${t}>`);

export const uno = (xml, tag) => {
  const m = rxTag(tag).exec(xml || '');
  return m ? m[1].trim() : null;
};

export const todos = (xml, tag) => {
  const rx = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = rx.exec(xml || ''))) out.push(m[1]);
  return out;
};

const num = v => (v == null || v === '' ? null : Number(v));

const escapar = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Un elemento simple del namespace `ar`. Omite los vacios: ARCA rechaza etiquetas nulas. */
export const el = (tag, valor) =>
  valor === null || valor === undefined || valor === '' ? '' : `<ar:${tag}>${escapar(valor)}</ar:${tag}>`;

// ── Transporte ────────────────────────────────────────────────

const AUTH = (ta, cuit) =>
  `<ar:Auth><ar:Token>${ta.token}</ar:Token><ar:Sign>${ta.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;

/**
 * Llama un metodo y devuelve el XML crudo de la respuesta.
 *
 * Si la conexion falla o se corta, el error sale marcado con `.sinRespuesta`. Esa marca
 * es importante: significa que NO sabemos que paso del otro lado, y quien la reciba
 * tiene que ir a preguntarle a ARCA en vez de reintentar. Ver `emitirConCae`.
 */
export async function llamar(ent, metodo, cuerpo, { timeoutMs = 30000 } = {}) {
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body><ar:${metodo}>${cuerpo}</ar:${metodo}></soapenv:Body>
</soapenv:Envelope>`;

  const corte = AbortSignal.timeout(timeoutMs);
  let r;
  try {
    r = await fetch(ent.wsfev1, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `http://ar.gov.afip.dif.FEV1/${metodo}`,
      },
      body: sobre,
      signal: corte,
    });
  } catch (e) {
    const err = new Error(`${metodo}: no hubo respuesta de ARCA (${e.name === 'TimeoutError' ? 'timeout' : e.message})`);
    err.sinRespuesta = true;
    throw err;
  }

  const texto = await r.text();
  if (!r.ok) {
    const fault = uno(texto, 'faultstring');
    // Un 500 con faultstring es una respuesta: ARCA contesto y dijo que no.
    if (fault) throw new Error(`${metodo}: ${fault}`);
    const err = new Error(`${metodo}: HTTP ${r.status}`);
    err.sinRespuesta = r.status >= 500;
    throw err;
  }
  return texto;
}

/** Los Errors de una respuesta: si hay alguno, el comprobante no se autorizo. */
export const erroresDe = xml =>
  todos(uno(xml, 'Errors') || '', 'Err').map(e => ({ code: num(uno(e, 'Code')), msg: uno(e, 'Msg') }));

/** Los Events: avisos del servicio, no del comprobante. Se loguean y ya. */
export const eventosDe = xml =>
  todos(uno(xml, 'Events') || '', 'Evt').map(e => ({ code: num(uno(e, 'Code')), msg: uno(e, 'Msg') }));

// ── Metodos ───────────────────────────────────────────────────

/** El ultimo numero autorizado para un punto de venta y tipo. 0 si no hay ninguno. */
export async function ultimoAutorizado(ent, ta, cuit, ptoVta, cbteTipo) {
  const xml = await llamar(ent, 'FECompUltimoAutorizado',
    `${AUTH(ta, cuit)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`);
  const errores = erroresDe(xml);
  if (errores.length) throw new Error('FECompUltimoAutorizado: ' + errores.map(e => `[${e.code}] ${e.msg}`).join(' · '));
  return num(uno(xml, 'CbteNro')) ?? 0;
}

/** Un comprobante ya emitido, para saber si quedo autorizado cuando no hubo respuesta. */
export async function consultarComprobante(ent, ta, cuit, ptoVta, cbteTipo, nro) {
  const xml = await llamar(ent, 'FECompConsultar',
    `${AUTH(ta, cuit)}<ar:FeCompConsReq><ar:CbteTipo>${cbteTipo}</ar:CbteTipo><ar:CbteNro>${nro}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq>`);
  const errores = erroresDe(xml);
  if (errores.length) return { hay: false, errores };
  const r = uno(xml, 'ResultGet');
  if (!r) return { hay: false, errores: [] };
  return {
    hay: true,
    cae: uno(r, 'CodAutorizacion'),
    caeVto: uno(r, 'FchVto'),
    resultado: uno(r, 'Resultado'),
    cbteNro: num(uno(r, 'CbteDesde')),
    cbteFch: uno(r, 'CbteFch'),
    impTotal: num(uno(r, 'ImpTotal')),
    observaciones: todos(uno(r, 'Observaciones') || '', 'Obs').map(o => ({ code: num(uno(o, 'Code')), msg: uno(o, 'Msg') })),
  };
}

/**
 * Pide el CAE para UN comprobante.
 *
 * Devuelve siempre el mismo objeto, tanto si salio como si no: `autorizado` dice cual de
 * los dos, y `errores` y `observaciones` van por separado siempre.
 */
export async function solicitarCae(ent, ta, cuit, cab, det) {
  const xml = await llamar(ent, 'FECAESolicitar',
    `${AUTH(ta, cuit)}<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${cab.ptoVta}</ar:PtoVta><ar:CbteTipo>${cab.cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>${det}</ar:FECAEDetRequest></ar:FeDetReq>` +
    `</ar:FeCAEReq>`);

  const errores = erroresDe(xml);
  const eventos = eventosDe(xml);
  const cab_ = uno(xml, 'FeCabResp') || '';
  const detR = uno(uno(xml, 'FeDetResp') || '', 'FECAEDetResponse') || '';

  const observaciones = todos(uno(detR, 'Observaciones') || '', 'Obs')
    .map(o => ({ code: num(uno(o, 'Code')), msg: uno(o, 'Msg') }));

  // El resultado del detalle manda sobre el de la cabecera: la cabecera resume el lote y
  // acá el lote es siempre de un comprobante.
  const resultado = uno(detR, 'Resultado') || uno(cab_, 'Resultado') || null;
  const cae = uno(detR, 'CAE') || null;

  return {
    autorizado: resultado === 'A' && !!cae,
    resultado,                       // A aprobado · R rechazado · P parcial
    cae,
    caeVto: uno(detR, 'CAEFchVto') || null,
    cbteNro: num(uno(detR, 'CbteDesde')),
    fchProceso: uno(cab_, 'FchProceso'),
    errores,
    observaciones,
    eventos,
    xml,
  };
}

/**
 * Las tablas del sistema (tipos de comprobante, alicuotas, condiciones de IVA). Se
 * consultan y se cachean: el manual dice explicitamente que hay que sacarlas de aca y no
 * escribirlas a mano, porque cambian sin avisar.
 */
const cacheParam = new Map();

export async function parametros(ent, ta, cuit, metodo) {
  const clave = `${ent.clave}:${metodo}`;
  const guardado = cacheParam.get(clave);
  if (guardado && Date.now() < guardado.vence) return guardado.datos;

  const xml = await llamar(ent, metodo, AUTH(ta, cuit));
  const errores = erroresDe(xml);
  if (errores.length) throw new Error(`${metodo}: ` + errores.map(e => `[${e.code}] ${e.msg}`).join(' · '));

  const cuerpo = uno(xml, 'ResultGet') || '';
  const datos = [];
  // Cada tabla usa su propia etiqueta (IvaTipo, CbteTipo, DocTipo...), pero todas traen
  // Id y Desc adentro, asi que se leen por eso en vez de por el nombre del contenedor.
  for (const item of cuerpo.split(/<\/(?:\w+:)?\w+Tipo>|<\/(?:\w+:)?CondicionIvaReceptor>/)) {
    const id = uno(item, 'Id');
    const desc = uno(item, 'Desc');
    if (id != null && desc != null) datos.push({ id: num(id), desc });
  }
  cacheParam.set(clave, { datos, vence: Date.now() + 12 * 3600 * 1000 });
  return datos;
}
