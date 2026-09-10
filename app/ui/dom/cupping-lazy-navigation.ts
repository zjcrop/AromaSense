import type { StageId } from "../../../shared/protocol/aromasense-v1";
import type { CuppingScreenController, CuppingScreenState } from "../cupping-screen-controller";
import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const MEMORY_PREFIX = "aromasense.cupping.last-page.v1:";
const PATCH_FLAG = Symbol.for("aromasense.cupping.lazy-navigation.v1");

interface SamplePageMemory {
  stageId: StageId;
  finalPhase?: string;
}

export interface CuppingPageMemory {
  version: 1;
  lastSampleId: string;
  samples: Record<string, SamplePageMemory>;
}

export interface CuppingNavigationTarget {
  sampleId: string;
  stageId: StageId;
  finalPhase?: string;
}

interface RendererInternals {
  controller: CuppingScreenController;
  options: { now(): string };
}

interface RendererPrototype {
  [PATCH_FLAG]?: boolean;
  initialize(this: RendererInternals, sessionId: string): Promise<void>;
  select(this: RendererInternals, sampleId: string, stageId: StageId): Promise<void>;
  selectFinalPhase(this: RendererInternals, sampleId: string, phase: string): Promise<void>;
}

function stageExists(state: CuppingScreenState, sampleId: string, stageId: string): stageId is StageId {
  return state.rail.find((item) => item.sampleId === sampleId)?.stages.some((stage) => stage.stageId === stageId) === true;
}

function finalPhaseExists(state: CuppingScreenState, sampleId: string, phase: string | undefined): boolean {
  if (!phase) return false;
  return state.rail
    .find((item) => item.sampleId === sampleId)
    ?.stages.find((stage) => stage.stageId === "final")
    ?.finalPhases?.some((item) => item.phase === phase) === true;
}

function firstStage(state: CuppingScreenState, sampleId: string): StageId | undefined {
  return state.rail.find((item) => item.sampleId === sampleId)?.stages[0]?.stageId;
}

export function resolveInitialCuppingTarget(
  state: CuppingScreenState,
  memory: CuppingPageMemory | undefined
): CuppingNavigationTarget | undefined {
  if (!state.samples.length) return undefined;
  const rememberedSample = memory?.lastSampleId;
  const sampleId = rememberedSample && state.samples.some((item) => item.sampleId === rememberedSample)
    ? rememberedSample
    : state.samples[0]!.sampleId;
  const remembered = memory?.samples[sampleId];
  const stageId = remembered && stageExists(state, sampleId, remembered.stageId)
    ? remembered.stageId
    : firstStage(state, sampleId);
  if (!stageId) return undefined;
  const finalPhase = stageId === "final" && finalPhaseExists(state, sampleId, remembered?.finalPhase)
    ? remembered?.finalPhase
    : undefined;
  return { sampleId, stageId, ...(finalPhase ? { finalPhase } : {}) };
}

function storageKey(sessionId: string): string {
  return `${MEMORY_PREFIX}${sessionId}`;
}

function readMemory(sessionId: string): CuppingPageMemory | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CuppingPageMemory>;
    if (parsed.version !== 1 || typeof parsed.lastSampleId !== "string" || !parsed.samples || typeof parsed.samples !== "object") return undefined;
    return parsed as CuppingPageMemory;
  } catch {
    return undefined;
  }
}

function writeMemory(sessionId: string, target: CuppingNavigationTarget): void {
  if (typeof window === "undefined") return;
  try {
    const previous = readMemory(sessionId);
    const memory: CuppingPageMemory = {
      version: 1,
      lastSampleId: target.sampleId,
      samples: {
        ...(previous?.samples ?? {}),
        [target.sampleId]: {
          stageId: target.stageId,
          ...(target.finalPhase ? { finalPhase: target.finalPhase } : {})
        }
      }
    };
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(memory));
  } catch {
    // Navigation memory is an acceleration layer only. Never block cupping.
  }
}

function currentFinalPhase(controller: CuppingScreenController): string | undefined {
  const active = controller.current()?.active;
  if (active?.context.stageId !== "final") return undefined;
  const value = active.slice.observations.find((item) => item.fieldKey === "final_phase")?.value;
  return typeof value === "string" && value.trim() ? value.trim() : "flavor";
}

function installCuppingProgressSuppression(): void {
  if (typeof document === "undefined" || document.head.querySelector("style[data-aromasense-cupping-progress-suppression]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCuppingProgressSuppression = "true";
  style.textContent = `
    #app[data-screen="cupping"] ~ .aromasense-long-progress{
      display:none!important;
    }
  `;
  document.head.append(style);
}

function installNavigationPatch(): void {
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;

  const originalInitialize = prototype.initialize;
  const originalSelect = prototype.select;
  const originalSelectFinalPhase = prototype.selectFinalPhase;

  prototype.select = async function(sampleId: string, suggestedStageId: StageId): Promise<void> {
    const stateBefore = this.controller.current();
    let stageId = suggestedStageId;
    let rememberedFinalPhase: string | undefined;

    // A sample-card change resumes that sample's own last page. A deliberate
    // stage click inside the already active sample must always win immediately.
    if (stateBefore && stateBefore.active?.context.sampleId !== sampleId) {
      const remembered = readMemory(stateBefore.sessionId)?.samples[sampleId];
      if (remembered && stageExists(stateBefore, sampleId, remembered.stageId)) {
        stageId = remembered.stageId;
        rememberedFinalPhase = remembered.finalPhase;
      } else {
        stageId = firstStage(stateBefore, sampleId) ?? suggestedStageId;
      }
    }

    await originalSelect.call(this, sampleId, stageId);
    if (stageId === "final" && rememberedFinalPhase && currentFinalPhase(this.controller) !== rememberedFinalPhase) {
      await originalSelectFinalPhase.call(this, sampleId, rememberedFinalPhase);
    }

    const stateAfter = this.controller.current();
    const active = stateAfter?.active;
    if (!stateAfter || !active) return;
    writeMemory(stateAfter.sessionId, {
      sampleId: active.context.sampleId,
      stageId: active.context.stageId,
      ...(active.context.stageId === "final" ? { finalPhase: currentFinalPhase(this.controller) } : {})
    });
  };

  prototype.selectFinalPhase = async function(sampleId: string, phase: string): Promise<void> {
    await originalSelectFinalPhase.call(this, sampleId, phase);
    const state = this.controller.current();
    const active = state?.active;
    if (!state || !active) return;
    writeMemory(state.sessionId, {
      sampleId: active.context.sampleId,
      stageId: active.context.stageId,
      ...(active.context.stageId === "final" ? { finalPhase: currentFinalPhase(this.controller) } : {})
    });
  };

  prototype.initialize = async function(sessionId: string): Promise<void> {
    await originalInitialize.call(this, sessionId);
    const state = this.controller.current();
    if (!state || state.active || state.sessionStatus === "completed" || state.sessionStatus === "archived") return;
    const target = resolveInitialCuppingTarget(state, readMemory(sessionId));
    if (!target) return;

    // Only the target slice is opened. No other sensory page is pre-rendered.
    await prototype.select.call(this, target.sampleId, target.stageId);
    if (target.stageId === "final" && target.finalPhase && currentFinalPhase(this.controller) !== target.finalPhase) {
      await prototype.selectFinalPhase.call(this, target.sampleId, target.finalPhase);
    }
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installCuppingProgressSuppression();
  installNavigationPatch();
}
