// Arranque: el visor monta el marco del móvil y el panel, la app pinta su primera pantalla sin errores, y la versión
// «?chrome=0» muestra la app sola a pantalla completa. Si la app ya expone window.__mvc, también comprueba el puente.
export const meta = { description: 'visor + primera pantalla de la app, sin errores ni peticiones externas' };

const SECTIONS = ['Estás en', 'Perfil de prueba', 'Ir a pantalla', 'Simulaciones', 'Correcciones', 'Cómo probarla'];

export default async function boot(s) {
  await s.step('abre el visor y la app arranca', async () => {
    await s.open('');
    s.expect(await s.page.locator('.v-phone').isVisible(), 'el marco del móvil (.v-phone) está visible');
    const text = (await s.appText()).trim();
    s.expect(text.length > 20, `la primera pantalla de la app tiene texto (tiene ${text.length} caracteres)`);
  });

  await s.step('el marco dibuja barra de estado, isla e indicador de inicio', async () => {
    s.expect(/^\d{1,2}:\d{2}$/.test((await s.page.locator('.sb-time').textContent()).trim()), 'la barra de estado muestra la hora');
    s.expect(await s.page.locator('.v-island').isVisible(), 'la isla dinámica del iPhone 15 está visible');
    s.expect(await s.page.locator('.v-home').isVisible(), 'el indicador de inicio está visible');
  });

  await s.step('el panel tiene las seis secciones, en orden', async () => {
    const titles = await s.page.locator('.v-sec-h > span:first-child').allTextContents();
    s.expect(JSON.stringify(titles) === JSON.stringify(SECTIONS), `secciones del panel ${JSON.stringify(SECTIONS)} (hay ${JSON.stringify(titles)})`);
  });

  await s.step('la pantalla actual coincide con «Estás en» (si la app expone el puente)', async () => {
    await s.requireBridge();
    const route = await s.app.evaluate(() => window.__mvc.route());
    s.expect(route, 'window.__mvc.route() devuelve el nombre de la pantalla');
    const shown = await s.page.locator('.v-where .v-route').textContent();
    s.expect(shown.trim() === route, `«Estás en» muestra ${route} (muestra ${shown.trim()})`);
    const routes = await s.app.evaluate(() => window.__mvc.routes());
    s.expect(Array.isArray(routes) && routes.length > 0, 'window.__mvc.routes() lista las rutas de la app');
  });

  await s.step('sin texto prohibido ni salidas a Internet', async () => {
    await s.checkForbiddenText('la primera pantalla');
    await s.checkBlocked('la primera pantalla');
  });

  await s.step('captura del visor completo', async () => {
    await s.shot('visor');
  });

  await s.step('«?chrome=0»: la app sola, sin marco ni panel', async () => {
    await s.page.setViewportSize({ width: 393, height: 852 });
    await s.open('chrome=0&profile=new&perm=granted');
    s.expect(!(await s.page.locator('.v-panel').isVisible()), 'el panel está oculto');
    s.expect(!(await s.page.locator('.v-island').isVisible()), 'la isla dinámica está oculta');
    const box = await s.page.locator('.v-app').boundingBox();
    s.expect(box && Math.abs(box.width - 393) < 1 && Math.abs(box.height - 852) < 1, `el iframe ocupa 393×852 (ocupa ${box && Math.round(box.width)}×${box && Math.round(box.height)})`);
    await s.shot('chrome0');
  });
}
