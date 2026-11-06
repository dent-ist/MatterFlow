const { chromium } = require('playwright');
const U={director:'KE\\testuser02',podlead:'KE\\testuser06',tech:'KE\\testuser01'};
const R='/home/user/wt/ui-designer/docs/ux/ui-update/review-8/';
(async()=>{const b=await chromium.launch();
 const mk=async(u,w)=>{const c=await b.newContext({viewport:{width:w[0],height:w[1]},extraHTTPHeaders:{'X-Dev-User':U[u]}}); const p=await c.newPage(); return [c,p];};
 const go=async(p,url)=>{await p.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{} await p.waitForTimeout(2500);};
 let [c,p]=await mk('director',[1366,768]); await go(p,'/dashboard');
 // unassigned card
 await p.getByRole('button',{name:/Unassigned/}).first().click(); await p.waitForTimeout(1500);
 console.log('unassigned th',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('main thead th')].map(t=>[t.textContent.trim().slice(0,12),Math.round(t.getBoundingClientRect().width)]))));
 await p.screenshot({path:R+'summary-unassigned-card-1366x768.png'});
 await p.getByRole('button',{name:/Unassigned/}).first().click(); await p.waitForTimeout(800);
 await p.getByRole('button',{name:/^Columns/}).click(); await p.waitForTimeout(700);
 console.log('columns menu',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('[role=menu] *, [class*=cc] label')].map(e=>e.textContent.trim()).filter(t=>t&&t.length<24).slice(0,40))));
 await p.screenshot({path:R+'summary-columns-menu-1366x768.png'}); await p.keyboard.press('Escape');
 // collapsed + gauge click
 await p.getByRole('button',{name:/Hide Panel/}).click(); await p.waitForTimeout(1200);
 const g=p.locator('[class*=gauge], mf-dash-gauge').first(); try{await g.click({timeout:2500}); await p.waitForTimeout(1200); console.log('gauge click -> pressed',await p.evaluate(()=>[...document.querySelectorAll('button[aria-pressed=true]')].map(x=>x.textContent.trim().slice(0,20)))); }catch(e){console.log('gauge click fail');}
 await p.screenshot({path:R+'summary-gauge-click-1366x768.png'});
 // restore
 await p.getByRole('button',{name:/Show Panel/}).click(); await c.close();
 for (const u of ['podlead','tech']) { [c,p]=await mk(u,[1366,768]); await go(p,'/dashboard'); console.log(u,'btn',await p.evaluate(()=>!![...document.querySelectorAll('button')].find(x=>/(Hide|Show) Panel/.test(x.textContent+(x.getAttribute('aria-label')||'')))), 'tabs',await p.evaluate(()=>[...document.querySelectorAll('[role=tab]')].length)); await p.screenshot({path:R+`dash-${u}-1366x768.png`}); await c.close(); }
 await b.close();})();
