const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(rpc){
 const elements={};const $=id=>elements[id]??=( {value:'',checked:true,disabled:false,textContent:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn},reportValidity(){return true}} );
 const values={salePaidAt:'2026-09-27T12:00',saleProfile:'123',salePlan:'personal',saleAmount:'500.50',saleSeller:'SELLER',saleMethod:'efectivo',saleReference:'RECEIPT-1',saleDiscount:'Promo'};
 for(const [id,value]of Object.entries(values))$(id).value=value;
 $('saleProfile').selectedOptions=[{text:'Cliente QA'}];let sequence=0;
 const ctx={$,Intl,Number,Date,JSON,crypto:{randomUUID:()=>`operation-${++sequence}`},db:{rpc},confirm:()=>true,refreshAll:async()=>{},fmt:v=>v};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('admin/assisted-sales.js','utf8'),ctx);ctx.initAssistedSales();
 return {$,submit:()=>$('assistedSaleForm').listeners.submit({preventDefault(){}})};
}
test('assisted sale submits actual amount and retains operation on uncertain retry',async()=>{
 const calls=[];const ui=setup(async(name,payload)=>{calls.push({name,payload});return {error:{message:'network unavailable'}}});
 await ui.submit();await ui.submit();assert.equal(calls.length,2);assert.equal(calls[0].payload.p_amount,500.50);assert.equal(calls[0].payload.p_request_id,calls[1].payload.p_request_id);assert.equal(ui.$('saveAssistedSale').disabled,false);
 ui.$('saleAmount').value='400';await ui.submit();assert.notEqual(calls[1].payload.p_request_id,calls[2].payload.p_request_id);
});
test('assisted sale prevents concurrent duplicate submits and clears confirmation on success',async()=>{
 let resolve,calls=0;const ui=setup(()=>{calls++;return new Promise(r=>resolve=r)});
 const pending=ui.submit();await ui.submit();assert.equal(calls,1);
 resolve({data:{expires_at:'2027-09-28',commission_mxn:100.10,payment_reference:'RECEIPT-1'}});await pending;
 assert.equal(ui.$('saleVerified').checked,false);assert.match(ui.$('saleMessage').textContent,/Pago registrado y plan activado/);await ui.submit();assert.equal(calls,1);
});
test('assisted sale requires receipt verification before any mutation',async()=>{
 let calls=0;const ui=setup(async()=>{calls++;return {data:{}}});ui.$('saleVerified').checked=false;await ui.submit();assert.equal(calls,0);
});
