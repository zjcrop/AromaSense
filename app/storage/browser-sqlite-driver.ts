import initSqlJs, { type SqlJsDatabase } from "sql.js";
import type { SQLiteScriptDriver } from "./local-migration-runner";
import type { SqlValue } from "./local-cupping-repository";

const STORE_NAME = "database";
const DATABASE_KEY = "main";

function openIndexedDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_OPEN_FAILED"));
  });
}

function readBytes(db: IDBDatabase): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(DATABASE_KEY);
    request.onsuccess = () => {
      const value = request.result;
      if (value instanceof ArrayBuffer) resolve(new Uint8Array(value));
      else if (value instanceof Uint8Array) resolve(value);
      else resolve(undefined);
    };
    request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_READ_FAILED"));
  });
}

function writeBytes(db: IDBDatabase, bytes: Uint8Array): Promise<void> {
  const copy = bytes.slice().buffer;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(copy, DATABASE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("INDEXEDDB_WRITE_FAILED"));
    tx.onabort = () => reject(tx.error ?? new Error("INDEXEDDB_WRITE_ABORTED"));
  });
}

export interface BrowserSQLiteOptions {
  databaseName?: string;
  wasmUrl?: string;
}

export class BrowserSQLiteDriver implements SQLiteScriptDriver {
  private transactionDepth = 0;
  private savepointSequence = 0;
  private persistTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly db: SqlJsDatabase,
    private readonly indexedDb: IDBDatabase
  ) {
    this.db.run("PRAGMA foreign_keys = ON");
  }

  static async open(options: BrowserSQLiteOptions = {}): Promise<BrowserSQLiteDriver> {
    const SQL = await initSqlJs({ locateFile: () => options.wasmUrl ?? "./sql-wasm.wasm" });
    const indexedDb = await openIndexedDb(options.databaseName ?? "aromasense-web-B0.1.a");
    const saved = await readBytes(indexedDb);
    return new BrowserSQLiteDriver(saved ? new SQL.Database(saved) : new SQL.Database(), indexedDb);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    const statement = this.db.prepare(sql);
    try {
      statement.run(params);
    } finally {
      statement.free();
    }
    if (this.transactionDepth === 0) await this.persist();
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      if (!statement.step()) return undefined;
      return statement.getAsObject() as T;
    } finally {
      statement.free();
    }
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<readonly T[]> {
    const statement = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      statement.bind(params);
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const outermost = this.transactionDepth === 0;
    const savepoint = `as_web_${++this.savepointSequence}`;
    this.db.run(outermost ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.transactionDepth += 1;
    try {
      const result = await work();
      this.transactionDepth -= 1;
      this.db.run(outermost ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      if (outermost) await this.persist();
      return result;
    } catch (error) {
      this.transactionDepth -= 1;
      if (outermost) this.db.run("ROLLBACK");
      else {
        this.db.run(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.run(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw error;
    }
  }

  async flush(): Promise<void> {
    await this.persist();
  }

  close(): void {
    this.indexedDb.close();
    this.db.close();
  }

  private persist(): Promise<void> {
    const bytes = this.db.export();
    this.persistTail = this.persistTail.then(() => writeBytes(this.indexedDb, bytes));
    return this.persistTail;
  }
}
