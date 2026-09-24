const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('editor and authentication scripts fetch current security fixes before cached copies',async()=>{
  const handlers={};let network=0;
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{
    self:{location:{origin:'https://clickonme.pro'},addEventListener:(name,fn)=>handlers[name]=fn},URL,
    fetch:async()=>{network++;return {ok:true,clone(){return this;}};},
    caches:{match:async()=>{throw Error('stale cache read before network');},open:async()=>({put(){}})}
  });
  for(const path of ['/crear/','/crear/index.html','/crear/auth-bridge.js','/supabase-config.js']){
    let response;
    handlers.fetch({request:{method:'GET',url:'https://clickonme.pro'+path},respondWith:p=>response=p});
    await response;
  }
  assert.equal(network,4);
});
