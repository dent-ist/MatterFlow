// Screenshots and contrast/fit check for the Dashboard Calendar mockup (WPx CAL-00). Run: node docs/ux/mockups/dashboard-calendar/shots.js [shots|check]
// Needs the global `playwright` package. Contrast = the script pattern of the Dashboard v4 mockup: every text node against its effective background, 4.5:1 (3:1 for large text).
const {chromium}=require('playwright');const path=require('path');
const URL='file://'+path.resolve(__dirname,'index.html');
const SIZES=[[1366,768],[1920,1080],[1366,600],[768,1024],[375,812]];
const MAIN=[['month','#'],['week','#view=week'],['timeline','#view=timeline'],['timeline-weeks','#view=timeline&scale=week&tlm=2027-06'],['day-risk','#day=2026-11-25'],['pod-lead','#role=pod'],['technician','#role=tech'],
  ['profile','#screen=profile&role=pod&past=1'],['profile-add','#screen=profile&role=pod&dlg=addself'],['admin','#screen=admin'],['admin-2027','#screen=admin&ayear=2027&acal=uk'],['admin-import','#screen=admin&dlg=import']];
const EXTRA=[['loading','#state=loading'],['error','#state=error'],['empty','#state=empty'],['no-reasons','#without=Dashboard.ViewAbsenceReasons&view=timeline'],['tech-with-calendar','#role=tech&with=Dashboard.ViewCalendar,Dashboard.ViewAbsenceReasons&without=Dashboard.ViewAbsenceReasons'],
  ['risk-days','#pop=risk'],['thresholds','#dlg=thr'],['overlap-warning','#role=pod&dlg=warn'],['add-on-behalf','#dlg=add'],['edit-bar','#view=timeline&dlg=edit'],['picker','#day=2026-11-03&pop=pick1104'],['reassign','#dlg=reassign'],
  ['day-thanksgiving','#day=2026-11-26'],['day-weekend','#day=2026-11-07'],['pod-filter-qc','#pod=qc'],['all-features-off','#off=thr,banner,fcst,risk,ovl,exp'],['mockup-toolbox','#mock=1'],
  ['profile-overlap','#screen=profile&role=tech&dlg=overlap'],['profile-past-date','#screen=profile&role=pod&dlg=past'],['profile-delete','#screen=profile&role=pod&dlg=del'],['profile-edit','#screen=profile&role=pod&dlg=edit'],
  ['admin-holiday-dialog','#screen=admin&dlg=hol'],['admin-calendar-dialog','#screen=admin&dlg=cal'],['admin-user-field','#screen=admin&dlg=user'],['admin-no-access','#screen=admin&role=pod'],['admin-loading','#screen=admin&state=loading'],['admin-error','#screen=admin&state=error'],['admin-empty','#screen=admin&state=empty']];
function inPage(){
  const parse=c=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,\/]+/).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
  const over=(t,b)=>{const a=t.a+b.a*(1-t.a);return{r:(t.r*t.a+b.r*b.a*(1-t.a))/a,g:(t.g*t.a+b.g*b.a*(1-t.a))/a,b:(t.b*t.a+b.b*b.a*(1-t.a))/a,a}};
  const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)};
  const bgOf=el=>{const ch=[];for(let e=el;e;e=e.parentElement){const bg=parse(getComputedStyle(e).backgroundColor);if(bg&&bg.a>0){ch.push(bg);if(bg.a===1)break}}let acc={r:255,g:255,b:255,a:1};for(let i=ch.length-1;i>=0;i--)acc=over(ch[i],acc);return acc};
  const bad=[];
  document.querySelectorAll('body *').forEach(el=>{
    if(['SCRIPT','STYLE'].includes(el.tagName)||el.closest('svg,.sr,[hidden],#tip'))return;
    const own=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim());if(!own.length)return;
    const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return;
    const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||el.disabled||el.closest('[disabled]')||el.closest('[aria-disabled=true]'))return;
    const fg=parse(cs.color);const bg=bgOf(el);const t=over({...fg,a:fg.a*(parseFloat(cs.opacity)||1)},bg);
    const l1=lum(t),l2=lum(bg);const ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
    const px=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight,10)>=700;const need=px>=24||(px>=18.66&&bold)?3:4.5;
    if(ratio<need)bad.push({text:own.map(n=>n.textContent.trim()).join(' ').slice(0,40),ratio:+ratio.toFixed(2),need});});
  return bad;}
(async()=>{const mode=process.argv[2]||'check';const b=await chromium.launch();let total=0,n=0,fit=0;const fs=require('fs');const dir=path.resolve(__dirname,'screenshots');if(mode==='shots')fs.mkdirSync(dir,{recursive:true});
 for(const [w,h] of SIZES){const pg=await b.newPage({viewport:{width:w,height:h}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  const states=MAIN.map(x=>[x[0],x[1],true]).concat(EXTRA.map(x=>[x[0],x[1],false]));
  for(const [name,hash,main] of states){await pg.goto('about:blank');await pg.goto(URL+hash);await pg.waitForTimeout(120);
   if(mode==='shots'){if(main||(w===1366&&h===768)||w===375)await pg.screenshot({path:path.resolve(dir,name+'-'+w+'x'+h+'.png')});continue;}
   const bad=await pg.evaluate(inPage);n++;bad.forEach(x=>console.log('FAIL contrast',w+'x'+h,name,JSON.stringify(x)));total+=bad.length;
   const m=await pg.evaluate(()=>({sh:document.scrollingElement.scrollHeight,sw:document.scrollingElement.scrollWidth,ih:innerHeight,iw:innerWidth}));
   const fixed=w>=768&&h>=561;if(m.sw>m.iw||(fixed&&m.sh>m.ih+1)){fit++;console.log('FAIL fit',w+'x'+h,name,JSON.stringify(m))}}
  errs.forEach(e=>{total++;console.log('FAIL console',w+'x'+h,e)});await pg.close();}
 await b.close();if(mode==='check')console.log('Checked '+n+' state/size combinations: '+total+' contrast or console failures, '+fit+' fit failures.');})();
