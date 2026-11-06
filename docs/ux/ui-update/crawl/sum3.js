const { chromium } = require('playwright');
const R='/home/user/wt/ui-designer/docs/ux/ui-update/review-8/';
(async()=>{const b=await chromium.launch();
 const go=async(p,url)=>{await p.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{} await p.waitForTimeout(2500);};
 for (const w of [[1366,768],[1920,1080]]) {
 const c=await b.newContext({viewport:{width:w[0],height:w[1]},extraHTTPHeaders:{'X-Dev-User':'KE\\testuser02'}}); const p=await c.newPage(); await go(p,'/dashboard');
 await p.getByRole('button',{name:/Hide Panel/}).click(); await p.waitForTimeout(1200);
 const cand=await p.evaluate(()=>[...document.querySelectorAll('main button, main [role=img], main [role=button]')].slice(0,14).map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,50)));
 if(w[0]===1366) console.log('row buttons',JSON.stringify(cand));
 try{ await p.getByRole('button',{name:/unassigned|gauge|level/i}).filter({hasNotText:/^Unassigned\s*8$/}).last().click({timeout:2500}); await p.waitForTimeout(1000); console.log(w[0],'pressed',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('button[aria-pressed=true]')].map(x=>x.textContent.trim().slice(0,20))))); }catch(e){console.log('click fail',String(e.message).slice(0,60));}
 await p.getByRole('button',{name:/Show Panel/}).click(); await c.close(); }
 // calendar
 for (const w of [[1366,768],[1920,1080]]) {
 const c=await b.newContext({viewport:{width:w[0],height:w[1]},extraHTTPHeaders:{'X-Dev-User':'KE\\testuser02'}}); const p=await c.newPage(); await go(p,'/dashboard?tab=calendar');
 const tiles=async(tag)=>console.log(w[0],tag,JSON.stringify(await p.evaluate(()=>{const pn=[...document.querySelectorAll('aside, [class*=panel]')].find(x=>/Available/.test(x.textContent)&&/Out of Office/i.test(x.textContent)); const t=[...document.querySelectorAll('[class*=tile], [class*=count]')].filter(e=>/^(Available|Out of Office|Off Hours|On Holiday)/.test(e.textContent.trim())&&e.getBoundingClientRect().height>30&&e.getBoundingClientRect().height<120).slice(0,5).map(e=>[e.textContent.trim().replace(/\s+/g,' ').slice(0,22),Math.round(e.getBoundingClientRect().width),Math.round(e.getBoundingClientRect().height),e.getAttribute('title')||'']); return t;})));
 await tiles('month today'); await p.screenshot({path:R+`calendar-month-${w.join('x')}.png`});
 try{ await p.getByRole('gridcell').nth(0).count(); }catch{}
 await p.evaluate(()=>{}); 
 // thanksgiving 11/26: click the cell with label 26
 try{ await p.locator('[role=gridcell], td').filter({hasText:/^\s*26/}).first().click({timeout:3000}); await p.waitForTimeout(1200); await tiles('thanksgiving'); await p.screenshot({path:R+`calendar-thanksgiving-${w.join('x')}.png`}); }catch(e){console.log('cell click fail');}
 await c.close(); }
 await b.close();})();
