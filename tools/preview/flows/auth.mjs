// Humo del slice «auth»: alta completa con SMS simulado (02 → 03 → 04), con validación, código incorrecto y entrada a la app.
//
//   node tools/preview/smoke.mjs --dev --flow auth -v
export const meta = { description: 'alta de una persona nueva: perfil, datos, SMS, código y entrada (slice auth)', timeoutSeconds: 300, viewport: { width: 393, height: 852 } };

export default async function auth(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();
  const open = async (route, params, opts) => {
    await s.inApp(([n, p, o]) => window.__mvc.open(n, p, o), [route, params, opts]);
    await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
    await s.settle();
  };
  const here = () => s.inApp(() => window.__mvc.route());

  await s.step('02 · Elige tu perfil: sin elegir no avanza; elegir pasajero y Continuar abre «Tu cuenta»', async () => {
    await open('Welcome', {}, { profile: 'new' });
    s.expect((await here()) === 'Welcome', 'la persona nueva empieza en Bienvenida');
    await s.tap('Welcome.createAccount');
    await s.until(() => window.__mvc.route() === 'ChooseRole', null, 'Crear cuenta lleva a Elige tu perfil');
    await s.tap('ChooseRole.continue');
    await s.waitText('Elige al menos un perfil para continuar.');
    await s.tap('ChooseRole.passenger');
    await s.tap('ChooseRole.continue');
    await s.until(() => window.__mvc.route() === 'CreateAccount', null, 'Continuar lleva a Tu cuenta');
  });

  await s.step('03 · Tu cuenta: valida todo a la vez y no pide SMS con datos incompletos', async () => {
    await s.tap('CreateAccount.submit');
    await s.waitText('Escribe tu nombre.');
    const text = await s.appText();
    for (const msg of ['Escribe tus apellidos.', 'Escribe tu número de móvil.', 'Elige tu provincia.', 'Para crear tu cuenta debes aceptar']) {
      s.expect(text.includes(msg), `error «${msg}»`);
    }
    s.expect((await here()) === 'CreateAccount', 'sigue en Tu cuenta');
    await s.type('CreateAccount.givenName', 'Lucía');
    await s.type('CreateAccount.familyName', 'Romero Gil');
    await s.type('CreateAccount.phone', '700111222');
    await s.tap('CreateAccount.province');
    await s.waitText('Sevilla');
    await s.page.getByText('Sevilla', { exact: true }).last().click();
    await s.tap('CreateAccount.consent');
    await s.shot('03-tu-cuenta-rellena');
  });

  await s.step('04 · Confirma tu móvil: código incorrecto y luego el SMS real simulado → entra a la app', async () => {
    await s.tap('CreateAccount.submit');
    await s.until(() => window.__mvc.route() === 'VerifyPhone', null, 'Recibir código abre Confirma tu móvil');
    await s.type('VerifyPhone.code', '000000');
    await s.waitText('Código incorrecto');
    const sms = await s.inApp(() => window.__mvc.lastSms && window.__mvc.lastSms());
    const code = String((sms && (sms.code || sms.text || sms.body)) || sms || '').match(/\d{6}/)?.[0];
    s.expect(!!code, `el SMS simulado trae un código (${JSON.stringify(sms)})`);
    await s.type('VerifyPhone.code', code);
    await s.until(() => !['VerifyPhone', 'CreateAccount', 'ChooseRole', 'Welcome'].includes(window.__mvc.route()), null, 'tras verificar sale del alta', 15000);
    s.note(`ruta tras el alta: ${await here()}`);
    await s.shot('04-tras-el-alta');
    await s.checkForbiddenText('tras el alta');
  });
  await s.step('05 · Iniciar sesión: móvil inválido da error; el de una cuenta existente recibe SMS y entra', async () => {
    await open('SignIn', {}, { profile: 'new' });
    await s.tap('SignIn.submit');
    await s.settle();
    s.expect((await here()) === 'SignIn', 'con el móvil vacío sigue en Iniciar sesión');
    s.expect(/móvil|teléfono|número/i.test(await s.appText()), 'el móvil vacío muestra un error');
    await s.type('SignIn.phone', '611000101');
    await s.tap('SignIn.submit');
    await s.until(() => window.__mvc.route() === 'VerifyPhone', null, 'Iniciar sesión abre Confirma tu móvil');
    const sms = await s.inApp(() => window.__mvc.lastSms && window.__mvc.lastSms());
    const code = String((sms && (sms.code || sms.text || sms.body)) || sms || '').match(/\d{6}/)?.[0];
    s.expect(!!code, 'el SMS simulado trae un código');
    await s.type('VerifyPhone.code', code);
    await s.until(() => !['VerifyPhone', 'SignIn', 'Welcome'].includes(window.__mvc.route()), null, 'tras verificar entra a la app', 15000);
    await s.shot('05-sesion-iniciada');
    await s.checkForbiddenText('sesión iniciada');
  });
}
