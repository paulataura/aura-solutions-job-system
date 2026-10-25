const CACHE='aura-contractor-shell-v32-6';
const APP='./Aura_Solutions_Supabase_Test_v32_6.html';
const SUPABASE_CDN='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.add(APP);
  try{
   await cache.add(SUPABASE_CDN);
  }catch(error){
   // A previously installed version may already have the library. Keep that
   // known-good copy when the CDN is temporarily unreachable during upgrade.
   const previous=await caches.match(SUPABASE_CDN);
   if(!previous)throw error;
   await cache.put(SUPABASE_CDN,previous);
  }
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('aura-contractor-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);
 if(url.href===SUPABASE_CDN||url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('/@supabase/supabase-js@2')){event.respondWith(caches.match(SUPABASE_CDN).then(c=>c||fetch(req).then(r=>{const x=r.clone();caches.open(CACHE).then(k=>k.put(SUPABASE_CDN,x));return r;})));return;}
 if(req.mode==='navigate'&&url.origin===self.location.origin&&url.pathname.endsWith('/Aura_Solutions_Supabase_Test_v32_6.html')){event.respondWith(fetch(req).catch(()=>caches.match(APP,{ignoreSearch:true})));}
});
