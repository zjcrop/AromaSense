from pathlib import Path
import re

def replace1(path, old, new):
    p = Path(path)
    text = p.read_text()
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected 1 literal match, got {n}: {old[:200]!r}")
    p.write_text(text.replace(old, new, 1))

def sub1(path, pattern, replacement):
    p = Path(path)
    text = p.read_text()
    out, n = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f"{path}: expected 1 regex match, got {n}: {pattern[:200]!r}")
    p.write_text(out)

stable = "app/ui/dom/stable-cupping-screen-renderer.ts"

replace1(stable,
    "interface ManagerMessage { text: string; error?: boolean; }",
    '''interface ManagerMessage { text: string; error?: boolean; }
interface RuntimeRecognitionDraft {
  version: 1;
  sessionId: string;
  page: RecognizedPage;
  index: number;
  addedSampleIds: string[];
  preview?: string;
  updatedAt: string;
}''')

replace1(stable,
    "    .free-cupping-manager__add{width:100%;min-height:42px;margin:0 0 12px;border:1px solid rgba(214,173,99,.36);border-radius:8px;background:#1c1c1c;color:#d6ad63;font:inherit;font-weight:750;cursor:pointer}",
    '''    .free-cupping-manager__add,.free-cupping-manager__resume{width:100%;min-height:42px;margin:0 0 12px;border:1px solid rgba(214,173,99,.36);border-radius:8px;background:#1c1c1c;color:#d6ad63;font:inherit;font-weight:750;cursor:pointer}
    .free-cupping-manager__resume{margin-top:-4px;border-color:rgba(131,185,230,.34);color:#9fc8eb;background:#181c20}''')

replace1(stable,
    '''    .cupping-layout__rail-list.sample-rail{overflow-x:hidden!important;overflow-y:auto!important;touch-action:pan-y!important;overscroll-behavior-y:contain!important;scroll-behavior:smooth!important;-webkit-overflow-scrolling:touch;scrollbar-width:thin}
    .sample-rail__active-tab{display:none!important}
    .sample-rail__item.is-active::before{content:"";position:absolute;z-index:1;inset:1px -4px 1px -6px;border:1px solid rgba(214,173,99,.34);border-left:0;border-radius:0 999px 999px 0;background:linear-gradient(90deg,rgba(104,78,39,.96),rgba(128,95,45,.96));box-shadow:0 4px 14px rgba(0,0,0,.24),inset -1px 0 0 rgba(255,255,255,.08);pointer-events:none}''',
    '''    .cupping-layout__rail{position:relative!important;overflow:visible!important}
    .cupping-layout__rail-list.sample-rail{position:relative!important;z-index:2!important;overflow-x:hidden!important;overflow-y:auto!important;touch-action:pan-y!important;overscroll-behavior-y:contain!important;scroll-behavior:smooth!important;-webkit-overflow-scrolling:touch;scrollbar-width:none!important;-ms-overflow-style:none!important}
    .cupping-layout__rail-list.sample-rail::-webkit-scrollbar,.cupping-main__editor::-webkit-scrollbar,.batch-review__panel::-webkit-scrollbar,.free-cupping-manager__panel::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}
    .cupping-main__editor,.batch-review__panel,.free-cupping-manager__panel{scrollbar-width:none!important;-ms-overflow-style:none!important}
    .sample-rail__active-tab{display:none!important}
    .sample-rail__item.is-active::before{content:none!important;display:none!important}
    .cupping-rail-active-float{position:absolute;z-index:1;left:3px;top:0;box-sizing:border-box;border:1px solid rgba(214,173,99,.42);border-radius:14px 999px 999px 14px;background:linear-gradient(90deg,rgba(82,64,37,.92),rgba(128,95,45,.96));box-shadow:0 5px 18px rgba(0,0,0,.30),inset 0 0 0 1px rgba(255,255,255,.055);opacity:0;pointer-events:none;will-change:top,width,height,opacity;transition:top .22s cubic-bezier(.2,.7,.2,1),width .22s cubic-bezier(.2,.7,.2,1),height .22s cubic-bezier(.2,.7,.2,1),opacity .12s ease}
    .sample-rail__item.is-active{z-index:4!important;overflow:visible!important}
    .sample-rail__item.is-active .sample-rail__select,.sample-rail__item.is-active .sample-rail__number,.sample-rail__item.is-active .sample-rail__active-copy{position:relative;z-index:5!important}
    .sample-rail__item.is-active .sample-rail__sample-name{position:relative;z-index:6!important;font-size:clamp(20px,2vw,23px)!important;font-weight:760!important;text-shadow:0 1px 9px rgba(0,0,0,.32)}''')

replace1(stable, "  private managerPageMode = false;",
'''  private managerPageMode = false;
  private runtimeDraftMemory?: RuntimeRecognitionDraft;
  private railFloat?: HTMLElement;
  private railScrollTarget?: HTMLElement;
  private railScrollHandler?: () => void;
  private railResizeHandler?: () => void;''')

