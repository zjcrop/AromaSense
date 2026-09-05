import type { ComparisonBundle, ComparisonMapping } from "../core/comparison-bundle";
import type { SQLiteDriver } from "./local-cupping-repository";

export interface StoredComparison { bundle: ComparisonBundle; mapping: ComparisonMapping; }
interface Row { mapping_json: string; }

export class ComparisonMappingStore {
  constructor(private readonly db: SQLiteDriver) {}
  async replace(localSessionId: string, value: StoredComparison, now: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run("DELETE FROM comparison_mappings WHERE local_session_id = ?", [localSessionId]);
      await this.db.run(
        `INSERT INTO comparison_mappings (mapping_id, local_session_id, comparison_subject_id, mapping_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [`${localSessionId}:${value.bundle.comparisonSubjectId}`, localSessionId, value.bundle.comparisonSubjectId, JSON.stringify(value), now]
      );
    });
  }
  async get(localSessionId: string): Promise<StoredComparison | undefined> {
    const row = await this.db.get<Row>("SELECT mapping_json FROM comparison_mappings WHERE local_session_id = ? ORDER BY updated_at DESC LIMIT 1", [localSessionId]);
    return row ? JSON.parse(row.mapping_json) as StoredComparison : undefined;
  }
  async clear(localSessionId: string): Promise<void> { await this.db.run("DELETE FROM comparison_mappings WHERE local_session_id = ?", [localSessionId]); }
}
