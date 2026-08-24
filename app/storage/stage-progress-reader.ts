import type { StageId } from "../../shared/protocol/aromasense-v1";
import type { StageStatus } from "../core/cupping-state-machine";
import type { SQLiteDriver } from "./local-cupping-repository";

export interface SampleStageProgress {
  sampleId: string;
  stageId: StageId;
  status: StageStatus;
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

export class StageProgressReader {
  constructor(private readonly db: SQLiteDriver) {}

  async listForSession(sessionId: string): Promise<readonly SampleStageProgress[]> {
    const rows = await this.db.all<StageProgressRow>(
      `SELECT sample_id, stage_id, status, started_at, completed_at, updated_at
       FROM stage_state
       WHERE session_id = ?
       ORDER BY sample_id, stage_id`,
      [sessionId]
    );

    return rows.map((row) => ({
      sampleId: row.sample_id,
      stageId: row.stage_id,
      status: row.status,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      updatedAt: row.updated_at
    }));
  }
}
