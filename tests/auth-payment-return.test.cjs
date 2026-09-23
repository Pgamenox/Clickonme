const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('crear/auth-bridge.js', 'utf8');

async function login(search) {
  const elements = Object.fromEntries(['signinBtn', 'authEmail', 'authPassword', 'authStatus']
    .map((id) => [id, { value: id === 'authEmail' ? 'cliente@example.com' : 'Password123!',
      addEventListener(event, handler) { if (event === 'click') this.click = handler; } }]));
  let destination;
  const session = { access_token: 'access', refresh_token: 'refresh' };
  const window = {
    CLICKONME_SUPABASE_URL: 'https://db.test', CLICKONME_SUPABASE_KEY: 'anon',
    localStorage: {},
    supabase: { createClient: () => ({ auth: {
      signInWithPassword: async () => ({ data: { session }, error: null }),
      getSession: async () => ({ data: { session } }),
    } }) },
  };
  vm.runInNewContext(source, {
    window, URLSearchParams,
    document: { readyState: 'complete', getElementById: (id) => elements[id] },
    sessionStorage: { setItem() {} },
    location: { search, replace: (url) => { destination = url; } },
  });
  await elements.signinBtn.click();
  return destination;
}

test('keeps the payment and profile reference after signing in', async () => {
  const destination = await login('?id=42&payment=success&payment_id=123&status=approved');
  const params = new URL(destination, 'https://clickonme.pro').searchParams;
  assert.equal(params.get('id'), '42');
  assert.equal(params.get('payment_id'), '123');
  assert.equal(params.get('payment'), 'success');
  assert.equal(params.get('status'), 'approved');
});

test('drops unrelated query parameters from the redirect', async () => {
  const destination = await login('?id=42&redirect=https%3A%2F%2Fevil.example&token=secret');
  assert.equal(destination, '/crear/?id=42&auth=ok&v=auth4');
});
