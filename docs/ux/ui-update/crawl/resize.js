const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1920,height:1080},extraHTTPHeaders:{'X-Dev-User':'KE\\testuser02'}}); const p=await c.newPage();
 const w=async()=>p.evaluate(()=>{const t=[...document.querySelectorAll('main thead th')].find(x=>/^Title/.test(x.textContent.trim())); return Math.round(t.getBoundingClientRect().width);});
 await p.goto('http://localhost:4200/tasks',{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{} await p.waitForTimeout(2000);
 console.log('start',await w());
 const th=p.locator('main thead th:has-text("Title")').first(); const bb=await th.boundingBox();
 const handle=th.locator('[class*=resize],[class*=handle],[data-resize]').first();
 let hb=null; try{hb=await handle.boundingBox();}catch{}
 const x=hb?hb.x+hb.width/2:bb.x+bb.width-2, y=bb.y+bb.height/2;
 for (const dx of [-120, 200]) { const b3=await th.boundingBox(); const x=b3.x+b3.width-2; await p.mouse.move(x,y); await p.mouse.down(); await p.mouse.move(x+dx/2,y,{steps:5}); await p.mouse.move(x+dx,y,{steps:5}); await p.mouse.up(); await p.waitForTimeout(600); console.log('after drag',dx,await w()); const bb2=await th.boundingBox(); }
 await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500); console.log('after reload',await w());
 try{ await th.hover(); await p.locator('main thead th:has-text("Title")').first().locator('button[aria-haspopup]').click({timeout:2000}); await p.getByRole('menuitem',{name:/Reset Width/}).click({timeout:2000}); await p.waitForTimeout(800); console.log('after reset',await w()); }catch(e){console.log('reset menu not reached');}
 await b.close();})();
