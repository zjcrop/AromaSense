import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const androidOut = resolve(root, "mobile/android/app/src/main/assets/www");
const pagesOut = resolve(root, "site");
const cloudBaseUrl = process.env.AROMASENSE_CLOUD_URL ?? "";

async function buildTarget(out) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await build({
    entryPoints: [resolve(root, "app/runtime/web-entry.ts")],
    outfile: resolve(out, "app.js"),
    bundle: true,
    platform: "browser",
    target: ["chrome110"],
    format: "iife",
    sourcemap: true,
    loader: { ".sql": "text" },
    legalComments: "none"
  });

  for (const file of ["aromasense-cupping.css", "batch-setup.css", "account.css"]) {
    await cp(resolve(root, `app/ui/dom/${file}`), resolve(out, file));
  }

  await cp(resolve(root, "node_modules/sql.js/dist/sql-wasm.wasm"), resolve(out, "sql-wasm.wasm"));

  const template = await readFile(resolve(root, "web/index.template.html"), "utf8");
  await writeFile(
    resolve(out, "index.html"),
    template.replaceAll(
      "__CLOUD_BASE_URL__",
      cloudBaseUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    ),
    "utf8"
  );
  await writeFile(resolve(out, ".nojekyll"), "", "utf8");
}

await buildTarget(androidOut);
await buildTarget(pagesOut);
