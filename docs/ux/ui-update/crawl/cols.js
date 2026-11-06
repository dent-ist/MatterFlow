const { chromium } = require('playwright');
const U={podlead:'KE\\testuser06',director:'KE\\testuser02',tech:'KE\\testuser01'};
(async()=>{const b=await chromium.launch();
 for (const [u,url] of [['podlead','/pods/work'],['director','/tasks'],['tech','/my-work']]) for (const w of [[1366,768],[1920,1080]]) {
  const c=await b.newContext({viewport:{width:w[0],height:w[1]},extraHTTPHeaders:{'X-Dev-User':U[u]}}); const p=await c.newPage();
  await p.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:8000});}catch{} await p.waitForTimeout(2000);
  const r=await p.evaluate(()=>{const th=[...document.querySelectorAll('main thead th')].map(t=>[t.textContent.trim().slice(0,12),Math.round(t.getBoundingClientRect().width)]);
    const sc=document.querySelector('[class*=scroll], .mf-scroll-area, mf-grid-frame [tabindex="0"]'); const t=document.querySelector('main table'); const fr=t?.closest('[class*=frame],[class*=scroll]');
    return {th, tableW:t&&Math.round(t.getBoundingClientRect().width), frameW:fr&&Math.round(fr.clientWidth), scrollW:fr&&fr.scrollWidth};});
  console.log(u,w.join('x'),JSON.stringify(r)); await c.close();}
 await b.close();})();
