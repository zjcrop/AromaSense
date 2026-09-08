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
    const probe = spawnSync(executable,["--version"],{encoding:"utf8"}); if (probe.status===0) return executable;
  }
  throw new Error("Chrome/Chromium is required for cupping rail acceptance");
}
async function freePort() {
  const server=createServer(); await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});
  const address=server.address(); requireCondition(address&&typeof address==="object","Unable to allocate Chrome port"); const port=address.port; await new Promise(ok=>server.close(ok)); return port;
}
async function startStaticServer() {
  await stat(resolve(site,"index.html"));
  const server=createServer(async(request,response)=>{try{const url=new URL(request.url||"/","http://127.0.0.1");const relative=decodeURIComponent(url.pathname==="/"?"index.html":url.pathname.replace(/^\/+/,""));const file=resolve(site,relative);if(file!==site&&!file.startsWith(`${site}${sep}`))return response.writeHead(403).end("forbidden");const info=await stat(file);if(!info.isFile())throw new Error("not-file");const bytes=await readFile(file);response.writeHead(200,{"content-type":MIME.get(extname(file).toLowerCase())||"application/octet-stream","cache-control":"no-store"});response.end(bytes);}catch{response.writeHead(404,{"content-type":"text/plain; charset=utf-8"}).end("not found");}});
  await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);}); const address=server.address(); requireCondition(address&&typeof address==="object","Static server did not expose port"); return {server,url:`http://127.0.0.1:${address.port}/`};
}
async function waitUntil(check,label,timeoutMs=TIMEOUT_MS){const deadline=Date.now()+timeoutMs;let lastError;while(Date.now()<deadline){try{const value=await check();if(value)return value;}catch(error){lastError=error;}await delay(80);}throw new Error(`${label} timed out${lastError?`: ${lastError instanceof Error?lastError.message:String(lastError)}`:""}`);}

