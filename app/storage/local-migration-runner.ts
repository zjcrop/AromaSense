import type { SQLiteDriver } from "./local-cupping-repository";

export interface SQLiteScriptDriver extends SQLiteDriver {
  exec(sql: string): void;
}

export interface LocalMigration {
  id: number;
  name: string;
  sql: string;
}

export class LocalMigrationRunner {
  constructor(private readonly db: SQLiteScriptDriver) {}

  async apply(migrations: readonly LocalMigration[], now: string): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _aromasense_migrations (
        migration_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(
      (await this.db.all<{ migration_id: number }>(
        "SELECT migration_id FROM _aromasense_migrations ORDER BY migration_id"
      )).map((row) => row.migration_id)
    );

    for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
      if (applied.has(migration.id)) continue;
      await this.db.transaction(async () => {
        this.db.exec(migration.sql);
        await this.db.run(
          "INSERT INTO _aromasense_migrations (migration_id, name, applied_at) VALUES (?, ?, ?)",
          [migration.id, migration.name, now]
        );
      });
      applied.add(migration.id);
    }
  }
}
