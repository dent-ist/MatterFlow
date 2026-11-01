const {chromium}=require('playwright');
// One lightweight Chromium launch, no test runner. Writes screenshots/NN-name-1366.png (1366x768) and -375.png (375x812).
// Run: node docs/ux/mockups/matter-detail/screenshots.cjs [outDir] [prefixes e.g. 01,04] [1366x768]   (needs a global `playwright` install)
const path=require('path');
const OUT=process.argv[2]||path.join(__dirname,'screenshots');require('fs').mkdirSync(OUT,{recursive:true});
const base='file://'+path.resolve(__dirname)+'/';
const T=async(pg,t)=>{await pg.click('[data-act=tab][data-v='+t+']');await pg.waitForTimeout(100)};
const STEPS={
 '01-summary':async pg=>{},
 '02-summary-edit-panel':async pg=>{await pg.click('.card-h [data-act=editall]');},
 '03-summary-scrolled':async pg=>{await pg.evaluate(()=>{const f=document.querySelector('#tabpanel');f.scrollTop=f.scrollHeight});},
 '04-tasks':async pg=>{await T(pg,'tasks')},
 '05-tasks-view-dropdown':async pg=>{await T(pg,'tasks');await pg.click('[data-dd=tview]');},
 '06-tasks-selected-link':async pg=>{await T(pg,'tasks');await pg.check('[data-sel=T-3105]');await pg.check('[data-sel=T-3107]');await pg.click('[data-act=bulklink]');},
 '07-projects':async pg=>{await T(pg,'projects')},
 '08-project-panel-tasks':async pg=>{await T(pg,'projects');await pg.click('tr[data-id=P3]');},
 '09-projects-new':async pg=>{await T(pg,'projects');await pg.click('[data-act=newproj]');},
 '10-assets':async pg=>{await T(pg,'assets')},
 '11-assets-type-dropdown':async pg=>{await T(pg,'assets');await pg.click('[data-dd=atype]');},
 '12-assets-panel':async pg=>{await T(pg,'assets');await pg.click('tr[data-id=A-204]');},
 '13-productions':async pg=>{await T(pg,'prods')},
 '14-production-detail':async pg=>{await T(pg,'prods');await pg.click('tr[data-id=PRD-002]');},
 '15-production-new':async pg=>{await T(pg,'prods');await pg.click('[data-act=newprod]');},
 '16-specs-subview':async pg=>{await T(pg,'prods');await pg.click('[data-act=pv][data-v=specs]');},
 '17-spec-new':async pg=>{await T(pg,'prods');await pg.click('[data-act=pv][data-v=specs]');await pg.click('[data-act=newspec]');},
 '18-notes':async pg=>{await T(pg,'notes')},
 '19-notes-tags-panel':async pg=>{await T(pg,'notes');await pg.click('[data-act=rail][data-v=tags]');},
 '20-notes-slash':async pg=>{await T(pg,'notes');await pg.click('#mockbtn');await pg.click('[data-act=slashdemo]');},
 '21-notes-slash-note':async pg=>{await T(pg,'notes');await pg.click('#mockbtn');await pg.click('[data-act=slashdemo]');await pg.keyboard.type('note');await pg.keyboard.press('Enter');await pg.waitForTimeout(100);await pg.keyboard.press('Enter');},
 '22-notes-table-menu':async pg=>{await T(pg,'notes');await pg.click('#tb [data-v=table]');await pg.hover('#tblpop button[data-r="4"][data-c="5"]',{timeout:3000}).catch(()=>{});},
 '23-notes-table-tools':async pg=>{await T(pg,'notes');await pg.click('#ed table td');},
 '24-notes-style-dropdown':async pg=>{await T(pg,'notes');await pg.click('#ed p');await pg.click('[data-act=tstyle]');},
 '25-notes-splitter-wide':async pg=>{await T(pg,'notes');await pg.focus('#splitter');for(let i=0;i<8;i++)await pg.keyboard.press('ArrowRight');},
 '26-notes-ai-panel':async pg=>{await T(pg,'notes');await pg.click('[data-act=rail][data-v=ai]');},
 '27-notes-ai-off':async pg=>{await pg.goto(base+'index.html#tab=notes&ai=no');await pg.reload();await pg.click('.nlistc [data-act=ai]',{force:true});},
 '28-notes-ai-warning':async pg=>{await pg.goto(base+'index.html#tab=notes&warn=1');await pg.reload();await pg.click('[data-act=nsave]');},
 '29-activities':async pg=>{await T(pg,'acts')},
 '30-alt-specs-tab':async pg=>{await pg.goto(base+'alt-specs-own-tab.html');await T(pg,'specs')},
 '31-alt-productions':async pg=>{await pg.goto(base+'alt-specs-own-tab.html');await T(pg,'prods')},
 '32-new-menu':async pg=>{await pg.click('[data-act=newmenu]');},
 '33-set-inactive-blocked':async pg=>{await pg.click('[data-act=more]');await pg.click('[data-act=toggleactive]');},
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
