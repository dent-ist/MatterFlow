const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1920,height:1080},extraHTTPHeaders:{'X-Dev-User':'KE\\testuser02'}}); const p=await c.newPage();
 await p.goto('http://localhost:4200/tasks',{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{} await p.waitForTimeout(2500);
 const W=()=>p.evaluate(()=>Math.round([...document.querySelectorAll('main thead th')].find(x=>/Title/.test(x.textContent)).getBoundingClientRect().width));
 const th=p.locator('main thead th:has-text("Title")').first(); let bb=await th.boundingBox(); const y=bb.y+bb.height/2; await p.mouse.move(bb.x+bb.width-2,y); await p.mouse.down(); await p.mouse.move(bb.x+bb.width-82,y,{steps:6}); await p.mouse.up(); await p.waitForTimeout(600); console.log('narrowed',await W());
 await p.getByRole('button',{name:/^Columns/}).click(); await p.waitForTimeout(700);
 console.log(JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('button,[role=menuitem]')].map(e=>e.textContent.trim()).filter(t=>/reset|width|default|fit/i.test(t)).slice(0,10))));
 console.log(JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('button[data-width-reset]')].map(b=>[b.getAttribute('aria-label'),b.getAttribute('aria-disabled')])))); const r=p.locator('button[data-width-reset]:not([aria-disabled=true])').first(); if(await r.count()){ await r.click(); await p.waitForTimeout(900); console.log('after reset',await W()); await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500); console.log('after reload',await W()); }
 await b.close();})();
