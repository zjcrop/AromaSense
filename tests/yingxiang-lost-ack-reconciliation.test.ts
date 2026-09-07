import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildYingxiangManifest, defaultYingxiangEventPolicy } from "../app/core/yingxiang-event";
import type { YingxiangParticipantStatus, YingxiangRemoteEvent } from "../app/core/yingxiang-client";
import { YingxiangClientError } from "../app/core/yingxiang-client";
import { YingxiangDeliveryService } from "../app/core/yingxiang-delivery-service";
import { YingxiangParticipationService } from "../app/core/yingxiang-participation-service";
import type { SubmissionBundle } from "../app/core/submission-bundle";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

function openDb(): { dir: string; db: NodeSQLiteDriver } {
  const dir = mkdtempSync(join(tmpdir(), "yingxiang-lost-ack-"));
  const db = NodeSQLiteDriver.open(join(dir, "test.sqlite"));
  for (const file of readdirSync("app/storage").filter((name) => /^\d{4}.*\.sql$/u.test(name)).sort()) {
    db.exec(readFileSync(`app/storage/${file}`, "utf8"));
  }
  return { dir, db };
}

test("server status ACK restores a lost local ACK after event completion without resubmission", async () => {
  const state = openDb();
  const joinedAt = "2026-09-07T06:00:00.000Z";
  const token = "b".repeat(64);
  try {
    const policy = defaultYingxiangEventPolicy();
    const published: YingxiangRemoteEvent = {
      schemaVersion: "yingxiang-event/0.1",
      eventId: "event-lost-ack",
      eventRevision: 7,
      title: "ACK 恢复测试",
      status: "published",
      policy,
      manifest: buildYingxiangManifest({ organizerName: "Lab", cuppingMode: "blind", sampleCodes: ["A01"] }),
      createdAt: joinedAt,
      updatedAt: joinedAt
    };
    const completed: YingxiangRemoteEvent = {
      ...published,
      status: "completed",
      manifest: buildYingxiangManifest({
        organizerName: "Lab",
        cuppingMode: "blind",
        sampleCodes: ["A01"],
        coffees: [{ productName: "Alo 74158", country: "Ethiopia", region: "Guji", farm: "Alo", variety: "74158", process: "Natural", roast: "Light" }]
      }),
      updatedAt: "2026-09-07T08:00:00.000Z"
    };
    const principal = {
      schemaVersion: "yingxiang-principal/0.1" as const,
      participantId: "participant-lost-ack",
      eventId: published.eventId,
      identityKind: "guest" as const,
      displayName: "评委01",
      accountDisplayNameHidden: true as const,
      status: "active" as const,
      boundAt: joinedAt
    };
    await new YingxiangParticipationService(state.db, {
      async previewInvite() { return { event: published, invite: { inviteId: "invite", expiresAt: "later", remainingUses: 1 } }; },
      async joinInvite() { return { event: published, principal, replayed: false, accessToken: token }; }
    }, {
      now: () => joinedAt,
      createSessionId: () => "session-lost-ack",
      createSampleId: () => "sample-lost-ack"
    }).join({ token: "a".repeat(48), joinRequestId: `join:${crypto.randomUUID()}`, displayName: "评委01" });

    const repository = new LocalCuppingRepository(state.db);
    const session = await repository.getSession("session-lost-ack");
    await repository.saveObservation({
      observationId: "obs-final",
      sessionId: session.sessionId,
      sampleId: "sample-lost-ack",
      stageId: "scoring",
      fieldKey: "score_confirmed",
      value: true,
      dictionaryVersion: "v1",
      updatedAt: "2026-09-07T07:00:00.000Z"
    });
    await repository.saveSession({ ...session, status: "completed", completedAt: "2026-09-07T07:05:00.000Z", updatedAt: "2026-09-07T07:05:00.000Z" });

    let remoteEvent = published;
    let released = false;
    let accepted: SubmissionBundle | undefined;
    let submitCalls = 0;
    let loseFirstResponse = true;
    const remote = {
      async participantStatus(): Promise<YingxiangParticipantStatus> {
        return {
          event: remoteEvent,
          participant: {
            participantId: principal.participantId,
            displayName: principal.displayName,
            status: released ? "released" : "active",
            releasedAt: released ? "2026-09-07T08:00:00.000Z" : undefined
          },
          ack: accepted ? { revision: accepted.revision, contentHash: accepted.contentHash, receivedAt: "2026-09-07T07:10:00.000Z" } : null
        };
      },
      async sendProgress() { return {}; },
      async submit(_participantId: string, credential: string, bundle: SubmissionBundle) {
        submitCalls += 1;
        assert.equal(credential, token);
        accepted = bundle;
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new YingxiangClientError("NETWORK_ERROR", 0, "ACK 响应途中断网");
        }
        return { revision: bundle.revision, contentHash: bundle.contentHash };
      },
      async leave() { return {}; }
    };

    const first = new YingxiangDeliveryService(state.db, remote, () => "2026-09-07T07:10:00.000Z");
    await first.sync();
    assert.equal(submitCalls, 1);
    assert.ok(accepted);
    const afterLoss = (await first.list())[0];
    assert.equal(afterLoss.ack_revision, null);
    assert.equal(afterLoss.ack_hash, null);
    assert.match(afterLoss.last_error ?? "", /ACK 响应途中断网/);
    assert.equal(Number((await state.db.get<{ count: bigint }>("SELECT COUNT(*) AS count FROM submission_revisions"))?.count ?? 0n), 1);

    remoteEvent = completed;
    released = true;
    const second = new YingxiangDeliveryService(state.db, remote, () => "2026-09-07T08:01:00.000Z");
    await second.sync();
    assert.equal(submitCalls, 1);
    const recovered = (await second.list())[0];
    assert.equal(recovered.ack_revision, accepted!.revision);
    assert.equal(recovered.ack_hash, accepted!.contentHash);
    assert.equal(recovered.last_error, null);
    assert.equal(Number((await state.db.get<{ count: bigint }>("SELECT COUNT(*) AS count FROM submission_revisions"))?.count ?? 0n), 1);
    assert.equal((await repository.getSession("session-lost-ack")).metadata.revealedAt, "2026-09-07T08:01:00.000Z");
    const revealed = (await repository.listSamples("session-lost-ack"))[0];
    assert.equal(revealed.label, "Alo 74158");
    assert.equal(revealed.metadata.farm, "Alo");
  } finally {
    state.db.close();
    rmSync(state.dir, { recursive: true, force: true });
  }
});
