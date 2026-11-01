const {chromium}=require('playwright');
// One lightweight Chromium launch, no test runner. Writes screenshots/NN-name-1366.png (1366x768) and -375.png (375x812).
// Run: node docs/ux/mockups/matter-detail/screenshots.cjs [outDir] [prefixes e.g. 01,04] [1366x768]   (needs a global `playwright` install)
const path=require('path');
const OUT=process.argv[2]||path.join(__dirname,'screenshots');require('fs').mkdirSync(OUT,{recursive:true});
const base='file://'+path.resolve(__dirname)+'/';
const T=async(pg,t)=>{await pg.click('[data-act=tab][data-v='+t+']');await pg.waitForTimeout(100)};
const STEPS={
 '01-summary':async pg=>{},
 '02-summary-edit-field':async pg=>{await pg.click('[data-act=editfield][data-f=ai]');},
 '03-summary-edit-all':async pg=>{await pg.click('.card-h [data-act=editall]');},
 '04-tasks':async pg=>{await T(pg,'tasks')},
 '05-tasks-selected-link':async pg=>{await T(pg,'tasks');await pg.check('[data-sel=T-3105]');await pg.check('[data-sel=T-3107]');await pg.click('[data-act=bulklink]');},
 '06-projects':async pg=>{await T(pg,'projects')},
 '07-projects-new':async pg=>{await T(pg,'projects');await pg.click('[data-act=newproj]');},
 '08-calendar':async pg=>{await T(pg,'calendar')},
 '09-assets':async pg=>{await T(pg,'assets')},
 '10-assets-panel':async pg=>{await T(pg,'assets');await pg.click('tr[data-id=A-204]');},
 '11-productions':async pg=>{await T(pg,'prods')},
 '12-production-detail':async pg=>{await T(pg,'prods');await pg.click('tr[data-id=PRD-002]');},
 '13-production-new':async pg=>{await T(pg,'prods');await pg.click('[data-act=newprod]');},
 '14-specs-subview':async pg=>{await T(pg,'prods');await pg.click('[data-act=pv][data-v=specs]');},
 '15-spec-new':async pg=>{await T(pg,'prods');await pg.click('[data-act=pv][data-v=specs]');await pg.click('[data-act=newspec]');},
 '16-notes':async pg=>{await T(pg,'notes')},
 '17-notes-tags-panel':async pg=>{await T(pg,'notes');await pg.click('[data-act=rail][data-v=tags]');},
 '18-notes-slash':async pg=>{await T(pg,'notes');await pg.click('[data-act=slashdemo]');},
 '19-notes-slash-note':async pg=>{await T(pg,'notes');await pg.click('[data-act=slashdemo]');await pg.keyboard.type('note');await pg.keyboard.press('Enter');await pg.waitForTimeout(100);await pg.keyboard.press('Enter');},
 '20-notes-ai-panel':async pg=>{await T(pg,'notes');await pg.click('[data-act=rail][data-v=ai]');},
 '21-notes-ai-off':async pg=>{await pg.goto(base+'index.html#tab=notes&ai=no');await pg.reload();await pg.click('.nlistc [data-act=ai]',{force:true});},
 '22-notes-ai-warning':async pg=>{await pg.goto(base+'index.html#tab=notes&warn=1');await pg.reload();await pg.click('[data-act=nsave]');},
 '23-activities':async pg=>{await T(pg,'acts')},
 '24-alt-specs-tab':async pg=>{await pg.goto(base+'alt-specs-own-tab.html');await T(pg,'specs')},
 '25-alt-productions':async pg=>{await pg.goto(base+'alt-specs-own-tab.html');await T(pg,'prods')},
 '26-new-menu':async pg=>{await pg.click('[data-act=newmenu]');},
 '27-set-inactive-blocked':async pg=>{await pg.click('[data-act=more]');await pg.click('[data-act=toggleactive]');},
};
(async()=>{
 const only=process.argv[3]?process.argv[3].split(','):null;const vps=process.argv[4]?[process.argv[4]]:['1366x768','375x812'];
 const b=await chromium.launch();
 for(const vp of vps){const [w,h]=vp.split('x').map(Number);
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:1});const pg=await ctx.newPage();
  pg.on('pageerror',e=>console.log('ERR',vp,String(e)));
  for(const [n,fn] of Object.entries(STEPS)){ if(only&&!only.some(o=>n.startsWith(o)))continue;
   await pg.goto(base+'index.html');await pg.waitForTimeout(120);
   try{await fn(pg);await pg.waitForTimeout(250);await pg.screenshot({path:OUT+'/'+n+'-'+(w===375?'375':'1366')+'.png'})}catch(e){console.log('FAIL',n,vp,e.message.split('\n')[0])}
  }
  await ctx.close();}
 await b.close();
})();
