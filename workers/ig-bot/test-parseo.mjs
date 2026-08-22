import { limpiarJson, normalizar, expandirCanal, aFields, momentoDeSeguir } from './worker-ig.js';

const CANAL = 'TEXTO-REAL-DEL-CANAL';
let fallos = 0;
const ok = (cond, nombre, extra = '') => {
  console.log((cond ? '  ok   ' : '  FALLA') + ' ' + nombre + (cond ? '' : '  <- ' + extra));
  if (!cond) fallos++;
};

console.log('\n── limpiarJson ──');
ok(limpiarJson('{"a":1}') === '{"a":1}', 'json pelado');
ok(limpiarJson('```json\n{"a":1}\n```') === '{"a":1}', 'con fences');
ok(limpiarJson('Aca va:\n{"a":1}\nlisto') === '{"a":1}', 'con texto alrededor');
ok(limpiarJson('```\n{"a":{"b":2}}\n```') === '{"a":{"b":2}}', 'anidado');

console.log('\n── expandirCanal ──');
ok(JSON.stringify(expandirCanal(['hola', '[[CANAL]]'], CANAL)) === JSON.stringify(['hola', CANAL]), 'reemplaza la marca');
ok(JSON.stringify(expandirCanal(['[[CANAL]]', 'hola'], CANAL)) === JSON.stringify([CANAL, 'hola']), 'respeta el orden');
ok(JSON.stringify(expandirCanal(['hola', '[[CANAL]]'], null)) === JSON.stringify(['hola']), 'sin texto cargado descarta la marca');
ok(JSON.stringify(expandirCanal(['  [[CANAL]]  '], CANAL)) === JSON.stringify([CANAL]), 'tolera espacios');
ok(JSON.stringify(expandirCanal('no soy array', CANAL)) === '[]', 'no-array devuelve []');
ok(JSON.stringify(expandirCanal(['a', '', null, 'b'], CANAL)) === JSON.stringify(['a', 'b']), 'saca vacios');

console.log('\n── normalizar: caso feliz ──');
const feliz = normalizar({
  categoria: 'indeciso', confianza: 'alta', necesita_atencion: true,
  motivo: 'pidio_foto', prioridad: 1, resumen: 'pregunta por iphone 14',
  mensajes: ['hola tengo 15 en precio', '500 usd', 'ahora te mando la foto'],
}, CANAL);
ok(feliz.categoria === 'indeciso', 'categoria');
ok(feliz.necesitaAtencion === true && feliz.motivo === 'pidio_foto' && feliz.prioridad === 1, 'need attention');
ok(feliz.mensajes.length === 3, 'mensajes');

console.log('\n── normalizar: no necesita atencion ──');
const limpio = normalizar({
  categoria: 'curioso', confianza: 'alta', necesita_atencion: false,
  motivo: null, prioridad: 99, resumen: 'saludo', mensajes: ['hola'],
}, CANAL);
ok(limpio.motivo === null && limpio.prioridad === 99, 'motivo null y prioridad 99');

console.log('\n── normalizar: basura y bordes ──');
const sinMensajes = normalizar({ categoria: 'indeciso', necesita_atencion: false, mensajes: [] }, CANAL);
ok(sinMensajes.necesitaAtencion === true && sinMensajes.prioridad === 8, 'sin mensajes sube a la bandeja');

const catMala = normalizar({ categoria: 'inventada', necesita_atencion: false, mensajes: ['x'] }, CANAL);
ok(catMala.categoria === null && catMala.necesitaAtencion === true, 'categoria invalida sube a la bandeja');

const dudo = normalizar({ categoria: 'indeciso', confianza: 'baja', necesita_atencion: false, mensajes: ['x'] }, CANAL);
ok(dudo.necesitaAtencion === true && dudo.prioridad === 8, 'confianza baja sube a la bandeja');

const prioMala = normalizar({ categoria: 'indeciso', necesita_atencion: true, motivo: 'permuta', prioridad: 47, mensajes: ['x'] }, CANAL);
ok(prioMala.prioridad === 8, 'prioridad fuera de rango -> 8', String(prioMala.prioridad));

const motivoMalo = normalizar({ categoria: 'indeciso', necesita_atencion: true, motivo: 'cualquiera', prioridad: 2, mensajes: ['x'] }, CANAL);
ok(motivoMalo.motivo === 'no_supe_responder', 'motivo invalido -> no_supe_responder', motivoMalo.motivo);

const muchos = normalizar({ categoria: 'indeciso', necesita_atencion: false, mensajes: ['1', '2', '3', '4', '5', '6'] }, CANAL);
ok(muchos.mensajes.length === 4, 'corta en 4 mensajes', String(muchos.mensajes.length));

const vacio = normalizar({}, CANAL);
ok(vacio.necesitaAtencion === true && vacio.motivo === 'no_supe_responder' && vacio.prioridad === 8, 'objeto vacio -> fallback');

const prioStr = normalizar({ categoria: 'cerrado', necesita_atencion: true, motivo: 'cerrado', prioridad: '2', mensajes: ['x'] }, CANAL);
ok(prioStr.prioridad === 2, 'prioridad como string se convierte', String(prioStr.prioridad));

