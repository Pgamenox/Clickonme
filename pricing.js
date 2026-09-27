/* Business settings are the only source of commercial prices. Never cache quotes. */
(function(root){
  "use strict";
  const plans=["free","personal","business","artist","creator"];
  function parse(settings){
    const result={};
    for(const plan of plans){
      const normal=settings?.plan_prices?.[plan];
      if(typeof normal!=="number"||!Number.isInteger(normal)||(plan==="free"?normal!==0:normal<1||normal>999)) throw new Error("Precio no disponible");
      const promo=settings?.plan_promos?.[plan];
      const active=plan!=="free"&&settings?.plan_promo_active?.[plan]===true;
      if(active&&(typeof promo!=="number"||!Number.isInteger(promo)||promo<1||promo>=normal)) throw new Error("Promoción no disponible");
      result[plan]={normal,amount:active?promo:normal,promo:active};
    }
    return result;
  }
  async function load(){
    const response=await fetch(root.CLICKONME_SUPABASE_URL+"/rest/v1/business_settings?id=eq.main&select=plan_prices,plan_promos,plan_promo_active",{
      headers:{apikey:root.CLICKONME_SUPABASE_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)throw new Error("No se pudieron consultar los precios");
    const rows=await response.json();
    return parse(rows?.[0]);
  }
  function format(quote){return quote.promo?"PROMO $"+quote.amount+" · antes $"+quote.normal:"$"+quote.amount;}
  root.ClickOnMePricing={parse,load,format};
})(typeof window!=="undefined"?window:globalThis);
