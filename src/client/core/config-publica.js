export let configuracion = null;

/** Solo recibe URLs públicas: ninguna clave de servicio se envía al navegador. */
export async function cargarConfiguracion() {
  if (configuracion) return configuracion;
  const respuesta = await fetch('/api/config', { cache: 'no-store' });
  if (!respuesta.ok) throw new Error('El servidor no respondió con la configuración.');
  configuracion = await respuesta.json();
  return configuracion;
}
