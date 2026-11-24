import test from 'node:test';
import assert from 'node:assert/strict';
import { chatPausado, seMetioElDueno, ultimaVezDelDueno, PAUSA_EN_MANO, HORAS_EN_MANO } from '../src/shared/pausa-bot.js';

const HORA = 3600_000;
const ahora = Date.parse('2026-11-23T16:00:00Z');
const hace = horas => new Date(ahora - horas * HORA).toISOString();

test('si el dueño contestó a mano el bot se corre de ese chat, y vuelve solo a las horas', () => {
  const charla = horas => ({ botPausado: true, motivoPausa: PAUSA_EN_MANO, historial: [
    { de: 'cliente', texto: 'tenés el 17?', fecha: hace(horas + 1) },
    { de: 'bot', texto: 'sí, sale 1035', fecha: hace(horas + 1) },
    { de: 'juni', texto: 'te lo dejo en 1000', fecha: hace(horas) },
    { de: 'cliente', texto: 'dale', fecha: hace(0.1) },
  ] });
  assert.equal(chatPausado(charla(0.5), ahora), true, 'recién le contestó: el bot no se mete');
  assert.equal(chatPausado(charla(HORAS_EN_MANO - 0.1), ahora), true);
  assert.equal(chatPausado(charla(HORAS_EN_MANO + 0.1), ahora), false, 'pasaron las horas: vuelve a atender');
  // Cada mensaje suyo renueva la espera: cuenta el último.
  const renovada = charla(HORAS_EN_MANO + 5);
  renovada.historial.push({ de: 'juni', texto: 'te espero', fecha: hace(1) });
  assert.equal(chatPausado(renovada, ahora), true);
  // Sin una fecha con la que medir queda en pausa: es el lado seguro.
  assert.equal(chatPausado({ botPausado: true, motivoPausa: PAUSA_EN_MANO, historial: [] }, ahora), true);
});

test('la pausa del semáforo y la del bot que prometió algo no vencen solas', () => {
  const vieja = [{ de: 'juni', texto: 'hola', fecha: hace(HORAS_EN_MANO * 10) }];
  assert.equal(chatPausado({ botPausado: true, historial: vieja }, ahora), true, 'semáforo');
  assert.equal(chatPausado({ botPausado: true, motivoPausa: null, historial: vieja }, ahora), true);
  assert.equal(chatPausado({ botPausado: true, motivoPausa: 'el bot prometio algo y te lo dejo a vos', historial: vieja }, ahora), true);
  assert.equal(chatPausado({ botPausado: false, motivoPausa: PAUSA_EN_MANO, historial: vieja }, ahora), false);
  assert.equal(chatPausado({ historial: vieja }, ahora), false);
  assert.equal(chatPausado(null, ahora), false);
});

test('se reconoce cuándo escribió el dueño, venga la fecha como venga', () => {
  const texto = '2026-11-23T15:00:00.000Z', ms = Date.parse(texto);
  for (const fecha of [texto, new Date(ms), { toDate: () => new Date(ms) }, { seconds: ms / 1000, nanoseconds: 0 }]) {
    assert.equal(ultimaVezDelDueno([{ de: 'cliente', texto: 'x', fecha: texto }, { de: 'juni', texto: 'y', fecha }]), ms);
  }
  assert.ok(Number.isNaN(ultimaVezDelDueno([{ de: 'bot', texto: 'x', fecha: texto }])));
  assert.ok(Number.isNaN(ultimaVezDelDueno(null)));
  // "Se metió" si escribió después del mensaje del cliente que el bot estaba por contestar.
  const h = [{ de: 'cliente', texto: 'precio?', fecha: hace(0.02) }, { de: 'juni', texto: '1000', fecha: hace(0.01) }];
  assert.equal(seMetioElDueno(h, hace(0.02)), true);
  assert.equal(seMetioElDueno(h, hace(0.005)), false, 'lo suyo es de antes de este mensaje');
  assert.equal(seMetioElDueno([{ de: 'bot', texto: 'x', fecha: hace(0.01) }], hace(0.02)), false);
});
