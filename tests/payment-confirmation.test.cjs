const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('supabase/functions/confirm-mercadopago-payment/index.ts', 'utf8')
  .replace(/^import .*\n/, '')
  .replaceAll(': Request', '')
  .replaceAll(': unknown', '');

async function confirm({ appliedStatus = 'approved', owner = 'user-1', amount = 399 } = {}) {
  let handler;
  let rpcCalls = 0;
  const payload = (value) => new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
  const fetch = async (url) => {
    if (url.includes('/auth/v1/user')) return payload({ id: 'user-1' });
    if (url.includes('/v1/payments/123')) return payload({
      external_reference: 'clickonme-1-personal-attempt',
      transaction_amount: 399,
      currency_id: 'MXN',
      status: 'approved',
    });
    if (url.includes('/rest/v1/payments?')) {
      return payload(owner === 'user-1' ? [{ id: 'order-1', amount_mxn: amount }] : []);
    }
    if (url.includes('/rpc/apply_verified_payment_gateway')) {
      rpcCalls++;
      return payload([{ status: appliedStatus, current_period_end: '2027-09-23T00:00:00Z' }]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  vm.runInNewContext(source, {
    Deno: {
      env: { get: (name) => ({
        SUPABASE_URL: 'https://db.test',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
        MERCADO_PAGO_ACCESS_TOKEN: 'mp',
      })[name] },
      serve: (fn) => { handler = fn; },
    },
    fetch, Response, Request, URL, Set, Array, Number, String, JSON, console,
  });
  const response = await handler(new Request('https://db.test/functions/v1/confirm-mercadopago-payment', {
    method: 'POST',
    headers: { Authorization: 'Bearer session' },
    body: JSON.stringify({ paymentId: '123', profileId: 1 }),
  }));
  return { response, data: await response.json(), rpcCalls };
}

test('reports the applied status when a payment is approved', async () => {
  const result = await confirm();
  assert.equal(result.response.status, 200);
  assert.equal(result.data.status, 'approved');
  assert.equal(result.data.active, true);
  assert.equal(result.rpcCalls, 1);
});

test('does not claim an active plan when the gateway and database disagree', async () => {
  const result = await confirm({ appliedStatus: 'refunded' });
  assert.equal(result.data.status, 'refunded');
  assert.equal(result.data.active, false);
});

test('does not apply a payment belonging to another account', async () => {
  const result = await confirm({ owner: 'someone-else' });
  assert.equal(result.response.status, 403);
  assert.equal(result.rpcCalls, 0);
});

test('does not apply a payment with a different amount', async () => {
  const result = await confirm({ amount: 599 });
  assert.equal(result.response.status, 409);
  assert.equal(result.rpcCalls, 0);
});
