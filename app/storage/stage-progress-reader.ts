import type { StageId } from "../../shared/protocol/aromasense-v1";
import type { StageStatus } from "../core/cupping-state-machine";
import type { SQLiteDriver } from "./local-cupping-repository";

export interface SampleStageProgress {
  sampleId: string;
  stageId: StageId;
  status: StageStatus;
  observationCount: number;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

interface StageProgressRow {
  sample_id: string;
  stage_id: StageId;
  status: StageStatus;
  observation_count: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export class StageProgressReader {
  constructor(private readonly db: SQLiteDriver) {}

  async listForSession(sessionId: string): Promise<readonly SampleStageProgress[]> {
    const rows = await this.db.all<StageProgressRow>(
      `SELECT stage_state.sample_id,
              stage_state.stage_id,
              stage_state.status,
              stage_state.started_at,
              stage_state.completed_at,
              stage_state.updated_at,
              COUNT(observations.observation_id) AS observation_count
       FROM stage_state
       LEFT JOIN observations
         ON observations.sample_id = stage_state.sample_id
        AND observations.stage_id = stage_state.stage_id
       WHERE stage_state.session_id = ?
       GROUP BY stage_state.sample_id,
                stage_state.stage_id,
                stage_state.status,
                stage_state.started_at,
                stage_state.completed_at,
                stage_state.updated_at
       ORDER BY stage_state.sample_id, stage_state.stage_id`,
      [sessionId]
    );

    return rows.map((row) => ({
      sampleId: row.sample_id,
      stageId: row.stage_id,
      status: row.status,
      observationCount: Number(row.observation_count) || 0,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      updatedAt: row.updated_at
    }));
  }
}
