import type { SQLiteDriver } from "./local-cupping-repository";

interface PreferenceRow {
  value_json: string;
}

export class UserPreferencesRepository {
  constructor(private readonly db: SQLiteDriver) {}

  async get<T>(key: string): Promise<T | undefined> {
    const row = await this.db.get<PreferenceRow>(
      "SELECT value_json FROM user_preferences WHERE preference_key = ?",
      [key]
    );
    if (!row) {
      return undefined;
    }
    return JSON.parse(row.value_json) as T;
  }

  async set(key: string, value: unknown, now: string): Promise<void> {
    await this.db.run(
      `INSERT INTO user_preferences (preference_key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(preference_key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), now]
    );
  }

  async remove(key: string): Promise<void> {
    await this.db.run("DELETE FROM user_preferences WHERE preference_key = ?", [key]);
  }
}
