import { SENSORY_DICTIONARY_VERSION } from "../core/sensory-dictionary-v1";
import localSchema from "../storage/0001_local_schema.sql";
import sessionMetadataMigration from "../storage/0002_session_metadata.sql";
import workflowMigration from "../storage/0003_workflow_event_comparison.sql";
import submissionMigration from "../storage/0004_submission_revisions.sql";
import sessionTimingMigration from "../storage/0005_session_timing.sql";
import yingxiangEventMigration from "../storage/0006_yingxiang_event_context.sql";
import { AndroidSQLiteDriver } from "../storage/android-sqlite-driver";
import { BrowserSQLiteDriver } from "../storage/browser-sqlite-driver";
import { LocalMigrationRunner, type SQLiteScriptDriver } from "../storage/local-migration-runner";
import { StartupRenderer } from "../ui/dom/startup-renderer";
import { AromaSenseDomApp } from "./dom-app";
import { YingxiangBrowserBootstrap } from "./yingxiang-browser-bootstrap";

async function openRuntimeDatabase(): Promise<SQLiteScriptDriver> {
  if (window.AromaSenseSQLite) return AndroidSQLiteDriver.fromWindow();
  return BrowserSQLiteDriver.open({
    databaseName: "aromasense-web-B0.1.a",
    wasmUrl: "./sql-wasm.wasm"
  });
}

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("APP_ROOT_NOT_FOUND");

  let app: AromaSenseDomApp | undefined;
  let yingxiang: YingxiangBrowserBootstrap | undefined;
  const startup = new StartupRenderer(root, {
    onEnter: async () => {
      if (!app) return;
      startup.setEntering();
      await app.start();
      await yingxiang?.openPendingInvite();
    }
  });
  root.classList.add("startup-screen");
  root.dataset.screen = "startup";
  startup.render();
  startup.setStatus("dictionary", "ready", `${SENSORY_DICTIONARY_VERSION} 已载入`);
  startup.setStatus("database", "loading", "正在打开本地数据库…");

  const db = await openRuntimeDatabase();
  await new LocalMigrationRunner(db).apply(
    [
      { id: 1, name: "local_schema_v1", sql: localSchema },
      { id: 2, name: "session_metadata_0_1c", sql: sessionMetadataMigration },
      { id: 3, name: "workflow_event_comparison_0_2", sql: workflowMigration },
      { id: 4, name: "submission_revisions_0_2", sql: submissionMigration },
      { id: 5, name: "session_timing_0_2", sql: sessionTimingMigration },
      { id: 6, name: "yingxiang_event_context_0_1", sql: yingxiangEventMigration }
    ],
    new Date().toISOString()
  );
  startup.setStatus("database", "ready", "本地数据库与迁移已就绪");

  const now = () => new Date().toISOString();
  const cloudBaseUrl = document.documentElement.dataset.cloudBaseUrl || undefined;
  const createSessionId = () => crypto.randomUUID();
  const createSampleId = () => crypto.randomUUID();
  app = new AromaSenseDomApp(root, db, {
    now,
    createSessionId,
    createSampleId,
    observationIdFactory: (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`,
    cloudBaseUrl,
    firebaseApiKey: document.documentElement.dataset.firebaseApiKey || undefined,
    firebaseProjectId: document.documentElement.dataset.firebaseProjectId || undefined
  });

  yingxiang = new YingxiangBrowserBootstrap(root, db, {
    now,
    createSessionId,
    createSampleId,
    onOpenSession: (sessionId) => app?.openSession(sessionId),
    cloudBaseUrl
  });
  yingxiang.start();

  startup.setStatus("recognition", "ready", "图像识别按需加载；首次识别时初始化");
  startup.allowEnter();

  startup.setStatus("account", "loading", "正在读取本地账户状态…");
  startup.setStatus("sync", "loading", "正在恢复本地同步队列…");
  void app.preload().then((state) => {
    startup.setStatus("account", state.account === "signed-in" ? "ready" : "degraded", state.accountMessage);
    startup.setStatus("sync", "ready", `${state.syncMessage}${state.unfinishedSessions ? ` · ${state.unfinishedSessions} 个未完成杯测` : ""}`);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    startup.setStatus("account", "degraded", "账户状态读取失败，本地杯测仍可使用");
    startup.setStatus("sync", "degraded", `同步队列恢复异常：${message}`);
  });

  window.addEventListener("online", () => { void app?.syncPending(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void app?.syncPending();
  });
}

void main().catch((error) => {
  const root = document.getElementById("app");
  if (root) root.textContent = `AromaSense 启动失败：${error instanceof Error ? error.message : String(error)}`;
});
