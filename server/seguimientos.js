import instagram from './services/ig-bot/worker-ig.js';

/** Se habilita únicamente al trasladar el cron; evita duplicar el bot de producción. */
export function iniciarSeguimientos(config, { tareas, logger }) {
  if (config.SEGUIMIENTOS_ACTIVOS !== 'true') return () => {};
  if (config.SERVICIO_INSTAGRAM !== 'local' || !config.BOT_PASSWORD || !config.IG_APP_SECRET) {
    throw new Error('Los seguimientos requieren Instagram local completamente configurado.');
  }
  let temporizador;
  let detenido = false;
  async function programar() {
    const demora = 3_600_000 - Date.now() % 3_600_000;
    temporizador = setTimeout(async () => {
      try { await instagram.scheduled({}, config, tareas); await tareas.terminar(); }
      catch { logger.error('Falló el seguimiento de Instagram.'); }
      if (!detenido) programar();
    }, demora);
    temporizador.unref();
  }
  programar();
  return () => { detenido = true; clearTimeout(temporizador); };
}
