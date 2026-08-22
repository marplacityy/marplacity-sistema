import { limpiarJson, normalizar, expandirCanal, aFields } from './worker-ig.js';

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

console.log(fallos ? `\n${fallos} FALLA(S)\n` : '\nTodo verde\n');
process.exit(fallos ? 1 : 0);
