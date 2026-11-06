const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();
 const mk=async(u)=>{const c=await b.newContext({viewport:{width:1366,height:768},extraHTTPHeaders:{'X-Dev-User':u}});return c;};
 let c=await mk('KE\\testuser02'); let p=await c.newPage();
 for(const url of ['/tasks','/matters/1']){ await p.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{} await p.waitForTimeout(1800);
  if(url.startsWith('/matters')) { try{await p.getByRole('tab',{name:/^\s*Tasks/}).click(); await p.waitForTimeout(1500);}catch{} }
  await p.emulateMedia({media:'print'}); const t=await p.evaluate(()=>[...document.querySelectorAll('[data-print-when]')].map(e=>e.textContent.trim())); console.log(url,JSON.stringify(t)); await p.emulateMedia({media:'screen'});
  const pr=await p.evaluate(()=>{const r=[...document.querySelectorAll('tbody tr')].slice(0,3).map(tr=>{const tds=[...tr.querySelectorAll('td')]; const last=tds.slice(-2).map(td=>td.innerText.replace(/\s+/g,' ').trim()); return last.join(' | ');}); return r;}); console.log(url,'last cells',JSON.stringify(pr)); }
 await c.close(); c=await mk('KE\\testuser06'); p=await c.newPage();
 await p.goto('http://localhost:4200/pods/work',{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{} await p.waitForTimeout(2000);
 const m=await p.evaluate(()=>{const th=[...document.querySelectorAll('main thead th')].map(t=>[t.textContent.trim().slice(0,10),Math.round(t.getBoundingClientRect().width)]); const fr=document.querySelector('main table').closest('[class*=frame],[class*=scroll]'); const btn=document.querySelector('tbody tr td button[aria-label*="ssign"]'); const bb=btn&&btn.getBoundingClientRect(); return {th,scroll:fr.scrollWidth-fr.clientWidth,assign:bb&&[Math.round(bb.width),Math.round(bb.height)]};}); console.log('pod',JSON.stringify(m));
 await c.close(); c=await mk('KE\\testuser02'); p=await c.newPage();
 await p.goto('http://localhost:4200/dashboard?tab=calendar',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(3500); try{await p.getByRole('button',{name:/^Week$/}).click(); await p.waitForTimeout(1500);}catch{}
 console.log('week',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('main thead th')].slice(0,3).map(t=>{const cs=getComputedStyle(t);return [Math.round(t.getBoundingClientRect().height),cs.fontSize,cs.fontWeight,cs.color,cs.textTransform]}))));
 await b.close();})();
