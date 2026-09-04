import { CloudflareAuthClient } from "../core/auth-client";
import type { BatchSetupDraft } from "../core/batch-setup-draft";
import { CuppingSessionController, type ObservationIdFactory } from "../core/cupping-session-controller";
import { CuppingSetupService } from "../core/cupping-setup-service";
import { RevisionCheckpointService } from "../core/revision-checkpoint-service";
import { SampleRecognitionService } from "../core/sample-recognition-service";
import { SessionRecordService } from "../core/session-record-service";
import { SessionShareClient } from "../core/session-share-client";
import { CloudflareSyncRepository } from "../core/sync-repository";
import { SyncEngine, type SyncRunResult } from "../core/sync-engine";
import { LocalAuthSessionStore, LocalPendingRegistrationStore } from "../storage/auth-session-store";
import type { SQLiteDriver } from "../storage/local-cupping-repository";
import { LocalCuppingRepository } from "../storage/local-cupping-repository";
import { RecentSessionReader } from "../storage/recent-session-reader";
import { SampleSummaryReader } from "../storage/sample-summary-reader";
import { SessionRecordsReader } from "../storage/session-records-reader";
import { StageProgressReader } from "../storage/stage-progress-reader";
import { SyncQueueStore } from "../storage/sync-queue-store";
import { UserPreferencesRepository } from "../storage/user-preferences-repository";
import { CuppingScreenController } from "../ui/cupping-screen-controller";
import { FlavorGroupPreferenceService } from "../ui/flavor-group-preferences";
import { AccountRenderer } from "../ui/dom/account-renderer";
import { BatchSetupRenderer } from "../ui/dom/batch-setup-renderer";
import { CuppingScreenRenderer } from "../ui/dom/stable-cupping-screen-renderer";
import { RecordReplayRenderer } from "../ui/dom/record-replay-renderer";
import { SessionRecordsRenderer } from "../ui/dom/session-records-renderer";

const BATCH_SETUP_DRAFT_KEY = "batch.setup.draft.v2";
const RECORD_ORDER_KEY = "records.order.v1";

export interface AromaSenseDomAppOptions {
  now(): string;
  createSessionId(): string;
  createSampleId(index: number): string;
  observationIdFactory: ObservationIdFactory;
  cloudBaseUrl?: string;
  firebaseApiKey?: string;
  firebaseProjectId?: string;
}

export interface AppPreloadState {
  account: "cloud-unconfigured" | "signed-out" | "pending-verification" | "signed-in";
  accountMessage: string;
  syncMessage: string;
  unfinishedSessions: number;
}

type RootMode = "setup" | "cupping" | "account" | "records" | "replay" | "empty";

interface HomeModalHandle {
  overlay: HTMLElement;
  content: HTMLElement;
  close(): void;
}

