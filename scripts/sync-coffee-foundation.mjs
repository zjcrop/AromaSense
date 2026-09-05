import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export const FOUNDATION_RELEASE_ID = "coffee-foundation-1.0.4";
export const FOUNDATION_RELEASE_URL = "https://raw.githubusercontent.com/zjcrop/BrewIon/f6b018c9ba5f0b0c3c87465275defe85a7bbafe5/foundation/releases/coffee-foundation-1.0.4.json";

const projectRoot = resolve(import.meta.dirname, "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function validateManifest(manifest) {
  if (manifest?.contract !== "coffee-foundation/1.0" || manifest?.releaseId !== FOUNDATION_RELEASE_ID || !Array.isArray(manifest?.artifacts)) {
    throw new Error("Coffee Foundation 1.0.4 release manifest is invalid");
  }
  const runtime = manifest.artifacts.filter((artifact) => String(artifact?.kind ?? "").startsWith("foundation/runtime/"));
  if (!runtime.some((artifact) => artifact.kind.endsWith("/index.mjs")) || !runtime.some((artifact) => artifact.kind.endsWith("/ai-adapter.mjs"))) {
    throw new Error("Coffee Foundation runtime artifacts are incomplete");
  }
  return runtime;
}

async function localFoundationRoot() {
  const candidates = [process.env.AROMASENSE_FOUNDATION_ROOT, resolve(projectRoot, "../BrewIon-foundation-ai")].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(resolve(candidate, `foundation/releases/${FOUNDATION_RELEASE_ID}.json`))) return candidate;
  }
  return undefined;
}

export async function materializeCoffeeFoundation(destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(resolve(destination, "runtime"), { recursive: true });
  const localRoot = await localFoundationRoot();
  const manifest = localRoot
    ? JSON.parse(await readFile(resolve(localRoot, `foundation/releases/${FOUNDATION_RELEASE_ID}.json`), "utf8"))
    : JSON.parse((await fetchBytes(FOUNDATION_RELEASE_URL)).toString("utf8"));
  const artifacts = validateManifest(manifest);

  for (const artifact of artifacts) {
    const target = resolve(destination, "runtime", basename(artifact.kind));
    const bytes = localRoot ? await readFile(resolve(localRoot, artifact.kind)) : await fetchBytes(artifact.url);
    if (bytes.byteLength !== Number(artifact.bytes) || sha256(bytes) !== String(artifact.sha256).toLowerCase()) {
      throw new Error(`Coffee Foundation integrity check failed: ${artifact.kind}`);
    }
    await writeFile(target, bytes);
  }
  return { releaseId: FOUNDATION_RELEASE_ID, entry: resolve(destination, "runtime/index.mjs") };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const destination = resolve(process.argv[2] ?? resolve(projectRoot, "cloud/worker/.foundation"));
  const result = await materializeCoffeeFoundation(destination);
  process.stdout.write(`${result.releaseId}\n`);
}
