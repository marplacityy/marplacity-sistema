import { CATEGORIAS_CATALOGO, esUsado, slugFoto, armarMapaFotos, categoriaDe } from '../../shared/catalogo.js';
import { configuracion } from '../core/config-publica.js';
/** modulos/catalogo: lógica preservada de la aplicación original. */
import { contextoApp } from '../core/estado.js';
import { esc, escJs, showToast } from '../core/interfaz.js';
import { setSyncDot } from '../core/datos.js';
import { updateDoc, doc, setDoc } from 'firebase/firestore';
import { kbUltimaLista } from './conocimiento.js';
import { workerHeaders, textoDeIA } from './reportes.js';
export function pintarBadgePedidos() {
  const n = contextoApp.pedidosItems.filter(contextoApp.pedidoAbierto).length;
  const el = document.getElementById('nav-pedidos');
  if (!el) return;
  el.textContent = n;
  el.style.display = n ? 'inline-block' : 'none';
}
export function renderPedidos() {
  ['abiertos', 'todos'].forEach(f => document.getElementById('ped-f-' + f).className = f === contextoApp.pedidosFiltro ? 'btn-save' : 'btn-secondary');
  const lista = contextoApp.pedidosFiltro === 'abiertos' ? contextoApp.pedidosItems.filter(contextoApp.pedidoAbierto) : contextoApp.pedidosItems;
  const cuando = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  const monto = p => p.pago === 'mp' ? contextoApp.fmtARS(p.montoARS || 0) : contextoApp.fmtUSD(p.montoUSD || 0);
  document.getElementById('ped-body').innerHTML = lista.map(p => {
    const [txt, cls] = contextoApp.PED_ESTADOS[p.estado] || [p.estado, ''];
    const prod = p.producto || {},
      cli = p.cliente || {};
    const wa = (cli.whatsapp || '').replace(/\D/g, '');
    const msg = encodeURIComponent(`Hola ${cli.nombre || ''}! Te escribo por tu pedido del ${prod.nombre || ''} en el catálogo de MarplaCity.`);
    return `<tr style="${contextoApp.pedidoAbierto(p) ? '' : 'opacity:.6;'}">
      <td style="font-family:'DM Mono',monospace;font-size:11.5px;">${esc(cuando(p.creado))}<div class="sub" style="font-size:10px;color:var(--text3);">${esc(p.id.slice(0, 8))}</div></td>
      <td>${esc(cli.nombre || '—')}<div class="sub" style="font-size:11px;">${wa ? `<a href="https://wa.me/${wa}?text=${msg}" target="_blank" rel="noopener">📱 ${esc(cli.whatsapp)}</a>` : ''}${cli.email ? ' · ' + esc(cli.email) : ''}</div></td>
      <td>${esc(prod.nombre || '')}<div class="sub" style="font-size:11px;color:var(--text3);">${esc([prod.gb, prod.color, prod.tipo === 'pedido' ? 'a pedido' : ''].filter(Boolean).join(' · '))}</div></td>
      <td>${esc(contextoApp.PED_PAGOS[p.pago] || p.pago)}<div class="sub" style="font-family:'DM Mono',monospace;font-size:11.5px;">${monto(p)}</div></td>
      <td>${p.entrega === 'envio' ? 'Envío' : 'Retira'}${p.direccion ? `<div class="sub" style="font-size:11px;color:var(--text3);">${esc(p.direccion)}</div>` : ''}</td>
      <td><span class="badge ${cls}">${esc(txt)}</span></td>
      <td style="white-space:nowrap;">${contextoApp.pedidoAbierto(p) ? `
        <button class="btn-secondary" style="padding:5px 9px;font-size:11.5px;" onclick="cerrarPedido('${escJs(p.id)}','entregado')">✓ Entregado</button>
        <button class="btn-secondary" style="padding:5px 9px;font-size:11.5px;" onclick="cerrarPedido('${escJs(p.id)}','cancelado')">✕</button>` : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" style="color:var(--text3);">${contextoApp.pedidosFiltro === 'abiertos' ? 'No hay pedidos por atender.' : 'Todavía no hubo pedidos.'}</td></tr>`;
}

/** Cerrar un pedido: entregado o cancelado. Un pagado que se cancela hay que devolverlo desde Mercado Pago, eso no lo hace el sistema. */
export
/**
 * Las fotos de un equipo.
 *
 * Si el equipo TIENE color cargado, solo vale la foto de ese color. Nada de caer a una
 * genérica: hay tres iPhone 13 en stock —Blue, Red y Midnight— y mostrarle al que
 * compra un teléfono azul con el cartel "Red" al lado es peor que no mostrarle nada.
 *
 * La genérica queda para los equipos sin color cargado, donde no hay con qué
 * contradecirse.
 */
function fotosDe(nombre, color) {
  const modelo = slugFoto(nombre);
  const archivos = color ? contextoApp.FOTOS[`${modelo}-${slugFoto(color)}`] || [] : contextoApp.FOTOS[modelo] || [];
  return archivos.map(f => contextoApp.FOTOS_BASE + f);
}

/** Un equipo, con lo justo para mostrarlo. Es el único lugar que decide qué es público. */
export /** El orden de las categorías: el editado si existe, completado con las que falten. */
function ordenCategorias() {
  const todas = contextoApp.todasLasCategorias();
  const propio = Array.isArray(contextoApp.cfg.catalogoCategorias) ? contextoApp.cfg.catalogoCategorias.filter(c => todas.includes(c)) : [];
  return [...propio, ...todas.filter(c => !propio.includes(c))];
}
export function renderCategoriasCatalogo() {
  const items = catalogoCandidatos().filter(p => p._sale);
  const orden = ordenCategorias();
  document.getElementById('cat-categorias').innerHTML = orden.map((c, i) => {
    const n = items.filter(p => p.categoria === c).length;
    return `<div class="cat-fila-cat" style="${n ? '' : 'opacity:.55;'}">
      <span class="n">${i + 1}</span>
      <span class="nombre">${esc(c)}</span>
      <span class="cnt">${n ? n + ' producto' + (n === 1 ? '' : 's') : 'vacía, no se muestra'}</span>
      <button class="btn-secondary" ${i === 0 ? 'disabled' : ''} onclick="moverCategoria('${escJs(c)}',-1)">▲</button>
      <button class="btn-secondary" ${i === orden.length - 1 ? 'disabled' : ''} onclick="moverCategoria('${escJs(c)}',1)">▼</button>
      ${CATEGORIAS_CATALOGO.includes(c) ? '<span style="width:34px;"></span>' : `<button class="btn-secondary" title="Borrar esta categoría" onclick="borrarCategoria('${escJs(c)}')">✕</button>`}
      ${n ? `<button class="btn-secondary" onclick="catTab('productos');document.getElementById('cat-f-cat').value='${escJs(c)}';renderCatalogo()">Ver</button>` : ''}
    </div>`;
  }).join('');
}
/**
 * Todo lo que califica: equipos en stock, artículos del inventario con cantidad, y los
 * ítems de la última lista de cada origen. Un mismo producto en dos listas entra una sola
 * vez, con el precio de la primera (Mar del Plata, CABA, proveedor, en ese orden).
 */
export function catalogoCandidatos() {
  const fuera = new Set(contextoApp.cfg.catalogoExcluidos || []);
  const notas = contextoApp.cfg.catalogoNotas || {};
  const items = [...contextoApp.stockItems.filter(p => p.status === 'en_stock').map(p => ({
    ...contextoApp.productoPublico(p, 'stock'),
    _origen: 'Propio'
  })), ...contextoApp.consigItems.filter(p => p.status === 'en_stock').map(p => ({
    ...contextoApp.productoPublico(p, 'consig'),
    _origen: 'Consignación'
  })), ...contextoApp.invItems.filter(p => (Number(p.qty) || 0) > 0).map(p => ({
    ...contextoApp.accesorioPublico(p),
    _origen: 'Inventario'
  }))];
  const vistos = new Set();
  for (const origen of Object.keys(contextoApp.KB_ORIGENES)) {
    const lista = kbUltimaLista(origen);
    for (const it of lista && Array.isArray(lista.items) ? lista.items : []) {
      const p = contextoApp.pedidoPublico(it, lista);
      if (!p.nombre || vistos.has(p.id)) continue;
      vistos.add(p.id);
      items.push({
        ...p,
        _origen: 'Lista ' + contextoApp.KB_ORIGENES[origen]
      });
    }
  }
  const ajustes = contextoApp.cfg.catalogoAjustes || {};
  const todas = contextoApp.todasLasCategorias();
  const metas = contextoApp.cfg.catalogoMeta || {};
  return items.map(p => {
    const aj = ajustes[p.id] || {};
    const meta = metas[p.id] || {};
    // La entrega: "pedido" o "inmediato". Por defecto sale de dónde está cargado (las
    // listas son a pedido, el resto inmediato); lo que se tocó a mano manda.
    const entregaBase = p.tipo === 'pedido' ? 'pedido' : 'inmediato';
    const entrega = aj.entrega === 'pedido' || aj.entrega === 'inmediato' ? aj.entrega : entregaBase;
    const tipo = entrega === 'pedido' ? 'pedido' : p.tipo === 'pedido' ? 'equipo' : p.tipo;
    return {
      ...p,
      tipo,
      // Nuevo o usado. La página agrupa los nuevos de un mismo modelo en una tarjeta
      // con variantes (capacidad y color); los usados van uno por uno, cada unidad es única.
      condicion: esUsado(p) ? 'usado' : 'nuevo',
      categoria: aj.categoria && todas.includes(aj.categoria) ? aj.categoria : categoriaDe(p),
      descripcion: String(notas[p.id] || '').trim(),
      // Lo que Juni escribió para la tienda: título propio, meta description y palabras clave.
      ...(meta.titulo ? {
        titulo: meta.titulo
      } : {}),
      ...(meta.seoDescripcion ? {
        seoDescripcion: meta.seoDescripcion
      } : {}),
      ...(meta.keywords ? {
        keywords: meta.keywords
      } : {}),
      _entrega: entrega,
      _entregaBase: entregaBase,
      _catAuto: categoriaDe(p),
      _sale: p.precioUSD > 0 && !fuera.has(p.id)
    };
  });
}

// Los productos seleccionados en la tabla (ids). No se guarda: es para las acciones en bloque.
export /** Los candidatos que pasan los filtros de la barra. */
function catalogoFiltrados() {
  const q = (document.getElementById('cat-q')?.value || '').trim().toLowerCase();
  const fc = document.getElementById('cat-f-cat')?.value || '';
  const ft = document.getElementById('cat-f-tipo')?.value || '';
  return catalogoCandidatos().filter(p => (!q || `${p.nombre} ${p.gb} ${p.color} ${p.estado} ${p._origen}`.toLowerCase().includes(q)) && (!fc || p.categoria === fc) && (!ft && (p._sale || !p.precioUSD) || ft === 'inmediato' && p._entrega === 'inmediato' && p.precioUSD > 0 || ft === 'pedido' && p._entrega === 'pedido' && p.precioUSD > 0 || ft === 'sinprecio' && !p.precioUSD || ft === 'fuera' && p.precioUSD > 0 && !p._sale || ft === 'sinfoto' && !p.fotos.length));
}

/** La descripción que escribe Juni para un producto. Vive en la config, por id. */
export function renderCatalogo() {
  document.getElementById('cat-link').value = contextoApp.LINK_CATALOGO;
  const items = catalogoCandidatos();
  const salen = items.filter(p => p._sale);

  // ¿Lo que se ve en la página coincide con lo que hay ahora?
  const el = document.getElementById('cat-estado');
  if (!contextoApp.catPublicado) {
    el.innerHTML = '<div class="proveedor-alerta alerta-atencion">Todavía no publicaste nunca. La tienda no muestra nada hasta que lo hagas.</div>';
  } else {
    const ahora = JSON.stringify(salen.map(p => {
      const {
        _sale,
        _origen,
        _entrega,
        _entregaBase,
        _catAuto,
        ...q
      } = p;
      return q;
    })) + JSON.stringify(ordenCategorias());
    const antes = JSON.stringify(contextoApp.catPublicado.productos || []) + JSON.stringify(contextoApp.catPublicado.categorias || []);
    const cuando = contextoApp.catPublicado.actualizado ? new Date(contextoApp.catPublicado.actualizado).toLocaleString('es-AR') : '';
    el.innerHTML = ahora === antes ? `<div class="proveedor-alerta">✅ La tienda está al día · ${salen.length} producto${salen.length === 1 ? '' : 's'} publicado${salen.length === 1 ? '' : 's'} · ${esc(cuando)}</div>` : `<div class="proveedor-alerta alerta-atencion">🔔 <b>Hay cambios sin publicar.</b> La tienda muestra lo de ${esc(cuando)}. Tocá Publicar para actualizarla.</div>`;
  }
  if (contextoApp.catVista === 'categorias') {
    renderCategoriasCatalogo();
    return;
  }
  if (contextoApp.catVista === 'fotos') {
    renderFotosCatalogo();
    return;
  }

  // El filtro de categoría, con las que hay; conserva lo elegido.
  const selCat = document.getElementById('cat-f-cat');
  const catElegida = selCat.value;
  selCat.innerHTML = '<option value="">Todas las categorías</option>' + ordenCategorias().map(c => {
    const n = items.filter(p => p.categoria === c).length;
    return n ? `<option value="${esc(c)}" ${c === catElegida ? 'selected' : ''}>${esc(c)} (${n})</option>` : '';
  }).join('');
  const visibles = catalogoFiltrados();
  const ids = new Set(items.map(p => p.id));
  contextoApp.catSeleccion = new Set([...contextoApp.catSeleccion].filter(id => ids.has(id)));
  const sinFoto = salen.filter(p => !p.fotos.length).length;
  const sinPrecio = items.filter(p => !p.precioUSD).length;
  const eliminados = items.filter(p => p.precioUSD > 0 && !p._sale).length;
  document.getElementById('cat-resumen').textContent = `${visibles.length} producto${visibles.length === 1 ? '' : 's'}` + (sinFoto ? ` · ${sinFoto} sin foto` : '') + (sinPrecio ? ` · ${sinPrecio} sin precio (se cargan en Stock o Inventario)` : '') + (eliminados && !document.getElementById('cat-f-tipo').value ? ` · ${eliminados} eliminado${eliminados === 1 ? '' : 's'} del catálogo (ver con el filtro)` : '');
  document.getElementById('cat-sel-todos-btn').textContent = contextoApp.catSeleccion.size && contextoApp.catSeleccion.size >= visibles.length ? 'Deseleccionar' : 'Seleccionar todo';
  document.getElementById('cat-bulk').style.display = contextoApp.catSeleccion.size ? 'flex' : 'none';
  document.getElementById('cat-bulk-n').textContent = `${contextoApp.catSeleccion.size} seleccionado${contextoApp.catSeleccion.size === 1 ? '' : 's'}`;
  document.getElementById('cat-bulk-cat').innerHTML = '<option value="">Mover a categoría…</option>' + ordenCategorias().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  document.getElementById('cat-grid').innerHTML = visibles.map(p => {
    const foto = p.fotos[0];
    const estado = !p.precioUSD ? ['no', 'Sin precio'] : !p._sale ? ['no', 'Eliminado'] : p._entrega === 'pedido' ? ['ped', 'A pedido'] : ['ok', 'Inmediato'];
    return `<div class="cat-prod${p._sale ? '' : ' off'}${contextoApp.catSeleccion.has(p.id) ? ' sel' : ''}" onclick="abrirFichaCatalogo('${escJs(p.id)}')">
      <input type="checkbox" class="sel-box" ${contextoApp.catSeleccion.has(p.id) ? 'checked' : ''} onclick="event.stopPropagation()" onchange="seleccionarCatalogo('${escJs(p.id)}',this.checked)">
      <div class="foto">${foto ? `<img src="${esc(foto)}" loading="lazy" alt="">` : esc((String(p.nombre).match(/\d+/) || [String(p.nombre).slice(0, 1)])[0].slice(0, 2))}</div>
      <div class="cuerpo">
        <div class="nombre">${esc(p.nombre)}</div>
        <div class="sub">${esc([p.gb, p.color, p.categoria].filter(Boolean).join(' · '))}</div>
        <div class="pie"><span class="precio">${p.precioUSD ? contextoApp.fmtUSD(p.precioUSD) : '—'}</span><span class="estado ${estado[0]}">${estado[1]}</span></div>
      </div>
    </div>`;
  }).join('') || `<div class="empty" style="grid-column:1/-1;">${items.length ? 'Nada coincide con el filtro.' : 'No hay productos para publicar.'}</div>`;
}

// ── La ficha de un producto ──────────────────────────────────
export function renderFichaCatalogo() {
  const lista = catalogoFiltrados();
  const p = catalogoCandidatos().find(x => x.id === contextoApp.catFichaId);
  if (!p) {
    window.cerrarFichaCatalogo();
    return;
  }
  const i = lista.findIndex(x => x.id === p.id);
  document.getElementById('cat-panel-anterior').disabled = i <= 0;
  document.getElementById('cat-panel-siguiente').disabled = i < 0 || i >= lista.length - 1;
  document.getElementById('cat-panel-titulo').textContent = p.nombre;
  const meta = (contextoApp.cfg.catalogoMeta || {})[p.id] || {};
  const clave = contextoApp.claveFotoDe(p);
  const archivos = contextoApp.FOTOS[clave] || [];
  const tituloSeo = meta.titulo || [p.nombre, p.gb, p.color].filter(Boolean).join(' ');
  const descSeo = meta.seoDescripcion || p.descripcion || `${p.nombre}${p.gb ? ' ' + p.gb : ''}${p.color ? ' ' + p.color : ''} a ${contextoApp.fmtUSD(p.precioUSD)} en MarplaCity, Mar del Plata.`;
  const urlProd = contextoApp.LINK_CATALOGO + '#p=' + encodeURIComponent(p.id);
  const campo = 'width:100%;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);font-family:inherit;font-size:13.5px;color:var(--text);';
  document.getElementById('cat-panel-cuerpo').innerHTML = `
    <div class="cat-sec">
      <div class="cat-sec-t">Estado</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${!p.precioUSD ? '<span class="cat-pill">Sin precio</span>' : p._sale ? '<span class="cat-pill on">Publicado en la tienda</span>' : `<span class="cat-pill" style="color:var(--neg);">Eliminado del catálogo</span><button class="btn-secondary" style="width:auto;padding:6px 10px;font-size:12.5px;" onclick="toggleCatalogo('${escJs(p.id)}',true);renderFichaCatalogo()">Restaurar</button>`}
        <select onchange="ajusteCatalogo('${escJs(p.id)}','entrega',this.value);renderFichaCatalogo()" style="${campo}width:auto;">
          <option value="inmediato" ${p._entrega === 'inmediato' ? 'selected' : ''}>Entrega inmediata</option>
          <option value="pedido" ${p._entrega === 'pedido' ? 'selected' : ''}>A pedido</option>
        </select>
      </div>
      ${p.precioUSD ? '' : '<div class="proveedor-alerta alerta-atencion" style="margin-top:8px;">Sin precio de venta: no se publica. El precio se carga en Stock o Inventario.</div>'}
    </div>

    <div class="cat-sec">
      <div class="cat-sec-t">Título y descripción</div>
      <div class="field"><label>Título en la tienda</label>
        <input type="text" value="${esc(meta.titulo || '')}" placeholder="${esc(tituloSeo)}" onchange="metaCatalogo('${escJs(p.id)}','titulo',this.value)"></div>
      <div class="field"><label>Descripción</label>
        <textarea rows="4" placeholder="Lo que quieras contar: estado, qué incluye, garantía…" onchange="notaCatalogo('${escJs(p.id)}',this.value)">${esc(p.descripcion)}</textarea></div>
    </div>

    <div class="cat-sec">
      <div class="cat-sec-t">Imágenes <span style="font-weight:400;text-transform:none;letter-spacing:0;">· ${archivos.length ? archivos.length + ' foto' + (archivos.length === 1 ? '' : 's') : 'sin foto'}</span></div>
      ${archivos.length ? `<div class="cat-imgs">${archivos.map((a, k) => {
    const c = contextoApp.FOTOS_CLAS[a] || {};
    return `
        <div class="cat-img${k === 0 ? ' principal' : ''}">
          <img src="${esc(contextoApp.FOTOS_BASE + a)}" loading="lazy" alt="">
          ${k === 0 ? '<span class="tag">Principal</span>' : ''}
          <select onchange="vistaFoto('${escJs(a)}',this.value)" title="Qué muestra (la de frente y dorso va primera)">
            <option value="">vista ?</option>
            ${Object.entries(contextoApp.VISTAS).map(([v, t]) => `<option value="${v}" ${v === c.vista ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>`;
  }).join('')}</div>
        <div style="font-size:11.5px;color:var(--text3);margin-top:8px;">La principal es la de "frente y dorso"; después la de frente. Para sacar una foto o moverla a otro producto, pestaña Fotos.</div>` : `<div class="proveedor-alerta alerta-atencion">Sin foto. Buscala en Amazon desde la pestaña Fotos, o subí un archivo llamado <code>${esc(clave)}.jpg</code> a <code>fotos/</code>.</div>`}
    </div>

    <div class="cat-sec">
      <div class="cat-sec-t">Organización</div>
      <div class="field"><label>Categoría</label>
        <select onchange="ajusteCatalogo('${escJs(p.id)}','categoria',this.value);renderFichaCatalogo()">
          ${ordenCategorias().map(c => `<option value="${esc(c)}" ${c === p.categoria ? 'selected' : ''}>${esc(c)}${c === p._catAuto ? ' (automática)' : ''}</option>`).join('')}
        </select></div>
    </div>

    <div class="cat-sec">
      <div class="cat-sec-t">Datos del producto</div>
      <dl class="cat-kv">
        <dt>Precio</dt><dd style="font-family:'DM Mono',monospace;font-weight:600;">${p.precioUSD ? contextoApp.fmtUSD(p.precioUSD) : '—'}</dd>
        ${p.gb ? `<dt>Capacidad</dt><dd>${esc(p.gb)}</dd>` : ''}
        ${p.color ? `<dt>Color</dt><dd>${esc(p.color)}</dd>` : ''}
        ${p.bateria != null ? `<dt>Batería</dt><dd>${p.bateria}%</dd>` : ''}
        ${p.estado ? `<dt>Estado</dt><dd>${esc(p.estado)}</dd>` : ''}
        <dt>Condición</dt><dd>${p.condicion === 'usado' ? 'Usado' : 'Nuevo'}</dd>
        <dt>Origen</dt><dd>${esc(p._origen)}</dd>
        <dt>Id</dt><dd style="font-family:'DM Mono',monospace;font-size:11.5px;color:var(--text3);">${esc(p.id)}</dd>
      </dl>
      <div style="font-size:11.5px;color:var(--text3);margin-top:8px;">Precio, capacidad, color y batería se editan donde está cargado el producto (Stock, Inventario o la lista de precios).</div>
    </div>

    <div class="cat-sec">
      <div class="cat-sec-t">SEO y metadatos</div>
      <div class="field"><label>Descripción para buscadores (meta description)</label>
        <textarea rows="2" maxlength="160" placeholder="${esc(descSeo)}" onchange="metaCatalogo('${escJs(p.id)}','seoDescripcion',this.value)">${esc(meta.seoDescripcion || '')}</textarea></div>
      <div class="field"><label>Palabras clave <span style="color:var(--text3);font-weight:400;">(separadas por coma)</span></label>
        <input type="text" value="${esc(meta.keywords || '')}" placeholder="iphone 13, usado, mar del plata" onchange="metaCatalogo('${escJs(p.id)}','keywords',this.value)"></div>
      <div class="cat-seo-prev">
        <div class="t">${esc(tituloSeo)} — MarplaCity</div>
        <div class="u">${esc(urlProd)}</div>
        <div class="d">${esc(descSeo.slice(0, 160))}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn-secondary" style="width:auto;padding:7px 10px;font-size:12.5px;" onclick="navigator.clipboard.writeText('${escJs(urlProd)}').then(()=>showToast('Link copiado ✓'))">📋 Copiar link del producto</button>
        <a class="btn-secondary" style="width:auto;padding:7px 10px;font-size:12.5px;text-decoration:none;text-align:center;" href="${esc(urlProd)}" target="_blank" rel="noopener">↗ Ver en la tienda</a>
      </div>
    </div>

    ${p._sale ? `<div class="cat-sec">
      <button class="btn-danger" onclick="eliminarDelCatalogo('${escJs(p.id)}')">Eliminar del catálogo</button>
      <div style="font-size:11.5px;color:var(--text3);margin-top:6px;">Deja de publicarse en la tienda. Sigue en ${esc(p._origen)} y se puede restaurar.</div>
    </div>` : ''}`;
}

/**
 * Lo que hay hoy en la base de fotos. Se dibuja para poder mirarlo: es el unico lugar
 * donde se ve, porque el archivo de imagen esta en el repositorio y el mapa en Firestore.
 */
/** Las claves de foto de todo lo que se puede publicar, para los selects de asignación. */
export function clavesDeProductos() {
  const claves = new Set();
  for (const p of catalogoCandidatos()) {
    const m = slugFoto(p.nombre);
    if (m) claves.add(p.color ? `${m}-${slugFoto(p.color)}` : m);
  }
  return [...claves].sort();
}

// Qué muestra la foto, en el orden en que van dentro de un producto: la de frente y dorso
// juntos es la principal en todo el catálogo; después el frente solo, y el resto.
export function renderFotosCatalogo() {
  const claves = Object.keys(contextoApp.FOTOS).sort();
  const total = claves.reduce((a, k) => a + contextoApp.FOTOS[k].length, 0);
  // Las que la IA miró y no pudo ubicar en ningún producto: se listan para asignarlas a mano.
  const sueltas = Object.keys(contextoApp.FOTOS_CLAS).filter(a => !contextoApp.FOTOS_CLAS[a]?.clave).sort();
  const detalle = k => contextoApp.fotoAbierta !== k ? '' : `
    <div style="grid-column:1/-1;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;display:flex;flex-wrap:wrap;gap:10px;">
      ${contextoApp.FOTOS[k].map(a => {
    const c = contextoApp.FOTOS_CLAS[a] || {};
    return `
        <div style="width:150px;">
          <img src="${esc(contextoApp.FOTOS_BASE + a)}" loading="lazy" style="width:150px;height:110px;object-fit:contain;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);">
          <div style="font-family:'DM Mono',monospace;font-size:9.5px;color:var(--text3);margin:4px 0;word-break:break-all;">${esc(a)}${c.manual ? ' · a mano' : c.clave ? ' · IA' : ''}</div>
          ${contextoApp.selectClave(a, k)}
          ${contextoApp.selectVista(a, c.vista)}
        </div>`;
  }).join('')}
    </div>`;
  const faltan = [...new Set(catalogoCandidatos().filter(p => p._sale && !p.fotos.length).map(contextoApp.claveFotoDe))];
  const btnAmz = document.getElementById('btn-cat-amazon');
  if (btnAmz && !btnAmz.disabled) btnAmz.textContent = faltan.length ? `🛒 Buscar en Amazon (${faltan.length} sin foto)` : '🛒 Buscar en Amazon';
  document.getElementById('cat-fotos').innerHTML = !claves.length && !sueltas.length ? '<div class="proveedor-alerta alerta-atencion">La base de fotos está vacía. Subí archivos a <code>fotos/</code> y tocá Clasificar.</div>' : `<div class="proveedor-alerta" style="margin-bottom:10px;"><b>${total}</b> imagen${total === 1 ? '' : 'es'} de <b>${claves.length}</b> modelo${claves.length === 1 ? '' : 's'}${faltan.length ? ` · <b>${faltan.length}</b> producto${faltan.length === 1 ? '' : 's'} sin foto` : ''}. Tocá una para ver sus fotos y moverlas.</div>
       <div style="display:grid;grid-template-columns:repeat(auto-fill,82px);gap:10px;">${claves.map(k => `
         <div style="width:82px;text-align:center;cursor:pointer;" onclick="abrirFotoCat('${escJs(k)}')">
           <img src="${esc(contextoApp.FOTOS_BASE + contextoApp.FOTOS[k][0])}" loading="lazy"
                style="width:82px;height:82px;object-fit:contain;background:#fff;border:1px solid ${contextoApp.fotoAbierta === k ? 'var(--text)' : 'var(--border)'};border-radius:var(--radius-sm);">
           <div style="font-family:'DM Mono',monospace;font-size:9.5px;color:var(--text3);margin-top:4px;word-break:break-all;line-height:1.25;">${esc(k)}${contextoApp.FOTOS[k].length > 1 ? ` ·${contextoApp.FOTOS[k].length}` : ''}</div>
         </div>${detalle(k)}`).join('')}</div>
       ${sueltas.length ? `
       <div class="proveedor-alerta alerta-atencion" style="margin-top:14px;">📷 <b>${sueltas.length} foto${sueltas.length === 1 ? '' : 's'} sin identificar.</b> La IA no supo de qué producto son: asignalas vos.</div>
       <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;">${sueltas.map(a => `
         <div style="width:150px;">
           <img src="${esc(contextoApp.FOTOS_BASE + a)}" loading="lazy" style="width:150px;height:110px;object-fit:contain;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);">
           <div style="font-family:'DM Mono',monospace;font-size:9.5px;color:var(--text3);margin:4px 0;word-break:break-all;">${esc(a)}${contextoApp.FOTOS_CLAS[a]?.nota ? ` · ${esc(contextoApp.FOTOS_CLAS[a].nota)}` : ''}</div>
           ${contextoApp.selectClave(a, '')}
         </div>`).join('')}</div>` : ''}`;
}
/** Los archivos de imagen que hay de verdad en `fotos/`, según GitHub. */
export async function archivosDeFotos() {
  const r = await fetch('https://api.github.com/repos/marplacityy/marplacity-sistema/contents/fotos');
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub pidió esperar un rato (límite de consultas)' : 'GitHub contestó ' + r.status);
  return (await r.json()).filter(f => f.type === 'file' && /\.(jpe?g|png|webp)$/i.test(f.name)).map(f => f.name);
}

/** Guarda el mapa y las decisiones. Solo se conservan decisiones de archivos que existen. */
export async function guardarFotos(archivos) {
  const vivos = new Set(archivos);
  const clasificacion = Object.fromEntries(Object.entries(contextoApp.FOTOS_CLAS).filter(([a]) => vivos.has(a)));
  const mapa = armarMapaFotos(archivos, clasificacion);
  setSyncDot('syncing');
  await setDoc(contextoApp.fotosDoc, contextoApp.withUser({
    mapa,
    clasificacion,
    base: contextoApp.LINK_CATALOGO.replace(/[^/]+$/, '') + 'fotos/',
    actualizado: new Date().toISOString()
  }), {
    merge: false
  });
  return mapa;
}

/**
 * Una foto achicada a 1024 px y en JPEG, en base64, para mandarla a la IA.
 * Las fotos del celular pesan 3 o 4 MB; así van a 150 KB y la clasificación sale igual.
 */
export async function fotoParaIA(archivo) {
  const r = await fetch(contextoApp.FOTOS_RAW + encodeURIComponent(archivo));
  if (!r.ok) throw new Error(`no pude leer ${archivo} (${r.status})`);
  const bmp = await createImageBitmap(await r.blob());
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height); // los PNG con transparencia, sobre blanco
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

/**
 * Le muestra a la IA las fotos que todavía no tienen producto y le pide que diga de cuál
 * son. Una foto "nueva" es la que no tiene decisión guardada y cuyo nombre tampoco
 * coincide con un producto: las que ya se nombraron bien a mano no se vuelven a mirar.
 */
/**
 * Busca en Amazon (vía el Worker tienda, que tiene la clave de SerpApi) las fotos de
 * los productos publicados que no tienen ninguna, y las sube a fotos/ del repo. Va de a
 * uno, con el progreso a la vista: cada producto es una búsqueda paga. Al terminar se
 * rearma el mapa con la IA para confirmar modelo y color.
 */
export function inicializarCatalogo() {
  // ══ Catálogo web ═════════════════════════════════════════════
  //
  // Una página pública con los equipos que hay. Lo importante no es la página: es QUÉ SE
  // ESCRIBE en el documento que la alimenta.
  //
  // La regla de Firestore deja que ese doc lo lea cualquiera, sin estar logueado, porque
  // es para clientes. O sea que no hay forma de "mostrar solo algunos campos" del lado del
  // que lee: lo que esté adentro, se ve. Por eso el filtrado pasa acá, al escribir, y hay
  // una sola función que arma el producto público. Si algún día hay que sumar un dato, se
  // agrega ahí y en ningún otro lado.
  //
  // NUNCA entran: el costo (`valorUSD` en stock, `precioUSD` en consignación, que es lo
  // que se le debe al proveedor), el IMEI, el proveedor, las notas internas, ni los
  // chequeos de FMI y blacklist.
  // ══ Pedidos del catálogo web ═════════════════════════════════
  //
  // Los escribe el Worker `tienda`; acá solo se miran y se cierran. Un pedido está
  // "abierto" mientras haya alguien esperando algo: pagó o reservó y todavía no se le
  // entregó. Lo demás (creado sin pagar, rechazado, entregado, cancelado) es historial.
  contextoApp.PED_ESTADOS = {
    creado: ['Sin pagar', 'badge-per'],
    pendiente: ['Pago en proceso', 'badge-per'],
    pagado: ['Pagado', 'badge-inc'],
    reservado: ['Reservado', 'badge-inc'],
    rechazado: ['Rechazado', 'badge-neg'],
    devuelto: ['Devuelto', 'badge-neg'],
    entregado: ['Entregado', ''],
    cancelado: ['Cancelado', '']
  };
  contextoApp.PED_PAGOS = {
    mp: 'Mercado Pago',
    tarjeta: 'Tarjeta (USD)',
    efectivo: 'Efectivo en el local'
  };
  contextoApp.pedidoAbierto = p => p.estado === 'pagado' || p.estado === 'reservado' || p.estado === 'pendiente';
  window.filtrarPedidos = f => {
    contextoApp.pedidosFiltro = f;
    renderPedidos();
  };
  window.cerrarPedido = async function (id, estado) {
    const p = contextoApp.pedidosItems.find(x => x.id === id);
    if (!p) return;
    if (estado === 'cancelado' && !confirm(`¿Cancelar el pedido de ${p.cliente?.nombre || 'este cliente'}?\n\n${p.estado === 'pagado' ? 'OJO: ya está pagado. La devolución del dinero la tenés que hacer desde Mercado Pago, esto solo lo saca de la lista.' : 'Solo lo saca de la lista de pedidos por atender.'}`)) return;
    setSyncDot('syncing');
    try {
      await updateDoc(doc(contextoApp.db, 'pedidos', id), {
        estado,
        actualizado: new Date().toISOString(),
        cerradoPor: contextoApp.currentUser && contextoApp.currentUser.email || contextoApp.uid
      });
      showToast(estado === 'entregado' ? 'Pedido entregado ✓' : 'Pedido cancelado');
    } catch (e) {
      showToast('No se pudo: ' + e.message, true);
      setSyncDot('error');
    }
  };

  // El catálogo de fotos vive en Firestore (`catalogo/fotos`), no acá.
  //
  // Estaba escrito en el código, y eso significaba que solo lo veía el sistema. Ahora es
  // un dato: lo lee esta pantalla para publicar, y lo puede leer el bot de Instagram para
  // saber de qué equipos hay imagen y dónde está cada una. Una sola fuente para los dos.
  //
  // La clave es `modelo-color` cuando la foto es de ese color, y `modelo` a secas cuando
  // sirve para cualquiera. Importa porque hay dos iPhone 15 en stock, uno negro y uno
  // rosa: con una sola foto por modelo, al rosa le saldría la del negro.
  contextoApp.FOTOS = {}; // { 'iphone-15-black': ['iphone-15-black.jpg'], ... }
  contextoApp.FOTOS_BASE = 'fotos/'; // el prefijo, por si algún día se mudan a otro lado
  // Qué decidió la IA (o Juni a mano) de cada archivo: { 'IMG_0412.jpg': { clave, vista, confianza, manual } }.
  // `clave` en null es "mirada y no identificada". Manda sobre el nombre del archivo.
  contextoApp.FOTOS_CLAS = {};
  contextoApp.fotoAbierta = null; // la clave cuyo detalle está desplegado en la grilla
  // Los archivos se leen de acá para clasificar: es la copia cruda del repo, disponible al
  // instante después del push, sin esperar a que GitHub Pages termine de publicar.
  contextoApp.FOTOS_RAW = 'https://raw.githubusercontent.com/marplacityy/marplacity-sistema/main/fotos/';
  contextoApp.fotosDoc = doc(contextoApp.db, 'catalogo', 'fotos');
  contextoApp.catalogoDoc = doc(contextoApp.db, 'catalogo', 'publico');
  contextoApp.catPublicado = null; // lo último que se publicó, para comparar
  contextoApp.LINK_CATALOGO = configuracion.basePublica + 'catalogo.html'; // Reglas de cobro de la tienda. Pagar con tarjeta en dólares (Stripe) lleva recargo, y
  // Mercado Pago se ofrece solo para productos baratos: cobrar un teléfono por ahí dispara
  // impuestos que se comen el margen. Decidido por Juni el 06/09/2026.
  contextoApp.RECARGO_TARJETA_PCT = 5; // Mercado Pago cobra 8% con acreditación inmediata (visto en el primer pago real, 06/09/2026).
  contextoApp.RECARGO_MP_PCT = 8;
  contextoApp.MP_MAX_USD = 200;
  /**
   * El nombre del archivo de foto que le corresponde a un modelo.
   *
   * No hay una tabla que asocie producto con imagen: el nombre ES la asociación. "iPhone
   * 14 Pro" busca `fotos/iphone-14-pro.png`. Si el archivo no está, la página se cae sola
   * al recuadro con el modelo en grande, así que sumar una foto es dejarla en esa carpeta
   * con el nombre correcto y nada más — sin tocar código ni volver a publicar.
   *
   * Se le saca la capacidad porque la foto es del MODELO: un 128GB y un 256GB son la
   * misma foto.
   */

  contextoApp.productoPublico = (p, origen) => ({
    id: `${origen}_${p.id}`,
    tipo: 'equipo',
    nombre: String(p.nombre || p.producto || '').trim(),
    gb: String(p.gb || '').trim(),
    color: String(p.color || '').trim(),
    bateria: p.bateria != null && p.bateria !== '' ? Number(p.bateria) : null,
    ciclos: p.ciclos != null && p.ciclos !== '' ? Number(p.ciclos) : null,
    estado: String(p.estadoProducto || p.cosmetica || '').trim(),
    precioUSD: Number(origen === 'consig' ? p.precioVenta : p.precioVentaUSD) || 0,
    fotos: fotosDe(p.nombre || p.producto, p.color)
  }); // Un precio en la moneda que sea, pasado a dólares con el tipo de cambio de Configuración.
  contextoApp.enUSD = (precio, moneda) => {
    const n = Number(precio) || 0;
    if (moneda !== 'ARS') return n;
    const tc = parseFloat(contextoApp.cfg.tc) || 0;
    return tc ? Math.round(n / tc) : 0;
  };
  /** Un artículo del inventario (accesorios, cargadores, fundas): sin color ni batería. */
  contextoApp.accesorioPublico = p => ({
    id: `inv_${p.id}`,
    tipo: 'accesorio',
    nombre: String(p.nombre || '').trim(),
    gb: '',
    color: '',
    bateria: null,
    ciclos: null,
    estado: '',
    precioUSD: contextoApp.enUSD(p.sugerido, p.moneda),
    fotos: fotosDe(p.nombre, '')
  });
  /**
   * Un ítem de una lista de precios: NO está en el local, se trae a pedido. El id sale del
   * nombre y no de un doc, porque cada guardado de la lista es un doc nuevo y el cliente
   * que compartió el link ayer tiene que seguir cayendo en el mismo producto hoy.
   */
  contextoApp.pedidoPublico = (it, lista) => ({
    id: 'lista_' + slugFoto([it.producto, it.gb, it.color, it.condicion].filter(Boolean).join(' ')),
    tipo: 'pedido',
    nombre: String(it.producto || '').trim(),
    gb: String(it.gb || '').trim(),
    color: String(it.color || '').trim(),
    bateria: null,
    ciclos: null,
    estado: it.condicion === 'nuevo' ? 'Nuevo' : it.condicion === 'usado' ? 'Usado' : '',
    precioUSD: contextoApp.enUSD(it.precioPublico, lista.moneda),
    fotos: fotosDe(it.producto, it.color)
  });
  /**
   * La categoría de la página, deducida del nombre y del estado. Las categorías las pidió
   * Juni el 06/09/2026; el orden de las secciones de la portada es este por defecto y se
   * edita desde la pantalla Catálogo (cfg.catalogoCategorias). Las reglas se prueban de
   * arriba a abajo y gana la primera: los accesorios van antes que los equipos porque
   * "funda iPhone 15" tiene "iPhone" adentro.
   */

  /** Todas las categorías: las fijas más las que creó Juni (cfg.catalogoCategoriasExtra). */
  contextoApp.todasLasCategorias = () => [...CATEGORIAS_CATALOGO, ...(Array.isArray(contextoApp.cfg.catalogoCategoriasExtra) ? contextoApp.cfg.catalogoCategoriasExtra : [])];
  window.nuevaCategoria = function () {
    const nombre = String(prompt('Nombre de la categoría nueva (por ejemplo "Parlantes"):') || '').trim();
    if (!nombre) return;
    if (contextoApp.todasLasCategorias().some(c => c.toLowerCase() === nombre.toLowerCase())) {
      showToast('Esa categoría ya existe', true);
      return;
    }
    contextoApp.cfg.catalogoCategoriasExtra = [...(contextoApp.cfg.catalogoCategoriasExtra || []), nombre];
    setDoc(contextoApp.cfgDoc, contextoApp.withUser({
      catalogoCategoriasExtra: contextoApp.cfg.catalogoCategoriasExtra
    }), {
      merge: true
    }).catch(() => {});
    showToast(`Categoría "${nombre}" creada — asignale productos desde la tabla`);
    renderCatalogo();
  };

  /** Borrar una categoría propia. Los productos que la tenían vuelven a la automática. */
  window.borrarCategoria = function (nombre) {
    if (CATEGORIAS_CATALOGO.includes(nombre)) return;
    if (!confirm(`¿Borrar la categoría "${nombre}"?\n\nLos productos que la tenían vuelven a su categoría automática. No se borra ningún producto.`)) return;
    const ajustes = {
      ...(contextoApp.cfg.catalogoAjustes || {})
    };
    for (const id in ajustes) if (ajustes[id]?.categoria === nombre) {
      delete ajustes[id].categoria;
      if (!Object.keys(ajustes[id]).length) delete ajustes[id];
    }
    contextoApp.cfg.catalogoAjustes = ajustes;
    contextoApp.cfg.catalogoCategoriasExtra = (contextoApp.cfg.catalogoCategoriasExtra || []).filter(c => c !== nombre);
    contextoApp.cfg.catalogoCategorias = (contextoApp.cfg.catalogoCategorias || []).filter(c => c !== nombre);
    setDoc(contextoApp.cfgDoc, contextoApp.withUser({
      catalogoAjustes: ajustes,
      catalogoCategoriasExtra: contextoApp.cfg.catalogoCategoriasExtra,
      catalogoCategorias: contextoApp.cfg.catalogoCategorias
    }), {
      merge: true
    }).catch(() => {});
    renderCatalogo();
  };

  /** Lo que Juni decidió a mano de un producto: categoría y/o entrega. Vive en cfg.catalogoAjustes[id]. */
  window.ajusteCatalogo = function (id, campo, valor) {
    const ajustes = {
      ...(contextoApp.cfg.catalogoAjustes || {})
    };
    const aj = {
      ...(ajustes[id] || {})
    };
    if (valor) aj[campo] = valor;else delete aj[campo];
    if (Object.keys(aj).length) ajustes[id] = aj;else delete ajustes[id];
    contextoApp.cfg.catalogoAjustes = ajustes;
    setDoc(contextoApp.cfgDoc, contextoApp.withUser({
      catalogoAjustes: ajustes
    }), {
      merge: true
    }).catch(() => {});
    renderCatalogo();
  };
  window.moverCategoria = function (nombre, delta) {
    const orden = ordenCategorias();
    const i = orden.indexOf(nombre),
      j = i + delta;
    if (i < 0 || j < 0 || j >= orden.length) return;
    [orden[i], orden[j]] = [orden[j], orden[i]];
    contextoApp.cfg.catalogoCategorias = orden;
    setDoc(contextoApp.cfgDoc, contextoApp.withUser({
      catalogoCategorias: orden
    }), {
      merge: true
    }).catch(() => {});
    renderCatalogo();
  };
  contextoApp.catSeleccion = new Set();
  /** Seleccionar un producto (id) o todos los visibles (id null). */
  window.seleccionarCatalogo = function (id, on) {
    if (id) on ? contextoApp.catSeleccion.add(id) : contextoApp.catSeleccion.delete(id);else if (on) catalogoFiltrados().forEach(p => contextoApp.catSeleccion.add(p.id));else contextoApp.catSeleccion.clear();
    renderCatalogo();
  };

  /**
   * Una acción sobre todos los seleccionados: mover de categoría, cambiar la entrega,
   * sacar o incluir en el catálogo. Un solo guardado por acción.
   */
  window.accionCatalogo = function (campo, valor) {
    const ids = [...contextoApp.catSeleccion];
    if (!ids.length) return;
    if (campo === 'sale') {
      if (!valor && !confirm(`¿Eliminar del catálogo ${ids.length === 1 ? 'el producto seleccionado' : 'los ' + ids.length + ' seleccionados'}?\n\nDejan de publicarse en la tienda. No se borra nada del sistema: siguen en Stock, Inventario o la lista, y podés restaurarlos desde el filtro "Eliminados del catálogo".`)) return;
      const fuera = new Set(contextoApp.cfg.catalogoExcluidos || []);
      ids.forEach(id => valor ? fuera.delete(id) : fuera.add(id));
      contextoApp.cfg.catalogoExcluidos = [...fuera];
      setDoc(contextoApp.cfgDoc, contextoApp.withUser({
        catalogoExcluidos: contextoApp.cfg.catalogoExcluidos
      }), {
        merge: true
      }).catch(() => {});
      showToast(valor ? `${ids.length} restaurado${ids.length === 1 ? '' : 's'} en el catálogo` : `${ids.length} eliminado${ids.length === 1 ? '' : 's'} del catálogo`);
    } else {
      const ajustes = {
        ...(contextoApp.cfg.catalogoAjustes || {})
      };
      ids.forEach(id => {
        ajustes[id] = {
          ...(ajustes[id] || {}),
          [campo]: valor
        };
      });
      contextoApp.cfg.catalogoAjustes = ajustes;
      setDoc(contextoApp.cfgDoc, contextoApp.withUser({
        catalogoAjustes: ajustes
      }), {
        merge: true
      }).catch(() => {});
      showToast(campo === 'categoria' ? `${ids.length} movidos a "${valor}"` : `${ids.length} marcados como ${valor === 'pedido' ? 'a pedido' : 'inmediato'}`);
    }
    contextoApp.catSeleccion.clear();
    renderCatalogo();
  };

  /** Eliminar del catálogo desde la ficha: pasa al siguiente producto, o cierra si era el último. */
  window.eliminarDelCatalogo = function (id) {
    if (!confirm('¿Eliminar este producto del catálogo?\n\nDeja de publicarse en la tienda. No se borra del sistema y se puede restaurar.')) return;
    const lista = catalogoFiltrados();
    const i = lista.findIndex(p => p.id === id);
    const vecino = lista[i + 1] || lista[i - 1];
    window.toggleCatalogo(id, false);
    if (vecino) {
      contextoApp.catFichaId = vecino.id;
      renderFichaCatalogo();
    } else window.cerrarFichaCatalogo();
  };
  window.filtrarCatalogo = () => renderCatalogo();
  window.notaCatalogo = function (id, texto) {
    const notas = {
      ...(contextoApp.cfg.catalogoNotas || {})
    };
    texto = String(texto || '').trim();
    if (texto) notas[id] = texto;else delete notas[id];
    contextoApp.cfg.catalogoNotas = notas;
    setDoc(contextoApp.cfgDoc, contextoApp.withUser({
      catalogoNotas: notas
    }), {
      merge: true
    }).catch(() => {});
  };

  // Qué pestaña del catálogo está abierta: productos, categorias, fotos.
  contextoApp.catVista = 'productos';
  window.catTab = function (v) {
    contextoApp.catVista = v;
    ['productos', 'categorias', 'fotos'].forEach(t => {
      document.getElementById('cat-vista-' + t).style.display = t === v ? '' : 'none';
      document.getElementById('cat-tab-' + t).classList.toggle('on', t === v);
    });
    renderCatalogo();
  };
  window.LINK_CATALOGO_PUBLICO = () => contextoApp.LINK_CATALOGO;

  /** La clave de foto de un producto (modelo + color), la misma que usa la página. */
  contextoApp.claveFotoDe = p => slugFoto(p.nombre) + (p.color ? '-' + slugFoto(p.color) : '');
  contextoApp.catFichaId = null;
  window.abrirFichaCatalogo = function (id) {
    contextoApp.catFichaId = id;
    renderFichaCatalogo();
    document.getElementById('cat-panel-fondo').classList.add('open');
    document.getElementById('cat-panel').classList.add('open');
  };
  window.cerrarFichaCatalogo = function () {
    contextoApp.catFichaId = null;
    document.getElementById('cat-panel-fondo').classList.remove('open');
    document.getElementById('cat-panel').classList.remove('open');
  };
  /** Pasar al producto anterior o siguiente de la grilla, sin cerrar la ficha. */
  window.fichaCatalogoVecina = function (delta) {
    const lista = catalogoFiltrados();
    const i = lista.findIndex(p => p.id === contextoApp.catFichaId);
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    contextoApp.catFichaId = lista[j].id;
    renderFichaCatalogo();
  };

  /** Lo que Juni escribió a mano de un producto: descripción, título SEO, etc. Vive en cfg.catalogoNotas[id] (texto) y cfg.catalogoMeta[id] (objeto). */
  window.metaCatalogo = function (id, campo, valor) {
    const meta = {
      ...(contextoApp.cfg.catalogoMeta || {})
    };
    const m = {
      ...(meta[id] || {})
    };
    valor = String(valor || '').trim();
    if (valor) m[campo] = valor;else delete m[campo];
    if (Object.keys(m).length) meta[id] = m;else delete meta[id];
    contextoApp.cfg.catalogoMeta = meta;
    setDoc(contextoApp.cfgDoc, contextoApp.withUser({
      catalogoMeta: meta
    }), {
      merge: true
    }).catch(() => {});
    if (campo === 'titulo' || campo === 'seoDescripcion') renderFichaCatalogo(); // para la vista previa
  };
  contextoApp.VISTAS = {
    ambos: 'frente y dorso',
    frente: 'frente',
    dorso: 'dorso',
    lateral: 'lateral',
    caja: 'caja',
    otro: 'otro'
  };
  contextoApp.selectVista = (archivo, actual) => `<select onchange="vistaFoto('${escJs(archivo)}',this.value)"
      style="width:100%;font-size:11px;padding:4px 6px;margin-top:4px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);">
    <option value="">vista: ?</option>
    ${Object.entries(contextoApp.VISTAS).map(([k, v]) => `<option value="${k}" ${k === actual ? 'selected' : ''}>vista: ${v}</option>`).join('')}
  </select>`;
  contextoApp.selectClave = (archivo, actual) => {
    const opciones = [...new Set([...clavesDeProductos(), ...Object.keys(contextoApp.FOTOS)])].sort();
    return `<select onchange="asignarFoto('${escJs(archivo)}',this.value)"
      style="width:100%;font-size:11px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);">
    <option value="">— sin asignar —</option>
    ${opciones.map(k => `<option value="${esc(k)}" ${k === actual ? 'selected' : ''}>${esc(k)}</option>`).join('')}
  </select>`;
  };
  window.abrirFotoCat = k => {
    contextoApp.fotoAbierta = contextoApp.fotoAbierta === k ? null : k;
    renderFotosCatalogo();
  };

  /** Corregir qué muestra una foto. Cambia el orden dentro del producto: "ambos" pasa a ser la principal. */
  window.vistaFoto = async function (archivo, vista) {
    const previa = contextoApp.FOTOS_CLAS[archivo] || {};
    // Si el archivo no tenía decisión, la clave sigue saliendo del nombre: se conserva la que tiene hoy.
    const clave = 'clave' in previa ? previa.clave : Object.keys(contextoApp.FOTOS).find(k => contextoApp.FOTOS[k].includes(archivo)) || null;
    contextoApp.FOTOS_CLAS = {
      ...contextoApp.FOTOS_CLAS,
      [archivo]: {
        ...previa,
        clave,
        vista: vista || '',
        manual: true
      }
    };
    const archivos = [...new Set([...Object.values(contextoApp.FOTOS).flat(), ...Object.keys(contextoApp.FOTOS_CLAS)])];
    await guardarFotos(archivos);
  };

  /** Mover una foto a un producto (o sacarla). Lo que se decide a mano pisa a la IA y al nombre. */
  window.asignarFoto = async function (archivo, clave) {
    contextoApp.FOTOS_CLAS = {
      ...contextoApp.FOTOS_CLAS,
      [archivo]: {
        ...(contextoApp.FOTOS_CLAS[archivo] || {}),
        clave: clave || null,
        manual: true
      }
    };
    const archivos = [...new Set([...Object.values(contextoApp.FOTOS).flat(), ...Object.keys(contextoApp.FOTOS_CLAS)])];
    await guardarFotos(archivos);
  };
  window.buscarFotosAmazon = async function () {
    const btn = document.getElementById('btn-cat-amazon');
    if (!btn) return;
    const salen = catalogoCandidatos().filter(p => p._sale && !p.fotos.length);
    // Un producto por modelo+color: las variantes de capacidad comparten la foto.
    const vistos = new Set(),
      lista = [];
    for (const p of salen) {
      const k = slugFoto(p.nombre) + (p.color ? '-' + slugFoto(p.color) : '');
      if (vistos.has(k)) continue;
      vistos.add(k);
      lista.push(p);
    }
    if (!lista.length) return;
    // De a 20: cada producto es una búsqueda paga (250 gratis por mes). Una tanda de
    // 181 se comió el mes entero de un click el 07/09/2026.
    const TANDA = 20;
    const tanda = lista.slice(0, TANDA);
    if (!confirm(`Buscar fotos en Amazon para ${tanda.length} producto${tanda.length === 1 ? '' : 's'}${lista.length > TANDA ? ` (de ${lista.length} sin foto: van de a ${TANDA} por vez)` : ''}?\n\nCada uno es una búsqueda (hay 250 gratis por mes). Las fotos que encuentre se suben a fotos/ del repositorio y después la IA las revisa.`)) return;
    btn.disabled = true;
    let ok = 0,
      sin = 0,
      fallo = 0;
    const detalle = [];
    for (let i = 0; i < tanda.length; i++) {
      const p = tanda[i];
      btn.textContent = `Buscando ${i + 1} de ${tanda.length}: ${p.nombre}…`;
      try {
        const r = await fetch(contextoApp.TIENDA_URL + '/fotos', {
          method: 'POST',
          headers: await workerHeaders(),
          body: JSON.stringify({
            nombre: p.nombre,
            gb: p.gb,
            color: p.color,
            tipo: p.tipo
          })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `el Worker respondió ${r.status}`);
        if (d.subidos?.length) {
          ok++;
          detalle.push(`✓ ${p.nombre}${p.color ? ' ' + p.color : ''}: ${d.subidos.length} foto${d.subidos.length === 1 ? '' : 's'}`);
        } else {
          sin++;
          detalle.push(`– ${p.nombre}${p.color ? ' ' + p.color : ''}: nada parecido en Amazon`);
        }
      } catch (e) {
        fallo++;
        detalle.push(`✕ ${p.nombre}: ${e.message}`);
        if (/SERPAPI|GITHUB|no autorizado/i.test(e.message)) break;
      }
    }
    btn.disabled = false;
    console.log('Fotos desde Amazon:\n' + detalle.join('\n'));
    showToast(`Amazon: ${ok} con foto, ${sin} sin resultado${fallo ? `, ${fallo} con error` : ''}${lista.length > TANDA ? ` · quedan ${lista.length - tanda.length} sin foto para otra tanda` : ''}. Ahora tocá "Clasificar fotos nuevas" para que la IA las confirme.`);
    renderCatalogo();
  };
  window.clasificarFotos = async function () {
    const btn = document.getElementById('btn-cat-ia');
    btn.disabled = true;
    btn.textContent = 'Leyendo la carpeta…';
    try {
      const archivos = await archivosDeFotos();
      const conocidas = new Set(clavesDeProductos());
      const stems = new Set(archivos.map(n => n.replace(/\.[^.]+$/, '')));
      const nuevas = archivos.filter(a => {
        if (contextoApp.FOTOS_CLAS[a]) return false;
        const stem = a.replace(/\.[^.]+$/, '');
        const m = /^(.+)-[2-9]$/.exec(stem);
        return !conocidas.has(m && stems.has(m[1]) ? m[1] : stem);
      });
      if (!nuevas.length) {
        await guardarFotos(archivos);
        showToast('No hay fotos nuevas para clasificar — mapa sincronizado ✓');
        return;
      }

      // Los productos entre los que tiene que elegir: nombre y color, sin capacidad.
      const productos = [...new Set(catalogoCandidatos().map(p => JSON.stringify({
        producto: p.nombre,
        color: p.color || ''
      })))].map(x => JSON.parse(x));
      const LOTE = 6;
      let hechas = 0;
      for (let i = 0; i < nuevas.length; i += LOTE) {
        const lote = nuevas.slice(i, i + LOTE);
        btn.textContent = `Mirando ${Math.min(i + LOTE, nuevas.length)} de ${nuevas.length}…`;
        const contenido = [];
        for (const a of lote) {
          contenido.push({
            type: 'text',
            text: `Archivo: ${a}`
          });
          contenido.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: await fotoParaIA(a)
            }
          });
        }
        contenido.push({
          type: 'text',
          text: `Sos el que ordena las fotos de productos de un local de celulares. Para CADA archivo de arriba decí de qué producto es.

Productos que se venden (elegí "producto" y "color" EXACTAMENTE de esta lista; si la foto es de un producto que no está, poné null en producto):
${JSON.stringify(productos)}

Reglas:
- Mirá el equipo de la foto: modelo (por cámaras, botones, isla, notch, tamaño), color, si es un accesorio.
- vista: si la foto muestra el FRENTE Y EL DORSO JUNTOS (dos teléfonos lado a lado, uno de pantalla y otro de espalda), vista = "ambos": esa es la foto principal. Solo el frente (pantalla), "frente". Solo el dorso, "dorso". De costado, "lateral". La caja o los accesorios, "caja". Otra cosa, "otro".
- Si dudás entre dos modelos parecidos (13 vs 14, Pro vs no Pro), poné confianza "baja".
- No inventes colores que no están en la lista para ese producto.

Devolvé SOLO un JSON array, sin texto ni backticks, un objeto por archivo:
[{"archivo":"...","producto":"iPhone 13"|null,"color":"Red"|"","vista":"ambos|frente|dorso|lateral|caja|otro","confianza":"alta|baja","nota":"qué viste, en 5 palabras"}]`
        });
        const resp = await fetch(contextoApp.WORKER_URL, {
          method: 'POST',
          headers: await workerHeaders(),
          body: JSON.stringify({
            model: 'claude-sonnet-5',
            max_tokens: 3000,
            output_config: {
              effort: 'low'
            },
            messages: [{
              role: 'user',
              content: contenido
            }]
          })
        });
        const txt = textoDeIA(await resp.json()).replace(/^```(?:json)?\s*|\s*```$/g, '');
        const lista = JSON.parse(txt);
        if (!Array.isArray(lista)) throw new Error('la IA no devolvió una lista');
        for (const r of lista) {
          if (!lote.includes(r.archivo)) continue;
          const clave = r.producto ? slugFoto(r.producto) + (r.color ? '-' + slugFoto(r.color) : '') : null;
          contextoApp.FOTOS_CLAS = {
            ...contextoApp.FOTOS_CLAS,
            [r.archivo]: {
              clave,
              vista: String(r.vista || 'otro'),
              confianza: String(r.confianza || ''),
              nota: String(r.nota || '').slice(0, 80),
              manual: false
            }
          };
          hechas++;
        }
        // Lo que la IA no nombró queda como "sin identificar", para que no se vuelva a pagar.
        for (const a of lote) if (!contextoApp.FOTOS_CLAS[a]) contextoApp.FOTOS_CLAS = {
          ...contextoApp.FOTOS_CLAS,
          [a]: {
            clave: null,
            vista: 'otro',
            nota: 'la IA no la mencionó',
            manual: false
          }
        };
      }
      const mapa = await guardarFotos(archivos);
      const sinDueno = nuevas.filter(a => !contextoApp.FOTOS_CLAS[a]?.clave).length;
      const bajas = nuevas.filter(a => contextoApp.FOTOS_CLAS[a]?.confianza === 'baja').length;
      showToast(`Clasificadas ${hechas} foto${hechas === 1 ? '' : 's'} ✓ — ${Object.keys(mapa).length} modelos con imagen` + (sinDueno ? ` · ${sinDueno} sin identificar` : '') + (bajas ? ` · ${bajas} con duda, revisalas` : ''));
    } catch (e) {
      showToast('No pude clasificar: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = '🤖 Clasificar fotos nuevas';
  };

  /**
   * Rearma el mapa leyendo qué archivos hay realmente en `fotos/`.
   *
   * El navegador no puede listar una carpeta, pero el repositorio es público y GitHub la
   * lista por su API. Se pregunta ahí a propósito: eso es lo que GitHub Pages termina
   * sirviendo, así que si un archivo aparece en la lista, la URL de la foto anda seguro.
   *
   * La clave sale del nombre del archivo sin extensión. Las fotos extra del mismo equipo
   * terminan en `-2`, `-3`: ese sufijo se saca SOLO si existe el archivo base sin él, para
   * no romper un modelo que de verdad termine en número.
   */
  window.sincronizarFotos = async function () {
    const btn = document.getElementById('btn-cat-fotos');
    btn.disabled = true;
    btn.textContent = 'Leyendo la carpeta…';
    try {
      const archivos = await archivosDeFotos();
      const mapa = await guardarFotos(archivos);
      showToast(`Fotos sincronizadas ✓ — ${archivos.length} imagen${archivos.length === 1 ? '' : 'es'}, ${Object.keys(mapa).length} modelos`);
    } catch (e) {
      showToast('No pude sincronizar: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = '🔄 Sincronizar con la carpeta';
  };
  window.toggleCatalogo = function (id, sale) {
    const fuera = new Set(contextoApp.cfg.catalogoExcluidos || []);
    sale ? fuera.delete(id) : fuera.add(id);
    contextoApp.cfg.catalogoExcluidos = [...fuera];
    setDoc(contextoApp.cfgDoc, contextoApp.withUser({
      catalogoExcluidos: contextoApp.cfg.catalogoExcluidos
    }), {
      merge: true
    }).catch(() => {});
    renderCatalogo();
  };
  window.copiarLinkCatalogo = function () {
    navigator.clipboard.writeText(contextoApp.LINK_CATALOGO).then(() => showToast('Link copiado ✓')).catch(() => showToast('No pude copiar — seleccionalo a mano', true));
  };
  window.publicarCatalogo = async function () {
    const salen = catalogoCandidatos().filter(p => p._sale).map(p => {
      const {
        _sale,
        _origen,
        ...q
      } = p;
      return q;
    });
    if (!salen.length && !confirm('No hay ningún equipo para publicar.\n\nLa página va a quedar vacía. ¿Seguro?')) return;
    const btn = document.getElementById('btn-cat-publicar');
    btn.disabled = true;
    btn.textContent = 'Publicando…';
    setSyncDot('syncing');
    try {
      await setDoc(contextoApp.catalogoDoc, contextoApp.withUser({
        productos: salen,
        actualizado: new Date().toISOString(),
        local: {
          nombre: contextoApp.cfg.localNombre || 'MarplaCity',
          direccion: contextoApp.cfg.direccion || contextoApp.conoc.direccion || '',
          horarios: contextoApp.conoc.horarios || '',
          whatsapp: (contextoApp.cfg.localTel || '').replace(/\D/g, '')
        },
        // Lo que la página necesita para armar el pedido. El tipo de cambio es el de
        // Configuración al momento de publicar: si cambia, hay que volver a publicar.
        categorias: ordenCategorias(),
        cobro: {
          tc: parseFloat(contextoApp.cfg.tc) || 0,
          recargoTarjetaPct: contextoApp.RECARGO_TARJETA_PCT,
          recargoMpPct: contextoApp.RECARGO_MP_PCT,
          mpMaxUSD: contextoApp.MP_MAX_USD
        }
      }), {
        merge: false
      });
      showToast(`Catálogo publicado ✓ — ${salen.length} producto${salen.length === 1 ? '' : 's'}`);
    } catch (e) {
      showToast('Error al publicar: ' + e.message, true);
      setSyncDot('error');
    }
    btn.disabled = false;
    btn.textContent = '🌐 Publicar';
  };

  // ══ Asistente ════════════════════════════════════════════════
  //
  // Un chat que entiende lo que le contás y prepara el trabajo. La regla de oro está en el
  // diseño y no en el prompt: LAS HERRAMIENTAS QUE ESCRIBEN NO EXISTEN. El modelo solo
  // puede buscar, resumir y PROPONER; lo que propone se dibuja como una ficha que hay que
  // confirmar a mano. Aunque el modelo se equivoque o alguien le meta una instrucción rara
  // en el texto de una conversación, no hay forma de que un dato entre solo.
  //
  // Las herramientas corren en este navegador, con los permisos que ya tenés: el asistente
  // no accede a nada a lo que vos no accedas.
}