replace1(stable,
'''    this.managerOverlay?.remove();
    this.managerOverlay = undefined;
    this.root.querySelector(".free-cupping-return")?.remove();
    this.base.dispose();''',
'''    this.managerOverlay?.remove();
    this.managerOverlay = undefined;
    if (this.railScrollTarget && this.railScrollHandler) this.railScrollTarget.removeEventListener("scroll", this.railScrollHandler);
    if (this.railResizeHandler) window.removeEventListener("resize", this.railResizeHandler);
    this.railFloat?.remove();
    this.railFloat = undefined;
    this.railScrollTarget = undefined;
    this.root.querySelector(".free-cupping-return")?.remove();
    this.base.dispose();''')

replace1(stable,
'    this.observer.observe(this.root, { childList: true, subtree: true });',
'    this.observer.observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });')

float_methods = '''  private syncRailFloat(): void {
    const host = this.root.querySelector<HTMLElement>(".cupping-layout__rail");
    const list = this.root.querySelector<HTMLElement>(".cupping-layout__rail-list.sample-rail");
    if (!host || !list) {
      this.railFloat?.remove();
      this.railFloat = undefined;
      return;
    }
    if (!this.railFloat || this.railFloat.parentElement !== host) {
      this.railFloat?.remove();
      const marker = document.createElement("div");
      marker.className = "cupping-rail-active-float";
      marker.setAttribute("aria-hidden", "true");
      host.append(marker);
      this.railFloat = marker;
    }
    if (this.railScrollTarget !== list) {
      if (this.railScrollTarget && this.railScrollHandler) this.railScrollTarget.removeEventListener("scroll", this.railScrollHandler);
      this.railScrollTarget = list;
      this.railScrollHandler = () => this.positionRailFloat();
      list.addEventListener("scroll", this.railScrollHandler, { passive: true });
    }
    if (!this.railResizeHandler) {
      this.railResizeHandler = () => this.positionRailFloat();
      window.addEventListener("resize", this.railResizeHandler, { passive: true });
    }
    this.positionRailFloat();
  }

  private positionRailFloat(): void {
    const marker = this.railFloat;
    const host = marker?.parentElement instanceof HTMLElement ? marker.parentElement : undefined;
    const list = this.railScrollTarget;
    const active = list?.querySelector<HTMLElement>(".sample-rail__item.is-active");
    if (!marker || !host || !list || !active) {
      if (marker) marker.style.opacity = "0";
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const visible = activeRect.bottom > listRect.top && activeRect.top < listRect.bottom;
    const height = Math.max(42, Math.round(activeRect.height - 4));
    const top = Math.round(activeRect.top - hostRect.top + activeRect.height / 2 - height / 2);
    marker.style.top = `${top}px`;
    marker.style.left = "3px";
    marker.style.width = `${Math.max(54, Math.round(hostRect.width + 13))}px`;
    marker.style.height = `${height}px`;
    marker.style.opacity = visible ? "1" : "0";
  }

'''

replace1(stable, "  private stopInnerTimer(): void {", float_methods + "  private stopInnerTimer(): void {")

replace1(stable,
'''    const state = this.controller.current();
    if (!state) return;
    const mode = cuppingModeFromMetadata(state.sessionMetadata);''',
'''    const state = this.controller.current();
    if (!state) return;
    this.syncRailFloat();
    const mode = cuppingModeFromMetadata(state.sessionMetadata);''')

