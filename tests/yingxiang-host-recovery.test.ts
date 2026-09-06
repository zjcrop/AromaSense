import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildSync } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "yingxiang-host-recovery-"));
buildSync({ entryPoints: ["cloud/worker/src/yingxiang-host-auth.ts"], bundle: true, platform: "node", format: "cjs", outfile: join(dir, "host-auth.cjs") });
const auth = require(join(dir, "host-auth.cjs"));
rmSync(dir, { recursive: true, force: true });

class D1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(
        user_id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        password_hash TEXT,
        password_salt TEXT,
        password_iterations INTEGER,
        email_verified_at TEXT,
        created_at TEXT
      );`);
    for (const file of ["0007_yingxiang_events.sql", "0008_account_display_name.sql", "0010_yingxiang_host_accounts_and_sequence.sql", "0011_yingxiang_host_recovery.sql"]) {
      this.sqlite.exec(readFileSync(`cloud/worker/migrations/${file}`, "utf8"));
    }
  }
  prepare(sql: string) {
    const db = this.sqlite; let params: unknown[] = [];
    const bound = () => {
      const values: unknown[] = [];
      const text = sql.replace(/\?(\d+)/g, (_, n) => { values.push(params[Number(n) - 1]); return "?"; });
      return { statement: db.prepare(text), values };
    };
    return {
      bind(...args: unknown[]) { params = args; return this; },
      async first() { const { statement, values } = bound(); return statement.get(...values as never[]) ?? null; },
      async all() { const { statement, values } = bound(); return { results: statement.all(...values as never[]) }; },
      async run() { const { statement, values } = bound(); const result = statement.run(...values as never[]); return { success: true, meta: { changes: Number(result.changes) } }; }
    };
  }
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    this.sqlite.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run()); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

async function call(db: D1, path: string, body?: unknown, token?: string) {
  const request = new Request(`https://example.invalid/api/v1/yingxiang/host/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response: Response = await auth.handleYingxiangHostAuthRoute(request, new URL(request.url), db);
  return { status: response.status, body: await response.json() as any };
}

test("Yingxiang host recovery rebinds one device, revokes tokens and rotates recovery code", async () => {
  const db = new D1();
  try {
    const deviceA = "a".repeat(64), deviceB = "b".repeat(64), deviceC = "c".repeat(64);
    const created = await call(db, "register", { accountName: "Lab Host", deviceSecret: deviceA });
    assert.equal(created.status, 201);
    assert.match(created.body.token, /^[a-f0-9]{64}$/);
    assert.match(created.body.recoveryCode, /^[a-f0-9]{48}$/);
    const recoveryA = created.body.recoveryCode as string;
    const oldToken = created.body.token as string;

    const normalLogin = await call(db, "login", { accountName: "Lab Host", deviceSecret: deviceA });
    assert.equal(normalLogin.status, 200);
    assert.equal(normalLogin.body.accountName, "Lab Host");

    const foreignDevice = await call(db, "login", { accountName: "Lab Host", deviceSecret: deviceB });
    assert.equal(foreignDevice.status, 403);
    assert.equal(foreignDevice.body.error, "YINGXIANG_HOST_DEVICE_MISMATCH");

    const wrongRecovery = await call(db, "recover", { accountName: "Lab Host", recoveryCode: "d".repeat(48), deviceSecret: deviceB });
    assert.equal(wrongRecovery.status, 403);
    assert.equal(wrongRecovery.body.error, "YINGXIANG_HOST_RECOVERY_CODE_MISMATCH");

    const recovered = await call(db, "recover", { accountName: "Lab Host", recoveryCode: recoveryA, deviceSecret: deviceB });
    assert.equal(recovered.status, 200);
    assert.match(recovered.body.recoveryCode, /^[a-f0-9]{48}$/);
    assert.notEqual(recovered.body.recoveryCode, recoveryA);
    const recoveryB = recovered.body.recoveryCode as string;

    const oldSession = await call(db, "me", undefined, oldToken);
    assert.equal(oldSession.status, 401);
    assert.equal((await call(db, "login", { accountName: "Lab Host", deviceSecret: deviceA })).status, 403);
    assert.equal((await call(db, "login", { accountName: "Lab Host", deviceSecret: deviceB })).status, 200);

    const reusedOldRecovery = await call(db, "recover", { accountName: "Lab Host", recoveryCode: recoveryA, deviceSecret: deviceC });
    assert.equal(reusedOldRecovery.status, 403);

    const secondRecovery = await call(db, "recover", { accountName: "Lab Host", recoveryCode: recoveryB, deviceSecret: deviceC });
    assert.equal(secondRecovery.status, 200);
    assert.notEqual(secondRecovery.body.recoveryCode, recoveryB);
    assert.equal((await call(db, "login", { accountName: "Lab Host", deviceSecret: deviceB })).status, 403);
    assert.equal((await call(db, "login", { accountName: "Lab Host", deviceSecret: deviceC })).status, 200);
  } finally { db.sqlite.close(); }
});

test("legacy Yingxiang host receives a recovery code on the next valid device login", async () => {
  const db = new D1();
  try {
    const device = "e".repeat(64);
    const created = await call(db, "register", { accountName: "Legacy Seed", deviceSecret: device });
    assert.equal(created.status, 201);
    db.sqlite.prepare("UPDATE yingxiang_host_accounts SET recovery_secret_hash = NULL, recovery_updated_at = NULL WHERE account_id = ?").run(created.body.accountId);
    const login = await call(db, "login", { accountName: "Legacy Seed", deviceSecret: device });
    assert.equal(login.status, 200);
    assert.match(login.body.recoveryCode, /^[a-f0-9]{48}$/);
    const row = db.sqlite.prepare("SELECT recovery_secret_hash FROM yingxiang_host_accounts WHERE account_id = ?").get(created.body.accountId) as { recovery_secret_hash: string };
    assert.match(row.recovery_secret_hash, /^[a-f0-9]{64}$/);
  } finally { db.sqlite.close(); }
});
