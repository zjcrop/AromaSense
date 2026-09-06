import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildSync } from "esbuild";
import { buildYingxiangManifest, defaultYingxiangEventPolicy } from "../app/core/yingxiang-event";

const dir = mkdtempSync(join(tmpdir(), "yingxiang-auto-invite-"));
buildSync({ entryPoints: ["cloud/worker/src/yingxiang-api.ts"], bundle: true, platform: "node", format: "cjs", outfile: join(dir, "api.cjs") });
const api = require(join(dir, "api.cjs"));
rmSync(dir, { recursive: true, force: true });

class D1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(user_id TEXT PRIMARY KEY,email TEXT);");
    for (const file of ["0007_yingxiang_events.sql", "0008_account_display_name.sql", "0009_yingxiang_collection.sql", "0010_yingxiang_host_accounts_and_sequence.sql"]) {
      this.sqlite.exec(readFileSync(`cloud/worker/migrations/${file}`, "utf8"));
    }
    this.sqlite.exec("INSERT INTO users(user_id,email) VALUES ('host','host@example.invalid')");
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

async function ownerCall(db: D1, path: string, body?: unknown) {
  const request = new Request(`https://example.invalid/api/v1/yingxiang/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response: Response = await api.handleYingxiangAuthenticatedRoute(request, new URL(request.url), db, { userId: "host", email: "host@example.invalid" }, "https://example.invalid");
  return { status: response.status, body: await response.json() as any };
}

async function publicCall(db: D1, path: string, body?: unknown) {
  const request = new Request(`https://example.invalid/api/v1/yingxiang/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response: Response = await api.handleYingxiangPublicRoute(request, new URL(request.url), db);
  return { status: response.status, body: await response.json() as any };
}

test("one organizer invite assigns prefix names by successful join order and hides blind coffee identity", async () => {
  const db = new D1();
  try {
    const policy = {
      ...defaultYingxiangEventPolicy(),
      participantName: {
        mode: "organizer_assigned" as const,
        allowAccountDisplayName: false,
        uniqueWithinEvent: true,
        minLength: 1,
        maxLength: 24,
        requiredPrefix: "评委"
      }
    };
    const manifest = buildYingxiangManifest({
      organizerName: "Lab",
      cuppingMode: "blind",
      sampleCodes: ["101", "205"],
      coffees: [
        { productName: "TOH Lot", country: "Ethiopia", region: "Guji", variety: "74158", roast: "浅烘", notes: "TOH冠军" },
        { productName: "Washed Gesha", country: "Panama", farm: "Estate", variety: "Gesha", roast: "浅烘" }
      ]
    });
    const created = await ownerCall(db, "events", { title: "自动编号测试", policy, manifest });
    assert.equal(created.status, 201);
    const invite = await ownerCall(db, `events/${created.body.event.eventId}/invites`, { maxUses: 3 });
    assert.equal(invite.status, 201);
    assert.equal(invite.body.assignedName, undefined);

    const preview = await publicCall(db, `invites/${invite.body.token}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.invite.automaticName, true);
    assert.equal(preview.body.invite.namePrefix, "评委");
    assert.equal(preview.body.event.manifest.samples[0].coffee, undefined);
    assert.equal(preview.body.event.manifest.samples[0].sampleCode, "101");

    const first = await publicCall(db, `invites/${invite.body.token}/join`, { joinRequestId: `join:${crypto.randomUUID()}` });
    const second = await publicCall(db, `invites/${invite.body.token}/join`, { joinRequestId: `join:${crypto.randomUUID()}` });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(first.body.principal.displayName, "评委01");
    assert.equal(second.body.principal.displayName, "评委02");
    const rows = db.sqlite.prepare("SELECT display_name, participant_ordinal FROM yingxiang_participants ORDER BY participant_ordinal").all() as Array<{ display_name: string; participant_ordinal: number }>;
    assert.deepEqual(rows.map((row) => [row.display_name, row.participant_ordinal]), [["评委01", 1], ["评委02", 2]]);
  } finally { db.sqlite.close(); }
});