draft_helpers = '''  private runtimeDraftKey(): string | undefined {
    const sessionId = this.controller.current()?.sessionId?.trim();
    return sessionId ? `aromasense.runtime-recognition-draft.v1.${sessionId}` : undefined;
  }

  private reviewedSample(sample: RecognizedSample, value: BatchReviewValue): RecognizedSample {
    const metadata: Record<string, unknown> = { ...sample.metadata };
    for (const [key] of EDITABLE_SAMPLE_FIELDS) delete metadata[key];
    for (const [key, fieldValue] of Object.entries(value.fields)) {
      const normalized = fieldValue.trim();
      if (normalized) metadata[key] = normalized;
    }
    return { ...sample, label: value.label.trim(), metadata };
  }

  private saveRuntimeRecognitionDraft(
    page: RecognizedPage,
    index: number,
    addedSampleIds: readonly string[],
    preview?: string,
    currentValue?: BatchReviewValue
  ): RuntimeRecognitionDraft | undefined {
    const sessionId = this.controller.current()?.sessionId;
    const key = this.runtimeDraftKey();
    if (!sessionId || !key || !page.samples.length) return undefined;
    const safeIndex = Math.max(0, Math.min(page.samples.length - 1, Math.trunc(index)));
    const samples = page.samples.map((sample, sampleIndex) =>
      sampleIndex === safeIndex && currentValue ? this.reviewedSample(sample, currentValue) : sample
    );
    const draft: RuntimeRecognitionDraft = {
      version: 1,
      sessionId,
      page: { ...page, samples },
      index: safeIndex,
      addedSampleIds: [...new Set(addedSampleIds.filter(Boolean))],
      preview,
      updatedAt: this.options.now()
    };
    this.runtimeDraftMemory = draft;
    try {
      const persisted = preview && preview.length > 750_000 ? { ...draft, preview: undefined } : draft;
      window.localStorage?.setItem(key, JSON.stringify(persisted));
    } catch { /* in-memory fallback still protects the current app lifetime */ }
    return draft;
  }

  private loadRuntimeRecognitionDraft(): RuntimeRecognitionDraft | undefined {
    const state = this.controller.current();
    const key = this.runtimeDraftKey();
    if (!state || !key) return undefined;
    if (this.runtimeDraftMemory?.sessionId === state.sessionId) return this.runtimeDraftMemory;
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as Partial<RuntimeRecognitionDraft>;
      if (parsed.version !== 1 || parsed.sessionId !== state.sessionId || !parsed.page || !Array.isArray(parsed.page.samples) || !parsed.page.samples.length) return undefined;
      const index = Number(parsed.index);
      if (!Number.isInteger(index) || index < 0 || index >= parsed.page.samples.length) return undefined;
      const draft: RuntimeRecognitionDraft = {
        version: 1,
        sessionId: state.sessionId,
        page: parsed.page as RecognizedPage,
        index,
        addedSampleIds: Array.isArray(parsed.addedSampleIds) ? parsed.addedSampleIds.map(String).filter(Boolean) : [],
        preview: typeof parsed.preview === "string" ? parsed.preview : undefined,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : ""
      };
      this.runtimeDraftMemory = draft;
      return draft;
    } catch {
      return undefined;
    }
  }

  private clearRuntimeRecognitionDraft(): void {
    const key = this.runtimeDraftKey();
    this.runtimeDraftMemory = undefined;
    if (!key) return;
    try { window.localStorage?.removeItem(key); } catch { /* best effort */ }
  }

'''

replace1(stable,
"  private async recognizeAndReviewPhoto(file: File, add: HTMLButtonElement, status: HTMLElement): Promise<void> {",
draft_helpers + "  private async recognizeAndReviewPhoto(file: File, add: HTMLButtonElement, status: HTMLElement): Promise<void> {")

replace1(stable,
'''      this.setBusyProgress(true, 80, `识别完成 · 等待确认 ${page.samples.length} 个豆子`);
      status.textContent = `识别到 ${page.samples.length} 个豆子，请逐一确认后加入当前杯测。`;
      this.openRecognitionReview(page, preview, status, add);''',
'''      this.saveRuntimeRecognitionDraft(page, 0, [], preview);
      this.setBusyProgress(false, 100, "");
      status.textContent = `识别到 ${page.samples.length} 个豆子，请逐一确认后加入当前杯测。`;
      this.openRecognitionReview(page, preview, status, add, 0, []);''')

new_review = '''  private openRecognitionReview(
    page: RecognizedPage,
    preview: string | undefined,
    status: HTMLElement,
    add: HTMLButtonElement,
    startIndex = 0,
    restoredAddedIds: readonly string[] = []
  ): void {
    const samples = [...page.samples];
    const addedIds: string[] = [...restoredAddedIds];
    const openAt = (index: number): void => {
      const sample = samples[index];
      if (!sample || !this.managerOverlay) return;
      this.setBusyProgress(false, 0, "");
      this.runtimeReview?.close();
      this.runtimeReview = openBatchReviewDialog({
        root: this.managerOverlay,
        rowId: `runtime-add-${index}`,
        index,
        total: samples.length,
        confirmed: addedIds.length,
        finalPending: index === samples.length - 1,
        previewUrl: preview,
        recognitionStatus: [page.engine, page.layoutType, sample.requiresReview ? "存在待核对字段" : "自动识别完成"].join(" · "),
        rawText: sample.rawText,
        label: sample.label,
        fields: reviewFields(sample),
        onExit: (value) => {
          this.saveRuntimeRecognitionDraft(page, index, addedIds, preview, value);
          this.runtimeReview?.close();
          this.runtimeReview = undefined;
          add.disabled = false;
          this.setBusyProgress(false, 0, "");
          this.managerMessage = {
            text: `识别结果已暂存：已加入 ${addedIds.length} 个，待确认 ${samples.length - index} 个。可随时继续确认。`
          };
          this.rebuildManager();
        },
        onConfirm: async (value: BatchReviewValue) => {
          this.setBusyProgress(false, 0, "");
          const reviewed = this.reviewedSample(sample, value);
          const metadata: Record<string, unknown> = { ...reviewed.metadata };
          const recognition = metadata.recognition && typeof metadata.recognition === "object"
            ? metadata.recognition as Record<string, unknown>
            : {};
          metadata.recognition = {
            ...recognition,
            runtimeRosterAddition: true,
            runtimeUserConfirmed: true,
            runtimeAddedAt: this.options.now()
          };
          const id = crypto.randomUUID();
          try {
            await this.controller.addSample(id, { label: reviewed.label, metadata }, this.options.now());
            addedIds.push(id);
            this.runtimeReview?.close();
            this.runtimeReview = undefined;
            if (index + 1 < samples.length) {
              this.saveRuntimeRecognitionDraft(page, index + 1, addedIds, preview);
              openAt(index + 1);
              return;
            }
            this.clearRuntimeRecognitionDraft();
            await this.finishRuntimeAddition(addedIds, status);
          } catch (error) {
            this.setBusyProgress(false, 0, "");
            throw error;
          }
        }
      });
    };
    openAt(Math.max(0, Math.min(samples.length - 1, startIndex)));
  }

'''

