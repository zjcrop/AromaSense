import { CuppingSessionController, type ObservationIdFactory } from "../core/cupping-session-controller";
import { CuppingSetupService } from "../core/cupping-setup-service";
import type { SQLiteDriver } from "../storage/local-cupping-repository";
import { LocalCuppingRepository } from "../storage/local-cupping-repository";
import { SampleSummaryReader } from "../storage/sample-summary-reader";
import { StageProgressReader } from "../storage/stage-progress-reader";
import { UserPreferencesRepository } from "../storage/user-preferences-repository";
import { CuppingScreenController } from "../ui/cupping-screen-controller";
import { FlavorGroupPreferenceService } from "../ui/flavor-group-preferences";
import { BatchSetupRenderer } from "../ui/dom/batch-setup-renderer";
import { BrowserVoicePromptPlayer } from "../ui/dom/browser-voice";
import { CuppingScreenRenderer } from "../ui/dom/cupping-screen-renderer";

export interface AromaSenseDomAppOptions {
  now(): string;
  createSessionId(): string;
  createSampleId(index: number): string;
  observationIdFactory: ObservationIdFactory;
}

export class AromaSenseDomApp {
  private screen?: CuppingScreenRenderer;

  constructor(
    private readonly root: HTMLElement,
    private readonly db: SQLiteDriver,
    private readonly options: AromaSenseDomAppOptions
  ) {}

  showSetup(): void {
    this.screen?.dispose();
    this.root.replaceChildren();
    const localRepository = new LocalCuppingRepository(this.db);
    const setup = new BatchSetupRenderer(
      this.root,
      new CuppingSetupService(localRepository),
      {
        now: this.options.now,
        createSessionId: this.options.createSessionId,
        createSampleId: this.options.createSampleId,
        onCreated: (sessionId) => this.openSession(sessionId)
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
      editor
    );
    const flavorService = new FlavorGroupPreferenceService(new UserPreferencesRepository(this.db));
    this.screen = new CuppingScreenRenderer(
      this.root,
      controller,
      flavorService,
      new SampleSummaryReader(this.db),
      {
        now: this.options.now,
        voicePlayer: new BrowserVoicePromptPlayer()
      }
    );
    await this.screen.initialize(sessionId);
  }

  dispose(): void {
    this.screen?.dispose();
    this.screen = undefined;
    this.root.replaceChildren();
  }
}
