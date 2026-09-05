import { CuppingSetupService } from "./cupping-setup-service";
import type { YingxiangClient, YingxiangInvitePreview, YingxiangRemoteEvent } from "./yingxiang-client";
import type { YingxiangEventPrincipal } from "./yingxiang-event";
import type { SQLiteDriver } from "../storage/local-cupping-repository";
import { LocalCuppingRepository } from "../storage/local-cupping-repository";
import { YingxiangEventStore, type YingxiangEventContext } from "../storage/yingxiang-event-store";

export interface YingxiangParticipationOptions {
  now(): string;
  createSessionId(): string;
  createSampleId(index: number): string;
}

export interface JoinYingxiangInput {
  token: string;
  joinRequestId: string;
  displayName?: string;
  nameSource?: "custom" | "account";
}

export interface JoinedYingxiangSession {
  eventId: string;
  participantId: string;
  displayName: string;
  sessionId: string;
  resumed: boolean;
}

function eventContext(event: YingxiangRemoteEvent): YingxiangEventContext {
  return {
    eventId: event.eventId,
    eventRevision: event.eventRevision,
    title: event.title,
    status: event.status,
    policy: event.policy,
    manifest: event.manifest,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

function localPrincipal(remote: Awaited<ReturnType<YingxiangClient["joinInvite"]>>["principal"]): YingxiangEventPrincipal {
  return {
    schemaVersion: "yingxiang-principal/0.1",
    principalId: remote.participantId,
    eventId: remote.eventId,
    participantId: remote.participantId,
    identityKind: remote.identityKind,
    accountUserId: remote.accountUserId,
    displayName: remote.displayName,
    accountDisplayNameHidden: true,
    status: "active",
    boundAt: remote.boundAt
  };
}

function localDateTime(now: string): { date: string; time: string } {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("YINGXIANG_NOW_INVALID");
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export class YingxiangParticipationService {
  private readonly events: YingxiangEventStore;
  private readonly setup: CuppingSetupService;

  constructor(
    private readonly db: SQLiteDriver,
    private readonly client: Pick<YingxiangClient, "previewInvite" | "joinInvite">,
    private readonly options: YingxiangParticipationOptions
  ) {
    this.events = new YingxiangEventStore(db);
    this.setup = new CuppingSetupService(new LocalCuppingRepository(db));
  }

  preview(token: string): Promise<YingxiangInvitePreview> {
    return this.client.previewInvite(token);
  }

  async join(input: JoinYingxiangInput): Promise<JoinedYingxiangSession> {
    const joined = await this.client.joinInvite(input.token, {
      joinRequestId: input.joinRequestId,
      displayName: input.displayName,
      nameSource: input.nameSource
    });
    const existing = await this.events.getSessionBinding(joined.event.eventId, joined.principal.participantId);
    if (existing) {
      return {
        eventId: joined.event.eventId,
        participantId: joined.principal.participantId,
        displayName: joined.principal.displayName,
        sessionId: existing.sessionId,
        resumed: true
      };
    }

    const now = this.options.now();
    const dateTime = localDateTime(now);
    const sessionId = this.options.createSessionId();
    const samples = [...joined.event.manifest.samples]
      .sort((a, b) => a.order - b.order)
      .map((sample) => ({
        label: sample.label || sample.sampleCode,
        metadata: {
          eventSampleId: sample.eventSampleId,
          sampleCode: sample.sampleCode,
          eventRevision: joined.event.eventRevision
        }
      }));

    await this.db.transaction(async () => {
      await this.events.putEventContext(eventContext(joined.event), now);
      await this.events.putPrincipal(localPrincipal(joined.principal));
      await this.setup.create({
        sessionId,
        title: joined.event.title,
        metadata: {
          ...dateTime,
          organizer: joined.event.manifest.organizerName,
          participants: joined.principal.displayName,
          eventName: joined.event.title,
          cuppingMode: joined.event.manifest.cuppingMode,
          eventId: joined.event.eventId,
          eventRevision: joined.event.eventRevision
        },
        samples,
        now,
        sampleIdFactory: (index) => this.options.createSampleId(index)
      });
      await this.events.bindSession({
        eventId: joined.event.eventId,
        participantId: joined.principal.participantId,
        sessionId,
        boundAt: now
      });
    });

    return {
      eventId: joined.event.eventId,
      participantId: joined.principal.participantId,
      displayName: joined.principal.displayName,
      sessionId,
      resumed: joined.replayed
    };
  }
}
