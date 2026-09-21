const CACHE="clickonme-pwa-v7";
const OFFLINE="/";
const CORE=["/","/brand.css","/logo-clickonme.png","/pwa-icon.svg","/crear/perfil.html"];
self.addEventListener("install",event=>{
 self.skipWaiting();
 event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));
});
self.addEventListener("activate",event=>event.waitUntil(
 caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET")return;
 const u=new URL(event.request.url);
 if(u.origin!==self.location.origin)return;
 const isProfile=u.pathname==="/crear/perfil.html";
 const isHomepage=u.pathname==="/" || u.pathname==="/index.html";
 if(isProfile||isHomepage){
   event.respondWith(fetch(event.request).then(r=>{if(r&&r.ok)caches.open(CACHE).then(c=>c.put(event.request,r.clone()));return r;}).catch(()=>caches.match(event.request).then(r=>r||caches.match(isProfile?"/crear/perfil.html":OFFLINE)||caches.match(OFFLINE))));
   return;
 }
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{if(r&&r.ok)caches.open(CACHE).then(c=>c.put(event.request,r.clone()));return r;}).catch(()=>caches.match(OFFLINE))));
});