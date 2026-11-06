const { chromium } = require('playwright');
const U={director:'KE\\testuser02',podlead:'KE\\testuser06',tech:'KE\\testuser01'};
const R='/home/user/wt/ui-designer/docs/ux/ui-update/review-8/';
(async()=>{const b=await chromium.launch();
 for(const w of [[1366,768],[1920,1080]]){
  const c=await b.newContext({viewport:{width:w[0],height:w[1]},extraHTTPHeaders:{'X-Dev-User':U.director}}); const p=await c.newPage();
  await p.goto('http://localhost:4200/dashboard',{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{} await p.waitForTimeout(2500);
  const info=async(tag)=>{const r=await p.evaluate(()=>{const btn=[...document.querySelectorAll('button')].find(x=>/(Hide|Show) Panel/i.test((x.textContent||'')+(x.getAttribute('aria-label')||''))); const bb=btn&&btn.getBoundingClientRect(); const fr=document.querySelector('main table')?.closest('[class*=frame],[class*=scroll]'); const th=[...document.querySelectorAll('main thead th')].map(t=>[t.textContent.trim().slice(0,8),Math.round(t.getBoundingClientRect().width)]); return {btn:bb&&[Math.round(bb.x),Math.round(bb.y),Math.round(bb.width),Math.round(bb.height)],exp:btn&&btn.getAttribute('aria-expanded'),label:btn&&btn.textContent.trim(),frame:fr&&[fr.clientWidth,fr.scrollWidth],th};}); console.log(w.join('x'),tag,JSON.stringify(r));};
  await info('shown'); await p.screenshot({path:R+`dashboard-summary-shown-${w.join('x')}.png`});
  const btn=p.getByRole('button',{name:/Hide Panel/i}); try{await btn.click({timeout:3000}); await p.waitForTimeout(1500); await info('collapsed'); await p.screenshot({path:R+`dashboard-summary-collapsed-${w.join('x')}.png`});
   await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(2800); await info('after reload');
   await p.getByRole('button',{name:/Show Panel/i}).click({timeout:3000}); await p.waitForTimeout(1200); await info('shown again');}catch(e){console.log('btn',String(e.message).slice(0,80));}
  await c.close();}
 await b.close();})();
