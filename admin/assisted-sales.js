let assistedSales = [], assistedSalesReady = false, saleRequest = null;
function salesMoney(value) { return new Intl.NumberFormat('es-MX', {style:'currency',currency:'MXN'}).format(Number(value)||0); }
function assistedRevenue(profileId) { return assistedSales.filter(s=>profileId==null||String(s.profile_id)===String(profileId)).reduce((sum,s)=>sum+Number(s.amount_mxn),0); }
function updateSaleCustomers() {
 const select=$('saleProfile'), previous=select.value;
 select.replaceChildren(new Option('Selecciona una tarjeta entregada',''));
 for(const c of cards.filter(c=>c.user_id)) select.add(new Option(c.name+' /'+c.slug,String(c.id)));
 if([...select.options].some(o=>o.value===previous)) select.value=previous;
}
function saleEstimate() {
 const key=$('salePlan').value, list=Number($('plan'+key[0].toUpperCase()+key.slice(1)).value), amount=Number($('saleAmount').value);
 $('saleAmount').max=list>0?String(list):'';
 $('saleEstimate').textContent='Precio de lista: '+salesMoney(list)+'. Comisión posible en el primer pago: '+salesMoney($('saleSeller').value.trim()?Math.round(amount*20)/100:0)+'. La base de datos verifica si corresponde.';
}
async function loadAssistedSales() {
 assistedSalesReady=false;
 const {data,error}=await db.from('assisted_sales').select('*').order('activated_at',{ascending:false});
 if(error){$('assistedSalesMessage').textContent='No se pudo cargar el registro de ventas: '+error.message;return;}
 assistedSales=data||[]; assistedSalesReady=true; $('assistedSalesMessage').textContent='';
 const pending=assistedSales.filter(s=>s.commission_status==='pending').reduce((n,s)=>n+Number(s.commission_mxn),0);
 $('assistedTotals').textContent='Cobros asistidos: '+salesMoney(assistedRevenue())+' · Comisiones pendientes: '+salesMoney(pending);
 const labels={pending:'Pendiente',paid:'Pagada',not_applicable:'No corresponde'};
 $('assistedSalesRows').innerHTML=assistedSales.map(s=>`<tr><td>${escapeHtml(s.customer_name)}<br>${escapeHtml(s.seller_code||'Sin vendedor')}</td><td>${escapeHtml(s.plan)} · ${salesMoney(s.amount_mxn)}<br><small>Lista: ${salesMoney(s.list_price_mxn)} · ${escapeHtml(s.discount_note||'Sin descuento')}</small></td><td>Recibido · ${escapeHtml(s.payment_method)}<br>${escapeHtml(s.payment_reference)}<br>${fmt(s.paid_at)}</td><td>${fmt(s.activated_at)}<br>${fmt(s.expires_at)}</td><td>${salesMoney(s.commission_mxn)} · ${labels[s.commission_status]}${s.commission_status==='pending'?`<br><button data-commission="${s.id}">Registrar comisión pagada</button>`:''}${s.commission_reference?'<br>'+escapeHtml(s.commission_reference):''}</td></tr>`).join('')||'<tr><td colspan="5">Todavía no hay ventas asistidas registradas.</td></tr>';
}
function initAssistedSales() {
 for(const id of ['salePlan','saleAmount','saleSeller']) $(id).addEventListener('input',saleEstimate);
 $('assistedSaleForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if($('saveAssistedSale').disabled||!$('assistedSaleForm').reportValidity())return;
  const paidAt=new Date($('salePaidAt').value);
  if(!Number.isFinite(paidAt.getTime())){$('saleMessage').textContent='Revisa la fecha del pago.';return;}
  const payload={p_profile_id:Number($('saleProfile').value),p_plan:$('salePlan').value,p_amount:Number($('saleAmount').value),p_seller_code:$('saleSeller').value.trim(),p_method:$('saleMethod').value,p_reference:$('saleReference').value.trim(),p_paid_at:paidAt.toISOString(),p_discount_note:$('saleDiscount').value.trim()};
  if(!payload.p_profile_id||!$('saleVerified').checked)return;
  if(!confirm('Registrar '+salesMoney(payload.p_amount)+' ya recibidos para '+$('saleProfile').selectedOptions[0].text+' y activar '+payload.p_plan+' por un año?'))return;
  // Reuse the operation identifier for a network retry with identical data.
  const fingerprint=JSON.stringify(payload);
  if(!saleRequest||saleRequest.fingerprint!==fingerprint)saleRequest={fingerprint,id:crypto.randomUUID()};
  $('saveAssistedSale').disabled=true;$('saleMessage').textContent='Registrando pago y activación…';
  try{
   const {data,error}=await db.rpc('admin_record_assisted_sale',{p_request_id:saleRequest.id,...payload});
   if(error)throw error;
   const sale=Array.isArray(data)?data[0]:data;
   $('saleMessage').textContent='Pago registrado y plan activado. Vence: '+fmt(sale.expires_at)+'. Comisión: '+salesMoney(sale.commission_mxn)+'. Folio: '+sale.payment_reference;
   $('saleVerified').checked=false; saleRequest=null;
   await refreshAll();
  }catch(error){$('saleMessage').textContent='No se confirmó el registro: '+error.message+'. Si se interrumpió la conexión, reintenta con el mismo folio.';}
  finally{$('saveAssistedSale').disabled=false;}
 });
 $('assistedSalesRows').addEventListener('click',async e=>{
  const button=e.target.closest('button[data-commission]');if(!button||button.disabled)return;
  const sale=assistedSales.find(s=>s.id===button.dataset.commission);if(!sale)return;
  const ref=prompt('Folio del pago de comisión ya realizado a '+sale.seller_code+' por '+salesMoney(sale.commission_mxn)+':');
  if(!ref||ref.trim().length<3)return;
  if(!confirm('Confirmar que esta comisión ya fue pagada? No se enviará dinero.'))return;
  button.disabled=true;
  try{const {error}=await db.rpc('admin_mark_commission_paid',{p_sale_id:sale.id,p_reference:ref.trim()});if(error)throw error;await loadAssistedSales();await loadAudit();}
  catch(error){$('assistedSalesMessage').textContent=error.message;button.disabled=false;}
 });
 $('exportAssistedSales').onclick=()=>csvDownload('clickonme-ventas-comisiones.csv',[
  ['Cliente','Vendedor','Plan','Lista MXN','Cobrado MXN','Descuento','Método','Estado pago','Folio','Fecha pago','Activación','Vencimiento','Primer pago','Comisión MXN','Estado comisión','Fecha pago comisión','Folio comisión'],
  ...assistedSales.map(s=>[s.customer_name,s.seller_code,s.plan,s.list_price_mxn,s.amount_mxn,s.discount_note,s.payment_method,s.payment_status,s.payment_reference,s.paid_at,s.activated_at,s.expires_at,s.first_payment,s.commission_mxn,s.commission_status,s.commission_paid_at,s.commission_reference])]);
}
