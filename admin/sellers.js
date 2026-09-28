let sellers=[],sellersReady=false;
async function loadSellers(){
 sellersReady=false;$('saleSeller').disabled=true;
 const {data,error}=await db.from('sales_representatives').select('*').eq('is_qa',qaMode).order('name');
 if(error){$('sellersMessage').textContent='No se pudo cargar el catálogo: '+error.message;return;}
 sellers=data||[];sellersReady=true;$('sellersMessage').textContent='';
 const previous=$('saleSeller').value;
 $('saleSeller').replaceChildren(new Option('Venta directa / Sin comisión',''));
 for(const seller of sellers.filter(s=>s.active))$('saleSeller').add(new Option(seller.name+' · '+seller.code+' · '+seller.commission_percent+'%',seller.id));
 if(sellers.some(s=>s.active&&s.id===previous))$('saleSeller').value=previous;
 $('saleSeller').disabled=false;
 $('sellerRows').innerHTML=sellers.map(s=>`<tr><td>${escapeHtml(s.name)}<br><small>${escapeHtml(s.id)}</small></td><td>${escapeHtml(s.code)}</td><td>${s.active?'Activo':'Inactivo'}</td><td>${Number(s.commission_percent)}%</td><td>${fmt(s.created_at)}</td><td><button data-edit-seller="${s.id}">Editar vendedor</button></td></tr>`).join('')||'<tr><td colspan="6">Sin vendedores registrados. Puedes usar Venta directa / Sin comisión.</td></tr>';
 saleEstimate();
}
function resetSellerForm(){
 $('sellerId').value='';$('sellerName').value='';$('sellerCode').value='';$('sellerCode').disabled=false;$('sellerActive').value='true';$('sellerRate').value='20';
}
function initSellers(){
 $('clearSeller').onclick=resetSellerForm;
 $('sellerRows').addEventListener('click',e=>{
  const b=e.target.closest('button[data-edit-seller]');if(!b)return;
  const s=sellers.find(s=>s.id===b.dataset.editSeller);if(!s)return;
  $('sellerId').value=s.id;$('sellerName').value=s.name;$('sellerCode').value=s.code;$('sellerCode').disabled=true;$('sellerActive').value=String(s.active);$('sellerRate').value=s.commission_percent;
  $('sellerForm').scrollIntoView({behavior:'smooth',block:'center'});
 });
 $('sellerForm').addEventListener('submit',async e=>{
  e.preventDefault();if($('saveSeller').disabled||!$('sellerForm').reportValidity())return;
  const payload={p_id:$('sellerId').value||null,p_name:$('sellerName').value.trim(),p_code:$('sellerCode').value.trim().toUpperCase(),p_active:$('sellerActive').value==='true',p_commission_percent:Number($('sellerRate').value)};
  if(qaMode&&!payload.p_code.startsWith('QA-E2E-')){$('sellersMessage').textContent='El código QA debe comenzar con QA-E2E-';return;}
  if(!qaMode&&payload.p_code.startsWith('QA-E2E-')){$('sellersMessage').textContent='Abre la vista QA para crear vendedores de prueba.';return;}
  if(!confirm('Guardar vendedor '+payload.p_name+' ('+payload.p_code+') con comisión '+payload.p_commission_percent+'% para primeras ventas nuevas? El historial no cambia.'))return;
  $('saveSeller').disabled=true;
  try{const {error}=await db.rpc('admin_save_sales_representative',payload);if(error)throw error;resetSellerForm();await loadSellers();await loadAudit();$('sellersMessage').textContent='Vendedor guardado. Las comisiones anteriores conservan su porcentaje.';}
  catch(error){$('sellersMessage').textContent='No se pudo guardar: '+error.message;}
  finally{$('saveSeller').disabled=false;}
 });
}
