import assert from "node:assert/strict";
import test from "node:test";
import { createCoffeeFoundationGateway } from "../app/core/coffee-foundation-runtime";
import type { PageStructureInput, PageStructureResult } from "../app/core/page-structure-contract";

const dynamicImport = (0, eval)("(specifier) => import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>;

type MutableGlobal = typeof globalThis & {
  CoffeeFoundation?: Record<string, unknown>;
  LuckyBeanRecognitionCore?: Record<string, unknown>;
};

function blocksSideBySide(): PageStructureInput["blocks"] {
  return [
    { id: "l-origin", text: "Ethiopia Guji", x: 0.05, y: 0.10, width: 0.34, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "r-origin", text: "Colombia Huila", x: 0.57, y: 0.10, width: 0.36, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "l-variety", text: "Gesha", x: 0.05, y: 0.22, width: 0.22, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "r-variety", text: "Pink Bourbon", x: 0.57, y: 0.22, width: 0.32, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "l-process", text: "Washed", x: 0.05, y: 0.34, width: 0.22, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "r-process", text: "Honey Process", x: 0.57, y: 0.34, width: 0.31, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "l-flavor", text: "Jasmine Citrus", x: 0.05, y: 0.46, width: 0.34, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "r-flavor", text: "Peach Cacao", x: 0.57, y: 0.46, width: 0.31, height: 0.05, confidence: 0.98, roleHint: "coffee_core" }
  ];
}

function input(blocks = blocksSideBySide()): PageStructureInput {
  return { fullText: blocks.map((block) => block.text).join("\n"), blocks, layoutHints: { layoutType: "grid", segmentCount: 1 } };
}

function twoRecordResult(unassignedEvidence: readonly string[] = []): PageStructureResult {
  return {
    schemaVersion: "ai-page-structure-result/1.0",
    task: "structure-page",
    engine: "zhipu-test",
    model: "fixture",
    createdAt: "2026-09-07T10:00:00Z",
    inputFingerprint: "fixture-p3-structure-authority",
    samples: [
      {
        sampleRef: "left",
        confidence: 0.94,
        evidenceRefs: ["l-origin", "l-variety", "l-process", "l-flavor"],
        fields: [{ field: "country", value: "Ethiopia", confidence: 0.9, evidenceRefs: ["l-origin"] }]
      },
      {
        sampleRef: "right",
        confidence: 0.93,
        evidenceRefs: unassignedEvidence.includes("r-flavor")
          ? ["r-origin", "r-variety", "r-process"]
          : ["r-origin", "r-variety", "r-process", "r-flavor"],
        fields: [{ field: "country", value: "Colombia", confidence: 0.9, evidenceRefs: ["r-origin"] }]
      }
    ],
    unassignedEvidence,
    policy: { authority: "advisory", mayInventFact: false, mayOverwriteFact: false }
  };
}

async function withRuntime<T>(result: PageStructureResult, run: () => Promise<T>): Promise<T> {
  const target = globalThis as MutableGlobal;
  const previousCoffee = target.CoffeeFoundation;
  const previousRecognition = target.LuckyBeanRecognitionCore;
  const previousFetch = globalThis.fetch;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const core = await dynamicImport("luckybean-static-app/src/recognition-core.js");

  target.LuckyBeanRecognitionCore = core;
  target.CoffeeFoundation = {
    validateAiPageStructureResult(value: unknown) { return { ok: true, value }; }
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-US", onLine: true } });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  try {
    return await run();
  } finally {
    if (previousCoffee === undefined) delete target.CoffeeFoundation;
    else target.CoffeeFoundation = previousCoffee;
    if (previousRecognition === undefined) delete target.LuckyBeanRecognitionCore;
    else target.LuckyBeanRecognitionCore = previousRecognition;
    globalThis.fetch = previousFetch;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}

test("P3: P1 two-record AI grouping is released only after P0 structure recovery materializes it", async () => {
  await withRuntime(twoRecordResult(), async () => {
    const gateway = createCoffeeFoundationGateway("https://foundation.invalid", async () => "token");
    const result = await gateway.structurePage!(input());
    assert.equal(result.ok, true);
    assert.equal(result.result?.samples.length, 2);
  });
});

test("P3: unassigned evidence cannot bypass P0 by returning two P1 samples", async () => {
  await withRuntime(twoRecordResult(["r-flavor"]), async () => {
    const gateway = createCoffeeFoundationGateway("https://foundation.invalid", async () => "token");
    const result = await gateway.structurePage!(input());
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /^foundation-unassigned-evidence:/u);
  });
});

test("P3: a two-sample proposal is rejected when Foundation has no multi-record hypothesis support", async () => {
  const singleCoffeeBlocks: PageStructureInput["blocks"] = [
    { id: "origin", text: "Ethiopia Guji", x: 0.05, y: 0.10, width: 0.34, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "notes-heading", text: "Tasting Notes", x: 0.58, y: 0.10, width: 0.30, height: 0.05, confidence: 0.98, roleHint: "layout_context" },
    { id: "variety", text: "Gesha", x: 0.05, y: 0.22, width: 0.22, height: 0.05, confidence: 0.98, roleHint: "coffee_core" },
    { id: "note", text: "Jasmine Peach", x: 0.58, y: 0.22, width: 0.28, height: 0.05, confidence: 0.98, roleHint: "coffee_core" }
  ];
  const falseSplit: PageStructureResult = {
    ...twoRecordResult(),
    samples: [
      { sampleRef: "left", confidence: 0.95, evidenceRefs: ["origin", "variety"], fields: [] },
      { sampleRef: "right", confidence: 0.95, evidenceRefs: ["notes-heading", "note"], fields: [] }
    ],
    unassignedEvidence: []
  };
  await withRuntime(falseSplit, async () => {
    const gateway = createCoffeeFoundationGateway("https://foundation.invalid", async () => "token");
    const result = await gateway.structurePage!(input(singleCoffeeBlocks));
    assert.equal(result.ok, false);
  });
});
