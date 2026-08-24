import { CloudflareAuthClient } from "../core/auth-client";
import { CuppingSessionController, type ObservationIdFactory } from "../core/cupping-session-controller";
import { CuppingSetupService } from "../core/cupping-setup-service";
import { RevisionCheckpointService } from "../core/revision-checkpoint-service";
import { SampleRecognitionService } from "../core/sample-recognition-service";
import { CloudflareSyncRepository } from "../core/sync-repository";
import { SyncEngine, type SyncRunResult } from "../core/sync-engine";
import { LocalAuthSessionStore } from "../storage/auth-session-store";
import type { SQLiteDriver } from "../storage/local-cupping-repository";
import { LocalCuppingRepository } from "../storage/local-cupping-repository";
import { RecentSessionReader } from "../storage/recent-session-reader";
import { SampleSummaryReader } from "../storage/sample-summary-reader";
import { StageProgressReader } from "../storage/stage-progress-reader";
import { SyncQueueStore } from "../storage/sync-queue-store";
import { UserPreferencesRepository } from "../storage/user-preferences-repository";
import { CuppingScreenController } from "../ui/cupping-screen-controller";
import { FlavorGroupPreferenceService } from "../ui/flavor-group-preferences";
import { AccountRenderer } from "../ui/dom/account-renderer";
import { BatchSetupRenderer } from "../ui/dom/batch-setup-renderer";
import { BrowserVoicePromptPlayer } from "../ui/dom/browser-voice";
import { CuppingScreenRenderer } from "../ui/dom/cupping-screen-renderer";

export interface AromaSenseDomAppOptions {
  now(): string;
  createSessionId(): string;
  createSampleId(index: number): string;
  observationIdFactory: ObservationIdFactory;
  cloudBaseUrl?: string;
}

export class AromaSenseDomApp {
  private screen?: CuppingScreenRenderer;
  private readonly preferences: UserPreferencesRepository;
  private readonly authStore: LocalAuthSessionStore;
  private readonly authClient?: CloudflareAuthClient;
  private readonly syncQueue: SyncQueueStore;
  private readonly syncEngine?: SyncEngine;
  private readonly revisions: RevisionCheckpointService;

  constructor(
    private readonly root: HTMLElement,
    private readonly db: SQLiteDriver,
    private readonly options: AromaSenseDomAppOptions
  ) {
    this.preferences = new UserPreferencesRepository(db);
    this.authStore = new LocalAuthSessionStore(this.preferences, options.now);
    this.syncQueue = new SyncQueueStore(db);
    const repository = new LocalCuppingRepository(db);
    this.revisions = new RevisionCheckpointService(
      db,
      repository,
      this.syncQueue,
      { revisionId: () => crypto.randomUUID(), queueId: () => crypto.randomUUID() }
    );

    if (options.cloudBaseUrl) {
      this.authClient = new CloudflareAuthClient(options.cloudBaseUrl, this.authStore);
      const remote = new CloudflareSyncRepository(options.cloudBaseUrl, {
        token: async () => (await this.authClient?.current())?.token
      });
      this.syncEngine = new SyncEngine(this.syncQueue, remote);
    }
  }

  async start(): Promise<void> {
    await this.syncEngine?.recoverInterrupted();
    await this.showSetup();
  }

  async showAccount(returnSessionId?: string): Promise<void> {
    this.screen?.dispose();
    this.screen = undefined;
    this.root.replaceChildren();
    await new AccountRenderer(this.root, this.authClient, {
      onAuthenticated: async () => {
        await this.syncPending();
        if (returnSessionId) await this.openSession(returnSessionId);
        else await this.showSetup();
      },
      onSkip: async () => {
        if (returnSessionId) await this.openSession(returnSessionId);
        else await this.showSetup();
      },
      onSync: async () => { await this.syncPending(); },
      getSyncSummary: () => this.syncQueue.counts()
    }).render();
  }

  async showSetup(): Promise<void> {
    this.screen?.dispose();
    this.screen = undefined;
    this.root.replaceChildren();
    const localRepository = new LocalCuppingRepository(this.db);
    const recentSessions = await new RecentSessionReader(this.db).list(10);
    const current = await this.authClient?.current();
    const counts = await this.syncQueue.counts();
    const waiting = counts.pending + counts.failed + counts.conflict;
    const setup = new BatchSetupRenderer(
      this.root,
      new CuppingSetupService(localRepository),
      new SampleRecognitionService(),
      {
        now: this.options.now,
        createSessionId: this.options.createSessionId,
        createSampleId: this.options.createSampleId,
        onCreated: (sessionId) => this.openSession(sessionId),
        onResume: (sessionId) => this.openSession(sessionId),
        onOpenAccount: () => this.showAccount(),
        recentSessions,
        syncLabel: current ? (waiting ? `同步 ${waiting}` : "账户 · 已登录") : "账户 / 同步"
      }
    );
    setup.render();
  }

  async openSession(sessionId: string): Promise<void> {
    this.screen?.dispose();
    this.root.replaceChildren();

    const repository = new LocalCuppingRepository(this.db);
    const editor = new CuppingSessionController(repository, this.options.observationIdFactory);
    const controller = new CuppingScreenController(
      repository,
      new StageProgressReader(this.db),
      editor,
      this.revisions
    );
    const flavorService = new FlavorGroupPreferenceService(this.preferences);
    const counts = await this.syncQueue.counts();
    const waiting = counts.pending + counts.failed + counts.conflict;
    this.screen = new CuppingScreenRenderer(
      this.root,
      controller,
      flavorService,
      new SampleSummaryReader(this.db),
      {
        now: this.options.now,
        voicePlayer: new BrowserVoicePromptPlayer(),
        syncLabel: waiting ? `同步 ${waiting}` : "同步",
        onExit: async () => { await this.showSetup(); },
        onOpenAccount: async (activeSessionId) => { await this.showAccount(activeSessionId); },
        onSync: async () => { await this.syncPending(); },
        onSessionFinished: async () => {
          await this.syncPending();
        }
      }
    );
    await this.screen.initialize(sessionId);
  }

  async syncPending(): Promise<SyncRunResult | undefined> {
    if (!this.syncEngine || !(await this.authClient?.current())) return undefined;
    return this.syncEngine.runOnce();
  }

  async syncCounts() {
    return this.syncQueue.counts();
  }

  dispose(): void {
    this.screen?.dispose();
    this.screen = undefined;
    this.root.replaceChildren();
  }
}
