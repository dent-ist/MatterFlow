const { chromium } = require('playwright');
const fs = require('fs');
const axeSrc = fs.readFileSync('/home/user/wt/ui-designer/frontend/node_modules/axe-core/axe.min.js', 'utf8');
const U = { director: 'KE\\testuser02', podlead: 'KE\\testuser06', tech: 'KE\\testuser01', admin: 'KE\\kekim', pm: 'KE\\testuser35' };
const pages = [
 ['director','/dashboard'],['director','/matters'],['director','/matters/1'],['director','/clients'],['director','/clients/1'],['director','/projects'],['director','/assets'],['director','/assets/1'],['director','/tasks'],['director','/tasks/200'],['director','/tasks/new'],['director','/profile'],['director','/notifications'],['director','/search?q=Demo'],
 ['tech','/my-work'],['podlead','/pods/work'],['pm','/my-matters'],
 ['admin','/admin/users'],['admin','/admin/roles'],['admin','/admin/pods'],['admin','/admin/task-types'],['admin','/admin/priorities'],['admin','/admin/asset-types'],['admin','/admin/custom-fields'],['admin','/admin/reports'],['admin','/admin/audit'],['admin','/admin/settings'],['tech','/403'],
];
(async()=>{
 const b=await chromium.launch(); const out=[];
 for (const size of [[1366,768],[1920,1080]]) {
  const ctxs={};
  for (const [p,url] of pages) {
   ctxs[p] ||= await b.newContext({viewport:{width:size[0],height:size[1]},extraHTTPHeaders:{'X-Dev-User':U[p]}});
   const page=await ctxs[p].newPage();
   try { await page.goto('http://localhost:4200'+url,{waitUntil:'domcontentloaded'}); try{await page.waitForLoadState('networkidle',{timeout:8000});}catch{} await page.waitForTimeout(1800);
    await page.evaluate(axeSrc);
    const r=await page.evaluate(async()=>{const x=await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']});return x.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,ex:v.nodes[0].target.join(' ').slice(0,80)}));});
    out.push({size:size.join('x'),p,url,v:r});
   } catch(e){ out.push({size:size.join('x'),p,url,err:String(e.message).slice(0,80)}); }
   await page.close();
  }
  for (const c of Object.values(ctxs)) await c.close();
 }
 await b.close();
 fs.writeFileSync('/home/user/ud-run/axe-out.json',JSON.stringify(out,null,1));
 for (const o of out) console.log(o.size,o.url,o.err||o.v.map(v=>v.id+'x'+v.n).join(',')||'0');
})();
