const { chromium } = require('playwright');
const U = { director: 'KE\\testuser02', podlead: 'KE\\testuser06', tech: 'KE\\testuser01', admin: 'KE\\kekim', pm: 'KE\\testuser35' };
const pages = [['director','/tasks'],['director','/matters/1','Tasks'],['director','/projects/1'],['podlead','/pods/work'],['tech','/my-work'],['director','/dashboard'],['director','/dashboard','Breakdowns'],['director','/matters'],['pm','/my-matters']];
(async()=>{
 const b=await chromium.launch();
 for (const size of [[1366,768],[1920,1080]]) { const ctxs={};
  for (const [p,url,tab] of pages) {
   ctxs[p] ||= await b.newContext({viewport:{width:size[0],height:size[1]},extraHTTPHeaders:{'X-Dev-User':U[p]}});
   const page=await ctxs[p].newPage(); await page.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'}); try{await page.waitForLoadState('networkidle',{timeout:8000});}catch{} await page.waitForTimeout(1800);
   if(tab){ try{ await page.getByRole('tab',{name:new RegExp('^\\s*'+tab)}).click({timeout:3000}); await page.waitForTimeout(1500);}catch{} }
   const r=await page.evaluate(()=>{
     const out={ok:0,bad:[]};
     for (const e of document.querySelectorAll('main *, mf-grid-frame *')) {
       if (e.children.length>0 && !e.matches('span,a,button,td,th,div')) continue;
       const cs=getComputedStyle(e); if (e.scrollWidth<=e.clientWidth+1 || e.clientWidth<8) continue;
       if (!/(hidden|clip)/.test(cs.overflowX)) continue;
       const ell=cs.textOverflow==='ellipsis'; const hasTip=e.getAttribute('title')||e.getAttribute('aria-label')||e.closest('[title],[aria-label]');
       const cls=(e.className&&e.className.toString())||''; const text=(e.textContent||'').trim().slice(0,22);
       if (ell && hasTip) out.ok++; else out.bad.push((e.tagName+'.'+cls.slice(0,28)+' "'+text+'" ell='+ell+' tip='+!!hasTip));
     }
     out.bad=[...new Set(out.bad)].slice(0,12); return out; });
   console.log(size.join('x'),url,tab||'',JSON.stringify({ok:r.ok,bad:r.bad.length}),r.bad.slice(0,6).join(' | '));
   await page.close();
  }
  for (const c of Object.values(ctxs)) await c.close();
 }
 await b.close();
})();
