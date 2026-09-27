const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const settings={plan_prices:{free:0,personal:600,business:700,artist:850,creator:999}};
const context={};vm.runInNewContext(fs.readFileSync('pricing.js','utf8'),context);
const pricing=context.ClickOnMePricing;
test('all current prices come from settings and future changes propagate',()=>{
 for(const [plan,amount] of Object.entries(settings.plan_prices))assert.equal(pricing.parse(settings)[plan].amount,amount);
 assert.equal(pricing.parse({plan_prices:{...settings.plan_prices,personal:650}}).personal.amount,650);
});
test('missing, corrupt and partial settings never fall back to commercial prices',()=>{
 for(const input of [null,{}, {plan_prices:{personal:600}},...['600',0,-1,1000,null].map(personal=>({plan_prices:{...settings.plan_prices,personal}}))]) assert.throws(()=>pricing.parse(input));
});
test('active valid promotions are consistent, inactive promotions are ignored',()=>{
 const input={...settings,plan_promos:{personal:500},plan_promo_active:{personal:true}};
 assert.equal(pricing.parse(input).personal.amount,500);
 assert.equal(pricing.format(pricing.parse(input).personal),'PROMO $500 · antes $600');
 input.plan_promo_active.personal=false;assert.equal(pricing.parse(input).personal.amount,600);
 input.plan_promo_active.personal=true;input.plan_promos.personal=700;assert.throws(()=>pricing.parse(input));
});
test('price requests bypass caches and reject network/server errors',async()=>{
 const ctx={CLICKONME_SUPABASE_URL:'https://db.test',CLICKONME_SUPABASE_KEY:'public',AbortSignal,
 fetch:async(url,options)=>{assert.equal(options.cache,'no-store');return {ok:true,json:async()=>[settings]};}};
 vm.runInNewContext(fs.readFileSync('pricing.js','utf8'),ctx);
 assert.equal((await ctx.ClickOnMePricing.load()).artist.amount,850);
 ctx.fetch=async()=>({ok:false});await assert.rejects(ctx.ClickOnMePricing.load());
 ctx.fetch=async()=>{throw Error('offline');};await assert.rejects(ctx.ClickOnMePricing.load());
});
