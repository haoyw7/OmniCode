import { chromium } from 'playwright';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('build/motion-migration');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
const results=[];
for(const mobile of [false,true]) for(const reduced of [false,true]) {
 const name=`${mobile?'mobile':'desktop'}-${reduced?'reduced':'normal'}`;
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,reducedMotion:reduced?'reduce':'no-preference',recordVideo:{dir:path.join(out,name),size:mobile?{width:390,height:844}:{width:1440,height:900}}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.stack));
 const cdp=await context.newCDPSession(page);await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing',transferMode:'ReturnAsStream'});
 await page.goto(`http://127.0.0.1:1438/tests/browser/${mobile?'motion-mobile':'motion-migration'}.html`,{waitUntil:'networkidle'});
 await page.waitForTimeout(700);
 await page.evaluate(()=>{window.__frames=[];window.__sceneFrames={};window.__scene=null;window.__shifts=[];let last=performance.now();function sample(now){window.__frames.push(now-last);if(window.__scene)(window.__sceneFrames[window.__scene]??=[]).push(now-last);last=now;window.__capture=requestAnimationFrame(sample)}window.__capture=requestAnimationFrame(sample);new PerformanceObserver(list=>window.__shifts.push(...list.getEntries().map(e=>({value:e.value,hadRecentInput:e.hadRecentInput})))).observe({type:'layout-shift',buffered:true})});
 const shot=async(label)=>page.screenshot({path:path.join(out,`${name}-${label}.png`)});
 const drag=async(x,y,dx,dy)=>{
  await page.evaluate(()=>{window.__scene='drag';performance.mark('motion-drag-start')});
  if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=16;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/16,y:y+dy*i/16}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else {await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=16;i++){await page.mouse.move(x+dx*i/16,y+dy*i/16);await page.waitForTimeout(16);}await page.mouse.up();}
  await page.waitForTimeout(750);await page.evaluate(()=>{performance.mark('motion-drag-end');window.__scene=null})
 };
 await shot('initial');
 const observations={};
 if(mobile){
  await page.getByTestId('sheet-open').click();if(reduced){await page.evaluate(()=>new Promise(requestAnimationFrame));observations.sheetNextPaintY=await page.locator('.mobile-sheet').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m42)}await page.waitForTimeout(600);if(reduced){observations.sheetSettledY=await page.locator('.mobile-sheet').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m42);observations.sheetImmediate=observations.sheetNextPaintY===observations.sheetSettledY;}await shot('sheet');
  const grip=await page.locator('.mobile-sheet-grip').boundingBox();if(!grip)throw Error('Sheet grip missing');
  await drag(grip.x+grip.width/2,grip.y+grip.height/2,0,35);observations.sheetReturned=await page.locator('.mobile-sheet').count()>0;await shot('sheet-rebound');
  const again=await page.locator('.mobile-sheet-grip').boundingBox();await drag(again.x+again.width/2,again.y+again.height/2,0,360);observations.sheetClosed=await page.locator('.mobile-sheet').count()===0;await shot('sheet-closed');
  await page.getByTestId('drawer-open').click();if(reduced){await page.evaluate(()=>new Promise(requestAnimationFrame));observations.drawerNextPaintX=await page.locator('.mobile-drawer').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41)}await page.waitForTimeout(600);await shot('drawer');
  const drawer=await page.locator('.mobile-drawer').boundingBox();await drag(drawer.x+drawer.width*.7,drawer.y+200,-drawer.width*.85,0);observations.drawerClosed=await page.locator('.mobile-drawer-backdrop').evaluate(e=>e.dataset.open==='false' && e.dataset.settledClosed==='true');await shot('drawer-closed');
  await page.getByTestId('page-switch').click();if(reduced){await page.evaluate(()=>new Promise(requestAnimationFrame));observations.pageNextPaintX=await page.locator('.mobile-page-layer[data-page-active=true]').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41);observations.pageNextPaintLayers=await page.locator('.mobile-page-layer').count();}await page.waitForTimeout(400);await shot('forward');
  await page.getByTestId('page-switch').click();await page.waitForTimeout(400);await shot('back');
 }else{
  await page.getByRole('button',{name:'Close sidebar',exact:true}).click();await page.waitForTimeout(350);await shot('sidebar-closed');
  observations.sidebarWidth=await page.locator('[data-sidebar-transition]').evaluate(e=>e.getBoundingClientRect().width);
  await page.getByRole('button',{name:'Open sidebar',exact:true}).click();await page.waitForTimeout(350);
  await page.getByRole('radio',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'tokens.ts',exact:true}).click();await page.waitForTimeout(350);observations.activeTab=await page.getByRole('tab',{name:'tokens.ts',exact:true}).getAttribute('aria-selected');await shot('tab');await page.getByRole('button',{name:'Close tokens.ts',exact:true}).click();await page.waitForTimeout(350);await shot('tab-closed');
  await page.getByRole('button',{name:'Toggle tool card'}).click();await page.waitForTimeout(300);observations.foldHidden=await page.getByLabel('Tool retained state').evaluate(e=>e.closest('[hidden]')!==null);await shot('tool-closed');
  await page.getByRole('button',{name:'Toggle tool card'}).click();await page.waitForTimeout(300);
  const input=page.locator('textarea').first();await input.fill('A multi-line composer\nkeeps its surrounding layout\nwhile the draft grows\nand preserves the input.');await page.waitForTimeout(400);await shot('composer');
  await page.getByRole("button",{name:"Show the work",exact:true}).click();await page.waitForTimeout(300);
  const tool=page.locator('button[aria-label*="error details for"]');await tool.click();await page.waitForTimeout(300);await shot('actual-tool-open');await tool.click();await page.waitForTimeout(300);await shot('actual-tool-closed');
  await page.evaluate(()=>{window.__scene='stream';performance.mark('motion-stream-start')});
  for(let i=1;i<=45;i++){await page.evaluate(({i})=>window.motionStream(Array.from({length:i},(_,n)=>`Streaming paragraph ${n+1}: **Motion** preserves stable message identity and displays each received chunk immediately.`).join('\n\n'),i<45),{i});await page.waitForTimeout(40)}
  await page.evaluate(()=>{performance.mark('motion-stream-end');window.__scene=null});await shot('stream');
  await page.getByRole('button',{name:'Open modal'}).click();await page.waitForTimeout(300);await shot('modal');await page.locator('.modal-frame button[aria-label]').click();await page.waitForTimeout(300);
 }
 const metrics=await page.evaluate(()=>{cancelAnimationFrame(window.__capture);const frames=window.__frames.filter(x=>x>0).sort((a,b)=>a-b);const scenes=Object.fromEntries(Object.entries(window.__sceneFrames).map(([name,values])=>{const v=values.sort((a,b)=>a-b);return[name,{frames:v.length,p95FrameMs:v[Math.floor(v.length*.95)],maxFrameMs:v.at(-1),framesOver34Ms:v.filter(x=>x>34).length}]}));return {scenes,frames:frames.length,p95FrameMs:frames[Math.floor(frames.length*.95)],maxFrameMs:frames.at(-1),framesOver34Ms:frames.filter(x=>x>34).length,layoutShift:window.__shifts.reduce((s,e)=>s+e.value,0),unexpectedLayoutShift:window.__shifts.filter(e=>!e.hadRecentInput).reduce((s,e)=>s+e.value,0)}});
 const traceEnd=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await traceEnd;let trace='';while(true){const r=await cdp.send('IO.read',{handle:stream});trace+=r.data;if(r.eof)break}await cdp.send('IO.close',{handle:stream});await writeFile(path.join(out,`${name}-performance.json`),trace);
 const events=JSON.parse(trace).traceEvents;const intervals=[];for(const kind of ['stream','drag']){let start;for(const event of events){if(event.name===`motion-${kind}-start`)start=event.ts;else if(event.name===`motion-${kind}-end`&&start!==undefined){intervals.push({kind,start,end:event.ts});start=undefined}}}const traceMetrics=Object.fromEntries(['stream','drag'].filter(kind=>intervals.some(i=>i.kind===kind)).map(kind=>{const relevant=events.filter(e=>e.ph==='X'&&e.dur&&intervals.some(i=>i.kind===kind&&e.ts>=i.start&&e.ts<i.end));const layout=relevant.filter(e=>['Layout','UpdateLayoutTree'].includes(e.name));const tasks=relevant.filter(e=>e.name==='RunTask');return[kind,{layoutEvents:layout.length,maxLayoutMs:Math.max(0,...layout.map(e=>e.dur/1000)),totalLayoutMs:layout.reduce((sum,e)=>sum+e.dur/1000,0),taskEvents:tasks.length,tasksOver50Ms:tasks.filter(e=>e.dur>50000).length}]}));results.push({name,observations,metrics,traceMetrics,errors});const video=page.video();await context.close();if(video)await rename(await video.path(),path.join(out,name,'capture.webm'));
}
await browser.close();await writeFile(path.join(out,'results.json'),JSON.stringify({browser:'/opt/google/chrome/chrome',results},null,2));console.log(JSON.stringify(results,null,2));
