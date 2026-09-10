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
      response.writeHead(200, { "content-type": MIME.get(extname(file).toLowerCase()) || "application/octet-stream", "cache-control": "no-store" });
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
  await waitExpression(cdp, `document.querySelector('[data-aroma-sca-score="${key}"] output')?.textContent?.trim()===${js(String(value))} && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, `aroma score ${key}`);
}
async function selectFlavorTag(cdp, selector) {
  await click(cdp, selector);
  await waitExpression(cdp, `document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, `flavor tag ${selector}`);
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
    await setValue(cdp, '[data-session-field="杯测会名称"] input', "Current Round Visible UI");
    await setValue(cdp, '[data-cupping-type="true"]', "competition");
    await waitExpression(cdp, `document.querySelector('[data-cupping-type="true"]')?.value==='competition'`, "competition cupping type selection");

    await click(cdp, '[aria-label="批量录入"]');
    await waitExpression(cdp, `Boolean(document.querySelector('[data-batch-intake-source="text"]'))`, "batch text-intake option");
    await click(cdp, '[data-batch-intake-source="text"]');
    await waitExpression(cdp, `Boolean(document.querySelector('.manual-import__textarea'))`, "manual text intake");
    await setValue(cdp, '.manual-import__textarea', "验收样品；埃塞俄比亚；古吉；水洗；浅烘；茉莉、柑橘");
    await click(cdp, '.manual-import__primary');
    await waitExpression(cdp, `Boolean(document.querySelector('.batch-setup__row.is-auto-accepted .batch-setup__sample-label')) && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "competition sample seeded from text intake");

    await click(cdp, ".batch-setup__start");
    await waitExpression(cdp, `document.querySelector('#app')?.dataset.screen==='cupping'`, "cupping screen");
    await waitExpression(cdp, `Boolean(document.querySelector('.competition-preflight__start'))`, "competition preflight");
    const preflight = await cdp.evaluate(`(() => ({
      count: document.querySelector('.competition-preflight__count')?.textContent?.trim() || '',
      notice: document.querySelector('.competition-preflight__notice')?.textContent?.trim() || '',
      timerVisible: getComputedStyle(document.querySelector('[data-cupping-timer]')).visibility
    }))()`);
    requireCondition(/共\s*1\s*只/.test(preflight?.count || "") && /电话、切后台或重新进入 App/.test(preflight?.notice || ""), `Competition preflight contract missing: ${JSON.stringify(preflight)}`);
    requireCondition(preflight?.timerVisible === "hidden", `Competition timer must stay hidden before start: ${JSON.stringify(preflight)}`);

    await click(cdp, ".competition-preflight__start");
    await waitExpression(cdp, `Boolean(document.querySelector('[data-stage-id="aroma"]')) && !document.querySelector('.competition-preflight__start')`, "started competition stage strip");

    const initial = await cdp.evaluate(`(() => {
      const steps=[...document.querySelectorAll('.cupping-stage-step')];
      const current=document.querySelector('.cupping-stage-step[aria-current="step"]');
      const timer=document.querySelector('[data-cupping-timer]');
      const previous=document.querySelector('.cupping-nav--previous');
      const next=document.querySelector('.cupping-nav--next');
      const centers=steps.map(step=>{
        const dot=step.querySelector('.cupping-stage-step__status-dot')?.getBoundingClientRect();
        const label=step.querySelector('.cupping-stage-step__label')?.getBoundingClientRect();
        const index=step.querySelector('.cupping-stage-step__index')?.getBoundingClientRect();
        const c=r=>r ? r.left+r.width/2 : 0;
        return [c(dot),c(label),c(index)];
      });
      return {
        ids: steps.map(n=>n.dataset.stageId),
        labels: steps.map(n=>n.querySelector('.cupping-stage-step__label')?.textContent?.trim()),
        indexes: steps.map(n=>n.querySelector('.cupping-stage-step__index')?.textContent?.trim()),
        indexBackgrounds: steps.map(n=>getComputedStyle(n.querySelector('.cupping-stage-step__index')).backgroundColor),
        centerDelta: Math.max(...centers.flatMap(v=>[Math.abs(v[0]-v[1]),Math.abs(v[1]-v[2]),Math.abs(v[0]-v[2])])),
        currentId: current?.dataset.stageId,
        currentClass: current?.className,
        currentHintVisibility: current ? getComputedStyle(current,'::after').visibility : '',
        timer: timer?.textContent?.replace(/\s+/g,' ').trim() || '',
        compactTimerLines: timer?.querySelectorAll('.cupping-rail-timer__compact-line').length || 0,
        previous: previous?.textContent?.trim() || '',
        next: next?.textContent?.trim() || '',
        previousDisplay: previous ? getComputedStyle(previous).display : '',
        nextDisplay: next ? getComputedStyle(next).display : '',
        previousTriangles: previous ? getComputedStyle(previous,'::before').content : '',
        nextTriangles: next ? getComputedStyle(next,'::before').content : '',
        stagePosition: getComputedStyle(document.querySelector('.cupping-main__stage-strip')).position
      };
    })()`);
    requireCondition(JSON.stringify(initial?.ids) === JSON.stringify(["aroma","high_temp","mid_temp","low_temp","flavor","overall","scoring"]), `Wrong formal stages: ${JSON.stringify(initial)}`);
    requireCondition(JSON.stringify(initial?.labels) === JSON.stringify(["香气","高温","中温","低温","风味","综评","评分"]), `Wrong visible stage labels: ${JSON.stringify(initial)}`);
    requireCondition(JSON.stringify(initial?.indexes) === JSON.stringify(["1","2","3","4","5","6","7"]), `Stage index circles missing: ${JSON.stringify(initial)}`);
    requireCondition(initial?.currentId === "aroma" && /is-not_started/.test(initial?.currentClass || ""), `Browsing incorrectly started aroma: ${JSON.stringify(initial)}`);
    requireCondition(initial?.currentHintVisibility === "hidden" && initial?.stagePosition === "relative", `Completion hint/gap cleanup is not active: ${JSON.stringify(initial)}`);
    requireCondition(/杯测计时/.test(initial?.timer || "") && initial?.compactTimerLines === 2, `Cupping timer/compact two-line contract missing: ${JSON.stringify(initial)}`);
    requireCondition(initial?.previous === "←" && initial?.next === "→" && initial?.previousDisplay === "none" && initial?.nextDisplay !== "none", `First-stage directional controls are wrong: ${JSON.stringify(initial)}`);
    requireCondition((initial?.previousTriangles || "").includes("◀◀◀◀◀") && (initial?.nextTriangles || "").includes("▶▶▶▶▶"), `Five-triangle navigation is missing: ${JSON.stringify(initial)}`);
    requireCondition((initial?.centerDelta ?? 99) <= 1.2, `Stage dot/label/index centers are misaligned: ${JSON.stringify(initial)}`);
    requireCondition(initial?.indexBackgrounds?.[0] !== initial?.indexBackgrounds?.[1], `Current index circle must be filled while inactive indexes stay hollow: ${JSON.stringify(initial)}`);

    await click(cdp, "[data-rail-toggle]");
    const legend = await waitExpression(cdp, `(() => {
      const node=document.querySelector('.cupping-progress-legend');
      return node ? node.textContent?.replace(/\s+/g,' ').trim() : false;
    })()`, "three-state legend");
    requireCondition(/灰色\s*未开始/.test(legend) && /浅蓝\s*已开始/.test(legend) && /绿色\s*已完成/.test(legend), `Progress legend incomplete: ${legend}`);

    await click(cdp, '[data-stage-id="aroma"]');
    await waitExpression(cdp, `Boolean(document.querySelector('.aroma-dual-entry')) && Boolean(document.querySelector('[data-aroma-sca-score="final_sca_affective_fragrance"]'))`, "dual aroma editor");
    const aromaLayout = await cdp.evaluate(`(() => {
      const bridge=[...document.querySelectorAll('.aroma-dual-entry__bridge button')];
      const tag=document.querySelector('[data-aroma-phase="shared"] .flavor-tag');
      const tagStyle=tag ? getComputedStyle(tag) : null;
      const bridgeStyle=bridge[0] ? getComputedStyle(bridge[0]) : null;
      return {
        targets: document.querySelectorAll('[data-aroma-target]').length,
        active: document.querySelector('.aroma-target.is-active')?.dataset.aromaTarget,
        bridgeCount: bridge.length,
        bridgeText: bridge.map(n=>n.textContent?.trim()),
        bridgeBorder: bridgeStyle?.borderTopWidth || '',
        bridgeBackground: bridgeStyle?.backgroundColor || '',
        aromaScores: document.querySelectorAll('[data-aroma-sca-score]').length,
        phaseNav: Boolean(document.querySelector('.final-assessment__phase-nav')),
        tagBorder: tagStyle?.borderStyle || '',
        tagRadius: tagStyle?.borderRadius || '',
        tagBackground: tagStyle?.backgroundColor || '',
        noteButton: document.querySelector('.floating-note-trigger')?.textContent?.trim() || ''
      };
    })()`);
    requireCondition(aromaLayout?.targets === 2 && aromaLayout?.active === "dry" && aromaLayout?.bridgeCount === 3 && aromaLayout?.aromaScores === 2, `Dual aroma layout is incomplete: ${JSON.stringify(aromaLayout)}`);
    requireCondition(JSON.stringify(aromaLayout?.bridgeText) === JSON.stringify(["⇄","←","→"]) && aromaLayout?.bridgeBorder === "0px" && aromaLayout?.bridgeBackground === "rgba(0, 0, 0, 0)", `Dry/wet symbol bridge is not edge-clean: ${JSON.stringify(aromaLayout)}`);
    requireCondition(aromaLayout?.tagBorder === "solid" && aromaLayout?.tagRadius !== "0px" && aromaLayout?.tagBackground === "rgba(0, 0, 0, 0)", `Flavor tag outline/no-fill contract missing: ${JSON.stringify(aromaLayout)}`);
    requireCondition(aromaLayout?.noteButton.includes("✍"), `Aroma floating note button missing: ${JSON.stringify(aromaLayout)}`);

    await setAromaScore(cdp, "final_sca_affective_fragrance", 5);
    await setAromaScore(cdp, "final_sca_affective_aroma", 5);
    await setRangeByLabel(cdp, "干香强度", "6");
    await waitExpression(cdp, `document.querySelector('[data-stage-id="aroma"]')?.classList.contains('is-active')===true && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "aroma active state");
    const activeBorder = await cdp.evaluate(`getComputedStyle(document.querySelector('[data-stage-id="aroma"]')).borderBottomColor`);
    await setRangeByLabel(cdp, "湿香强度", "7");
    await click(cdp, '[data-aroma-target="dry"]');
    await selectFlavorTag(cdp, '[data-aroma-phase="shared"] .flavor-tag');
    await click(cdp, '[data-aroma-target="wet"]');
    await selectFlavorTag(cdp, '[data-aroma-phase="shared"] .flavor-tag');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="aroma"]')?.classList.contains('is-completed')===true`, "aroma completed state");
    const completedState = await cdp.evaluate(`(() => {
      const step=document.querySelector('[data-stage-id="aroma"]');
      const dot=step?.querySelector('.cupping-stage-step__status-dot');
      return { border: step ? getComputedStyle(step).borderBottomColor : '', animationName: dot ? getComputedStyle(dot).animationName : '', animationDuration: dot ? getComputedStyle(dot).animationDuration : '' };
    })()`);
    requireCondition(completedState?.border !== activeBorder, `Completed state did not visibly change progress color: ${JSON.stringify(completedState)}`);
    requireCondition(/aromasense-stage-completion-triple-flash/.test(completedState?.animationName || "") && completedState?.animationDuration === "2.1s", `Latest triple-flash animation not active: ${JSON.stringify(completedState)}`);

    const tempStages = [
      ["high_temp", 0],
      ["mid_temp", 1],
      ["low_temp", 2]
    ];
    for (const [stageId, tagIndex] of tempStages) {
      await click(cdp, `[data-stage-id="${stageId}"]`);
      await waitExpression(cdp, `document.querySelector('[data-stage-id="${stageId}"]')?.getAttribute('aria-current')==='step'`, `${stageId} selection`);
      const selector = `.cupping-main__editor .flavor-tag-item:nth-of-type(${Number(tagIndex) + 1}) .flavor-tag`;
      const exists = await cdp.evaluate(`Boolean(document.querySelector(${js(selector)}))`);
      if (exists) await selectFlavorTag(cdp, selector);
      else await selectFlavorTag(cdp, '.cupping-main__editor .flavor-tag');
    }

    await click(cdp, '[data-stage-id="flavor"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="flavor"]')?.getAttribute('aria-current')==='step' && Boolean(document.querySelector('.flavor-replication'))`, "flavor replication controls");
    const flavorReplication = await cdp.evaluate(`(() => ({
      labels:[...document.querySelectorAll('.flavor-replication__button')].map(n=>n.textContent?.trim()),
      enabled:[...document.querySelectorAll('.flavor-replication__button')].map(n=>!n.disabled)
    }))()`);
    requireCondition(JSON.stringify(flavorReplication?.labels) === JSON.stringify(["加载高温风味","加载中温风味","加载低温风味","全部加载"]), `Four flavor replication buttons are wrong: ${JSON.stringify(flavorReplication)}`);
    requireCondition(flavorReplication?.enabled?.every(Boolean) === true, `Flavor replication source buttons should be available: ${JSON.stringify(flavorReplication)}`);
    await click(cdp, '.flavor-replication__button:last-child');
    await waitExpression(cdp, `document.querySelector('.selected-tag-stack__item') && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "all flavor tags loaded");

    await click(cdp, '[data-stage-id="overall"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="overall"]')?.getAttribute('aria-current')==='step' && Boolean(document.querySelector('.cup-comparison'))`, "overall selection");
    const overall = await cdp.evaluate(`(() => {
      const editor=document.querySelector('.cupping-main__editor');
      const quick=document.querySelector('.floating-note-trigger');
      const quickStyle=quick ? getComputedStyle(quick) : null;
      return {
        cls: document.querySelector('[data-stage-id="overall"]')?.className,
        body: editor?.textContent || '',
        phaseNav: Boolean(editor?.querySelector('.final-assessment__phase-nav')),
        aromaInputs: ['final_sca_affective_fragrance','final_sca_affective_aroma'].filter(k=>editor?.querySelector(`[data-field-key="${k}"]`)).length,
        scaInputs: editor?.querySelectorAll('.final-assessment__sca-scale').length || 0,
        cupCount: document.querySelector('.cup-comparison__count')?.dataset.sampleCupCount || '',
        disabled: [...document.querySelectorAll('.cup-comparison__row input')].every((node)=>node.disabled),
        quickBackground: quickStyle?.backgroundColor || '',
        quickColor: quickStyle?.color || '',
        quickBorder: quickStyle?.borderTopWidth || ''
      };
    })()`);
    requireCondition(/is-not_started|is-active/.test(overall?.cls || ""), `Overall stage status is invalid: ${JSON.stringify(overall)}`);
    requireCondition(overall?.phaseNav === false && overall?.aromaInputs === 0 && overall?.scaInputs === 6, `Overall still exposes legacy phase nav or duplicate dry/wet scoring: ${JSON.stringify(overall)}`);
    requireCondition(/具体缺陷\s*\/\s*异味记录/.test(overall?.body || ""), `Overall does not visibly expose defect/off-flavor section: ${JSON.stringify(overall)}`);
    requireCondition(overall?.cupCount === "1" && overall?.disabled === true, `Single-cup comparison controls are not disabled/clean: ${JSON.stringify(overall)}`);
    requireCondition(overall?.quickBackground === "rgb(185, 153, 90)" && overall?.quickColor === "rgb(17, 17, 17)" && overall?.quickBorder === "0px", `Overall quick-record button styling is wrong: ${JSON.stringify(overall)}`);

    const overallFields = [
      "final_sca_affective_flavor", "final_sca_affective_aftertaste", "final_sca_affective_acidity",
      "final_sca_affective_sweetness", "final_sca_affective_mouthfeel", "final_sca_affective_overall"
    ];
    for (const fieldKey of overallFields) {
      await setValue(cdp, `[data-field-key="${fieldKey}"] input`, "5");
      await waitExpression(cdp, `document.querySelector('[data-field-key="${fieldKey}"] .final-assessment__sca-scale-value')?.textContent?.trim()==='5' && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, `SCA field ${fieldKey}`);
    }
    await setValue(cdp, '[data-field-key="quality_clean"] input', "8");
    await waitExpression(cdp, `document.querySelector('[data-field-key="quality_clean"] output')?.textContent?.trim()==='8' && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "AromaSense cleanliness profile");
    await waitExpression(cdp, `document.querySelector('.final-assessment__live-score-value')?.textContent?.trim()==='79.00'`, "complete aggregate SCA 79.00 score");

    await click(cdp, '[data-stage-id="scoring"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="scoring"]')?.getAttribute('aria-current')==='step'`, "scoring selection");
    const scoring = await cdp.evaluate(`(() => {
      const editor=document.querySelector('.cupping-main__editor');
      const next=document.querySelector('.cupping-nav--next');
      return {
        body: editor?.textContent || '',
        score: editor?.querySelector('.final-assessment__score-value')?.textContent?.trim() || '',
        missing: editor?.querySelector('.scoring-missing-fields')?.textContent?.trim() || '',
        phaseNav: Boolean(editor?.querySelector('.final-assessment__phase-nav')),
        hasConfirm: Boolean(editor?.querySelector('.final-assessment__score-confirm')),
        hasLockBanner: Boolean(document.querySelector('.cupping-main__lock-status')),
        readonly: editor?.getAttribute('aria-readonly') || '',
        hasRadar: Boolean(editor?.querySelector('[aria-label*="结构雷达图"]')),
        hasEvolution: Boolean(editor?.querySelector('.temperature-flavor-profile__canvas')),
        nextDisplay: next ? getComputedStyle(next).display : ''
      };
    })()`);
    requireCondition(scoring?.score === "79.00", `SCA score did not use aroma-node dry/wet values: ${JSON.stringify(scoring)}`);
    requireCondition(scoring?.phaseNav === false, `Legacy 风味描述/综评/评分 phase navigation remains on scoring: ${JSON.stringify(scoring)}`);
    requireCondition(scoring?.hasConfirm === false && scoring?.hasLockBanner === false && scoring?.readonly !== "true", `Scoring must stay live/editable until whole-session competition completion: ${JSON.stringify(scoring)}`);
    requireCondition(scoring?.nextDisplay === "none", `Right triangle group must disappear on scoring: ${JSON.stringify(scoring)}`);
    requireCondition(/填充色仅表达风味倾向，不表示温度、质量或得分/.test(scoring?.body || ""), `Flavor-color semantics are missing: ${JSON.stringify(scoring)}`);
    requireCondition(scoring?.hasRadar === true && scoring?.hasEvolution === true, `Sensory conclusion charts are missing: ${JSON.stringify(scoring)}`);

    const relevantErrors = cdp.errors.filter((entry) => !/favicon|Failed to load resource.*404|onnxruntime/i.test(entry));
    requireCondition(relevantErrors.length === 0, `Browser errors:\n${relevantErrors.join("\n")}`);

    console.log("AromaSense current-round visible UI acceptance: PASS");
    console.log(JSON.stringify({ preflight, initial, legend, aromaLayout, completedState, flavorReplication, overall, scoring }, null, 2));
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