(function(){
  async function refresh(){
    const nodes=document.querySelectorAll("[data-public-price]");
    try{
      const prices=await ClickOnMePricing.load();
      nodes.forEach(node=>{node.textContent=ClickOnMePricing.format(prices[node.dataset.publicPrice]);});
      if(document.getElementById("pricingStatus"))document.getElementById("pricingStatus").textContent="Precios vigentes en MXN. Planes pagados por año.";
    }catch{
      nodes.forEach(node=>{node.textContent="No disponible";});
      if(document.getElementById("pricingStatus"))document.getElementById("pricingStatus").textContent="No pudimos consultar los precios. Vuelve a intentarlo antes de contratar.";
    }
  }
  refresh();
  window.addEventListener("pageshow",event=>{if(event.persisted)refresh();});
  window.addEventListener("online",refresh);
})();
