const { chromium } = require('playwright');
const fs = require('fs');
const U = { director: 'KE\\testuser02', podlead: 'KE\\testuser06', tech: 'KE\\testuser01', admin: 'KE\\kekim', pm: 'KE\\testuser35' };
const pages = [['director','/dashboard'],['director','/matters'],['director','/matters/1'],['director','/clients'],['director','/clients/1'],['director','/projects'],['director','/projects/1'],['director','/assets'],['director','/assets/1'],['director','/tasks'],['director','/tasks/200'],['director','/tasks/new'],['director','/profile'],['director','/notifications'],['director','/search?q=Demo'],['tech','/my-work'],['podlead','/pods/work'],['pm','/my-matters'],['admin','/admin/users'],['admin','/admin/roles'],['admin','/admin/pods'],['admin','/admin/task-types'],['admin','/admin/priorities'],['admin','/admin/status-labels'],['admin','/admin/asset-types'],['admin','/admin/custom-fields'],['admin','/admin/reports'],['admin','/admin/audit'],['admin','/admin/settings']];
const MON='(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
const rx = { monthName: new RegExp('\\b'+MON+'\\.? \\d{1,2}\\b','g'), iso: /\b\d{4}-\d{2}-\d{2}\b/g, utc: /\b(UTC|EDT|EST)\b/g, keAcct: /KE\\\w+/g, sentenceBtn: /^(New|Create|Add|Clear|Reset|Show|Save|Edit|Open) [a-z]/ };
(async()=>{
 const b=await chromium.launch(); const out=[]; const ctxs={};
 for (const [p,url] of pages) {
  ctxs[p] ||= await b.newContext({viewport:{width:1366,height:768},extraHTTPHeaders:{'X-Dev-User':U[p]}});
  const page=await ctxs[p].newPage();
  try { await page.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'}); try{await page.waitForLoadState('networkidle',{timeout:8000});}catch{} await page.waitForTimeout(1800);
   const r=await page.evaluate(({m,i,u,k})=>{
     const text=document.querySelector('main')?.innerText||document.body.innerText;
     const mm=text.match(new RegExp(m,'g'))||[]; const ii=text.match(new RegExp(i,'g'))||[]; const uu=text.match(new RegExp(u,'g'))||[]; const kk=text.match(new RegExp(k,'g'))||[];
     const btns=[...document.querySelectorAll('main button, main a.mf-btn, header button')].map(b=>(b.getAttribute('aria-label')||b.textContent||'').trim()).filter(t=>t&&t.length<40);
     const lower=btns.filter(t=>/^(New|Create|Add|Clear|Reset|Show|Save|Edit|Open|Change|Delete|Remove|Assign|Mark|Export|Import) [a-z]/.test(t));
     const tabs=[...document.querySelectorAll('[role=tab]')].map(t=>t.textContent.trim());
     return {title:document.title,month:[...new Set(mm)].slice(0,6),iso:[...new Set(ii)].slice(0,4),zone:[...new Set(uu)].slice(0,3),acct:[...new Set(kk)].slice(0,3),lowerBtns:[...new Set(lower)].slice(0,8),h1:(document.querySelector('h1')||{}).textContent?.trim(),tabs:tabs.slice(0,8)};
   },{m:rx.monthName.source,i:rx.iso.source,u:rx.utc.source,k:rx.keAcct.source});
   out.push({url,...r});
  } catch(e){ out.push({url,err:String(e.message).slice(0,60)}); }
  await page.close();
 }
 await b.close();
 fs.writeFileSync('/home/user/ud-run/scan-out.json',JSON.stringify(out,null,1));
 for (const o of out) console.log(o.url,'|',o.title,'|',JSON.stringify({m:o.month,i:o.iso,z:o.zone,a:o.acct,lb:o.lowerBtns}));
})();
