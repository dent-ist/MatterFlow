const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1366,height:768},extraHTTPHeaders:{'X-Dev-User':'KE\\testuser02'}}); const p=await c.newPage();
 await p.goto('http://localhost:4200/dashboard',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(3500);
 await p.getByRole('button',{name:/Hide Panel/}).click(); await p.waitForTimeout(1200);
 await p.locator('[aria-label^="Unassigned wait gauge"]').first().click({timeout:3000}); await p.waitForTimeout(1200);
 console.log(JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('[aria-pressed=true]')].map(x=>(x.getAttribute('aria-label')||x.textContent).trim().slice(0,30)))), JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('main thead th')].map(t=>t.textContent.trim().slice(0,12)))));
 await p.getByRole('button',{name:/Show Panel/}).click(); await b.close();})();
