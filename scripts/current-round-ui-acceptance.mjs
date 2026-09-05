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
    const field=[...document.querySelectorAll('.sensory-field')].find((node)=>node.querySelector('.sensory-field__label')?.textContent?.trim()===${js(label)});
    const input=field?.querySelector('.sensory-range__input');
    if(!(input instanceof HTMLInputElement)) return false;
    input.value=${js(String(value))};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return input.value;
  })()`);
  requireCondition(result === String(value), `Unable to set range field ${label}`);
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

    await click(cdp, '[data-home-action="manual-entry"]');
    const manual = await cdp.evaluate(`(() => ({
      textarea: Boolean(document.querySelector('.manual-import__textarea')),
      hint: document.querySelector('.manual-import__hint')?.textContent?.trim() || ''
    }))()`);
    requireCondition(manual?.textarea === true && /每个豆子一行/.test(manual?.hint || ""), `Manual intake contract not visible: ${JSON.stringify(manual)}`);
    await click(cdp, ".manual-import__close");

    await setValue(cdp, '[data-session-field="组织方"] input', "AromaSense UI Acceptance");
    await setValue(cdp, '[data-session-field="杯测会名称"] input', "Current Round Visible UI");
    await click(cdp, 'button[data-cupping-target="blind"]');
    await click(cdp, ".batch-setup__start");
    await waitExpression(cdp, `Boolean(document.querySelector('.cupping-count-dialog__input'))`, "blind sample dialog");
    await setValue(cdp, ".cupping-count-dialog__input", "1");
    await click(cdp, ".cupping-count-dialog__confirm");
    await waitExpression(cdp, `document.querySelector('#app')?.dataset.screen==='cupping'`, "cupping screen");
    await click(cdp, ".sample-rail__select");
    await waitExpression(cdp, `Boolean(document.querySelector('[data-stage-id="aroma"]'))`, "formal stage strip");

    const initial = await cdp.evaluate(`(() => {
      const steps=[...document.querySelectorAll('.cupping-stage-step')];
      const current=document.querySelector('.cupping-stage-step[aria-current="step"]');
      const timer=document.querySelector('[data-cupping-timer]');
      return {
        ids: steps.map(n=>n.dataset.stageId), labels: steps.map(n=>n.textContent?.trim()),
        currentId: current?.dataset.stageId, currentClass: current?.className,
        currentHint: current ? getComputedStyle(current,'::after').content : '',
        currentBorder: current ? getComputedStyle(current).borderBottomColor : '',
        timer: timer?.textContent?.replace(/\\s+/g,' ').trim() || '',
        compactTimerLines: timer?.querySelectorAll('.cupping-rail-timer__compact-line').length || 0
      };
    })()`);
    requireCondition(JSON.stringify(initial?.ids) === JSON.stringify(["aroma","high_temp","mid_temp","low_temp","flavor","overall","scoring"]), `Wrong formal stages: ${JSON.stringify(initial)}`);
    requireCondition(JSON.stringify(initial?.labels) === JSON.stringify(["香气","高温","中温","低温","风味","综评","评分"]), `Wrong visible stage labels: ${JSON.stringify(initial)}`);
    requireCondition(initial?.currentId === "aroma" && /is-not_started/.test(initial?.currentClass || ""), `Browsing incorrectly started aroma: ${JSON.stringify(initial)}`);
    requireCondition(/未开始/.test(initial?.currentHint || "") && /完成标准/.test(initial?.currentHint || ""), `Current completion criterion is not visibly rendered: ${JSON.stringify(initial)}`);
    requireCondition(/杯测计时/.test(initial?.timer || "") && initial?.compactTimerLines === 2, `Cupping timer/compact two-line contract missing: ${JSON.stringify(initial)}`);

    await click(cdp, "[data-rail-toggle]");
    const legend = await waitExpression(cdp, `(() => {
      const node=document.querySelector('.cupping-progress-legend');
      return node ? node.textContent?.replace(/\\s+/g,' ').trim() : false;
    })()`, "three-state legend");
    requireCondition(/灰色\s*未开始/.test(legend) && /浅蓝\s*已开始/.test(legend) && /绿色\s*已完成/.test(legend), `Progress legend incomplete: ${legend}`);

    await click(cdp, '[data-stage-id="overall"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="overall"]')?.getAttribute('aria-current')==='step'`, "overall selection");
    const overall = await cdp.evaluate(`(() => ({
      cls: document.querySelector('[data-stage-id="overall"]')?.className,
      body: document.querySelector('.cupping-main__editor')?.textContent || ''
    }))()`);
    requireCondition(/is-not_started/.test(overall?.cls || ""), `Browsing incorrectly started overall: ${JSON.stringify(overall)}`);
    requireCondition(/缺陷与异味/.test(overall?.body || ""), `Overall does not visibly expose defect/off-flavor section: ${JSON.stringify(overall)}`);

    await click(cdp, '[data-stage-id="aroma"]');
    await waitExpression(cdp, `Boolean(document.querySelector('.sensory-range__input'))`, "aroma editor");
    await setRangeByLabel(cdp, "湿香强度", "7");
    await waitExpression(cdp, `document.querySelector('[data-stage-id="aroma"]')?.classList.contains('is-active')===true && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "aroma active state");
    const activeBorder = await cdp.evaluate(`getComputedStyle(document.querySelector('[data-stage-id="aroma"]')).borderBottomColor`);
    requireCondition(activeBorder !== initial?.currentBorder, `Started state did not visibly change progress color: ${activeBorder}`);

    const groupTitle = await cdp.evaluate(`document.querySelector('.flavor-group__title')?.getAttribute('aria-expanded')`);
    if (groupTitle !== "true") {
      await click(cdp, ".flavor-group__title");
      await waitExpression(cdp, `Boolean(document.querySelector('.flavor-tag'))`, "expanded flavor group");
    }
    await click(cdp, ".flavor-tag");
    await waitExpression(cdp, `document.querySelector('[data-stage-id="aroma"]')?.classList.contains('is-completed')===true && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "aroma completed state");
    const completedBorder = await cdp.evaluate(`getComputedStyle(document.querySelector('[data-stage-id="aroma"]')).borderBottomColor`);
    requireCondition(completedBorder !== activeBorder, `Completed state did not visibly change progress color: ${completedBorder}`);
    const aromaStamp = await cdp.evaluate(`document.querySelector('[data-stage-completion="aroma"]')?.textContent?.replace(/\\s+/g,' ').trim() || ''`);
    requireCondition(/本进程完成/.test(aromaStamp) && /分\s*\d{2}秒/.test(aromaStamp) && /\d{2}:\d{2}/.test(aromaStamp), `Aroma completion timestamp missing: ${aromaStamp}`);

    await click(cdp, '[data-stage-id="scoring"]');
    await waitExpression(cdp, `document.querySelector('[data-stage-id="scoring"]')?.getAttribute('aria-current')==='step'`, "scoring selection");
    const scoring = await cdp.evaluate(`(() => {
      const editor=document.querySelector('.cupping-main__editor');
      const confirm=editor?.querySelector('.final-assessment__score-confirm');
      const style=confirm ? getComputedStyle(confirm) : null;
      return {
        body: editor?.textContent || '',
        label: confirm?.textContent?.trim() || '',
        fontSize: style?.fontSize || '',
        fontWeight: style?.fontWeight || '',
        textAlign: style?.textAlign || ''
      };
    })()`);
    requireCondition(/确认得分/.test(scoring?.label || ""), `Scoring step does not expose explicit score confirmation: ${JSON.stringify(scoring)}`);
    requireCondition(/确认得分后，本样品杯测记录将被锁定，无法修改/.test(scoring?.body || ""), `Score lock warning is missing: ${JSON.stringify(scoring)}`);
    requireCondition(parseFloat(scoring?.fontSize || "0") >= 18 && Number(scoring?.fontWeight || 0) >= 700 && scoring?.textAlign === "center", `Score confirmation is not large/bold/centered: ${JSON.stringify(scoring)}`);

    await click(cdp, ".final-assessment__score-confirm");
    await waitExpression(cdp, `document.querySelector('.cupping-main__lock-status')?.textContent?.includes('已锁定为只读')===true && document.querySelector('#app')?.getAttribute('aria-busy')!=='true'`, "score-confirmed sample lock");
    const locked = await cdp.evaluate(`(() => ({
      banner: document.querySelector('.cupping-main__lock-status')?.textContent?.trim() || '',
      confirm: document.querySelector('.final-assessment__score-confirm')?.textContent?.trim() || '',
      stamp: document.querySelector('.cupping-completion-stamp')?.textContent?.replace(/\\s+/g,' ').trim() || '',
      readonly: document.querySelector('.cupping-main__editor')?.getAttribute('aria-readonly') || ''
    }))()`);
    requireCondition(/得分已确认/.test(locked?.confirm || "") && locked?.readonly === "true", `Score confirmation did not lock the sample: ${JSON.stringify(locked)}`);
    requireCondition(/本分支完成/.test(locked?.stamp || "") && /\d{2}:\d{2}/.test(locked?.stamp || ""), `Score branch completion timestamp missing: ${JSON.stringify(locked)}`);

    const relevantErrors = cdp.errors.filter((entry) => !/favicon|Failed to load resource.*404|onnxruntime/i.test(entry));
    requireCondition(relevantErrors.length === 0, `Browser errors:\n${relevantErrors.join("\n")}`);

    console.log("AromaSense current-round visible UI acceptance: PASS");
    console.log(JSON.stringify({ initial, legend, overallClass: overall.cls, activeBorder, completedBorder, aromaStamp, scoring, locked }, null, 2));
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
