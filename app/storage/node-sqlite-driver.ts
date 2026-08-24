import { DatabaseSync } from "node:sqlite";
import type { SQLiteDriver, SqlValue } from "./local-cupping-repository";

export class NodeSQLiteDriver implements SQLiteDriver {
  private transactionDepth = 0;

  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  static open(filename: string): NodeSQLiteDriver {
    return new NodeSQLiteDriver(new DatabaseSync(filename));
  }

  close(): void {
    this.db.close();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    const statement = this.db.prepare(sql);
    statement.run(...params);
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    const statement = this.db.prepare(sql);
    return statement.get(...params) as T | undefined;
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<readonly T[]> {
    const statement = this.db.prepare(sql);
    return statement.all(...params) as T[];
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const outermost = this.transactionDepth === 0;
    const savepoint = `aromasense_tx_${this.transactionDepth}`;

    if (outermost) {
      this.db.exec("BEGIN IMMEDIATE");
    } else {
      this.db.exec(`SAVEPOINT ${savepoint}`);
    }

    this.transactionDepth += 1;

    try {
      const result = await work();
      this.transactionDepth -= 1;
      if (outermost) {
        this.db.exec("COMMIT");
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      return result;
    } catch (error) {
      this.transactionDepth -= 1;
      if (outermost) {
        this.db.exec("ROLLBACK");
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw error;
    }
  }
}
