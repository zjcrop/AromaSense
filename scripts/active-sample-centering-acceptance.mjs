import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const site = resolve(root, "site");
const TIMEOUT_MS = 30_000;
const MIME = new Map([[".html","text/html; charset=utf-8"],[".js","text/javascript; charset=utf-8"],[".mjs","text/javascript; charset=utf-8"],[".css","text/css; charset=utf-8"],[".json","application/json"],[".wasm","application/wasm"],[".webp","image/webp"],[".png","image/png"]]);

function requireCondition(value, message) { if (!value) throw new Error(message); }
function chromeExecutable() {
  for (const executable of [process.env.CHROME_BIN,"google-chrome","google-chrome-stable","chromium","chromium-browser"].filter(Boolean)) {
    const probe = spawnSync(executable,["--version"],{encoding:"utf8"});
    if (probe.status===0) return executable;
  }
  throw new Error("Chrome/Chromium is required for active-sample centering acceptance");
}
async function freePort() {
  const server=createServer();
  await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});
  const address=server.address(); requireCondition(address&&typeof address==="object","Unable to allocate Chrome port");
  const port=address.port; await new Promise(ok=>server.close(ok)); return port;
}
async function startStaticServer() {
  await stat(resolve(site,"index.html"));
  const server=createServer(async(request,response)=>{try{
    const url=new URL(request.url||"/","http://127.0.0.1");
    const relative=decodeURIComponent(url.pathname==="/"?"index.html":url.pathname.replace(/^\/+/,""));
    const file=resolve(site,relative);
    if(file!==site&&!file.startsWith(`${site}${sep}`)) return response.writeHead(403).end("forbidden");
    const info=await stat(file); if(!info.isFile()) throw new Error("not-file");
    const bytes=await readFile(file);
    response.writeHead(200,{"content-type":MIME.get(extname(file).toLowerCase())||"application/octet-stream","cache-control":"no-store"}); response.end(bytes);
  }catch{response.writeHead(404,{"content-type":"text/plain; charset=utf-8"}).end("not found");}});
  await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});
  const address=server.address(); requireCondition(address&&typeof address==="object","Static server did not expose port");
  return {server,url:`http://127.0.0.1:${address.port}/`};
}
async function waitUntil(check,label,timeoutMs=TIMEOUT_MS){const deadline=Date.now()+timeoutMs;let lastError;while(Date.now()<deadline){try{const value=await check();if(value)return value;}catch(error){lastError=error;}await delay(80);}throw new Error(`${label} timed out${lastError?`: ${lastError instanceof Error?lastError.message:String(lastError)}`:""}`);}

