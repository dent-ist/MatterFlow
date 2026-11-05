const { chromium } = require('playwright');
(async()=>{
 const b=await chromium.launch();
 const run=async(user,url,fn,click)=>{const c=await b.newContext({viewport:{width:1366,height:768},extraHTTPHeaders:{'X-Dev-User':user}});const p=await c.newPage();await p.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'});try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{}await p.waitForTimeout(2000); if(click) await click(p); const r=await p.evaluate(fn); console.log(url,JSON.stringify(r)); await c.close();};
 const titles=()=>[...document.querySelectorAll('[title],[aria-label]')].map(e=>e.getAttribute('title')||e.getAttribute('aria-label')).filter(t=>/(January|February|March|April|May|June|July|August|September|October|November|December|Oct |Nov |Dec )/.test(t||'')).slice(0,4);
 const vis=()=>{const t=document.querySelector('main').innerText;return (t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b/g)||[]).slice(0,6);};
 await run('KE\\testuser02','/assets/1',vis);
 await run('KE\\testuser02','/assets/reports',vis);
 await run('KE\\testuser35','/my-matters',()=>{const t=document.querySelector('main').innerText;return {acct:(t.match(/KE\\\w+/g)||[]).length,vis:(t.match(/\b(Oct|Nov|Dec)[a-z]* \d{1,2}\b/g)||[]).slice(0,4)}});
 await run('KE\\testuser02','/dashboard',vis,async p=>{await p.getByRole('tab',{name:/Trends/}).click();await p.waitForTimeout(2000);});
 await run('KE\\testuser02','/tasks/200',vis,async p=>{await p.getByRole('button',{name:/^Edit/}).first().click();await p.waitForTimeout(1500);});
 await b.close();
})();
