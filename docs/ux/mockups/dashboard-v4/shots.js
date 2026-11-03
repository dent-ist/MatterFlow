// Screenshots and contrast/fit check for the Dashboard v4 mockup. Run: node docs/ux/mockups/dashboard-v4/shots.js [shots|check]
const {chromium}=require('playwright');const path=require('path');
const URL='file://'+path.resolve(__dirname,'index.html');
const SIZES=[[1366,768],[1920,1080],[1366,600],[768,1024],[375,812]];
const ROLES=['director','pod','tech'];
const EXTRA=[['n3','#n=3&un=fresh'],['n40','#n=40&un=pile&gauge=B'],['sel-overdue','#card=overdue'],['calm','#un=none&n=0'],['loading','#state=loading'],['error','#state=error'],['people','#people=1&n=12'],['mock','#mock=1'],['nobattery','#without=ViewUsers'],['gauge-C','#gauge=C&un=pile&adv=2']];
const STATES=[];for(const r of ROLES)STATES.push(['role-'+r,'#role='+r]);EXTRA.forEach(e=>STATES.push(e));
STATES.push(['empty','#state=empty'],['stale','#state=stale'],['noview','#without=View'],['3cards','#cards=3'],['clock','#hours=clock&un=mixed'],['sens-off','#sens=0']);
function inPage(){
  const parse=c=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,\/]+/).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
  const over=(t,b)=>{const a=t.a+b.a*(1-t.a);return{r:(t.r*t.a+b.r*b.a*(1-t.a))/a,g:(t.g*t.a+b.g*b.a*(1-t.a))/a,b:(t.b*t.a+b.b*b.a*(1-t.a))/a,a}};
  const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)};
  const bgOf=el=>{const ch=[];for(let e=el;e;e=e.parentElement){const bg=parse(getComputedStyle(e).backgroundColor);if(bg&&bg.a>0){ch.push(bg);if(bg.a===1)break}}let acc={r:255,g:255,b:255,a:1};for(let i=ch.length-1;i>=0;i--)acc=over(ch[i],acc);return acc};
  const bad=[];
  document.querySelectorAll('body *').forEach(el=>{
    if(['SCRIPT','STYLE'].includes(el.tagName)||el.closest('svg,.sr,[hidden]'))return;
    const own=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim());if(!own.length)return;
    const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return;
    const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||el.disabled||el.closest('[disabled]'))return;
    const fg=parse(cs.color);const bg=bgOf(el);const t=over({...fg,a:fg.a*(parseFloat(cs.opacity)||1)},bg);
    const l1=lum(t),l2=lum(bg);const ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
    const px=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight,10)>=700;const need=px>=24||(px>=18.66&&bold)?3:4.5;
    if(ratio<need)bad.push({text:own.map(n=>n.textContent.trim()).join(' ').slice(0,40),ratio:+ratio.toFixed(2),need});});
  return bad;}
(async()=>{const mode=process.argv[2]||'check';const b=await chromium.launch();let total=0,n=0,fit=0;
 for(const [w,h] of SIZES){const pg=await b.newPage({viewport:{width:w,height:h}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  for(const [name,hash] of STATES){await pg.goto('about:blank');await pg.goto(URL+hash);await pg.waitForTimeout(120);
   if(mode==='shots'){if(['role-director','role-pod','role-tech'].includes(name)||w===1366&&h===768||w===375)await pg.screenshot({path:path.resolve(__dirname,'screenshots',name+'-'+w+'x'+h+'.png')});continue;}
   const bad=await pg.evaluate(inPage);n++;bad.forEach(x=>console.log('FAIL contrast',w+'x'+h,name,JSON.stringify(x)));total+=bad.length;
   const m=await pg.evaluate(()=>({sh:document.scrollingElement.scrollHeight,sw:document.scrollingElement.scrollWidth,ih:innerHeight,iw:innerWidth}));
   const fixed=w>=768&&h>=561;if(m.sw>m.iw||(fixed&&m.sh>m.ih+1)){fit++;console.log('FAIL fit',w+'x'+h,name,JSON.stringify(m))}}
  errs.forEach(e=>{total++;console.log('FAIL console',w+'x'+h,e)});await pg.close();}
 await b.close();if(mode==='check')console.log('Checked '+n+' state/size combinations: '+total+' contrast or console failures, '+fit+' fit failures.');})();