class Cdp {
  constructor(url){this.url=url;this.id=0;this.pending=new Map();this.errors=[];}
  async open(){this.ws=new WebSocket(this.url);this.ws.addEventListener("message",e=>this.message(String(e.data)));await new Promise((ok,fail)=>{this.ws.addEventListener("open",ok,{once:true});this.ws.addEventListener("error",()=>fail(new Error("CDP websocket failed")),{once:true});});}
  message(raw){const message=JSON.parse(raw);if(message.id){const item=this.pending.get(message.id);if(!item)return;this.pending.delete(message.id);return message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}if(message.method==="Runtime.exceptionThrown")this.errors.push(message.params?.exceptionDetails?.text||"runtime exception");}
  send(method,params={}){const id=++this.id;return new Promise((ok,fail)=>{this.pending.set(id,{resolve:ok,reject:fail});this.ws.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression){const result=await this.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||"evaluate failed");return result.result?.value;}
  close(){try{this.ws?.close();}catch{}}
}
const js=value=>JSON.stringify(value);
async function waitExpression(cdp,expression,label){return waitUntil(async()=>await cdp.evaluate(expression)||false,label);}
async function click(cdp,selector){const ok=await cdp.evaluate(`(()=>{const n=document.querySelector(${js(selector)});if(!(n instanceof HTMLElement))return false;n.click();return true;})()`);requireCondition(ok===true,`Unable to click ${selector}`);}
async function setValue(cdp,selector,value){const result=await cdp.evaluate(`(()=>{const n=document.querySelector(${js(selector)});if(!(n instanceof HTMLInputElement||n instanceof HTMLTextAreaElement||n instanceof HTMLSelectElement))return false;n.value=${js(String(value))};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return n.value;})()`);requireCondition(result===String(value),`Unable to set ${selector}`);}

async function run(appUrl){
  const executable=chromeExecutable(),port=await freePort(),profile=await mkdtemp(resolve(tmpdir(),"aromasense-rail-"));
  const chrome=spawn(executable,["--headless=new","--disable-gpu","--disable-dev-shm-usage","--no-sandbox","--no-first-run","--no-default-browser-check",`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
  let cdp;
  try {
    await waitUntil(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},"Chrome startup",20_000);
    const targetResponse=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`,{method:"PUT"});requireCondition(targetResponse.ok,`Chrome target HTTP ${targetResponse.status}`);const target=await targetResponse.json();cdp=new Cdp(target.webSocketDebuggerUrl);await cdp.open();await Promise.all([cdp.send("Page.enable"),cdp.send("Runtime.enable")]);
    await waitExpression(cdp,`document.querySelector('#app')?.dataset.screen==='setup'`,"setup screen");
    await setValue(cdp,'[data-session-field="组织方"] input',"Rail Scroll Acceptance");
    await setValue(cdp,'[data-session-field="杯测会名称"] input',"30 Samples Rail");
    await setValue(cdp,'[data-cupping-type="true"]',"blind");
    await click(cdp,".batch-setup__start");
    await waitExpression(cdp,`Boolean(document.querySelector('.cupping-count-dialog__input'))`,"sample-count dialog");
    await setValue(cdp,".cupping-count-dialog__input","30");
    await click(cdp,".cupping-count-dialog__confirm");
    await waitExpression(cdp,`document.querySelector('#app')?.dataset.screen==='cupping'`,"cupping screen");
    await waitExpression(cdp,`document.querySelectorAll('.sample-rail__item').length===30`,"30 rail items");
    const compact=await cdp.evaluate(`document.querySelector('.cupping-layout')?.classList.contains('is-rail-compact')===true`); if(compact) await click(cdp,"[data-rail-toggle]");
    await waitExpression(cdp,`document.querySelector('.cupping-layout')?.classList.contains('is-rail-compact')===false`,"expanded rail");
    await click(cdp,".sample-rail__select");
    await waitExpression(cdp,`(()=>{const m=document.querySelector('.cupping-rail-active-float');return m instanceof HTMLElement&&getComputedStyle(m).opacity==='1';})()`,"floating active marker");

    const before=await cdp.evaluate(`(()=>{
      const list=document.querySelector('.cupping-layout__rail-list.sample-rail');
      const host=document.querySelector('.cupping-layout__rail');
      const marker=document.querySelector('.cupping-rail-active-float');
      const active=document.querySelector('.sample-rail__item.is-active');
      const name=active?.querySelector('.sample-rail__sample-name');
      if(!(list instanceof HTMLElement)||!(host instanceof HTMLElement)||!(marker instanceof HTMLElement)||!(active instanceof HTMLElement)||!(name instanceof HTMLElement))return null;
      const ls=getComputedStyle(list),hs=getComputedStyle(host),ms=getComputedStyle(marker),as=getComputedStyle(active),ns=getComputedStyle(name);
      const mr=marker.getBoundingClientRect(),hr=host.getBoundingClientRect();
      return {overflowY:ls.overflowY,touchAction:ls.touchAction,scrollBehavior:ls.scrollBehavior,scrollbarWidth:ls.scrollbarWidth,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,scrollTop:list.scrollTop,hostOverflow:hs.overflow,markerParent:marker.parentElement?.className||'',markerPosition:ms.position,markerOpacity:ms.opacity,markerTop:mr.top,markerRight:mr.right,hostRight:hr.right,markerZ:Number(ms.zIndex)||0,listZ:Number(ls.zIndex)||0,activeZ:Number(as.zIndex)||0,nameZ:Number(ns.zIndex)||0,nameFont:parseFloat(ns.fontSize)||0};
    })()`);
    requireCondition(before?.overflowY==="auto",`Computed overflowY is not auto: ${JSON.stringify(before)}`);
    requireCondition(before?.touchAction==="pan-y",`Computed touch-action is not pan-y: ${JSON.stringify(before)}`);
    requireCondition(before?.scrollBehavior==="smooth",`Rail lost product smooth scrolling: ${JSON.stringify(before)}`);
    requireCondition(before?.scrollbarWidth==="none",`Rail scrollbar is still visible: ${JSON.stringify(before)}`);
    requireCondition(before?.scrollHeight>before?.clientHeight,`Rail does not overflow with 30 samples: ${JSON.stringify(before)}`);
    requireCondition(before?.hostOverflow==="visible",`Rail host still clips floating marker: ${JSON.stringify(before)}`);
    requireCondition(/cupping-layout__rail/.test(before?.markerParent||"")&&before?.markerPosition==="absolute",`Current marker is not a rail-level floating layer: ${JSON.stringify(before)}`);
    requireCondition(before?.markerRight>before?.hostRight+5,`Floating marker does not protrude past rail edge: ${JSON.stringify(before)}`);
    requireCondition(before?.listZ>before?.markerZ&&before?.activeZ>before?.markerZ&&before?.nameZ>before?.markerZ,`Active text/card is not above marker: ${JSON.stringify(before)}`);
    requireCondition(before?.nameFont>=20,`Active sample name is not visibly enlarged: ${JSON.stringify(before)}`);

    const scrollTestReady=await cdp.evaluate(`(()=>{const n=document.querySelector('.cupping-layout__rail-list.sample-rail');if(!(n instanceof HTMLElement))return false;n.style.scrollBehavior='auto';n.scrollTop=24;return true;})()`);
    requireCondition(scrollTestReady===true,"Unable to initiate deterministic rail scroll");
    const smallMove=await waitExpression(cdp,`(()=>{const n=document.querySelector('.cupping-layout__rail-list.sample-rail');return n instanceof HTMLElement&&n.scrollTop>0?n.scrollTop:false;})()`,"rail small scroll movement");
    requireCondition(Number(smallMove)>0,`Rail small scroll did not move: ${smallMove}`);
    await delay(360);
    const followed=await cdp.evaluate(`(()=>{const m=document.querySelector('.cupping-rail-active-float');return m instanceof HTMLElement?{top:m.getBoundingClientRect().top,opacity:getComputedStyle(m).opacity}:null;})()`);
    requireCondition(followed?.opacity==="1"&&followed.top<before.markerTop-4,`Floating marker did not follow active item while scrolling: ${JSON.stringify({before,followed})}`);

    const bottomStarted=await cdp.evaluate(`(()=>{const n=document.querySelector('.cupping-layout__rail-list.sample-rail');if(!(n instanceof HTMLElement))return false;n.scrollTop=n.scrollHeight;return true;})()`);
    requireCondition(bottomStarted===true,"Unable to initiate rail bottom scroll");
    const moved=await waitExpression(cdp,`(()=>{const n=document.querySelector('.cupping-layout__rail-list.sample-rail');if(!(n instanceof HTMLElement))return false;const max=n.scrollHeight-n.clientHeight;return max>0&&n.scrollTop>=max-1?n.scrollTop:false;})()`,"rail bottom scroll movement");
    requireCondition(Number(moved)>0,`Rail scrollTop did not move: ${moved}`);
    await delay(360);
    const after=await cdp.evaluate(`(()=>{const n=document.querySelector('.cupping-layout__rail-list.sample-rail');const m=document.querySelector('.cupping-rail-active-float');return n instanceof HTMLElement&&m instanceof HTMLElement?{scrollTop:n.scrollTop,max:n.scrollHeight-n.clientHeight,markerOpacity:getComputedStyle(m).opacity}:null;})()`);
    requireCondition(after?.scrollTop>0&&after.scrollTop<=after.max+1,`Rail scrolling is out of range: ${JSON.stringify(after)}`);
    requireCondition(after?.markerOpacity==="0",`Marker should hide when active item scrolls out of viewport: ${JSON.stringify(after)}`);
    console.log("AromaSense cupping rail scroll + floating marker acceptance: PASS",JSON.stringify({before,smallMove,followed,after}));
  } finally {
    cdp?.close();
    if (chrome.exitCode === null) {
      const exited = new Promise((resolveExit) => chrome.once("exit", resolveExit));
      chrome.kill("SIGTERM");
      await Promise.race([exited, delay(1800)]);
    }
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:120}).catch(()=>undefined);
  }
}

const {server,url}=await startStaticServer();
try { await run(url); } finally { await new Promise(ok=>server.close(ok)); }
