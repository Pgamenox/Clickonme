// Checkout externo: prepara enlaces y mensajes, pero nunca cobra ni activa tarjetas.
const EXTERNAL_PAYMENT_PLANS = Object.freeze({
  personal: 'Personal', business: 'Business', artist: 'Artista', creator: 'Creator'
});
let externalPaymentLinks = {};
function normalizeExternalPaymentUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('Escribe un enlace HTTPS válido de Mercado Pago.'); }
  const host = url.hostname.toLowerCase();
  const trusted = host === 'mpago.la' || host === 'mercadopago.com.mx' ||
    host.endsWith('.mercadopago.com.mx') || host === 'mercadopago.com' ||
    host.endsWith('.mercadopago.com');
  if (url.protocol !== 'https:' || !trusted || url.username || url.password) {
    throw new Error('Se admiten únicamente enlaces HTTPS oficiales de Mercado Pago.');
  }
  return url.href;
}
function externalPaymentText(seller, plan, link) {
  if (!EXTERNAL_PAYMENT_PLANS[plan] || !link) throw new Error('Elige un plan con enlace configurado.');
  const introduction = seller ? 'Hola, soy ' + seller.name + ', del equipo ClickOnMe.' :
    'Hola, te comparto la forma de pago de ClickOnMe.';
  const sellerCode = seller ? '\nCódigo del vendedor: ' + seller.code + '.' : '';
  return introduction + '\n\nTarjeta digital ClickOnMe, plan ' + EXTERNAL_PAYMENT_PLANS[plan] +
    ' (vigencia anual).\nPaga de forma segura en este enlace externo de Mercado Pago:\n' +
    link + '\n\nVerifica que el importe mostrado en Mercado Pago corresponda al plan acordado.' +
    '\nDespués de pagar, envíame tu folio de operación y el correo con el que registrarás tu tarjeta.' +
    '\nPara crear o editar tu tarjeta: https://clickonme.pro/crear/' +
    '\nAdministración activará el plan una vez confirmado el pago.' + sellerCode;
}
function displayExternalPaymentLinks(values) {
  externalPaymentLinks = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  for (const plan of Object.keys(EXTERNAL_PAYMENT_PLANS)) {
    $('externalUrl-' + plan).value = externalPaymentLinks[plan] || '';
  }
}
function syncExternalPaymentSellers() {
  const select = $('externalSeller'), previous = select.value;
  select.replaceChildren(new Option('Venta directa · sin comisión', ''));
  for (const s of sellers.filter(s => s.active)) {
    select.add(new Option(s.name + ' · ' + s.code, s.id));
  }
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
  select.disabled = !sellersReady;
}
async function copyExternalPaymentText(value, status) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw Error('Portapapeles no disponible');
    await navigator.clipboard.writeText(value);
    status.textContent = 'Copiado. Compártelo con el vendedor o cliente por WhatsApp.';
  } catch {
    prompt('Copia este texto:', value);
    status.textContent = 'Puedes copiarlo de la ventana.';
  }
}
function initExternalPaymentLinks() {
  $('saveExternalLinks').onclick = async () => {
    const status = $('externalLinksMessage'), button = $('saveExternalLinks'), next = {};
    if (qaMode) { status.textContent = 'Sal de la vista QA para configurar enlaces de cobro reales.'; return; }
    try {
      for (const plan of Object.keys(EXTERNAL_PAYMENT_PLANS)) {
        const value = normalizeExternalPaymentUrl($('externalUrl-' + plan).value);
        if (value) next[plan] = value;
      }
    } catch (error) { status.textContent = error.message; return; }
    if (!confirm('Guardar estos enlaces externos? Comprueba que cada enlace cobre el importe correcto y que los fondos lleguen a tu cuenta de Mercado Pago.')) return;
    button.disabled = true; status.textContent = 'Guardando enlaces…';
    try {
      const {data, error} = await db.from('business_settings')
        .update({external_payment_links:next,updated_at:new Date().toISOString()})
        .eq('id','main').select('external_payment_links').single();
      if (error) throw error;
      displayExternalPaymentLinks(data.external_payment_links);
      status.textContent = 'Enlaces guardados. Ningún pago fue realizado.';
      await logAdmin('update_external_payment_links','business_settings','main',
        {configured_plans:Object.keys(next)});
      await loadAudit();
    } catch (error) { status.textContent = 'No se guardaron: ' + error.message; }
    finally { button.disabled = false; }
  };
  const make = async (kit) => {
    const status = $('externalKitMessage'), plan = $('externalPlan').value;
    if (qaMode) { status.textContent = 'La vista QA no comparte enlaces de cobro reales.'; return; }
    if (!sellersReady) { status.textContent = 'No se cargó el catálogo de vendedores.'; return; }
    let link;
    try { link = normalizeExternalPaymentUrl($('externalUrl-' + plan).value); }
    catch (error) { status.textContent = error.message; return; }
    if (!link) { status.textContent = 'Configura y guarda primero el enlace de ese plan.'; return; }
    if (link !== externalPaymentLinks[plan]) {
      status.textContent = 'Guarda los enlaces antes de compartirlos.'; return;
    }
    const sellerId = $('externalSeller').value;
    const seller = sellerId ? sellers.find(s => s.active && s.id === sellerId) : null;
    if (sellerId && !seller) { status.textContent = 'Selecciona un vendedor activo.'; return; }
    const value = kit ? externalPaymentText(seller, plan, link) : link;
    await copyExternalPaymentText(value, status);
  };
  $('copyExternalLink').onclick = () => make(false);
  $('copyExternalKit').onclick = () => make(true);
}
// Pure helpers exported only for unit tests (no customer/payment data).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {normalizeExternalPaymentUrl, externalPaymentText};
}
