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

export interface AppPreloadState {
  account: "cloud-unconfigured" | "signed-out" | "signed-in";
  accountMessage: string;
  syncMessage: string;
  unfinishedSessions: number;
}

type RootMode = "setup" | "cupping" | "account" | "empty";

export class AromaSenseDomApp {
  private screen?: CuppingScreenRenderer;
  private readonly preferences: UserPreferencesRepository;
  private readonly authStore: LocalAuthSessionStore;
  private readonly authClient?: CloudflareAuthClient;
  private readonly syncQueue: SyncQueueStore;
  private readonly syncEngine?: SyncEngine;
  private readonly revisions: RevisionCheckpointService;
  private readonly recognizer = new SampleRecognitionService();
  private preloadPromise?: Promise<AppPreloadState>;

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

  preload(): Promise<AppPreloadState> {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = (async () => {
      await this.syncEngine?.recoverInterrupted();
      const [session, counts, recent] = await Promise.all([
        this.authClient?.current(),
        this.syncQueue.counts(),
        new RecentSessionReader(this.db).list(50)
      ]);
      const waiting = counts.pending + counts.failed + counts.conflict;
      return {
        account: !this.options.cloudBaseUrl ? "cloud-unconfigured" : session ? "signed-in" : "signed-out",
        accountMessage: !this.options.cloudBaseUrl
          ? "云服务未配置，本地功能可用"
          : session
            ? `已读取登录账户 ${session.email}`
            : "未登录，本地功能可用",
        syncMessage: waiting ? `${waiting} 项任务等待处理` : "本地同步队列已恢复",
        unfinishedSessions: recent.filter((item) => item.status === "draft" || item.status === "active").length
      };
    })().catch((error) => {
      this.preloadPromise = undefined;
      throw error;
    });
    return this.preloadPromise;
  }

  warmRecognition() {
    return this.recognizer.warmup();
  }

  async start(): Promise<void> {
    await this.preload();
    await this.showSetup();
  }

  async showAccount(returnSessionId?: string): Promise<void> {
    this.screen?.dispose();
    this.screen = undefined;
    this.setRootMode("account");
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
    this.setRootMode("setup");
    const localRepository = new LocalCuppingRepository(this.db);
    const recentSessions = await new RecentSessionReader(this.db).list(10);
    const current = await this.authClient?.current();
    const counts = await this.syncQueue.counts();
    const waiting = counts.pending + counts.failed + counts.conflict;
    const setup = new BatchSetupRenderer(
      this.root,
      new CuppingSetupService(localRepository),
      this.recognizer,
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
    this.screen = undefined;
    this.setRootMode("cupping");

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
        onSessionFinished: async () => { await this.syncPending(); }
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
    this.setRootMode("empty");
  }

  private setRootMode(mode: RootMode): void {
    this.root.replaceChildren();
    this.root.classList.remove("batch-setup", "aromasense-cupping", "account-screen", "startup-screen");
    if (mode === "setup") this.root.classList.add("batch-setup");
    if (mode === "cupping") this.root.classList.add("aromasense-cupping");
    if (mode === "account") this.root.classList.add("account-screen");
    this.root.dataset.screen = mode;
  }
}
