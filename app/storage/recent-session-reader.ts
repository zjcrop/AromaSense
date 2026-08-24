import type { CuppingSession } from "../core/session-lifecycle";
import type { SQLiteDriver } from "./local-cupping-repository";

export interface RecentSessionSummary {
  sessionId: string;
  title?: string;
  status: CuppingSession["status"];
  updatedAt: string;
  sampleCount: number;
}

interface RecentSessionRow {
  session_id: string;
  title: string | null;
  status: CuppingSession["status"];
  updated_at: string;
  sample_count: number;
}

export class RecentSessionReader {
  constructor(private readonly db: SQLiteDriver) {}

  async list(limit = 10): Promise<readonly RecentSessionSummary[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    const rows = await this.db.all<RecentSessionRow>(
      `SELECT s.session_id, s.title, s.status, s.updated_at, COUNT(p.sample_id) AS sample_count
       FROM sessions s
       LEFT JOIN samples p ON p.session_id = s.session_id
       GROUP BY s.session_id, s.title, s.status, s.updated_at
       ORDER BY s.updated_at DESC
       LIMIT ?`,
      [safeLimit]
    );
    return rows.map((row) => ({
      sessionId: row.session_id,
      title: row.title ?? undefined,
      status: row.status,
      updatedAt: row.updated_at,
      sampleCount: Number(row.sample_count) || 0
    }));
  }
}
