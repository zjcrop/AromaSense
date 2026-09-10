import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import { CuppingSessionController, type ActiveEditingState } from "../../core/cupping-session-controller";
import type { EditingContext } from "../../core/cupping-state-machine";
import type { LocalCuppingRepository } from "../../storage/local-cupping-repository";
import type { CuppingScreenState } from "../cupping-screen-controller";
import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const CONTROLLER_PATCH = Symbol.for("aromasense.cupping.aroma-single-axis-score.controller.v1");
const RENDERER_PATCH = Symbol.for("aromasense.cupping.aroma-single-axis-score.renderer.v1");
const SINGLE_AXIS_VERSION = "sensory-flow/2.2-single-axis-score";

export const AROMA_SINGLE_AXIS_SCORE_MAP = {
  dry_fragrance_intensity: "final_sca_affective_fragrance",
  wet_aroma_intensity: "final_sca_affective_aroma"
} as const;

type AromaSourceField = keyof typeof AROMA_SINGLE_AXIS_SCORE_MAP;

export function normalizeAromaAxisScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9 ? value : undefined;
}

function latestField(observations: readonly SensoryObservation[], fieldKey: string): SensoryObservation | undefined {
  return observations
    .filter((item) => item.fieldKey === fieldKey)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1);
}

interface EditingInternals {
  active?: ActiveEditingState;
  repository: LocalCuppingRepository;
  observationIdFactory(context: EditingContext, fieldKey: string): string;
}

interface EditingPrototype {
  [CONTROLLER_PATCH]?: boolean;
  open(context: EditingContext, now: string): Promise<ActiveEditingState>;
  saveField(fieldKey: string, value: unknown, now: string): Promise<void>;
}

async function persistScoreAlias(
  host: EditingInternals,
  context: EditingContext,
  sourceField: AromaSourceField,
  value: unknown,
  updatedAt: string
): Promise<void> {
  const score = normalizeAromaAxisScore(value);
  if (score === undefined) return;
  const targetField = AROMA_SINGLE_AXIS_SCORE_MAP[sourceField];
  const aromaContext: EditingContext = { ...context, stageId: "aroma" };
  await host.repository.saveObservation({
    observationId: host.observationIdFactory(aromaContext, targetField),
    sessionId: context.sessionId,
    sampleId: context.sampleId,
    stageId: "aroma",
    fieldKey: targetField,
    value: score,
    dictionaryVersion: SINGLE_AXIS_VERSION,
    updatedAt
  });
}

async function synchronizeExistingAxes(host: EditingInternals, context: EditingContext, now: string): Promise<void> {
  const observations = await host.repository.listObservationsForSample(context.sampleId);
  for (const sourceField of Object.keys(AROMA_SINGLE_AXIS_SCORE_MAP) as AromaSourceField[]) {
    const source = latestField(observations, sourceField);
    const score = normalizeAromaAxisScore(source?.value);
    if (score === undefined) continue;
    const target = latestField(observations, AROMA_SINGLE_AXIS_SCORE_MAP[sourceField]);
    if (target?.value === score && target.dictionaryVersion === SINGLE_AXIS_VERSION) continue;
    await persistScoreAlias(host, context, sourceField, score, source?.updatedAt ?? now);
  }
}

function installControllerPatch(): void {
  const prototype = CuppingSessionController.prototype as unknown as EditingPrototype;
  if (prototype[CONTROLLER_PATCH]) return;
  prototype[CONTROLLER_PATCH] = true;

  const originalOpen = prototype.open;
  prototype.open = async function(context: EditingContext, now: string): Promise<ActiveEditingState> {
    const host = this as unknown as EditingInternals;
    await synchronizeExistingAxes(host, context, now);
    return originalOpen.call(this, context, now);
  };

  const originalSave = prototype.saveField;
  prototype.saveField = async function(fieldKey: string, value: unknown, now: string): Promise<void> {
    const host = this as unknown as EditingInternals;
    const context = host.active?.context;
    await originalSave.call(this, fieldKey, value, now);
    if (!context || !(fieldKey in AROMA_SINGLE_AXIS_SCORE_MAP)) return;
    await persistScoreAlias(host, context, fieldKey as AromaSourceField, value, now);
  };
}

interface RendererInternals {
  root: HTMLElement;
  state?: CuppingScreenState;
}

interface RendererPrototype {
  [RENDERER_PATCH]?: boolean;
  render(this: RendererInternals): Promise<void>;
}

function applySingleAxisUi(renderer: RendererInternals): void {
  const active = renderer.state?.active;
  if (!active || active.context.stageId !== "aroma") return;

  for (const duplicate of renderer.root.querySelectorAll(".aroma-affective-score,[data-aroma-sca-score]")) duplicate.remove();

  for (const fieldKey of Object.keys(AROMA_SINGLE_AXIS_SCORE_MAP) as AromaSourceField[]) {
    const field = renderer.root.querySelector<HTMLElement>(`[data-field-key="${fieldKey}"]`);
    const input = field?.querySelector<HTMLInputElement>(".sensory-range__input");
    const output = field?.querySelector<HTMLOutputElement>(".sensory-range__value");
    if (!field || !input) continue;
    field.dataset.singleAxisScore = "true";
    input.min = "1";
    input.max = "9";
    input.step = "1";
    const current = Number(input.value);
    if (!Number.isInteger(current) || current < 1 || current > 9) input.value = "5";
    if (output) output.value = input.value;
  }
}

function installRendererPatch(): void {
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[RENDERER_PATCH]) return;
  prototype[RENDERER_PATCH] = true;
  const originalRender = prototype.render;
  prototype.render = async function(): Promise<void> {
    await originalRender.call(this);
    applySingleAxisUi(this);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installControllerPatch();
  installRendererPatch();
}
