const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('crear/index.html','utf8');

test('save recovers after session network failure and blocks concurrent attempts',async()=>{
  let click,calls=0,rejectSession;
  const button={disabled:false,textContent:'Guardar cambios',addEventListener:(_,fn)=>click=fn};
  const source=html.slice(html.indexOf('let publishInFlight=false;'),html.indexOf('function goToMobilePreview'));
  vm.runInNewContext(source,{publishButton:button,currentProfileId:42,alert(){},
    supabaseClient:{auth:{getSession:()=>{calls++;return new Promise((_,reject)=>rejectSession=reject);}}}});
  const saving=click();
  // Session rendering may touch disabled state; the independent guard must hold.
  button.disabled=false;
  await click();assert.equal(calls,1);
  rejectSession(Error('offline'));await saving;
  assert.equal(button.disabled,false);assert.equal(button.textContent,'Guardar cambios');
  const retry=click();assert.equal(calls,2);rejectSession(Error('offline'));await retry;
});

test('analytics dialog opens and escapes saved profile names',async()=>{
  const source=html.slice(html.indexOf('function escapeHtml(value){'),html.indexOf('async function loadMyCards(){'));
  let opened=false,alerted=false;
  const modal={innerHTML:'',querySelector:()=>({insertAdjacentElement(){}}),showModal(){opened=true;}};
  const query={select(){return this;},eq(){return this;},gte(){return this;},order:async()=>({data:[]})};
  const context={localStorage:{getItem:()=>null},supabaseClient:{from:()=>query},
    document:{getElementById:()=>modal,createElement:()=>({style:{},appendChild(){}})},alert(){alerted=true;},button:{textContent:'Métricas'}};
  vm.createContext(context);
  await vm.runInContext(source+';showProfileAnalytics("qa","<img src=x onerror=alert(1)>",button)',context);
  assert.equal(alerted,false);assert.equal(opened,true);
  assert.ok(modal.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(context.button.disabled,false);
});

test('stored icon values cannot create HTML attributes or event handlers',()=>{
  const slot={children:[],replaceChildren(){this.children=[];},appendChild(x){this.children.push(x);},set innerHTML(_){throw Error('HTML injection sink');}};
  const source=html.slice(html.indexOf('function renderIcon(key){'),html.indexOf('async function optimizeIcon'));
  const customIcons={whatsapp:'https://example.test/x" onerror="alert(1)'};
  vm.runInNewContext(source+';renderIcon("whatsapp")',{
    customIcons,defaultIcons:{whatsapp:'W'},document:{querySelector:()=>slot,createElement:()=>({})}
  });
  assert.equal(slot.children.length,1);
  assert.equal(slot.children[0].src,customIcons.whatsapp);
  assert.equal(slot.children[0].onerror,undefined);
});

test('checkout recovers after a thrown network error and keeps the original label',async()=>{
  let click;
  const button={disabled:false,textContent:'Renovar plan',addEventListener:(_,fn)=>click=fn};
  const start=html.indexOf('payButton.addEventListener("click",async()=>{');
  const end=html.indexOf('async function trackBusinessEvent',start);
  let calls=0;
  vm.runInNewContext(html.slice(start,end),{
    payButton:button,currentProfileId:42,document:{getElementById:()=>({value:'personal'})},
    supabaseClient:{functions:{invoke:async()=>{calls++;throw Error('offline');}}},
    refreshCheckoutPlan(){},alert(){},Number,window:{location:{}},trackBusinessEvent:async()=>{}
  });
  await Promise.all([click(),click()]);
  assert.equal(calls,1);
  assert.equal(button.disabled,false);
  assert.equal(button.textContent,'Renovar plan');
  await click();
  assert.equal(calls,2);
});


test('plan status renders Free and annual plans without interrupting profile loading',()=>{
  const title={},copy={},button={};
  const box={style:{},querySelector:s=>s==='strong'?title:copy};
  const source=html.slice(html.indexOf('function setPayButton(label){'),html.indexOf('let currentSubscriptionPlan='));
  const context={payButton:button,paymentBox:box};vm.createContext(context);vm.runInContext(source,context);
  context.renderPlanStatus({status:'active',subscription_plan:'free'});
  assert.equal(title.textContent,'Tu tarjeta está en Free');assert.equal(button.textContent,'Elegir plan');
  context.renderPlanStatus({status:'active',subscription_plan:'personal',current_period_end:new Date(Date.now()+365*86400000).toISOString()});
  assert.equal(title.textContent,'Plan activo');assert.equal(button.textContent,'Renovar anticipadamente');
});
