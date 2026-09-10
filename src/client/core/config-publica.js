export let configuracion = null;

/** Solo recibe URLs públicas: ninguna clave de servicio se envía al navegador. */
export async function cargarConfiguracion() {
  if (configuracion) return configuracion;
  if (import.meta.env.MODE === 'pages') {
    // GitHub Pages sirve la interfaz compilada; las APIs siguen en sus Workers.
    configuracion = {
      basePublica: new URL(import.meta.env.BASE_URL, location.origin).href,
      api: {
        ia: 'https://anthropic-proxy.fiwind702050.workers.dev',
        tienda: 'https://tienda.fiwind702050.workers.dev',
        instagram: 'https://ig-bot.fiwind702050.workers.dev',
        facturador: 'https://facturador.fiwind702050.workers.dev',
      },
    };
    return configuracion;
  }
  const respuesta = await fetch('/api/config', { cache: 'no-store' });
  if (!respuesta.ok) throw new Error('El servidor no respondió con la configuración.');
  configuracion = await respuesta.json();
  return configuracion;
}