export class AromaSenseDomApp {
  private screen?: CuppingScreenRenderer;
  private readonly preferences: UserPreferencesRepository;
  private readonly authStore: LocalAuthSessionStore;
  private readonly pendingRegistrationStore: LocalPendingRegistrationStore;
  private readonly authClient?: CloudflareAuthClient;
  private readonly syncQueue: SyncQueueStore;
  private readonly syncEngine?: SyncEngine;
  private readonly revisions: RevisionCheckpointService;
  private readonly recognizer = new SampleRecognitionService();
  private preloadPromise?: Promise<AppPreloadState>;
  private homeModal?: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly db: SQLiteDriver, private readonly options: AromaSenseDomAppOptions) {
    this.preferences = new UserPreferencesRepository(db);
    this.authStore = new LocalAuthSessionStore(this.preferences, options.now);
    this.pendingRegistrationStore = new LocalPendingRegistrationStore(this.preferences, options.now);
    this.syncQueue = new SyncQueueStore(db);
    const repository = new LocalCuppingRepository(db);
    this.revisions = new RevisionCheckpointService(db, repository, this.syncQueue, { revisionId: () => crypto.randomUUID(), queueId: () => crypto.randomUUID() });

    if (this.hasCloudAuthConfiguration()) {
      this.authClient = new CloudflareAuthClient(options.cloudBaseUrl!, options.firebaseApiKey!, this.authStore, this.pendingRegistrationStore);
      const remote = new CloudflareSyncRepository(options.cloudBaseUrl!, { token: async () => (await this.authClient?.current())?.token });
      this.syncEngine = new SyncEngine(this.syncQueue, remote);
    }
  }

  preload(): Promise<AppPreloadState> {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = (async () => {
      await this.syncEngine?.recoverInterrupted();
      const [session, pending, counts, recent] = await Promise.all([
        this.authClient?.current(), this.authClient?.pendingRegistration(), this.syncQueue.counts(), new RecentSessionReader(this.db).list(50)
      ]);
      const waiting = counts.pending + counts.failed + counts.conflict;
      const configured = this.hasCloudAuthConfiguration();
      const account = !configured ? "cloud-unconfigured" as const : session ? "signed-in" as const : pending ? "pending-verification" as const : "signed-out" as const;
      return {
        account,
        accountMessage: !configured ? "Firebase / Cloudflare 云端认证尚未配置，本地功能可用"
          : session ? `已读取登录账户 ${session.email}` : pending ? `等待 Firebase 邮箱验证：${pending.email}` : "未登录，本地功能可用",
        syncMessage: waiting ? `${waiting} 项任务等待处理` : "本地同步队列已恢复",
        unfinishedSessions: recent.filter((item) => item.status === "draft" || item.status === "active").length
      };
    })().catch((error) => { this.preloadPromise = undefined; throw error; });
    return this.preloadPromise;
  }

  warmRecognition() { return this.recognizer.warmup(); }
  async start(): Promise<void> { await this.preload(); await this.showSetup(); }

  async showAccount(returnSessionId?: string): Promise<void> {
    this.closeHomeModal();
    this.screen?.dispose(); this.screen = undefined; this.setRootMode("account");
    await new AccountRenderer(this.root, this.authClient, {
      onAuthenticated: async () => { await this.syncPending(); if (returnSessionId) await this.openSession(returnSessionId); else await this.showSetup(); },
      onSkip: async () => { if (returnSessionId) await this.openSession(returnSessionId); else await this.showSetup(); },
      onSync: async () => { await this.syncPending(); },
      getSyncSummary: () => this.syncQueue.counts()
    }).render();
  }

  async showSetup(): Promise<void> {
    this.closeHomeModal();
    this.screen?.dispose(); this.screen = undefined; this.setRootMode("setup");
    const localRepository = new LocalCuppingRepository(this.db);
    const recentSessions = await new RecentSessionReader(this.db).list(10);
    const setup = new BatchSetupRenderer(this.root, new CuppingSetupService(localRepository), this.recognizer, {
      now: this.options.now,
      createSessionId: this.options.createSessionId,
      createSampleId: this.options.createSampleId,
      onCreated: (sessionId) => this.openSession(sessionId),
      onResume: (sessionId) => this.openSession(sessionId),
      onOpenRecent: (sessionId, readOnly) => readOnly ? this.showReplay(sessionId) : this.openSession(sessionId),
      onOpenAccount: () => this.showHomeAccountModal(),
      onOpenRecords: () => this.showHomeRecordsModal(),
      recentSessions,
      syncLabel: "账户",
      loadDraft: () => this.preferences.get<BatchSetupDraft>(BATCH_SETUP_DRAFT_KEY),
      saveDraft: (draft) => this.preferences.set(BATCH_SETUP_DRAFT_KEY, draft, this.options.now()),
      clearDraft: () => this.preferences.remove(BATCH_SETUP_DRAFT_KEY)
    });
    await setup.render();
  }

  async openSession(sessionId: string): Promise<void> {
    this.closeHomeModal();
    this.screen?.dispose(); this.screen = undefined; this.setRootMode("cupping");
    const repository = new LocalCuppingRepository(this.db);
    const editor = new CuppingSessionController(repository, this.options.observationIdFactory);
    const controller = new CuppingScreenController(repository, new StageProgressReader(this.db), editor, this.revisions);
    const flavorService = new FlavorGroupPreferenceService(this.preferences);
    this.screen = new CuppingScreenRenderer(this.root, controller, flavorService, new SampleSummaryReader(this.db), {
      now: this.options.now,
      onExit: async () => { await this.showSetup(); },
      onOpenAccount: async (activeSessionId) => { await this.showAccount(activeSessionId); },
      onOpenRecords: async () => { await this.showRecords(); },
      onSessionFinished: async (sessionId) => { await this.syncPending([sessionId]); }
    });
    await this.screen.initialize(sessionId);
  }

  async showRecords(): Promise<void> {
    this.closeHomeModal();
    this.screen?.dispose(); this.screen = undefined; this.setRootMode("records");
    const repository = new LocalCuppingRepository(this.db);
    const recordService = new SessionRecordService(repository, this.options.now);
    const records = await new SessionRecordsReader(this.db).list(300);
    const shareClient = this.hasCloudAuthConfiguration()
      ? new SessionShareClient(this.options.cloudBaseUrl!, async () => (await this.authClient?.current())?.token)
      : undefined;
    const renderer = new SessionRecordsRenderer(this.root, {
      records,
      onBack: () => this.showSetup(),
      onOpen: async (sessionId, readOnly) => { if (readOnly) await this.showReplay(sessionId); else await this.openSession(sessionId); },
      onDelete: async (sessionIds) => { for (const sessionId of sessionIds) await recordService.delete(sessionId); await this.showRecords(); },
      onSync: async (sessionIds) => { await this.syncPending(sessionIds); await this.showRecords(); },
      onShare: async (sessionId) => {
        if (!shareClient) throw new Error("请先在账户中登录后再生成服务器分享链接");
        const snapshot = await recordService.snapshot(sessionId);
        return (await shareClient.create(snapshot)).shareUrl;
      },
      onExport: async (sessionId) => { this.downloadRecord(await recordService.snapshot(sessionId)); },
      loadOrder: () => this.preferences.get<readonly string[]>(RECORD_ORDER_KEY),
      saveOrder: (ids) => this.preferences.set(RECORD_ORDER_KEY, [...ids], this.options.now())
    });
    await renderer.render();
  }

  async showReplay(sessionId: string): Promise<void> {
    this.closeHomeModal();
    this.screen?.dispose(); this.screen = undefined; this.setRootMode("replay");
    const snapshot = await new SessionRecordService(new LocalCuppingRepository(this.db), this.options.now).snapshot(sessionId);
    new RecordReplayRenderer(this.root, snapshot, () => this.showRecords()).render();
  }

  async syncPending(sessionIds?: readonly string[]): Promise<SyncRunResult | undefined> {
    if (!this.syncEngine || !(await this.authClient?.current())) return undefined;
    if (sessionIds?.length) await this.syncQueue.retrySessions(sessionIds, this.options.now());
    return this.syncEngine.runOnce(sessionIds);
  }

  async syncCounts() { return this.syncQueue.counts(); }

  dispose(): void { this.closeHomeModal(); this.screen?.dispose(); this.screen = undefined; this.setRootMode("empty"); }

  private installHomeModalStyles(): void {
    if (document.head.querySelector("style[data-aromasense-home-modal]")) return;
    const style = document.createElement("style");
    style.dataset.aromasenseHomeModal = "true";
    style.textContent = `
      .home-modal{position:fixed;inset:0;z-index:2200;display:grid;place-items:center;padding:22px;background:rgba(0,0,0,.68);backdrop-filter:blur(9px)}
      .home-modal__content{width:min(860px,calc(100vw - 32px));max-height:min(86dvh,820px);overflow:auto;border:1px solid rgba(214,173,99,.28);border-radius:16px;background:#151515;box-shadow:0 24px 70px rgba(0,0,0,.52)}
      .home-modal__content.account-screen{min-height:0;padding:1px 0 24px}
      .home-modal__content .account-card{margin:28px auto 18px}
      .home-modal__content.session-records{min-height:0!important;max-width:none!important;margin:0!important;padding:18px!important}
      .home-modal__content .session-records__version{display:none!important}
      @media(max-width:620px){.home-modal{padding:10px}.home-modal__content{width:calc(100vw - 20px);max-height:92dvh;border-radius:12px}.home-modal__content.session-records{padding:12px!important}}
    `;
    document.head.append(style);
  }

  private createHomeModal(label: string): HomeModalHandle {
    this.closeHomeModal();
    this.installHomeModalStyles();
    const overlay = document.createElement("div");
    overlay.className = "home-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", label);
    const content = document.createElement("div");
    content.className = "home-modal__content";
    overlay.append(content);
    const close = (): void => {
      if (this.homeModal === overlay) this.homeModal = undefined;
      overlay.remove();
    };
    overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    document.body.append(overlay);
    this.homeModal = overlay;
    return { overlay, content, close };
  }

  private closeHomeModal(): void {
    this.homeModal?.remove();
    this.homeModal = undefined;
  }

  private async showHomeAccountModal(): Promise<void> {
    const modal = this.createHomeModal("账户");
    modal.content.classList.add("account-screen");
    await new AccountRenderer(modal.content, this.authClient, {
      onAuthenticated: async () => {
        await this.syncPending();
        modal.close();
        await this.showSetup();
      },
      onSkip: () => modal.close(),
      onSync: async () => { await this.syncPending(); },
      getSyncSummary: () => this.syncQueue.counts()
    }).render();
  }

  private async showHomeRecordsModal(): Promise<void> {
    const modal = this.createHomeModal("杯测记录");
    modal.content.classList.add("session-records");
    const repository = new LocalCuppingRepository(this.db);
    const recordService = new SessionRecordService(repository, this.options.now);
    const records = await new SessionRecordsReader(this.db).list(300);
    const shareClient = this.hasCloudAuthConfiguration()
      ? new SessionShareClient(this.options.cloudBaseUrl!, async () => (await this.authClient?.current())?.token)
      : undefined;
    const renderer = new SessionRecordsRenderer(modal.content, {
      records,
      onBack: () => modal.close(),
      onOpen: async (sessionId, readOnly) => {
        modal.close();
        if (readOnly) await this.showReplay(sessionId);
        else await this.openSession(sessionId);
      },
      onDelete: async (sessionIds) => {
        for (const sessionId of sessionIds) await recordService.delete(sessionId);
        modal.close();
        await this.showHomeRecordsModal();
      },
      onSync: async (sessionIds) => {
        await this.syncPending(sessionIds);
        modal.close();
        await this.showHomeRecordsModal();
      },
      onShare: async (sessionId) => {
        if (!shareClient) throw new Error("请先在账户中登录后再生成服务器分享链接");
        const snapshot = await recordService.snapshot(sessionId);
        return (await shareClient.create(snapshot)).shareUrl;
      },
      onExport: async (sessionId) => { this.downloadRecord(await recordService.snapshot(sessionId)); },
      loadOrder: () => this.preferences.get<readonly string[]>(RECORD_ORDER_KEY),
      saveOrder: (ids) => this.preferences.set(RECORD_ORDER_KEY, [...ids], this.options.now())
    });
    await renderer.render();

    const toolbar = modal.content.querySelector<HTMLElement>(".session-records__toolbar");
    if (toolbar) {
      const importButton = document.createElement("button");
      importButton.type = "button";
      importButton.className = "session-records__tool";
      importButton.textContent = "导入";
      importButton.addEventListener("click", () => {
        modal.close();
        queueMicrotask(() => this.root.querySelector<HTMLButtonElement>(".batch-setup__import-inline")?.click());
      });
      toolbar.prepend(importButton);
    }
  }

  private downloadRecord(snapshot: unknown): void {
    const body = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([body], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `AromaSense-0.1C-${this.options.now().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private hasCloudAuthConfiguration(): boolean {
    return Boolean(this.options.cloudBaseUrl && this.options.firebaseApiKey && this.options.firebaseProjectId);
  }

  private setRootMode(mode: RootMode): void {
    this.root.replaceChildren();
    this.root.classList.remove("batch-setup", "aromasense-cupping", "account-screen", "startup-screen", "session-records", "record-replay");
    if (mode === "setup") this.root.classList.add("batch-setup");
    if (mode === "cupping") this.root.classList.add("aromasense-cupping");
    if (mode === "account") this.root.classList.add("account-screen");
    if (mode === "records") this.root.classList.add("session-records");
    if (mode === "replay") this.root.classList.add("record-replay");
    this.root.dataset.screen = mode;
  }
}
