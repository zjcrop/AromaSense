import type { SQLiteDriver, SqlValue } from "./local-cupping-repository";

interface AndroidSQLiteBridge {
  exec(sql: string): string;
  run(sql: string, paramsJson: string): string;
  get(sql: string, paramsJson: string): string;
  all(sql: string, paramsJson: string): string;
  begin(): string;
  commit(): string;
  rollback(): string;
  savepoint(name: string): string;
  release(name: string): string;
  rollbackTo(name: string): string;
}

declare global {
  interface Window {
    AromaSenseSQLite?: AndroidSQLiteBridge;
  }
}

interface BridgeResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
}

function parse<T>(raw: string): T {
  const result = JSON.parse(raw) as BridgeResult<T>;
  if (!result.ok) throw new Error(`ANDROID_SQLITE:${result.error ?? "UNKNOWN"}`);
  return result.value as T;
}

export class AndroidSQLiteDriver implements SQLiteDriver {
  private depth = 0;
  private savepoint = 0;

  constructor(private readonly bridge: AndroidSQLiteBridge) {}

  static fromWindow(): AndroidSQLiteDriver {
    if (!window.AromaSenseSQLite) throw new Error("ANDROID_SQLITE_BRIDGE_NOT_AVAILABLE");
    return new AndroidSQLiteDriver(window.AromaSenseSQLite);
  }

  exec(sql: string): void {
    parse(this.bridge.exec(sql));
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    parse(this.bridge.run(sql, JSON.stringify(params)));
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    return parse<T | undefined>(this.bridge.get(sql, JSON.stringify(params)));
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<readonly T[]> {
    return parse<T[]>(this.bridge.all(sql, JSON.stringify(params)));
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const topLevel = this.depth === 0;
    const name = `as_sp_${++this.savepoint}`;
    if (topLevel) parse(this.bridge.begin()); else parse(this.bridge.savepoint(name));
    this.depth += 1;
    try {
      const result = await work();
      this.depth -= 1;
      if (topLevel) parse(this.bridge.commit()); else parse(this.bridge.release(name));
      return result;
    } catch (error) {
      this.depth -= 1;
      if (topLevel) parse(this.bridge.rollback());
      else {
        parse(this.bridge.rollbackTo(name));
        parse(this.bridge.release(name));
      }
      throw error;
    }
  }
}
