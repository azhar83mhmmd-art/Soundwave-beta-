const CACHE='sw-v4'
const STATIC=['/','/style.css','/script.js','/manifest.json']
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()))})
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))})
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url)
  if(e.request.method!=='GET'||url.pathname.startsWith('/api/')) return
  e.respondWith(caches.match(e.request).then(cached=>{
    const net=fetch(e.request).then(res=>{
      if(res.ok&&!url.hostname.includes('ytimg')&&!url.hostname.includes('youtube')){
        caches.open(CACHE).then(c=>c.put(e.request,res.clone()))
      }
      return res
    }).catch(()=>cached)
    return cached||net
  }))
})
