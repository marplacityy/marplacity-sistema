import { SITIO_PUBLICO, FOTOS_BASE } from '../../shared/sitio.js';

export let configuracion = null;

/** Solo recibe URLs públicas: ninguna clave de servicio se envía al navegador. */
export async function cargarConfiguracion() {
  if (configuracion) return configuracion;
  if (import.meta.env.MODE === 'pages') {
    // GitHub Pages sirve la interfaz compilada; las APIs siguen en sus Workers.
    configuracion = {
      // Los links públicos (tienda, documentos): la dirección que se comparte con clientes.
      basePublica: SITIO_PUBLICO,
      // Las fotos viven en Firebase Storage; el sistema las sube y las lista directo.
      fotosBase: FOTOS_BASE,
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
