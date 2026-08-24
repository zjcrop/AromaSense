declare module "sql.js" {
  export interface SqlJsStatement {
    bind(values?: readonly (string | number | null)[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, string | number | Uint8Array | null>;
    run(values?: readonly (string | number | null)[]): void;
    free(): boolean;
  }

  export interface SqlJsDatabase {
    exec(sql: string): unknown[];
    run(sql: string, params?: readonly (string | number | null)[]): SqlJsDatabase;
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  export interface SqlJsConfig {
    locateFile?(file: string): string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
