/**
 * El lector de listas de precios de Ecommodo, tal como está en su backend
 * (backend/src/controllers/aiController.js, rama mejoras-importador): lee una lista
 * pegada —en tabla o como llega por WhatsApp— sin usar ninguna IA. Acá es el respaldo
 * de "Interpretar con IA": si la IA no responde, la lista se lee igual.
 *
 * El bloque de abajo está copiado sin cambios, con sus comentarios en inglés, para
 * poder traer las mejoras que se le hagan allá. Lo propio de MarplaCity es el adaptador
 * del final (`itemsDeListaEcommodo`), que pasa sus productos al formato de las listas.
 */

const parsePrice = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;

  const raw = value.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(raw)) return NaN;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const decimalSeparator = lastComma > lastDot ? ',' : '.';
  const otherSeparator = decimalSeparator === ',' ? '.' : ',';
  const parts = raw.split(decimalSeparator);

  if (parts.length === 2 && parts[1].length !== 3) {
    return Number(parts[0].replaceAll(otherSeparator, '') + '.' + parts[1]);
  }

  return Number(raw.replace(/[.,]/g, ''));
};

// ─── Deterministic offline parser ──────────────────────────────────────────
// Fallback used when Gemini is overloaded / rate-limited. Handles the common
// tabular format sellers paste (tab or multi-space separated columns with
// model, capacity, color, battery %, price) plus simple single-line prose.

const MODEL_KEYWORD_REGEX = /\b(iphone|ipad|macbook|imac|mac\s*mini|apple\s*watch|watch|airpods|galaxy|samsung|xiaomi|redmi|poco|pixel|motorola|moto\s*g|huawei|honor|nokia|oneplus|realme|oppo|vivo|nothing|sony|lg|zte|tcl|alcatel|playstation|ps[345]|xbox|nintendo|switch|tablet|notebook|laptop|airtag|homepod)\b/i;

const CATEGORY_KEYWORDS = [
  { re: /\b(iphone|galaxy|pixel|xiaomi|redmi|poco|moto(\s|\b)|motorola|huawei|honor|oneplus|realme|oppo|vivo|nothing|samsung)\b/i, category: 'Smartphones' },
  { re: /\b(ipad|tablet)\b/i, category: 'Tablets' },
  { re: /\b(macbook|notebook|laptop)\b/i, category: 'Laptops' },
  { re: /\b(imac|mac\s*mini|mac\s*pro)\b/i, category: 'Computadoras' },
  { re: /\b(apple\s*watch|watch|smartwatch)\b/i, category: 'Wearables' },
  { re: /\b(airpods|airpod|earbuds|auriculares|headphones)\b/i, category: 'Audio' },
  { re: /\b(playstation|ps[345]|xbox|nintendo|switch|consola)\b/i, category: 'Consolas' },
  { re: /\b(airtag|homepod|cargador|cable|funda|case)\b/i, category: 'Accesorios' }
];

const inferCategory = (name) => {
  for (const { re, category } of CATEGORY_KEYWORDS) {
    if (re.test(name)) return category;
  }
  return 'General';
};

const inferTags = (name) => {
  const tags = [];
  if (/\b(iphone|ipad|macbook|imac|apple\s*watch|airpods|airtag|homepod|mac\s*mini)\b/i.test(name)) tags.push('Apple');
  if (/\bsamsung|galaxy\b/i.test(name)) tags.push('Samsung');
  if (/\bxiaomi|redmi|poco\b/i.test(name)) tags.push('Xiaomi');
  if (/\bmotorola|moto\b/i.test(name)) tags.push('Motorola');
  if (/\bgoogle|pixel\b/i.test(name)) tags.push('Google');
  return tags;
};

