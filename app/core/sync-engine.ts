import type { SyncRepository } from "./sync-repository";
import type { SyncQueueStore } from "../storage/sync-queue-store";

export interface SyncClock { now(): Date; }
export interface SyncRunResult { attempted: number; synced: number; conflicted: number; failed: number; }
export interface SyncEngineOptions { maxBatch?: number; baseRetryMs?: number; maxRetryMs?: number; }

export class SyncEngine {
  private readonly maxBatch: number;
  private readonly baseRetryMs: number;
  private readonly maxRetryMs: number;

  constructor(
    private readonly queue: SyncQueueStore,
    private readonly remote: SyncRepository,
    private readonly clock: SyncClock = { now: () => new Date() },
    options: SyncEngineOptions = {}
  ) {
    this.maxBatch = options.maxBatch ?? 25;
    this.baseRetryMs = options.baseRetryMs ?? 5_000;
    this.maxRetryMs = options.maxRetryMs ?? 15 * 60_000;
  }

  async recoverInterrupted(): Promise<void> { await this.queue.recoverInterrupted(this.clock.now().toISOString()); }

  async runOnce(sessionIds?: readonly string[]): Promise<SyncRunResult> {
    const result: SyncRunResult = { attempted: 0, synced: 0, conflicted: 0, failed: 0 };
    for (let index = 0; index < this.maxBatch; index += 1) {
      const now = this.clock.now();
      const item = await this.queue.claimReady(now.toISOString(), sessionIds);
      if (!item) break;
      result.attempted += 1;
      try {
        const upload = await this.remote.uploadRevision(item.revision);
        if (!upload.ok) {
          await this.queue.markConflict(item.queueId, `REVISION_CONFLICT:${upload.revisionId}:${upload.existingHash}`, this.clock.now().toISOString());
          result.conflicted += 1; continue;
        }
        if (upload.contentHash !== item.revision.contentHash) {
          await this.queue.markConflict(item.queueId, `ACK_HASH_MISMATCH:${upload.contentHash}`, this.clock.now().toISOString());
          result.conflicted += 1; continue;
        }
        await this.queue.markSynced(item.queueId, this.clock.now().toISOString());
        result.synced += 1;
      } catch (error) {
        const attempt = Math.max(1, item.attemptCount);
        const delay = Math.min(this.maxRetryMs, this.baseRetryMs * (2 ** Math.min(attempt - 1, 10)));
        const failedAt = this.clock.now();
        const nextAttemptAt = new Date(failedAt.getTime() + delay).toISOString();
        await this.queue.markFailed(item.queueId, error instanceof Error ? error.message : String(error), nextAttemptAt, failedAt.toISOString());
        result.failed += 1;
      }
    }
    return result;
  }
}
