(function(){
  async function refresh(){
    const nodes=document.querySelectorAll("[data-public-price]");
    try{
      const prices=await ClickOnMePricing.load();
      nodes.forEach(node=>{node.textContent=ClickOnMePricing.format(prices[node.dataset.publicPrice]);});
      if(document.getElementById("pricingStatus"))document.getElementById("pricingStatus").textContent="Planes pagados: MXN / año · Un solo pago · Vigencia de 12 meses.";
    }catch{
      nodes.forEach(node=>{node.textContent="No disponible";});
      if(document.getElementById("pricingStatus"))document.getElementById("pricingStatus").textContent="No pudimos consultar los precios. Vuelve a intentarlo antes de contratar.";
    }
  }
  refresh();
  window.addEventListener("pageshow",event=>{if(event.persisted)refresh();});
  window.addEventListener("online",refresh);
})();