sub1(stable,
r"  private openRecognitionReview\(.*?\n  \}\n\n  private async finishRuntimeAddition",
new_review + "  private async finishRuntimeAddition")

replace1(stable,
'''    captureInput.addEventListener("change", () => { const file = captureInput.files?.[0]; captureInput.value = ""; if (file) void this.recognizeAndReviewPhoto(file, add, status); });

    const list = document.createElement("div");''',
'''    captureInput.addEventListener("change", () => { const file = captureInput.files?.[0]; captureInput.value = ""; if (file) void this.recognizeAndReviewPhoto(file, add, status); });
    const pendingDraft = this.loadRuntimeRecognitionDraft();
    const resume = pendingDraft ? document.createElement("button") : undefined;
    if (resume && pendingDraft) {
      resume.type = "button";
      resume.className = "free-cupping-manager__resume";
      resume.textContent = `继续确认已识别豆子 · ${pendingDraft.index + 1}/${pendingDraft.page.samples.length}`;
      resume.addEventListener("click", () => {
        const draft = this.loadRuntimeRecognitionDraft();
        if (!draft) { this.rebuildManager(); return; }
        add.disabled = true;
        this.setBusyProgress(false, 0, "");
        status.textContent = `继续确认已暂存的识别结果：${draft.index + 1}/${draft.page.samples.length}`;
        this.openRecognitionReview(draft.page, draft.preview, status, add, draft.index, draft.addedSampleIds);
      });
    }

    const list = document.createElement("div");''')

replace1(stable,
"    panel.append(head, add, captureInput, list, status, progress); overlay.append(panel);",
"    panel.append(head, add); if (resume) panel.append(resume); panel.append(captureInput, list, status, progress); overlay.append(panel);")

test_path = Path("tests/runtime-cupping-review-regression.test.ts")
test_path.write_text('''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("cupping rail hides its scrollbar and renders a separate floating current-item layer below active text", () => {
  const source = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
  assert.match(source, /scrollbar-width:none!important/);
  assert.match(source, /cupping-rail-active-float/);
  assert.match(source, /host\\.append\\(marker\\)/);
  assert.match(source, /list\\.addEventListener\\("scroll"/);
  assert.match(source, /sample-rail__item\\.is-active::before\\{content:none!important;display:none!important\\}/);
  assert.match(source, /sample-rail__item\\.is-active \\.sample-rail__sample-name/);
  assert.match(source, /z-index:6!important/);
});

test("runtime bean recognition closes OCR busy state before review and persists a resumable draft", () => {
  const source = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
  assert.match(source, /saveRuntimeRecognitionDraft\\(page, 0, \\[\\], preview\\);[\\s\\S]*?setBusyProgress\\(false, 100, ""\\);[\\s\\S]*?openRecognitionReview/);
  assert.match(source, /aromasense\\.runtime-recognition-draft\\.v1/);
  assert.match(source, /localStorage\\?\\.setItem/);
  assert.match(source, /识别结果已暂存/);
  assert.match(source, /继续确认已识别豆子/);
  assert.match(source, /clearRuntimeRecognitionDraft\\(\\)/);
  assert.doesNotMatch(source, /setBusyProgress\\(true, 80, `识别完成/);
});
''')

for workflow in [
    Path(".github/workflows/oneshot-fix-rail-runtime-review.yml"),
    Path(".github/workflows/oneshot-fix-rail-runtime-review-v2.yml"),
    Path(".github/workflows/oneshot-fix-rail-runtime-review-v3.yml")
]:
    if workflow.exists():
        workflow.unlink()
self_path = Path("scripts/oneshot_fix_rail_runtime_review.py")
if self_path.exists():
    self_path.unlink()