class Cdp {
  constructor(url){this.url=url;this.id=0;this.pending=new Map();}
  async open(){this.ws=new WebSocket(this.url);this.ws.addEventListener("message",event=>this.message(String(event.data)));await new Promise((ok,fail)=>{this.ws.addEventListener("open",ok,{once:true});this.ws.addEventListener("error",()=>fail(new Error("CDP websocket failed")),{once:true});});}
  message(raw){const message=JSON.parse(raw);if(!message.id)return;const item=this.pending.get(message.id);if(!item)return;this.pending.delete(message.id);return message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}
  send(method,params={}){const id=++this.id;return new Promise((ok,fail)=>{this.pending.set(id,{resolve:ok,reject:fail});this.ws.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression){const result=await this.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||"evaluate failed");return result.result?.value;}
  close(){try{this.ws?.close();}catch{}}
}
const js=value=>JSON.stringify(value);
async function waitExpression(cdp,expression,label,timeoutMs=TIMEOUT_MS){return waitUntil(async()=>await cdp.evaluate(expression)||false,label,timeoutMs);}
async function click(cdp,selector){const ok=await cdp.evaluate(`(()=>{const n=document.querySelector(${js(selector)});if(!(n instanceof HTMLElement))return false;n.click();return true;})()`);requireCondition(ok===true,`Unable to click ${selector}`);}
async function setValue(cdp,selector,value){const result=await cdp.evaluate(`(()=>{const n=document.querySelector(${js(selector)});if(!(n instanceof HTMLInputElement||n instanceof HTMLTextAreaElement||n instanceof HTMLSelectElement))return false;n.value=${js(String(value))};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return n.value;})()`);requireCondition(result===String(value),`Unable to set ${selector}`);}

const geometryExpression = (displayNumber) => `(()=>{
  const list=document.querySelector('.cupping-layout__rail-list.sample-rail');
  const card=[...document.querySelectorAll('.sample-rail__item')].find(n=>Number(n.dataset.displayNumber)===${displayNumber});
  if(!(list instanceof HTMLElement)||!(card instanceof HTMLElement)||!card.classList.contains('is-active'))return false;
  const lr=list.getBoundingClientRect(),cr=card.getBoundingClientRect();
  const max=Math.max(0,list.scrollHeight-list.clientHeight);
  return {scrollTop:list.scrollTop,max,centerError:Math.abs((cr.top+cr.bottom)/2-(lr.top+lr.bottom)/2),compact:document.querySelector('.cupping-layout')?.classList.contains('is-rail-compact')===true};
})()`;

async function selectDisplayNumber(cdp, displayNumber) {
  const frames=await cdp.evaluate(`new Promise((resolve,reject)=>{
    const card=[...document.querySelectorAll('.sample-rail__item')].find(n=>Number(n.dataset.displayNumber)===${displayNumber});
    const button=card?.querySelector('.sample-rail__select');
    if(!(button instanceof HTMLElement)){reject(new Error('Missing sample ${displayNumber}'));return;}
    const frames=[],started=performance.now();
    button.click();
    const capture=()=>{
      const active=document.querySelector('.sample-rail__item.is-active');
      const marker=document.querySelector('.cupping-rail-active-float');
      const number=active?.querySelector('.sample-rail__number');
      const list=document.querySelector('.cupping-layout__rail-list');
      if(active?.dataset.displayNumber==='${displayNumber}'&&marker&&number&&list){
        const ms=getComputedStyle(marker),ns=getComputedStyle(number);
        const mr=marker.getBoundingClientRect(),nr=number.getBoundingClientRect(),cr=active.getBoundingClientRect();
        const mt=new DOMMatrixReadOnly(ms.transform),nt=new DOMMatrixReadOnly(ns.transform);
        frames.push({opacity:Number(ms.opacity),numberOpacity:Number(ns.opacity),visible:ms.visibility==='visible',
          x:mt.m41,y:mt.m42,numberX:nt.m41,numberY:nt.m42,top:mr.top,numberTop:nr.top,scrollTop:list.scrollTop,
          markerRight:mr.right,numberRight:nr.right,rowError:Math.abs(mr.top+mr.height/2-cr.top-cr.height/2),
          numberColor:ns.color,numberWeight:Number(ns.fontWeight),transition:ms.transitionProperty});
      }
      if(performance.now()-started<1000)requestAnimationFrame(capture);else resolve(frames);
    };
    requestAnimationFrame(capture);
  })`);
  requireCondition(frames.length>5,`Sample ${displayNumber} did not activate`);
  requireCondition(frames.some(f=>f.opacity===0&&f.numberOpacity===0),`Sample ${displayNumber} appeared before settling`);
  requireCondition(frames.some(f=>f.opacity===0&&f.markerRight<=0&&f.numberRight<=0),`Sample ${displayNumber} did not start outside the left viewport`);
  const entering=frames.filter(f=>f.visible&&f.opacity>.01&&f.opacity<.99);
  requireCondition(entering.length>=3,`Sample ${displayNumber} has no visible fade-in: ${JSON.stringify(frames)}`);
  requireCondition(entering.every(f=>f.x<0&&Math.abs(f.x-f.numberX)<.5&&f.y===0&&f.numberY===0),`Marker and number did not move horizontally together: ${JSON.stringify(entering)}`);
  requireCondition(entering.every(f=>Math.abs(f.opacity-f.numberOpacity)<.01),`Number faded separately from the marker: ${JSON.stringify(entering)}`);
  requireCondition(entering.every(f=>f.rowError<=1&&f.transition==='none'),`Visible marker travelled between rows: ${JSON.stringify(entering)}`);
  for(const key of ['top','numberTop','scrollTop']){
    requireCondition(Math.max(...entering.map(f=>f[key]))-Math.min(...entering.map(f=>f[key]))<=1,`Sample ${displayNumber} moved vertically during reveal (${key})`);
  }
  const last=frames.at(-1);
  requireCondition(last.visible&&last.opacity===1&&last.numberOpacity===1&&last.x===0&&last.numberX===0,`Sample ${displayNumber} did not finish revealing: ${JSON.stringify(last)}`);
  requireCondition(last.numberColor==='rgb(255, 255, 255)'&&last.numberWeight>=800,`Active number is not white and bold: ${JSON.stringify(last)}`);
  console.log(`Sample ${displayNumber} horizontal marker + number reveal: PASS`,JSON.stringify({frames:frames.length,enteringFrames:entering.length,final:last}));
}

async function run(appUrl){
  const executable=chromeExecutable(),port=await freePort(),profile=await mkdtemp(resolve(tmpdir(),"aromasense-active-center-"));
  const chrome=spawn(executable,["--headless=new","--disable-gpu","--disable-dev-shm-usage","--no-sandbox","--no-first-run","--no-default-browser-check",`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
  let cdp;
  try {
    await waitUntil(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},"Chrome startup",20_000);
    const targetResponse=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`,{method:"PUT"});requireCondition(targetResponse.ok,`Chrome target HTTP ${targetResponse.status}`);
    const target=await targetResponse.json();cdp=new Cdp(target.webSocketDebuggerUrl);await cdp.open();await Promise.all([cdp.send("Page.enable"),cdp.send("Runtime.enable")]);
    await waitExpression(cdp,`document.querySelector('#app')?.dataset.screen==='setup'`,"setup screen");
    await setValue(cdp,'[data-session-field="组织方"] input',"Active Sample Center Acceptance");
    await setValue(cdp,'[data-session-field="杯测会名称"] input',"30 Samples Centering");
    await setValue(cdp,'[data-cupping-type="true"]',"blind");
    await click(cdp,".batch-setup__start");
    await waitExpression(cdp,`Boolean(document.querySelector('.cupping-count-dialog__input'))`,"sample-count dialog");
    await setValue(cdp,".cupping-count-dialog__input","30");
    await click(cdp,".cupping-count-dialog__confirm");
    await waitExpression(cdp,`document.querySelector('#app')?.dataset.screen==='cupping'`,"cupping screen");
    await waitExpression(cdp,`document.querySelectorAll('.sample-rail__item').length===30`,"30 sample rail");
    await waitExpression(cdp,`Boolean(document.querySelector('.competition-preflight__start'))`,"blind competition preflight");
    await click(cdp,".competition-preflight__start");
    await waitExpression(cdp,`Boolean(document.querySelector('[data-stage-id="aroma"]'))&&!document.querySelector('.competition-preflight__start')`,"started blind competition");

    if(await cdp.evaluate(`document.querySelector('.cupping-layout')?.classList.contains('is-rail-compact')===true`)) await click(cdp,"[data-rail-toggle]");
    await waitExpression(cdp,`document.querySelector('.cupping-layout')?.classList.contains('is-rail-compact')===false`,"expanded rail");

    await selectDisplayNumber(cdp,15);
    const middle=await waitExpression(cdp,`${geometryExpression(15)}?.centerError<=12?${geometryExpression(15)}:false`,"expanded sample 15 centered",5_000);
    requireCondition(middle.scrollTop>1&&middle.scrollTop<middle.max-1,`Middle sample was not centered inside scroll range: ${JSON.stringify(middle)}`);

    await selectDisplayNumber(cdp,30);
    const bottom=await waitExpression(cdp,`(()=>{const g=${geometryExpression(30)};return g&&Math.abs(g.scrollTop-g.max)<=2?g:false;})()`,"sample 30 bottom clamp",5_000);

    await selectDisplayNumber(cdp,1);
    const top=await waitExpression(cdp,`(()=>{const g=${geometryExpression(1)};return g&&g.scrollTop<=2?g:false;})()`,"sample 1 top clamp",5_000);

    await click(cdp,"[data-rail-toggle]");
    await waitExpression(cdp,`document.querySelector('.cupping-layout')?.classList.contains('is-rail-compact')===true`,"compact rail");
    await selectDisplayNumber(cdp,18);
    const compactMiddle=await waitExpression(cdp,`${geometryExpression(18)}?.centerError<=12?${geometryExpression(18)}:false`,"compact sample 18 centered",5_000);
    requireCondition(compactMiddle.scrollTop>1&&compactMiddle.scrollTop<compactMiddle.max-1,`Compact middle sample was not centered: ${JSON.stringify(compactMiddle)}`);

    console.log("AromaSense active sample centering acceptance: PASS",JSON.stringify({middle,bottom,top,compactMiddle}));
  } finally {
    cdp?.close();
    if(chrome.exitCode===null){const exited=new Promise(resolveExit=>chrome.once("exit",resolveExit));chrome.kill("SIGTERM");await Promise.race([exited,delay(1800)]);}
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:120}).catch(()=>undefined);
  }
}

const {server,url}=await startStaticServer();
try{await run(url);}finally{await new Promise(ok=>server.close(ok));}
