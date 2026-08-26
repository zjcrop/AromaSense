import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CuppingSetupService } from "../app/core/cupping-setup-service";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");
const metadata = { date: "2026-08-26", time: "13:00", organizer: "AromaSense Test" } as const;

test("multi-session import rolls every new group back when a later group fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-multi-import-"));
  const db = NodeSQLiteDriver.open(join(dir, "multi.sqlite"));
  db.exec(schema);
  const repository = new LocalCuppingRepository(db);
  const service = new CuppingSetupService(repository);
  try {
    await service.create({
      sessionId: "already-exists",
      title: "Existing",
      metadata,
      samples: [{ label: "Existing sample" }],
      now: "2026-08-26T13:00:00+08:00",
      sampleIdFactory: () => "existing-sample"
    });

    await assert.rejects(service.createMany([
      {
        sessionId: "new-group-1",
        title: "Group 1",
        metadata,
        samples: [{ label: "A" }],
        now: "2026-08-26T13:01:00+08:00",
        sampleIdFactory: () => "new-sample-1"
      },
      {
        sessionId: "already-exists",
        title: "Conflicting Group",
        metadata,
        samples: [{ label: "B" }],
        now: "2026-08-26T13:01:00+08:00",
        sampleIdFactory: () => "new-sample-2"
      }
    ]));

    const rolledBack = await db.get<{ count: number }>("SELECT COUNT(*) AS count FROM sessions WHERE session_id = ?", ["new-group-1"]);
    const existing = await db.get<{ count: number }>("SELECT COUNT(*) AS count FROM sessions WHERE session_id = ?", ["already-exists"]);
    assert.equal(rolledBack?.count, 0);
    assert.equal(existing?.count, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
