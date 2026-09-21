const CACHE="clickonme-kit-v3";
const CORE=["/kit/","/brand.css","/logo-clickonme.png","/pwa-icon.svg"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));});
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const u=new URL(e.request.url);if(u.origin!==self.location.origin)return;if(u.pathname==="/kit/"||u.pathname==="/kit/index.html"){e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>r).catch(()=>new Response("Sin conexión",{status:503})));}});
