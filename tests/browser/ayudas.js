import { expect } from '@playwright/test';

export async function preparar(page) {
  const errores = [];
  page.on('pageerror', error => errores.push(error.message));
  // Impide que una prueba le escriba al negocio o a un servicio externo.
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (/^\/api\/(facturador|tienda|instagram|ia)/.test(url.pathname)) {
      return route.fulfill({ json: { ok: true, entorno: 'HOMOLOGACION', certificado: {}, condiciones: [{ id: 5, desc: 'Consumidor Final' }], documentos: [{ id: 99, desc: 'Sin identificar' }], alicuotas: [{ id: 5, desc: '21%' }] } });
    }
    return route.continue();
  });
  page.on('dialog', dialog => dialog.accept());
  return errores;
}

export async function entrar(page) {
  await page.goto('/');
  await expect(page.locator('#login-screen')).toHaveClass(/show/);
  await page.locator('#login-email').fill('prueba@example.invalid');
  await page.locator('#login-pass').fill('solo-datos-ficticios');
  await page.locator('#login-pass').press('Enter');
  await expect(page.locator('#page-home')).toHaveClass(/active/);
  await expect(page.locator('#home-saludo')).not.toHaveText('Inicio');
}

export async function ir(page, nombre) {
  await page.evaluate(nombre => window.goTo(nombre), nombre);
  await expect(page.locator('#page-' + nombre)).toHaveClass(/active/);
}
