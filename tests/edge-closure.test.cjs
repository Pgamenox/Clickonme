const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto,createHmac}=require('node:crypto');
const payload=(body,status=200)=>new Response(JSON.stringify(body),{status});
function edge(name,fetch,extra={}){
  let handler;
  const code=stripTypeScriptTypes(fs.readFileSync(`supabase/functions/${name}/index.ts`,'utf8').replace(/^import .*;\s*$/mg,''));
  vm.runInNewContext(code,{
    Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',MERCADO_PAGO_ACCESS_TOKEN:'mp',MERCADO_PAGO_WEBHOOK_SECRET:'webhook-test',REMINDER_CRON_SECRET:'cron-test',RESEND_API_KEY:'resend-test'})[n]},serve:fn=>handler=fn},
    fetch,Response,Request,URL,TextEncoder,crypto:webcrypto,console,...extra
  });
  return handler;
}
const request=(body,headers={})=>new Request('https://db.test/functions/v1/test',{method:'POST',headers,body:JSON.stringify(body)});

test('checkout ignores client prices and uses all four server plan prices',async()=>{
  for(const [plan,amount] of Object.entries({personal:399,business:599,artist:799,creator:999})){
    let item,order;
    const handler=edge('create-mercadopago-order',async(url,options)=>{
      if(url.includes('/auth/v1/user'))return payload({id:'user',email:'qa@example.invalid'});
      if(url.includes('/profiles?'))return payload([{id:42,account_role:'customer',demo_profile:false}]);
      if(url.includes('/business_settings?'))return payload([{plan_prices:{personal:399,business:599,artist:799,creator:999}}]);
      if(url.includes('/checkout/preferences')){item=JSON.parse(options.body).items[0];return payload({id:'pref',sandbox_init_point:'https://sandbox.mercadopago.com/checkout'});}
      if(url.endsWith('/payments')){order=JSON.parse(options.body);return payload({});}
      throw Error(url);
    });
    const response=await handler(request({profileId:42,plan,amount:1,price:1}));
    assert.equal(response.status,200);assert.equal(item.unit_price,amount);assert.equal(item.currency_id,'MXN');assert.equal(order.amount_mxn,amount);
  }
});

test('checkout denies expired sessions before contacting the payment provider',async()=>{
  const handler=edge('create-mercadopago-order',async url=>{assert.ok(url.includes('/auth/v1/user'));return payload({},401);});
  assert.equal((await handler(request({profileId:42,plan:'creator'}))).status,401);
});

test('webhook rejects invalid signatures before reading or applying any payment',async()=>{
  const handler=edge('mercadopago-webhook',async()=>{throw Error('must not call downstream');});
  assert.equal((await handler(request({type:'payment',data:{id:'123'}}))).status,401);
});

test('signed webhook verifies currency and amount against the saved order',async()=>{
  for(const [amount,currency,expected] of [[399,'MXN',200],[1,'MXN',409],[399,'USD',409]]){
    let rpc=0;
    const handler=edge('mercadopago-webhook',async url=>{
      if(url.includes('/v1/payments/123'))return payload({external_reference:'clickonme-test',transaction_amount:amount,currency_id:currency,status:'approved'});
      if(url.includes('/payments?'))return payload([{id:'order',amount_mxn:399}]);
      if(url.includes('/rpc/')){rpc++;return payload([{status:'approved'}]);}
      throw Error(url);
    });
    const ts=String(Date.now()),rid='qa-request';
    const signature=createHmac('sha256','webhook-test').update(`id:123;request-id:${rid};ts:${ts};`).digest('hex');
    const response=await handler(request({type:'payment',data:{id:'123'}},{'x-request-id':rid,'x-signature':`ts=${ts},v1=${signature}`}));
    assert.equal(response.status,expected);assert.equal(rpc,expected===200?1:0);
  }
});

test('reminders report provider failures and reuse a stable idempotency key',async()=>{
  const keys=[];
  const end=new Date(Date.now()+6.5*86400000).toISOString();
  const handler=edge('send-renewal-reminders',async(url,options)=>{
    if(url.includes('/profiles?'))return payload([{id:42,user_id:'user',name:'QA',slug:'qa',status:'active',subscription_plan:'personal',current_period_end:end,account_role:'customer',demo_profile:false}]);
    if(url.includes('/notification_log?'))return payload([]);
    if(url.includes('/auth/v1/admin/users/'))return payload({email:'qa@example.invalid'});
    if(url==='https://api.resend.com/emails'){keys.push(options.headers['Idempotency-Key']);return payload({},503);}
    throw Error(url);
  });
  for(let i=0;i<2;i++){
    const result=await handler(request({}, {'x-cron-secret':'cron-test'}));
    assert.equal(result.status,502);assert.equal((await result.json()).failed,1);
  }
  assert.ok(keys[0]);assert.equal(keys[0],keys[1]);
});

test('reminders fail closed when notification history cannot be read',async()=>{
  let emails=0;
  const handler=edge('send-renewal-reminders',async url=>{
    if(url.includes('/profiles?'))return payload([{id:42,user_id:'user',status:'active',subscription_plan:'personal',current_period_end:new Date(Date.now()+6.5*86400000).toISOString()}]);
    if(url.includes('/notification_log?'))return payload({},503);
    emails++;throw Error('must not send');
  });
  assert.equal((await handler(request({}, {'x-cron-secret':'cron-test'}))).status,502);assert.equal(emails,0);
  assert.equal((await handler(request({}))).status,401);
});

test('expired customers retain their manifest while suspended cards remain unavailable',async()=>{
  for(const status of ['active','trial','suspended','expired']){
    const row={name:'QA',status,account_role:'customer',demo_profile:false,subscription_plan:'personal',current_period_end:'2020-01-01',trial_ends_at:'2020-01-01'};
    const handler=edge('profile-manifest',async()=>{throw Error('unexpected fetch');},{createClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:row})})})})})});
    const result=await handler(new Request('https://db.test/functions/v1/profile-manifest?u=qa-card'));
    assert.equal(result.status,['active','trial'].includes(status)?200:410);
    if(result.ok)assert.equal((await result.json()).start_url,'https://clickonme.pro/crear/perfil.html?u=qa-card&source=pwa');
  }
});