console.log('\n── normalizar: producto ──');
const conProd = normalizar({ categoria: 'indeciso', necesita_atencion: false, producto: '  iPhone 15  ', mensajes: ['x'] }, CANAL);
ok(conProd.producto === 'iPhone 15', 'lo recorta de los costados', conProd.producto);
ok(normalizar({ categoria: 'curioso', necesita_atencion: false, mensajes: ['x'] }, CANAL).producto === null, 'sin producto queda null');
ok(normalizar({ categoria: 'curioso', necesita_atencion: false, producto: 47, mensajes: ['x'] }, CANAL).producto === null, 'un no-string queda null');
ok(normalizar({ categoria: 'curioso', necesita_atencion: false, producto: 'a'.repeat(200), mensajes: ['x'] }, CANAL).producto.length === 60, 'corta a 60');

console.log('\n── aFields ──');
const f = aFields({
  texto: 'hola', flag: true, prioridad: 8, plata: 1.5, lista: ['a', 'b'],
  cuando: new Date('2026-08-21T15:00:00.000Z'), vacio: null, nada: undefined,
});
ok(f.texto.stringValue === 'hola', 'string');
ok(f.flag.booleanValue === true, 'bool');
ok(f.prioridad.integerValue === '8', 'entero como integerValue', JSON.stringify(f.prioridad));
ok(f.plata.doubleValue === 1.5, 'decimal como doubleValue');
ok(f.lista.arrayValue.values.length === 2, 'array');
ok(f.cuando.timestampValue === '2026-08-21T15:00:00.000Z', 'Date como timestampValue', JSON.stringify(f.cuando));
// null se manda: el PATCH pisa campo por campo, si se salteara quedaria vivo el valor viejo
ok('vacio' in f && f.vacio.nullValue === null, 'null explicito se manda como nullValue');
ok(!('nada' in f), 'undefined no se manda (deja el campo como esta)');

console.log('\n── momentoDeSeguir ──');
const H = 60 * 60 * 1000;
// hora de reloj argentino -> instante. AR es UTC-3 fijo.
const ar = iso => Date.parse(iso + '-03:00');
// el t que hace que las 20 h de silencio caigan justo en esa hora argentina
const desde = iso => ar(iso) - 20 * H;
const enAR = ms => new Date(ms - 3 * H).toISOString().slice(0, 16).replace('T', ' ');

// De dia se manda cuando toca, sin mover nada
ok(momentoDeSeguir(desde('2026-08-21T15:00')) === ar('2026-08-21T15:00'), 'las 15 quedan a las 15');
ok(momentoDeSeguir(desde('2026-08-21T08:00')) === ar('2026-08-21T08:00'), 'las 08 en punto ya es de dia');
ok(momentoDeSeguir(desde('2026-08-21T23:30')) === ar('2026-08-21T23:30'), 'las 23:30 no se tocan');

// De madrugada se adelanta a las 23 del dia anterior
ok(momentoDeSeguir(desde('2026-08-21T03:00')) === ar('2026-08-20T23:00'), 'las 03 -> 23 del dia anterior', enAR(momentoDeSeguir(desde('2026-08-21T03:00'))));
ok(momentoDeSeguir(desde('2026-08-21T00:00')) === ar('2026-08-20T23:00'), 'las 00:00 en punto ya es de noche');
ok(momentoDeSeguir(desde('2026-08-21T07:59')) === ar('2026-08-20T23:00'), 'las 07:59 todavia es de noche');

// Bordes de calendario: setUTCDate(0) tiene que resolver mes y año
ok(momentoDeSeguir(desde('2026-09-01T02:00')) === ar('2026-08-31T23:00'), 'cambio de mes');
ok(momentoDeSeguir(desde('2026-01-01T02:00')) === ar('2025-12-31T23:00'), 'cambio de año');
ok(momentoDeSeguir(desde('2028-03-01T02:00')) === ar('2028-02-29T23:00'), 'año bisiesto');

// Las dos invariantes que sostienen todo: nunca mas tarde de las 20 h, nunca cerca de
// las 24 h de Meta. Se prueban sobre las 24 horas del dia, minuto 37 para no caer
// siempre en punto.
let tarde = 0, pasado = 0, adelantoMax = 0;
for (let h = 0; h < 24; h++) {
  const t = desde(`2026-08-21T${String(h).padStart(2, '0')}:37`);
  const m = momentoDeSeguir(t);
  if (m > t + 20 * H) tarde++;
  if (m - t >= 24 * H) pasado++;
  adelantoMax = Math.max(adelantoMax, (t + 20 * H - m) / H);
  const hora = new Date(m - 3 * H).getUTCHours();
  if (hora >= 0 && hora < 8) tarde++;   // no puede quedar ninguno en la madrugada
}
ok(tarde === 0, 'ninguno queda de madrugada ni se atrasa', String(tarde));
ok(pasado === 0, 'ninguno pasa las 24 h de Meta', String(pasado));
ok(adelantoMax <= 9, 'lo mas que se adelanta son 9 h', String(adelantoMax));

console.log(fallos ? `\n${fallos} FALLA(S)\n` : '\nTodo verde\n');
process.exit(fallos ? 1 : 0);
