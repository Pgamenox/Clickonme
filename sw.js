const CACHE="clickonme-pwa-v2";
const OFFLINE="/";
const CORE=["/","/brand.css","/logo-clickonme.png","/pablogarza/","/pablogarza/manifest.webmanifest"];
self.addEventListener("install",event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));});
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET") return;
 const u=new URL(event.request.url); if(u.origin!==self.location.origin) return;
 event.respondWith(fetch(event.request).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return r;}).catch(()=>caches.match(event.request).then(r=>r||caches.match(OFFLINE))));
});