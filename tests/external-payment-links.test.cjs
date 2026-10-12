const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExternalPaymentUrl, externalPaymentText } = require('../admin/external-payment-links.js');

test('accepts official Mexican Mercado Pago HTTPS checkout links', () => {
  assert.equal(normalizeExternalPaymentUrl(' https://mpago.la/123abc '), 'https://mpago.la/123abc');
  assert.equal(normalizeExternalPaymentUrl('https://link.mercadopago.com.mx/tienda'), 'https://link.mercadopago.com.mx/tienda');
  assert.equal(normalizeExternalPaymentUrl(''), '');
});
test('refuses unsafe and impersonated payment URLs', () => {
  for (const value of [
    'http://mpago.la/123', 'https://mpago.la.ejemplo.com/pago',
    'https://mercadopago.com.mx.evil.org/123', 'https://otro-proveedor.com/pagar',
    'https://attacker@mpago.la/abc', 'javascript:alert(1)', 'no-es-una-url'
  ]) assert.throws(() => normalizeExternalPaymentUrl(value));
});
test('seller kit includes plan, verified URL and seller code, not automatic release', () => {
  const seller = { name: 'Vendedor QA', code: 'QA-E2E-SELLER' };
  const msg = externalPaymentText(seller,'business','https://mpago.la/123');
  assert.match(msg,/Vendedor QA/);
  assert.match(msg,/QA-E2E-SELLER/);
  assert.match(msg,/https:\/\/mpago\.la\/123/);
  assert.match(msg,/vigencia anual/);
  assert.match(msg,/una vez confirmado el pago/);
  assert.match(msg,/folio de operación/);
  assert.doesNotMatch(msg,/activaci.n autom.tica/i);
});
test('direct sale has no seller code and requires a configured plan', () => {
  const msg = externalPaymentText(null,'personal','https://mpago.la/123');
  assert.doesNotMatch(msg,/C.digo del vendedor/);
  assert.throws(()=> externalPaymentText(null,'enterprise','https://mpago.la/123'));
  assert.throws(()=> externalPaymentText(null,'personal',''));
});
