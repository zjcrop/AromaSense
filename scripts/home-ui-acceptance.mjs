import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const site = resolve(root, "site");
const TIMEOUT_MS = 30_000;
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
    if (spawnSync(executable, ["--version"], { encoding: "utf8" }).status === 0) return executable;
  }
  throw new Error("Chrome/Chromium is required for home UI acceptance");
}

async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Unable to allocate Chrome port");
  const port = address.port;
  await new Promise((ok) => server.close(ok));
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
      response.writeHead(200, { "content-type": MIME.get(extname(file).toLowerCase()) || "application/octet-stream", "cache-control": "no-store" });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    }
  });
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Static server did not expose port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function waitUntil(check, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(`${label} timed out`);
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.errors = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => this.message(String(event.data)));
    await new Promise((ok, fail) => {
      this.ws.addEventListener("open", ok, { once: true });
      this.ws.addEventListener("error", () => fail(new Error("CDP websocket failed")), { once: true });
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

async function runAcceptance(appUrl) {
  const executable = chromeExecutable();
  const port = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), "aromasense-home-ui-"));
  const chrome = spawn(executable, [
    "--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox",
    "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let cdp;
  try {
    await waitUntil(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, "Chrome debugging startup");
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" });
    requireCondition(targetResponse.ok, `Chrome target HTTP ${targetResponse.status}`);
    const target = await targetResponse.json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Log.enable")]);
    await waitUntil(async () => (await cdp.evaluate(`document.querySelector('#app')?.dataset.screen==='setup'`)) === true, "setup screen");

    const home = await cdp.evaluate(`(() => {
      const actionNodes=[...document.querySelectorAll('.batch-setup__capture-actions button')];
      const capture=actionNodes.map(n=>n.textContent?.trim());
      const captureStyles=actionNodes.map(n=>{const s=getComputedStyle(n);return {text:n.textContent?.trim(),className:n.className,background:s.backgroundColor,border:s.border,color:s.color,height:n.getBoundingClientRect().height}});
      const footer=[...document.querySelectorAll('.batch-setup__footer-section > button')].map(n=>n.textContent?.trim());
      const header=[...document.querySelectorAll('.batch-setup__header-actions button')].map(n=>n.textContent?.trim());
      const start=document.querySelector('[data-home-action="start-cupping"]');
      const brand=document.querySelector('.batch-setup__brand');
      const chinese=document.querySelector('.batch-setup__brand-zh');
      const english=document.querySelector('.batch-setup__brand-en');
      const logo=document.querySelector('.batch-setup__brand-mark');
      const headerActions=document.querySelector('.batch-setup__header-actions');
      const viewportCenter=document.documentElement.clientWidth/2;
      const centerOf=(node)=>node ? (node.getBoundingClientRect().left+node.getBoundingClientRect().right)/2 : NaN;
      const logoRect=logo?.getBoundingClientRect();
      return {
        capture, captureStyles, footer, header,
        hasPhoto:capture.includes('拍摄录入'),
        hasDirectHistory:Boolean(document.querySelector('.batch-setup__history,.batch-setup__recent')),
        startFont:start ? parseFloat(getComputedStyle(start).fontSize) : 0,
        startHeight:start ? start.getBoundingClientRect().height : 0,
        brandGeometry:{
          viewportCenter,
          brandCenter:centerOf(brand),
          chineseCenter:centerOf(chinese),
          englishCenter:centerOf(english),
          brandError:Math.abs(centerOf(brand)-viewportCenter),
          chineseError:Math.abs(centerOf(chinese)-viewportCenter),
          englishError:Math.abs(centerOf(english)-viewportCenter),
          chineseGlyphs:[...document.querySelectorAll('.batch-setup__brand-zh > span')].map(n=>n.textContent),
          logoTag:logo?.tagName || '',
          logoWidth:logoRect?.width || 0,
          logoHeight:logoRect?.height || 0,
          accountLayerPosition:headerActions ? getComputedStyle(headerActions).position : ''
        }
      };
    })()`);

    requireCondition(JSON.stringify(home?.capture) === JSON.stringify(["批量识别","手工录入","清空列表","导入数据"]), `Wrong homepage actions: ${JSON.stringify(home)}`);
    requireCondition(JSON.stringify(home?.footer) === JSON.stringify(["开始杯测","记录"]), `Wrong footer actions: ${JSON.stringify(home)}`);
    requireCondition(JSON.stringify(home?.header) === JSON.stringify(["账户"]), `Header should only retain account action: ${JSON.stringify(home)}`);
    requireCondition(home?.hasPhoto === false, `拍摄录入 still visible: ${JSON.stringify(home)}`);
    requireCondition(home?.hasDirectHistory === false, `History still rendered directly on homepage: ${JSON.stringify(home)}`);
    requireCondition(home?.startFont >= 20 && home?.startHeight >= 60, `Start action is not visually dominant: ${JSON.stringify(home)}`);
    const styleKeys = (home?.captureStyles ?? []).map((item) => JSON.stringify({className:item.className,background:item.background,border:item.border,color:item.color,height:item.height}));
    requireCondition(styleKeys.length === 4 && new Set(styleKeys).size === 1, `Four home intake actions are not visually identical: ${JSON.stringify(home?.captureStyles)}`);
    requireCondition(home?.brandGeometry?.logoTag?.toLowerCase() === "svg" && home?.brandGeometry?.logoWidth >= 80 && home?.brandGeometry?.logoHeight >= 65, `AromaSense logo is missing or too small: ${JSON.stringify(home?.brandGeometry)}`);
    requireCondition(JSON.stringify(home?.brandGeometry?.chineseGlyphs) === JSON.stringify(["香","迹"]), `Chinese brand is not split into stable centered glyphs: ${JSON.stringify(home?.brandGeometry)}`);
    requireCondition(home?.brandGeometry?.accountLayerPosition === "absolute", `Account action still participates in brand centering flow: ${JSON.stringify(home?.brandGeometry)}`);
    requireCondition(home?.brandGeometry?.brandError <= 1.5 && home?.brandGeometry?.chineseError <= 1.5 && home?.brandGeometry?.englishError <= 1.5, `Homepage brand is not geometrically centered: ${JSON.stringify(home?.brandGeometry)}`);

    const opened = await cdp.evaluate(`(() => { const n=document.querySelector('[data-home-action="records"]'); if(!(n instanceof HTMLElement)) return false; n.click(); return true; })()`);
    requireCondition(opened === true, "Unable to expand records from footer");
    await waitUntil(async () => Boolean(await cdp.evaluate(`(() => { const menu=document.querySelector('[data-home-records-menu]'); return menu && !menu.hidden; })()`)), "records submenu");

    const expanded = await cdp.evaluate(`(() => ({
      expanded:document.querySelector('[data-home-action="records"]')?.getAttribute('aria-expanded'),
      labels:[...document.querySelectorAll('[data-home-record-scope]')].map(n=>n.textContent?.trim()),
      ids:[...document.querySelectorAll('[data-home-record-scope]')].map(n=>n.dataset.homeRecordScope),
      visible:!document.querySelector('[data-home-records-menu]')?.hidden
    }))()`);
    requireCondition(expanded?.expanded === "true" && expanded?.visible === true, `Record submenu did not expand below button: ${JSON.stringify(expanded)}`);
    requireCondition(JSON.stringify(expanded?.ids) === JSON.stringify(["unfinished","completed"]), `Record submenu scopes missing: ${JSON.stringify(expanded)}`);
    requireCondition(JSON.stringify(expanded?.labels) === JSON.stringify(["未完成记录","已完成记录"]), `Record submenu labels wrong: ${JSON.stringify(expanded)}`);

    const openCompleted = await cdp.evaluate(`(() => { const n=document.querySelector('[data-home-record-scope="completed"]'); if(!(n instanceof HTMLElement)) return false; n.click(); return true; })()`);
    requireCondition(openCompleted === true, "Unable to open completed records page");
    await waitUntil(async () => Boolean(await cdp.evaluate(`document.querySelector('.home-modal .session-records__scopes')`)), "completed records modal");
    await waitUntil(async () => (await cdp.evaluate(`document.querySelector('.home-modal [data-record-scope-tab].is-active')?.dataset.recordScopeTab`)) === "completed", "completed records scope");

    const completed = await cdp.evaluate(`(() => ({
      active:document.querySelector('.home-modal [data-record-scope-tab].is-active')?.dataset.recordScopeTab,
      scope:document.querySelector('.home-modal .session-records__list')?.dataset.recordScope
    }))()`);
    requireCondition(completed?.active === "completed" && completed?.scope === "completed", `Completed record page was not selected: ${JSON.stringify(completed)}`);

    const closeCompleted = await cdp.evaluate(`(() => { const n=document.querySelector('.home-modal .session-records__back'); if(!(n instanceof HTMLElement)) return false; n.click(); return true; })()`);
    requireCondition(closeCompleted === true, "Unable to close completed records page");
    await waitUntil(async () => (await cdp.evaluate(`Boolean(document.querySelector('.home-modal'))`)) === false, "completed records close");

    await cdp.evaluate(`document.querySelector('[data-home-action="records"]')?.click()`);
    await waitUntil(async () => Boolean(await cdp.evaluate(`(() => { const menu=document.querySelector('[data-home-records-menu]'); return menu && !menu.hidden; })()`)), "records submenu reopen");
    const openUnfinished = await cdp.evaluate(`(() => { const n=document.querySelector('[data-home-record-scope="unfinished"]'); if(!(n instanceof HTMLElement)) return false; n.click(); return true; })()`);
    requireCondition(openUnfinished === true, "Unable to open unfinished records page");
    await waitUntil(async () => (await cdp.evaluate(`document.querySelector('.home-modal [data-record-scope-tab].is-active')?.dataset.recordScopeTab`)) === "unfinished", "unfinished records scope");

    const unfinished = await cdp.evaluate(`(() => ({
      active:document.querySelector('.home-modal [data-record-scope-tab].is-active')?.dataset.recordScopeTab,
      scope:document.querySelector('.home-modal .session-records__list')?.dataset.recordScope
    }))()`);
    requireCondition(unfinished?.active === "unfinished" && unfinished?.scope === "unfinished", `Unfinished record page was not selected: ${JSON.stringify(unfinished)}`);

    const relevantErrors = cdp.errors.filter((entry) => !/favicon|Failed to load resource.*404|onnxruntime/i.test(entry));
    requireCondition(relevantErrors.length === 0, `Browser errors:\n${relevantErrors.join("\n")}`);
    console.log("AromaSense home UI acceptance: PASS");
    console.log(JSON.stringify({ home, expanded, completed, unfinished }, null, 2));
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    await Promise.race([new Promise((ok) => chrome.once("exit", ok)), delay(3000)]);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true });
  }
}

const { server, url } = await startStaticServer();
try { await runAcceptance(url); }
finally { await new Promise((ok) => server.close(ok)); }