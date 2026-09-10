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
    const result = await this.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    });
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
async function setRangeByLabel(cdp, label, value) {
  const result = await cdp.evaluate(`(() => {
    const field=[...document.querySelectorAll('.sensory-field')].find((node)=>node.querySelector('.sensory-field__label')?.textContent?.trim().startsWith(${js(label)}));
    const input=field?.querySelector('.sensory-range__input');
    if(!(input instanceof HTMLInputElement)) return false;
    input.value=${js(String(value))};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return input.value;
  })()`);
  requireCondition(result === String(value), `Unable to set range field ${label}`);
}
async function setAromaScore(cdp, key, value) {
  await setValue(cdp, `[data-aroma-sca-score="${key}"] input`, value);
  await waitExpression(
    cdp,
    `document.querySelector('[data-aroma-sca-score="${key}"] output')?.textContent?.trim()===${js(String(value))} && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`,
    `aroma score ${key}`
  );
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
    await setValue(cdp, '[data-session-field="杯测会名称"] input', "Final Cupping UX");
    await setValue(cdp, '[data-cupping-type="true"]', "competition");

    await click(cdp, '[aria-label="批量录入"]');
    await waitExpression(cdp, `Boolean(document.querySelector('[data-batch-intake-source="text"]'))`, "batch text intake option");
    await click(cdp, '[data-batch-intake-source="text"]');
    await waitExpression(cdp, `Boolean(document.querySelector('.manual-import__textarea'))`, "manual text intake");
    await setValue(cdp, '.manual-import__textarea', "验收样品；埃塞俄比亚；古吉；水洗；浅烘；茉莉、柑橘");
    await click(cdp, '.manual-import__primary');
    await waitExpression(cdp, `Boolean(document.querySelector('.batch-setup__row.is-auto-accepted .batch-setup__sample-label')) && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "sample seed");
    await click(cdp, '.batch-setup__start');
    await waitExpression(cdp, `document.querySelector('#app')?.dataset.screen==='cupping'`, "cupping screen");
    await waitExpression(cdp, `Boolean(document.querySelector('.competition-preflight__start'))`, "competition preflight");
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
        ids:steps.map(n=>n.dataset.stageId),
        labels:steps.map(n=>n.querySelector('.cupping-stage-step__label')?.textContent?.trim()),
        indexes:steps.map(n=>n.querySelector('.cupping-stage-step__index')?.textContent?.trim()),
        centerDelta,
        previousText:previous?.textContent?.trim()||'',
        nextText:next?.textContent?.trim()||'',
        previousDisplay:previous?getComputedStyle(previous).display:'',
        nextDisplay:next?getComputedStyle(next).display:'',
        previousTriangles:previous?getComputedStyle(previous,'::before').content:'',
        nextTriangles:next?getComputedStyle(next,'::before').content:''
      };
    })()`);
    requireCondition(JSON.stringify(initial?.ids) === JSON.stringify(["aroma","high_temp","mid_temp","low_temp","flavor","overall","scoring"]), `Wrong stages: ${JSON.stringify(initial)}`);
    requireCondition(JSON.stringify(initial?.labels) === JSON.stringify(["香气","高温","中温","低温","风味","综评","评分"]), `Wrong stage labels: ${JSON.stringify(initial)}`);
    requireCondition(JSON.stringify(initial?.indexes) === JSON.stringify(["1","2","3","4","5","6","7"]), `Wrong stage indexes: ${JSON.stringify(initial)}`);
    requireCondition((initial?.centerDelta ?? 99) <= 1.2, `Dot/label/index horizontal centers differ: ${JSON.stringify(initial)}`);
    requireCondition(initial?.previousText === "←" && initial?.nextText === "→" && initial?.previousDisplay === "none" && initial?.nextDisplay !== "none", `First-stage navigation visibility is wrong: ${JSON.stringify(initial)}`);
    requireCondition((initial?.previousTriangles || "").includes("◀◀◀◀◀") && (initial?.nextTriangles || "").includes("▶▶▶▶▶"), `Five-triangle controls missing: ${JSON.stringify(initial)}`);

    await waitExpression(cdp, `Boolean(document.querySelector('.aroma-dual-entry')) && document.querySelectorAll('[data-aroma-sca-score]').length===2`, "aroma dual entry");
    const aromaUi = await cdp.evaluate(`(() => {
      const bridge=[...document.querySelectorAll('.aroma-dual-entry__bridge button')];
      const bridgeStyle=bridge[0]?getComputedStyle(bridge[0]):null;
      const tag=document.querySelector('[data-aroma-phase="shared"] .flavor-tag');
      const tagStyle=tag?getComputedStyle(tag):null;
      const floating=document.querySelector('.floating-note-trigger');
      return {
        bridgeText:bridge.map(n=>n.textContent?.trim()),
        bridgeBorder:bridgeStyle?.borderTopWidth||'',
        bridgeBackground:bridgeStyle?.backgroundColor||'',
        bridgeFont:bridgeStyle?.fontSize||'',
        tagBorder:tagStyle?.borderTopWidth||'',
        tagStyle:tagStyle?.borderStyle||'',
        tagRadius:tagStyle?.borderRadius||'',
        tagBackground:tagStyle?.backgroundColor||'',
        floatingText:floating?.textContent?.trim()||''
      };
    })()`);
    requireCondition(JSON.stringify(aromaUi?.bridgeText) === JSON.stringify(["⇄","←","→"]), `Bridge symbols are wrong: ${JSON.stringify(aromaUi)}`);
    requireCondition(aromaUi?.bridgeBorder === "0px" && aromaUi?.bridgeBackground === "rgba(0, 0, 0, 0)" && parseFloat(aromaUi?.bridgeFont || "0") >= 22, `Bridge controls retain icon/button chrome: ${JSON.stringify(aromaUi)}`);
    requireCondition(aromaUi?.tagStyle === "solid" && parseFloat(aromaUi?.tagBorder || "0") > 0 && parseFloat(aromaUi?.tagBorder || "99") <= 1 && aromaUi?.tagRadius !== "0px" && aromaUi?.tagBackground === "rgba(0, 0, 0, 0)", `Flavor tag boundary styling is wrong: ${JSON.stringify(aromaUi)}`);
    requireCondition(aromaUi?.floatingText.includes("✍"), `Aroma quick note missing: ${JSON.stringify(aromaUi)}`);

    await setAromaScore(cdp, "final_sca_affective_fragrance", 5);
    await setAromaScore(cdp, "final_sca_affective_aroma", 5);
    await setRangeByLabel(cdp, "干香强度", 6);
    await setRangeByLabel(cdp, "湿香强度", 7);
    await click(cdp, '[data-aroma-target="dry"]');
    await click(cdp, '[data-aroma-phase="shared"] .flavor-tag');
    await waitIdle(cdp, "dry aroma tag save");
    await click(cdp, '[data-aroma-target="wet"]');
    await click(cdp, '[data-aroma-phase="shared"] .flavor-tag');
    await waitIdle(cdp, "wet aroma tag save");
    await waitExpression(cdp, `document.querySelector('[data-stage-id="aroma"]')?.classList.contains('is-completed')===true`, "aroma complete");

    for (const stageId of ["high_temp", "mid_temp", "low_temp"]) {
      await click(cdp, `[data-stage-id="${stageId}"]`);
      await waitExpression(cdp, `document.querySelector('[data-stage-id="${stageId}"]')?.getAttribute('aria-current')==='step' && Boolean(document.querySelector('.cupping-main__editor .flavor-tag'))`, `${stageId} page`);
      await click(cdp, '.cupping-main__editor .flavor-tag');
      await waitIdle(cdp, `${stageId} flavor tag save`);
    }

    await click(cdp, '[data-stage-id="flavor"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="flavor"]')?.getAttribute('aria-current')==='step' && Boolean(document.querySelector('.flavor-replication'))`, "flavor replication page");
    const replication = await cdp.evaluate(`(() => ({
      labels:[...document.querySelectorAll('.flavor-replication__button')].map(n=>n.textContent?.trim()),
      enabled:[...document.querySelectorAll('.flavor-replication__button')].map(n=>!n.disabled)
    }))()`);
    requireCondition(JSON.stringify(replication?.labels) === JSON.stringify(["加载高温风味","加载中温风味","加载低温风味","全部加载"]), `Replication button labels are wrong: ${JSON.stringify(replication)}`);
    requireCondition(replication?.enabled?.length === 4 && replication.enabled.every(Boolean), `Replication buttons are unexpectedly disabled: ${JSON.stringify(replication)}`);
    await click(cdp, '.flavor-replication__button:last-child');
    await waitExpression(cdp, `Boolean(document.querySelector('.selected-tag-stack__item')) && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "load all temperature flavor tags");

    await click(cdp, '[data-stage-id="overall"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="overall"]')?.getAttribute('aria-current')==='step' && Boolean(document.querySelector('.cup-comparison'))`, "overall page");
    const overall = await cdp.evaluate(`(() => {
      const editor=document.querySelector('.cupping-main__editor');
      const quick=document.querySelector('.floating-note-trigger');
      const quickStyle=quick?getComputedStyle(quick):null;
      const duplicateKeys=['final_sca_affective_fragrance','final_sca_affective_aroma'];
      return {
        legacyPhaseNav:Boolean(editor?.querySelector('.final-assessment__phase-nav')),
        duplicateAromaInputs:duplicateKeys.filter(k=>editor?.querySelector('[data-field-key="'+k+'"]')).length,
        scaInputs:editor?.querySelectorAll('.final-assessment__sca-scale').length||0,
        body:editor?.textContent||'',
        quickBackground:quickStyle?.backgroundColor||'',
        quickColor:quickStyle?.color||'',
        quickBorder:quickStyle?.borderTopWidth||''
      };
    })()`);
    requireCondition(overall?.legacyPhaseNav === false, `Legacy 风味描述/综评/评分 nav remains on overall: ${JSON.stringify(overall)}`);
    requireCondition(overall?.duplicateAromaInputs === 0 && overall?.scaInputs === 6, `Overall still duplicates dry/wet score entry: ${JSON.stringify(overall)}`);
    requireCondition(overall?.quickBackground === "rgb(185, 153, 90)" && overall?.quickColor === "rgb(17, 17, 17)" && overall?.quickBorder === "0px", `Overall quick-record styling is wrong: ${JSON.stringify(overall)}`);

    for (const fieldKey of [
      "final_sca_affective_flavor", "final_sca_affective_aftertaste", "final_sca_affective_acidity",
      "final_sca_affective_sweetness", "final_sca_affective_mouthfeel", "final_sca_affective_overall"
    ]) {
      await setValue(cdp, `[data-field-key="${fieldKey}"] input`, 5);
      await waitExpression(cdp, `document.querySelector('[data-field-key="${fieldKey}"] .final-assessment__sca-scale-value')?.textContent?.trim()==='5' && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, `overall SCA ${fieldKey}`);
    }
    await setValue(cdp, '[data-field-key="quality_clean"] input', 8);
    await waitExpression(cdp, `document.querySelector('[data-field-key="quality_clean"] output')?.textContent?.trim()==='8' && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "quality clean");
    await waitExpression(cdp, `document.querySelector('.final-assessment__live-score-value')?.textContent?.trim()==='79.00'`, "aggregate SCA score 79");

    await click(cdp, '[data-stage-id="scoring"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="scoring"]')?.getAttribute('aria-current')==='step'`, "scoring page");
    const scoring = await cdp.evaluate(`(() => {
      const editor=document.querySelector('.cupping-main__editor');
      const next=document.querySelector('.cupping-nav--next');
      return {
        score:editor?.querySelector('.final-assessment__score-value')?.textContent?.trim()||'',
        legacyPhaseNav:Boolean(editor?.querySelector('.final-assessment__phase-nav')),
        hasConfirm:Boolean(editor?.querySelector('.final-assessment__score-confirm')),
        nextDisplay:next?getComputedStyle(next).display:'',
        hasRadar:Boolean(editor?.querySelector('[aria-label*="结构雷达图"]')),
        hasEvolution:Boolean(editor?.querySelector('.temperature-flavor-profile__canvas'))
      };
    })()`);
    requireCondition(scoring?.score === "79.00", `Scoring did not source aroma-stage dry/wet values: ${JSON.stringify(scoring)}`);
    requireCondition(scoring?.legacyPhaseNav === false && scoring?.hasConfirm === false, `Legacy scoring controls remain: ${JSON.stringify(scoring)}`);
    requireCondition(scoring?.nextDisplay === "none", `Right five-triangle group must disappear at scoring: ${JSON.stringify(scoring)}`);
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