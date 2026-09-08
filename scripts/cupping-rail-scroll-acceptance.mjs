import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const site = resolve(root, "site");
const TIMEOUT_MS = 30_000;
const MIME = new Map([[".html","text/html; charset=utf-8"],[".js","text/javascript; charset=utf-8"],[".mjs","text/javascript; charset=utf-8"],[".css","text/css; charset=utf-8"],[".json","application/json; charset=utf-8"],[".wasm","application/wasm"],[".webp","image/webp"],[".png","image/png"]]);

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
    const before=await cdp.evaluate(`(()=>{const n=document.querySelector('.cupping-layout__rail-list.sample-rail');if(!(n instanceof HTMLElement))return null;const s=getComputedStyle(n);return{overflowY:s.overflowY,touchAction:s.touchAction,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,scrollTop:n.scrollTop,activeTabDisplay:getComputedStyle(document.querySelector('.sample-rail__active-tab')||n).display};})()`);
    requireCondition(before?.overflowY==="auto",`Computed overflowY is not auto: ${JSON.stringify(before)}`);
    requireCondition(before?.touchAction==="pan-y",`Computed touch-action is not pan-y: ${JSON.stringify(before)}`);
    requireCondition(before?.scrollHeight>before?.clientHeight,`Rail does not overflow with 30 samples: ${JSON.stringify(before)}`);
    const moved=await cdp.evaluate(`(()=>{const n=document.querySelector('.cupping-layout__rail-list.sample-rail');if(!(n instanceof HTMLElement))return null;n.scrollTop=n.scrollHeight;return n.scrollTop;})()`);
    requireCondition(Number(moved)>0,`Rail scrollTop did not move: ${moved}`);
    const after=await cdp.evaluate(`(()=>{const n=document.querySelector('.cupping-layout__rail-list.sample-rail');return n instanceof HTMLElement?{scrollTop:n.scrollTop,max:n.scrollHeight-n.clientHeight}:null;})()`);
    requireCondition(after?.scrollTop>0&&after.scrollTop<=after.max+1,`Rail scrolling is out of range: ${JSON.stringify(after)}`);
    console.log("AromaSense cupping rail scroll acceptance: PASS",JSON.stringify({before,after}));
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
