const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('crear/index.html', 'utf8');
const start = html.indexOf('async function confirmReturnedPayment(){');
const end = html.indexOf('document.getElementById("googleAuthBtn")', start);
assert.ok(start > 0 && end > start, 'Payment confirmation function exists');
const source = html.slice(start, end);

async function run(invoke) {
  const payButton = { disabled: false, textContent: 'Renovar plan' };
  const retryPaymentConfirmation = { style: { display: 'none' } };
  const message = { textContent: '' };
  const paymentBox = { style: {}, querySelector: () => message };
  let replaced = false;
  const context = {
    paymentConfirmationAttempted: false,
    currentUser: { id: 'user-1' }, currentProfileId: 42, returnedPaymentId: '123',
    returnedPaymentStatus: 'approved', retryPaymentConfirmation, paymentBox, payButton,
    supabaseClient: { functions: { invoke } },
    window: { history: { replaceState: () => { replaced = true; } } },
    Number, String, Date, encodeURIComponent,
  };
  vm.createContext(context);
  await vm.runInContext(`${source}\nconfirmReturnedPayment()`, context);
  return { context, payButton, retryPaymentConfirmation, replaced };
}

test('restores checkout and offers a separate retry when confirmation is pending', async () => {
  const { context, payButton, retryPaymentConfirmation, replaced } = await run(async () => ({ data: { status: 'pending' } }));
  assert.equal(payButton.disabled, false);
  assert.equal(payButton.textContent, 'Renovar plan');
  assert.equal(retryPaymentConfirmation.style.display, 'inline-block');
  assert.equal(context.paymentConfirmationAttempted, false);
  assert.equal(replaced, false);
});

test('recovers from a network error without leaving checkout disabled', async () => {
  const { context, payButton, retryPaymentConfirmation } = await run(async () => { throw new Error('offline'); });
  assert.equal(payButton.disabled, false);
  assert.equal(payButton.textContent, 'Renovar plan');
  assert.equal(retryPaymentConfirmation.style.display, 'inline-block');
  assert.equal(context.paymentConfirmationAttempted, false);
});
