/** Ganancia de una venta. Lógica pura: los costos actuales de los productos llegan
 *  por parámetro, así se puede probar sin Firebase ni DOM.
 *
 *  Un renglón de venta guarda el costo congelado (`costo`, en la moneda del renglón).
 *  Si después de vender se corrige a mano, queda `costoManual: true` y `costoMoneda`,
 *  y ese costo manda sobre el del producto. */

const aMoneda = (valor, de, hacia, tc) => de === hacia ? valor : !tc ? null : hacia === 'USD' ? valor / tc : valor * tc;
const redondear = n => Math.round(n * 100) / 100;

/** Costo ACTUAL del producto de un renglón, en su moneda. null si el producto ya no
 *  está o no tiene costo cargado. `costos` = { eq, consig, inv }: Map de id → documento. */
export function costoDelProducto(ci, fecha, costos) {
  if (ci.tipo === 'eq') {
    const s = costos.eq.get(ci.refId);
    return s ? { costo: s.valorUSD || 0, moneda: 'USD' } : null;
  }
  if (ci.tipo === 'consig') {
    const x = costos.consig.get(ci.refId);
    return x ? { costo: x.precioUSD || 0, moneda: 'USD' } : null;
  }
  if (ci.tipo === 'inv') {
    const p = costos.inv.get(ci.refId);
    if (!p || p.costo == null) return null;
    // costo vigente a la fecha de esta venta (historial de reposiciones)
    let costo = p.costo,
      moneda = p.moneda || ci.moneda || 'USD';
    if (p.costoHist && p.costoHist.length && fecha) {
      const vig = [...p.costoHist].filter(h => h.desde <= fecha).sort((a, b) => b.desde.localeCompare(a.desde))[0];
      if (vig) {
        costo = vig.costo;
        moneda = vig.moneda || moneda;
      }
    }
    return { costo, moneda };
  }
  return null;
}

/** Costo unitario con el que hoy se calcula la ganancia de un renglón: el corregido a
 *  mano manda; si no, el actual del producto; si no, el congelado al vender. null si
 *  el renglón no lleva costo (cobro de reparación, importado sin corregir, sin dato). */
export function costoVigente(ci, fecha, costos) {
  if (ci.tipo === 'rep') return null;
  if (ci.costoManual) return { costo: ci.costo || 0, moneda: ci.costoMoneda || ci.moneda || 'USD' };
  if (ci.tipo === 'imp') return null;
  return costoDelProducto(ci, fecha, costos) || (ci.costo != null ? { costo: ci.costo, moneda: ci.moneda || 'USD' } : null);
}

/** Ganancia de un renglón con el costo que trae el propio renglón (`costo` en
 *  `costoMoneda`), expresada en `moneda`. null si hace falta el TC y no está. */
export function gananciaRenglon(ci, moneda, tc) {
  const p = aMoneda(ci.precio || 0, ci.moneda || 'ARS', moneda, tc);
  const c = aMoneda(ci.costo || 0, ci.costoMoneda || ci.moneda || 'USD', moneda, tc);
  return p == null || c == null ? null : (p - c) * (ci.qty || 1);
}

/** Costo unitario (en `monedaCosto`) que deja al renglón con esa ganancia total.
 *  Nunca negativo. null si hace falta el TC y no está. */
export function costoParaGanancia(ci, ganancia, monedaCosto, tc) {
  const p = aMoneda(ci.precio || 0, ci.moneda || 'ARS', monedaCosto, tc);
  if (p == null) return null;
  return Math.max(0, redondear(p - (ganancia || 0) / (ci.qty || 1)));
}

/** Ganancia de la venta en USD, recalculada con los costos actuales de los productos.
 *  null si ningún renglón tiene costo conocido. */
export function gananciaDeVentaUSD(v, { tcActual = null, costos }) {
  if (!v.items || !v.items.length) {
    // ingreso manual: usar la ganancia congelada
    return v.gananciaUSD ?? (v.gananciaARS != null && v.tc ? v.gananciaARS / v.tc : null);
  }
  const tc = v.tc || tcActual || null;
  const aUSD = (val, mon) => mon === 'USD' ? val : tc ? val / tc : null;
  let gan = 0,
    hayCosto = false;
  for (const ci of v.items) {
    if (ci.tipo === 'rep') continue; // reps se computan por su lado
    if (ci.costoManual) {
      // costo corregido a mano en la venta: manda sobre el del producto
      const g = gananciaRenglon(ci, 'USD', tc);
      if (g == null) continue;
      hayCosto = true;
      gan += g;
      continue;
    }
    if (ci.tipo === 'imp') continue; // importados sin costo
    // costo ACTUAL del producto (fallback: el congelado en la venta)
    const c = costoDelProducto(ci, v.fecha, costos);
    let costoU = c ? aUSD(c.costo, c.moneda) : null;
    if (costoU == null) costoU = ci.costo != null ? aUSD(ci.costo, ci.moneda || 'USD') : null;
    if (costoU == null || costoU === 0 && !ci.costo) {
      // sin costo conocido: solo suma precio como ganancia si había costo congelado 0 explícito
      if (ci.costo == null) continue;
    }
    hayCosto = true;
    const precioU = aUSD(ci.precio || 0, ci.moneda || 'ARS');
    if (precioU == null) continue;
    gan += (precioU - (costoU || 0)) * (ci.qty || 1);
  }
  (v.cortesias || []).forEach(co => {
    hayCosto = true;
    gan -= co.costoUSD || 0;
  });
  return hayCosto ? gan : null;
}
