import { validateYingxiangManifest, type YingxiangEventManifest, type YingxiangEventPolicy, type YingxiangEventStatus } from "../core/yingxiang-event";
import type { SQLiteDriver } from "./local-cupping-repository";
import { YingxiangEventStore, type YingxiangEventContext } from "./yingxiang-event-store";

type RefreshResult = "created" | "updated" | "already_present";

const COFFEE_FIELDS = [
  "productName", "country", "region", "farm", "station", "variety", "roast", "process", "roaster", "altitude", "roastDate", "notes"
] as const;

function normalizePolicy(policy: YingxiangEventPolicy): Record<string, unknown> {
  return {
    schemaVersion: policy.schemaVersion,
    allowGuestParticipants: policy.allowGuestParticipants,
    participantName: {
      mode: policy.participantName.mode,
      allowAccountDisplayName: policy.participantName.allowAccountDisplayName,
      uniqueWithinEvent: policy.participantName.uniqueWithinEvent,
      minLength: policy.participantName.minLength,
      maxLength: policy.participantName.maxLength,
      ...(policy.participantName.requiredPrefix ? { requiredPrefix: policy.participantName.requiredPrefix } : {})
    },
    revealSampleIdentity: policy.revealSampleIdentity,
    calibrationRepeatEnabled: policy.calibrationRepeatEnabled
  };
}

function normalizedCoffee(sample: YingxiangEventManifest["samples"][number]): Record<string, string> | undefined {
  if (!sample.coffee) return undefined;
  const result: Record<string, string> = {};
  for (const key of COFFEE_FIELDS) {
    const value = sample.coffee[key]?.trim();
    if (value) result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizedManifest(manifest: YingxiangEventManifest): Record<string, unknown> {
  return {
    schemaVersion: manifest.schemaVersion,
    organizerName: manifest.organizerName,
    cuppingMode: manifest.cuppingMode,
    samples: [...manifest.samples]
      .sort((a, b) => a.order - b.order)
      .map((sample) => ({
        eventSampleId: sample.eventSampleId,
        sampleCode: sample.sampleCode,
        order: sample.order,
        ...(sample.label?.trim() ? { label: sample.label.trim() } : {}),
        ...(normalizedCoffee(sample) ? { coffee: normalizedCoffee(sample) } : {})
      }))
  };
}

function structureSignature(manifest: YingxiangEventManifest): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    organizerName: manifest.organizerName,
    cuppingMode: manifest.cuppingMode,
    samples: [...manifest.samples]
      .sort((a, b) => a.order - b.order)
      .map((sample) => ({ eventSampleId: sample.eventSampleId, sampleCode: sample.sampleCode, order: sample.order }))
  });
}

function fullSignature(context: YingxiangEventContext): string {
  return JSON.stringify({
    eventId: context.eventId,
    eventRevision: context.eventRevision,
    title: context.title,
    status: context.status,
    policy: normalizePolicy(context.policy),
    manifest: normalizedManifest(context.manifest),
    createdAt: context.createdAt,
    updatedAt: context.updatedAt
  });
}

function statusMayAdvance(previous: YingxiangEventStatus, next: YingxiangEventStatus): boolean {
  if (previous === next) return true;
  if (previous === "completed" || previous === "cancelled") return false;
  if (previous === "draft") return next === "published" || next === "active" || next === "completed" || next === "cancelled";
  if (previous === "published") return next === "active" || next === "completed" || next === "cancelled";
  return next === "completed" || next === "cancelled";
}

function disclosureIsSuperset(previous: YingxiangEventManifest, next: YingxiangEventManifest): boolean {
  const nextById = new Map(next.samples.map((sample) => [sample.eventSampleId, sample] as const));
  for (const prior of previous.samples) {
    const current = nextById.get(prior.eventSampleId);
    if (!current) return false;
    if (prior.label?.trim() && current.label?.trim() !== prior.label.trim()) return false;
    const priorCoffee = normalizedCoffee(prior) ?? {};
    const currentCoffee = normalizedCoffee(current) ?? {};
    for (const [key, value] of Object.entries(priorCoffee)) if (currentCoffee[key] !== value) return false;
  }
  return true;
}

function validateContext(context: YingxiangEventContext): void {
  if (!context.eventId.normalize("NFKC").trim() || !context.title.normalize("NFKC").trim()) throw new Error("YINGXIANG_EVENT_CONTEXT_INVALID");
  if (!Number.isSafeInteger(context.eventRevision) || context.eventRevision < 1) throw new Error("YINGXIANG_EVENT_REVISION_INVALID");
  if (!context.createdAt.trim() || !context.updatedAt.trim()) throw new Error("YINGXIANG_EVENT_TIMESTAMP_REQUIRED");
  validateYingxiangManifest(context.manifest, context.status !== "draft");
}

export class YingxiangParticipantEventRefresher {
  private readonly store: YingxiangEventStore;

  constructor(private readonly db: SQLiteDriver) {
    this.store = new YingxiangEventStore(db);
  }

  async refresh(context: YingxiangEventContext, cachedAt: string): Promise<RefreshResult> {
    validateContext(context);
    if (!cachedAt.trim()) throw new Error("YINGXIANG_EVENT_CACHE_TIMESTAMP_REQUIRED");
    const existing = await this.store.getEventContext(context.eventId);
    if (!existing) {
      await this.write(context, cachedAt);
      return "created";
    }
    if (context.eventRevision < existing.eventRevision) throw new Error("YINGXIANG_STALE_EVENT_REVISION");
    if (context.eventRevision > existing.eventRevision) {
      await this.write(context, cachedAt);
      return "updated";
    }
    if (fullSignature(context) === fullSignature(existing)) {
      await this.db.run("UPDATE yingxiang_event_contexts SET cached_at = ? WHERE event_id = ?", [cachedAt, context.eventId]);
      return "already_present";
    }
    if (context.createdAt !== existing.createdAt
      || JSON.stringify(normalizePolicy(context.policy)) !== JSON.stringify(normalizePolicy(existing.policy))
      || structureSignature(context.manifest) !== structureSignature(existing.manifest)
      || !statusMayAdvance(existing.status, context.status)
      || !disclosureIsSuperset(existing.manifest, context.manifest)) {
      throw new Error("YINGXIANG_EVENT_REVISION_CONFLICT");
    }
    await this.write(context, cachedAt);
    return "updated";
  }

  private async write(context: YingxiangEventContext, cachedAt: string): Promise<void> {
    await this.db.run(
      `INSERT INTO yingxiang_event_contexts
       (event_id, event_revision, title, status, policy_json, manifest_json, created_at, updated_at, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         event_revision=excluded.event_revision,
         title=excluded.title,
         status=excluded.status,
         policy_json=excluded.policy_json,
         manifest_json=excluded.manifest_json,
         updated_at=excluded.updated_at,
         cached_at=excluded.cached_at`,
      [
        context.eventId,
        context.eventRevision,
        context.title,
        context.status,
        JSON.stringify(normalizePolicy(context.policy)),
        JSON.stringify(normalizedManifest(context.manifest)),
        context.createdAt,
        context.updatedAt,
        cachedAt
      ]
    );
  }
}
