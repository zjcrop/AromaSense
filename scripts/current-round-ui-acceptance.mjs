import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const site = resolve(root, "site");
const TIMEOUT_MS = 45_000;
const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".wasm", "application/wasm"],
  [".webp", "image/webp"], [".png", "image/png"]
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function chromeExecutable() {
  for (const executable of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    const probe = spawnSync(executable, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return executable;
  }
  throw new Error("Chrome/Chromium is required for current-round UI acceptance");
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Unable to allocate Chrome port");
  const port = address.port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function startStaticServer() {
  await stat(resolve(site, "index.html"));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
      const file = resolve(site, relative);
      if (file !== site && !file.startsWith(`${site}${sep}`)) return response.writeHead(403).end("forbidden");
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not-file");
      const bytes = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME.get(extname(file).toLowerCase()) || "application/octet-stream",
        "cache-control": "no-store"
      });
      response.end(bytes);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Static server did not expose port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function waitUntil(check, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { lastError = error; }
    await delay(80);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`);
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.errors = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => this.message(String(event.data)));
    await new Promise((resolveOpen, reject) => {
      this.ws.addEventListener("open", resolveOpen, { once: true });
      this.ws.addEventListener("error", () => reject(new Error("CDP websocket failed")), { once: true });
    });
  }
  message(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      return message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params?.exceptionDetails?.text || "runtime exception");
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") this.errors.push(message.params.entry.text);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluate failed");
    return result.result?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

const js = (value) => JSON.stringify(value);
async function waitExpression(cdp, expression, label) {
  return waitUntil(async () => (await cdp.evaluate(expression)) || false, label);
}
async function click(cdp, selector) {
  const ok = await cdp.evaluate(`(() => { const n=document.querySelector(${js(selector)}); if(!(n instanceof HTMLElement)) return false; n.click(); return true; })()`);
  requireCondition(ok === true, `Unable to click ${selector}`);
}
async function setValue(cdp, selector, value) {
  const result = await cdp.evaluate(`(() => { const n=document.querySelector(${js(selector)}); if(!(n instanceof HTMLInputElement||n instanceof HTMLTextAreaElement||n instanceof HTMLSelectElement)) return false; n.value=${js(String(value))}; n.dispatchEvent(new Event('input',{bubbles:true})); n.dispatchEvent(new Event('change',{bubbles:true})); return n.value; })()`);
  requireCondition(result === String(value), `Unable to set ${selector}`);
}
async function setSensoryRange(cdp, fieldKey, value) {
  await setValue(cdp, `[data-field-key="${fieldKey}"] .sensory-range__input`, value);
  await waitExpression(cdp, `document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, `range ${fieldKey}`);
}
async function waitIdle(cdp, label) {
  await waitExpression(cdp, `document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, label);
}

async function runAcceptance(appUrl) {
  const executable = chromeExecutable();
  const port = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), "aromasense-current-round-"));
  const chrome = spawn(executable, [
    "--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox",
    "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => { stderr += chunk; });
  let cdp;
  try {
    await waitUntil(async () => {
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; }
    }, "Chrome debugging startup", 20_000);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" });
    requireCondition(targetResponse.ok, `Chrome target HTTP ${targetResponse.status}`);
    const target = await targetResponse.json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Log.enable")]);

    await waitExpression(cdp, `document.querySelector('#app')?.dataset.screen==='setup'`, "setup screen");
    await setValue(cdp, '[data-session-field="组织方"] input', "AromaSense UI Acceptance");
    await setValue(cdp, '[data-session-field="杯测会名称"] input', "Single Axis Aroma Score");
    await setValue(cdp, '[data-cupping-type="true"]', "competition");
    await click(cdp, '[aria-label="批量录入"]');
    await waitExpression(cdp, `Boolean(document.querySelector('[data-batch-intake-source="text"]'))`, "batch text intake");
    await click(cdp, '[data-batch-intake-source="text"]');
    await waitExpression(cdp, `Boolean(document.querySelector('.manual-import__textarea'))`, "manual intake");
    await setValue(cdp, '.manual-import__textarea', "验收样品；埃塞俄比亚；古吉；水洗；浅烘；茉莉、柑橘");
    await click(cdp, '.manual-import__primary');
    await waitExpression(cdp, `Boolean(document.querySelector('.batch-setup__row.is-auto-accepted')) && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "sample seed");
    await click(cdp, '.batch-setup__start');
    await waitExpression(cdp, `document.querySelector('#app')?.dataset.screen==='cupping'`, "cupping screen");
    await waitExpression(cdp, `Boolean(document.querySelector('.competition-preflight__start'))`, "preflight");
    await click(cdp, '.competition-preflight__start');
    await waitExpression(cdp, `Boolean(document.querySelector('[data-stage-id="aroma"]')) && !document.querySelector('.competition-preflight__start')`, "competition started");

    const initial = await cdp.evaluate(`(() => {
      const steps=[...document.querySelectorAll('.cupping-stage-step')];
      const previous=document.querySelector('.cupping-nav--previous');
      const next=document.querySelector('.cupping-nav--next');
      const center=(node)=>{const r=node?.getBoundingClientRect();return r?r.left+r.width/2:0};
      const centerDelta=Math.max(...steps.flatMap(step=>{
        const dot=center(step.querySelector('.cupping-stage-step__status-dot'));
        const label=center(step.querySelector('.cupping-stage-step__label'));
        const index=center(step.querySelector('.cupping-stage-step__index'));
        return [Math.abs(dot-label),Math.abs(label-index),Math.abs(dot-index)];
      }));
      return {
        ids:steps.map(n=>n.dataset.stageId), labels:steps.map(n=>n.querySelector('.cupping-stage-step__label')?.textContent?.trim()),
        indexes:steps.map(n=>n.querySelector('.cupping-stage-step__index')?.textContent?.trim()), centerDelta,
        previousText:previous?.textContent?.trim()||'', nextText:next?.textContent?.trim()||'',
        previousDisplay:previous?getComputedStyle(previous).display:'', nextDisplay:next?getComputedStyle(next).display:'',
        previousTriangles:previous?getComputedStyle(previous,'::before').content:'', nextTriangles:next?getComputedStyle(next,'::before').content:''
      };
    })()`);
    requireCondition(JSON.stringify(initial?.ids) === JSON.stringify(["aroma","high_temp","mid_temp","low_temp","flavor","overall","scoring"]), `Wrong stages: ${JSON.stringify(initial)}`);
    requireCondition((initial?.centerDelta ?? 99) <= 1.2, `Stage centers differ: ${JSON.stringify(initial)}`);
    requireCondition(initial?.previousDisplay === "none" && initial?.nextDisplay !== "none", `First-stage navigation wrong: ${JSON.stringify(initial)}`);
    requireCondition((initial?.previousTriangles||'').includes("◀◀◀◀◀") && (initial?.nextTriangles||'').includes("▶▶▶▶▶"), `Five-triangle navigation missing: ${JSON.stringify(initial)}`);

    await waitExpression(cdp, `Boolean(document.querySelector('.aroma-dual-entry')) && document.querySelectorAll('[data-single-axis-score="true"]').length===2`, "single-axis aroma UI");
    const aromaUi = await cdp.evaluate(`(() => {
      const axes=[...document.querySelectorAll('[data-single-axis-score="true"]')];
      const bridge=[...document.querySelectorAll('.aroma-dual-entry__bridge button')];
      const tag=document.querySelector('[data-aroma-phase="shared"] .flavor-tag');
      const tagStyle=tag?getComputedStyle(tag):null;
      return {
        duplicateScoreAxes:document.querySelectorAll('[data-aroma-sca-score],.aroma-affective-score').length,
        axisKeys:axes.map(n=>n.dataset.fieldKey),
        axisRanges:axes.map(n=>{const i=n.querySelector('input[type="range"]');return i?[i.min,i.max,i.step]:[]}),
        bridgeText:bridge.map(n=>n.textContent?.trim()),
        tagBorder:tagStyle?.borderTopWidth||'', tagRadius:tagStyle?.borderRadius||'', tagBackground:tagStyle?.backgroundColor||''
      };
    })()`);
    requireCondition(aromaUi?.duplicateScoreAxes === 0, `Duplicate dry/wet score axes remain: ${JSON.stringify(aromaUi)}`);
    requireCondition(JSON.stringify(aromaUi?.axisKeys) === JSON.stringify(["dry_fragrance_intensity","wet_aroma_intensity"]), `Wrong single score axes: ${JSON.stringify(aromaUi)}`);
    requireCondition(aromaUi?.axisRanges?.every((r)=>JSON.stringify(r)===JSON.stringify(["1","9","1"])), `Aroma score ranges are not 1-9: ${JSON.stringify(aromaUi)}`);
    requireCondition(JSON.stringify(aromaUi?.bridgeText) === JSON.stringify(["⇄","←","→"]), `Bridge symbols wrong: ${JSON.stringify(aromaUi)}`);
    requireCondition(parseFloat(aromaUi?.tagBorder||"0") > 0 && parseFloat(aromaUi?.tagBorder||"99") <= 1 && aromaUi?.tagRadius !== "0px" && aromaUi?.tagBackground === "rgba(0, 0, 0, 0)", `Flavor tag boundary wrong: ${JSON.stringify(aromaUi)}`);

    await setSensoryRange(cdp, "dry_fragrance_intensity", 5);
    await setSensoryRange(cdp, "wet_aroma_intensity", 5);
    await click(cdp, '[data-aroma-target="dry"]');
    await click(cdp, '[data-aroma-phase="shared"] .flavor-tag');
    await waitIdle(cdp, "dry aroma tag");
    await click(cdp, '[data-aroma-target="wet"]');
    await click(cdp, '[data-aroma-phase="shared"] .flavor-tag');
    await waitIdle(cdp, "wet aroma tag");
    await waitExpression(cdp, `document.querySelector('[data-stage-id="aroma"]')?.classList.contains('is-completed')===true`, "aroma complete");

    for (const stageId of ["high_temp", "mid_temp", "low_temp"]) {
      await click(cdp, `[data-stage-id="${stageId}"]`);
      await waitExpression(cdp, `document.querySelector('[data-stage-id="${stageId}"]')?.getAttribute('aria-current')==='step' && Boolean(document.querySelector('.cupping-main__editor .flavor-tag'))`, `${stageId} page`);
      await click(cdp, '.cupping-main__editor .flavor-tag');
      await waitIdle(cdp, `${stageId} flavor`);
    }

    await click(cdp, '[data-stage-id="flavor"]');
    await waitExpression(cdp, `Boolean(document.querySelector('.flavor-replication'))`, "flavor replication");
    const replication = await cdp.evaluate(`(() => ({labels:[...document.querySelectorAll('.flavor-replication__button')].map(n=>n.textContent?.trim()),enabled:[...document.querySelectorAll('.flavor-replication__button')].map(n=>!n.disabled)}))()`);
    requireCondition(JSON.stringify(replication?.labels) === JSON.stringify(["加载高温风味","加载中温风味","加载低温风味","全部加载"]), `Replication buttons wrong: ${JSON.stringify(replication)}`);
    requireCondition(replication?.enabled?.every(Boolean), `Replication buttons disabled: ${JSON.stringify(replication)}`);
    await click(cdp, '.flavor-replication__button:last-child');
    await waitIdle(cdp, "load all flavor tags");

    await click(cdp, '[data-stage-id="overall"]');
    await waitExpression(cdp, `Boolean(document.querySelector('.cup-comparison'))`, "overall page");
    const overall = await cdp.evaluate(`(() => ({
      legacyPhaseNav:Boolean(document.querySelector('.cupping-main__editor .final-assessment__phase-nav')),
      duplicateAromaInputs:['final_sca_affective_fragrance','final_sca_affective_aroma'].filter(k=>document.querySelector('.cupping-main__editor [data-field-key="'+k+'"]')).length,
      scaInputs:document.querySelectorAll('.cupping-main__editor .final-assessment__sca-scale').length,
      quick:Boolean(document.querySelector('.floating-note-trigger'))
    }))()`);
    requireCondition(overall?.legacyPhaseNav === false && overall?.duplicateAromaInputs === 0 && overall?.scaInputs === 6 && overall?.quick === true, `Overall contract wrong: ${JSON.stringify(overall)}`);

    for (const fieldKey of [
      "final_sca_affective_flavor", "final_sca_affective_aftertaste", "final_sca_affective_acidity",
      "final_sca_affective_sweetness", "final_sca_affective_mouthfeel", "final_sca_affective_overall"
    ]) {
      await setValue(cdp, `[data-field-key="${fieldKey}"] input`, 5);
      await waitIdle(cdp, `overall ${fieldKey}`);
    }
    await setValue(cdp, '[data-field-key="quality_clean"] input', 8);
    await waitIdle(cdp, "quality clean");
    await waitExpression(cdp, `document.querySelector('.final-assessment__live-score-value')?.textContent?.trim()==='79.00'`, "aggregate score 79");

    await click(cdp, '[data-stage-id="scoring"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="scoring"]')?.getAttribute('aria-current')==='step'`, "scoring page");
    const scoring = await cdp.evaluate(`(() => ({
      score:document.querySelector('.final-assessment__score-value')?.textContent?.trim()||'',
      legacyPhaseNav:Boolean(document.querySelector('.cupping-main__editor .final-assessment__phase-nav')),
      nextDisplay:getComputedStyle(document.querySelector('.cupping-nav--next')).display,
      hasRadar:Boolean(document.querySelector('[aria-label*="结构雷达图"]')),
      hasEvolution:Boolean(document.querySelector('.temperature-flavor-profile__canvas'))
    }))()`);
    requireCondition(scoring?.score === "79.00", `Scoring did not use original dry/wet axes: ${JSON.stringify(scoring)}`);
    requireCondition(scoring?.legacyPhaseNav === false && scoring?.nextDisplay === "none", `Scoring page navigation wrong: ${JSON.stringify(scoring)}`);
    requireCondition(scoring?.hasRadar === true && scoring?.hasEvolution === true, `Conclusion charts missing: ${JSON.stringify(scoring)}`);

    const relevantErrors = cdp.errors.filter((entry) => !/favicon|Failed to load resource.*404|onnxruntime/i.test(entry));
    requireCondition(relevantErrors.length === 0, `Browser errors:\n${relevantErrors.join("\n")}`);
    console.log("AromaSense current-round visible UI acceptance: PASS");
    console.log(JSON.stringify({ initial, aromaUi, replication, overall, scoring }, null, 2));
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    await Promise.race([new Promise((resolveExit) => chrome.once("exit", resolveExit)), delay(3000)]);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (stderr && process.env.AROMASENSE_ACCEPTANCE_DEBUG === "1") console.error(stderr);
  }
}

const { server, url } = await startStaticServer();
try { await runAcceptance(url); }
finally { await new Promise((resolveClose) => server.close(resolveClose)); }
