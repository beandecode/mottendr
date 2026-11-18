export function createOfflineWorker(cache, files) {
  return `const CACHE=${JSON.stringify(cache)},FILES=${JSON.stringify(files)};
// Files under assets/ and content/ carry a content hash and never change: an update reuses
// copies from earlier releases instead of downloading them again. Once every file is cached the
// worker takes over at once, so a copy whose old data files are gone repairs itself on next launch.
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>Promise.all(FILES.map(p=>{
 const url=new URL(p,self.registration.scope),hashed=/\\/(assets|content)\\//.test(url.pathname);
 return (hashed?caches.match(url):Promise.resolve(undefined)).then(r=>r?c.put(url,r):c.add(url));
}))).then(()=>self.skipWaiting())));
self.addEventListener('message',e=>{
 if(e.data==='SKIP_WAITING'){self.skipWaiting();return;}
 if(e.data==='CHECK_OFFLINE_READY'&&e.ports?.[0])e.waitUntil(caches.open(CACHE).then(c=>Promise.all(FILES.map(p=>c.match(new URL(p,self.registration.scope))))).then(all=>e.ports[0].postMessage({ready:all.every(Boolean)})).catch(()=>e.ports[0].postMessage({ready:false})));
});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>{
 const own=keys.filter(k=>k.startsWith('francais-')),previous=own.filter(k=>k!==CACHE).at(-1);
 return Promise.all(own.filter(k=>k!==CACHE&&k!==previous).map(k=>caches.delete(k)));
}).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.includes('/api/'))return;
 if(e.request.mode==='navigate'){e.respondWith(caches.open(CACHE).then(c=>c.match(new URL('index.html',self.registration.scope))).then(r=>r||fetch(e.request)));return;}
 const assetPath=new URL('assets/',self.registration.scope).pathname;
 if(FILES.some(p=>new URL(p,self.registration.scope).href===u.href)||u.pathname.startsWith(assetPath))
 e.respondWith(caches.open(CACHE).then(c=>c.match(e.request)).then(r=>r||caches.match(e.request)).then(r=>r||fetch(e.request)));
});`;
}
