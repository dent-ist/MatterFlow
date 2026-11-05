const { chromium } = require('playwright');
const U = { director: 'KE\\testuser02', podlead: 'KE\\testuser06', tech: 'KE\\testuser01', admin: 'KE\\kekim', pm: 'KE\\testuser35' };
const pages = [['director','/dashboard'],['director','/matters'],['director','/matters/1'],['director','/clients'],['director','/clients/1'],['director','/projects/1'],['director','/assets'],['director','/assets/1'],['director','/tasks'],['director','/tasks/200'],['director','/tasks/new'],['director','/profile'],['director','/search?q=Demo'],['tech','/my-work'],['podlead','/pods/work'],['pm','/my-matters'],['admin','/admin/users'],['admin','/admin/roles'],['admin','/admin/pods'],['admin','/admin/task-types'],['admin','/admin/priorities'],['admin','/admin/asset-types'],['admin','/admin/custom-fields'],['admin','/admin/reports'],['admin','/admin/audit'],['admin','/admin/settings']];
const MINOR=new Set(['a','an','and','as','at','for','in','of','on','or','the','to','by','with','from','into','per','vs']);
(async()=>{
 const b=await chromium.launch(); const ctxs={}; const flagged={};
 for (const [p,url] of pages) {
  ctxs[p] ||= await b.newContext({viewport:{width:1366,height:768},extraHTTPHeaders:{'X-Dev-User':U[p]}});
  const page=await ctxs[p].newPage();
  try { await page.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'}); try{await page.waitForLoadState('networkidle',{timeout:8000});}catch{} await page.waitForTimeout(1500);
   const items=await page.evaluate(()=>{
     const q=(s,k)=>[...document.querySelectorAll(s)].map(e=>({k,t:(e.getAttribute('aria-label')&&k==='btn'?'':'')+(e.textContent||'').replace(/\s+/g,' ').trim()})).filter(x=>x.t&&x.t.length<45);
     return [...q('main button, header button, main a.mf-btn','btn'),...q('[role=tab]','tab'),...q('h1,h2,h3','head'),...q('main th','col'),...q('main label, main legend','label')];
   });
   for (const it of items) {
     const words=it.t.replace(/\(\d+\)/g,'').replace(/[0-9]+/g,'').split(' ').filter(Boolean);
     if (words.length<2) continue;
     const bad=words.slice(1).filter(w=>/^[a-z]{3,}$/.test(w)&&!MINOR.has(w));
     if (it.k==='col') continue;
     if (bad.length && !/\.$|\?$|,/.test(it.t)) { const key=it.k+': '+it.t; (flagged[key] ||= new Set()).add(url); }
   }
  } catch(e){}
  await page.close();
 }
 await b.close();
 for (const [k,v] of Object.entries(flagged)) console.log(k,'|',[...v].slice(0,2).join(' '));
})();