const PRICE_REGEX = /([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+(?:[.,][0-9]{1,2})?)\s*(USD|U\$S|U\$D|US\$|ARS|\$)/i;
// Currency written before the amount ("u$s 850", "USD 1.150,00", "$ 380"), the
// usual shape of lists pasted from WhatsApp. The lookahead keeps "128GB" / "87%"
// from being read as an amount.
const PRICE_PREFIX_REGEX = /(USD|U\$S|U\$D|US\$|ARS|\$)\s*([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)(?!\s*(?:GB|TB|MB|%)|[0-9])/i;

// Finds the price in a line or column. The prefixed form wins: in
// "AirPods Pro 2 usd 210" the price is 210, not the "2" that precedes "usd".
const matchPrice = (text) => {
  const prefixed = text.match(PRICE_PREFIX_REGEX);
  const m = prefixed || text.match(PRICE_REGEX);
  if (!m) return null;
  const value = parsePrice(prefixed ? m[2] : m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, matched: m[0] };
};
const CAPACITY_REGEX = /\b(\d+(?:\.\d+)?)\s*(GB|TB|MB)\b/i;
const BATTERY_REGEX = /\b(100|\d{1,2})\s*%/;

const looksLikeModelHeader = (line) =>
  MODEL_KEYWORD_REGEX.test(line)
  && !matchPrice(line)
  && !CAPACITY_REGEX.test(line);

const splitRow = (line) => {
  if (/\t/.test(line)) {
    return line.split(/\t+/).map(s => s.trim()).filter(Boolean);
  }
  // Multi-space (≥2 consecutive spaces) also treated as column separator
  if (/ {2,}/.test(line)) {
    return line.split(/ {2,}/).map(s => s.trim()).filter(Boolean);
  }
  return [line.trim()];
};

const extractPriceFromCol = (col) => matchPrice(col);

const parseDeterministicRow = (line, lastHeader) => {
  if (!line || !line.trim()) return null;
  const cleanLine = line.replace(/[•·▪►–—*_~]/g, ' ').replace(/\s+/g, ' ').trim();
  const priceInLine = matchPrice(cleanLine);
  if (!priceInLine) return null;
  const price = priceInLine.value;

  // WhatsApp bold/italic/strike markers never belong to a product name
  const cols = splitRow(line.replace(/[*_~]/g, ' ').trimEnd());

  let capacity = '';
  let battery = '';
  const nameBits = [];

  if (cols.length >= 2) {
    for (const rawCol of cols) {
      let col = rawCol.trim();
      if (!col) continue;

      const priceInfo = extractPriceFromCol(col);
      if (priceInfo) {
        // A column can carry more than the price ("iPhone 13 87% - u$s 380"):
        // drop the price and keep reading what is left of it.
        col = col.replace(priceInfo.matched, ' ').replace(/[\s\-|/]+$/, '').trim();
        if (!col) continue;
      }

      const capOnly = col.match(/^(\d+(?:\.\d+)?)\s*(GB|TB|MB)$/i);
      if (capOnly && !capacity) {
        capacity = `${capOnly[1]}${capOnly[2].toUpperCase()}`;
        continue;
      }
      const battOnly = col.match(/^(100|\d{1,2})\s*%$/);
      if (battOnly && !battery) {
        battery = `${battOnly[1]}%`;
        continue;
      }

      let residual = col;
      const capEmbed = residual.match(CAPACITY_REGEX);
      if (capEmbed && !capacity) {
        capacity = `${capEmbed[1]}${capEmbed[2].toUpperCase()}`;
        residual = residual.replace(capEmbed[0], '').trim();
      }
      const battEmbed = residual.match(BATTERY_REGEX);
      if (battEmbed && !battery) {
        battery = `${battEmbed[1]}%`;
        residual = residual.replace(battEmbed[0], '').trim();
      }
      residual = residual.replace(/[,;|]/g, ' ').replace(/\s+/g, ' ').trim();
      if (residual) nameBits.push(residual);
    }
  } else {
    let residual = cleanLine.replace(priceInLine.matched, ' ');
    const capEmbed = residual.match(CAPACITY_REGEX);
    if (capEmbed) {
      capacity = `${capEmbed[1]}${capEmbed[2].toUpperCase()}`;
      residual = residual.replace(capEmbed[0], ' ');
    }
    const battEmbed = residual.match(BATTERY_REGEX);
    if (battEmbed) {
      battery = `${battEmbed[1]}%`;
      residual = residual.replace(battEmbed[0], ' ');
    }
    residual = residual.replace(/\s*[-|/]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (residual) nameBits.push(residual);
  }

  // Re-order so the model (first name bit) comes first, then capacity, then remaining descriptors (color, etc.)
  let modelPart = nameBits[0] || '';
  const descriptorParts = nameBits.slice(1);

  if (!MODEL_KEYWORD_REGEX.test(modelPart) && lastHeader && MODEL_KEYWORD_REGEX.test(lastHeader)) {
    modelPart = `${lastHeader} ${modelPart}`.trim();
  }

  const joinedName = [modelPart, ...descriptorParts].join(' ').replace(/\s+/g, ' ').trim();
  if (!joinedName) return null;

  if (!MODEL_KEYWORD_REGEX.test(joinedName)) {
    // No model keyword anywhere, almost certainly not a product row
    return null;
  }

  const namePieces = [modelPart];
  if (capacity) namePieces.push(capacity);
  namePieces.push(...descriptorParts);
  const fullName = namePieces.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();

  const descParts = [];
  if (battery) descParts.push(`Batería: ${battery}`);
  descParts.push('Importado por el titular. Consultar disponibilidad, color y condición exacta.');
  if (capacity) descParts.push(`Capacidad: ${capacity}.`);

  return {
    name: fullName,
    description: descParts.join(' '),
    price,
    stock: 1,
    category: inferCategory(fullName),
    tags: inferTags(fullName)
  };
};

export const parseProductsDeterministic = (text) => {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const products = [];
  let lastHeader = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (looksLikeModelHeader(line)) {
      lastHeader = line.replace(/[:–—-]+$/, '').trim();
      continue;
    }

    const parsed = parseDeterministicRow(rawLine, lastHeader);
    if (parsed) products.push(parsed);
  }

  return products;
};

// ── Adaptador a las listas de MarplaCity ─────────────────────

const MARCAS = { iphone: 'iPhone', ipad: 'iPad', macbook: 'MacBook', imac: 'iMac', airpods: 'AirPods', airtag: 'AirTag', homepod: 'HomePod', playstation: 'PlayStation', oneplus: 'OnePlus', usb: 'USB', gb: 'GB', tb: 'TB', ps5: 'PS5', ps4: 'PS4', lg: 'LG', tcl: 'TCL', zte: 'ZTE', se: 'SE', fe: 'FE', xr: 'XR', xs: 'XS', gps: 'GPS', oled: 'OLED', tv: 'TV', hd: 'HD', '5g': '5G', '4g': '4G' };
/** "IPHONE 16 PRO MAX" → "iPhone 16 Pro Max": el lector devuelve todo en mayúsculas. */
const presentable = texto => String(texto || '').toLowerCase().split(/\s+/).filter(Boolean)
  .map(w => MARCAS[w] || (/^[a-z]\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

const COLOR = '(?:negro|blanco|azul|rojo|verde|rosa|gris|plata|plateado|dorado|oro|violeta|lila|amarillo|naranja|celeste|grafito|natural|desierto|titanio|black|white|blue|red|green|pink|gray|grey|silver|gold|purple|yellow|orange|midnight|starlight|graphite|desert|titanium|teal|ultramarine|lavender|sage|mist|cosmic|deep|space|sierra|alpine|pacific|jet)';
const COLOR_AL_FINAL = new RegExp(`(?:\\s${COLOR})+$`, 'i');

/**
 * La lista leída sin IA, en el formato de las listas de precios:
 * {producto, gb, color, precioPublico, condicion}. En una tabla el lector arma el nombre
 * como "MODELO CAPACIDAD COLOR", así que lo que sigue a la capacidad es el color; en una
 * línea suelta la capacidad queda al final y el color sigue dentro del nombre (se
 * corrige en la vista previa).
 */
export function itemsDeListaEcommodo(texto) {
  return parseProductsDeterministic(texto).map(p => {
    const m = p.name.match(/^(.*?)\s*\b(\d+(?:\.\d+)?(?:GB|TB|MB))\b\s*(.*)$/);
    const bateria = /Batería: (\d{1,3})%/.exec(p.description);
    let producto = presentable(m ? m[1] : p.name);
    let color = m && m[3] ? presentable(m[3]) : null;
    // En una línea suelta el color quedó pegado al final del modelo ("iPhone 16 Negro").
    const alFinal = !color && COLOR_AL_FINAL.exec(producto);
    if (alFinal && alFinal.index > 0) { color = alFinal[0].trim(); producto = producto.slice(0, alFinal.index).trim(); }
    return {
      producto,
      gb: m ? m[2] : null,
      color,
      precioPublico: p.price,
      // Una batería por debajo de 100 solo la informa quien vende un usado.
      condicion: bateria && Number(bateria[1]) < 100 ? 'usado' : null,
    };
  }).filter(it => it.producto && it.precioPublico > 0);
}
