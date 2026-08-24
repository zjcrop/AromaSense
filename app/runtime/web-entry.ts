import localSchema from "../storage/0001_local_schema.sql";
import { AndroidSQLiteDriver } from "../storage/android-sqlite-driver";
import { AromaSenseDomApp } from "./dom-app";
import { PRODUCT_VERSION } from "../version";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("APP_ROOT_NOT_FOUND");

  const version = document.getElementById("version");
  if (version) version.textContent = PRODUCT_VERSION;

  const db = AndroidSQLiteDriver.fromWindow();
  db.exec(localSchema);

  const app = new AromaSenseDomApp(root, db, {
    now: () => new Date().toISOString(),
    createSessionId: () => crypto.randomUUID(),
    createSampleId: () => crypto.randomUUID(),
    observationIdFactory: (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`,
    cloudBaseUrl: document.documentElement.dataset.cloudBaseUrl || undefined
  });

  await app.start();
  window.addEventListener("online", () => { void app.syncPending(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void app.syncPending();
  });
}

void main().catch((error) => {
  const root = document.getElementById("app");
  if (root) root.textContent = `AromaSense 启动失败：${error instanceof Error ? error.message : String(error)}`;
});
