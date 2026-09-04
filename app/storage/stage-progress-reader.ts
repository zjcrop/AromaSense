import type { StageId, SensoryObservation } from "../../shared/protocol/aromasense-v1";
import {
  deriveStageStatus,
  finalPhaseProgress,
  meaningfulObservationCount,
  type FinalPhaseProgress
} from "../core/cupping-progress-policy";
import type { StageStatus } from "../core/cupping-state-machine";
import type { SQLiteDriver } from "./local-cupping-repository";

export interface SampleStageProgress {
  sampleId: string;
  stageId: StageId;
  status: StageStatus;
  observationCount: number;
  finalPhases?: readonly FinalPhaseProgress[];
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

interface StageProgressRow {
  sample_id: string;
  stage_id: StageId;
  status: StageStatus;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface ObservationProgressRow {
  observation_id: string;
  session_id: string;
  sample_id: string;
  stage_id: StageId;
  field_key: string;
  value_json: string;
  dictionary_version: string;
  updated_at: string;
}

function key(sampleId: string, stageId: StageId): string {
  return `${sampleId}:${stageId}`;
}

function observationFromRow(row: ObservationProgressRow): SensoryObservation {
  return {
    observationId: row.observation_id,
    sessionId: row.session_id,
    sampleId: row.sample_id,
    stageId: row.stage_id,
    fieldKey: row.field_key,
    value: JSON.parse(row.value_json) as unknown,
    dictionaryVersion: row.dictionary_version,
    updatedAt: row.updated_at
  };
}

function latestTimestamp(values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? "";
}

export class StageProgressReader {
  constructor(private readonly db: SQLiteDriver) {}

  async listForSession(sessionId: string): Promise<readonly SampleStageProgress[]> {
    const [stageRows, observationRows] = await Promise.all([
      this.db.all<StageProgressRow>(
        `SELECT sample_id, stage_id, status, started_at, completed_at, updated_at
         FROM stage_state
         WHERE session_id = ?`,
        [sessionId]
      ),
      this.db.all<ObservationProgressRow>(
        `SELECT observation_id, session_id, sample_id, stage_id, field_key, value_json,
                dictionary_version, updated_at
         FROM observations
         WHERE session_id = ?
         ORDER BY sample_id, stage_id, field_key`,
        [sessionId]
      )
    ]);

    const stagesByKey = new Map(stageRows.map((row) => [key(row.sample_id, row.stage_id), row] as const));
    const observationsByKey = new Map<string, SensoryObservation[]>();
    for (const row of observationRows) {
      const observation = observationFromRow(row);
      const k = key(observation.sampleId, observation.stageId);
      const items = observationsByKey.get(k) ?? [];
      items.push(observation);
      observationsByKey.set(k, items);
    }

    const keys = new Set([...stagesByKey.keys(), ...observationsByKey.keys()]);
    const progress: SampleStageProgress[] = [];
    for (const k of keys) {
      const stageRow = stagesByKey.get(k);
      const observations = observationsByKey.get(k) ?? [];
      const representative = observations[0];
      const sampleId = stageRow?.sample_id ?? representative?.sampleId;
      const stageId = stageRow?.stage_id ?? representative?.stageId;
      if (!sampleId || !stageId) continue;

      const status = deriveStageStatus(stageId, observations);
      progress.push({
        sampleId,
        stageId,
        status,
        observationCount: meaningfulObservationCount(observations),
        finalPhases: stageId === "final" ? finalPhaseProgress(observations) : undefined,
        startedAt: status === "not_started" ? undefined : stageRow?.started_at ?? observations[0]?.updatedAt,
        completedAt: status === "completed" ? stageRow?.completed_at ?? undefined : undefined,
        updatedAt: latestTimestamp([stageRow?.updated_at, ...observations.map((observation) => observation.updatedAt)])
      });
    }

    return progress.sort((a, b) => a.sampleId.localeCompare(b.sampleId) || a.stageId.localeCompare(b.stageId));
  }
}
