declare module "*.mjs" {
  export interface FoundationAiAdapterResult {
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    errors?: readonly string[];
    result?: Record<string, unknown>;
  }

  export function createZhipuAiAdapter(options: {
    apiKey?: string;
    model?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }): { enrichCoffeeBatch(samples: readonly string[]): Promise<FoundationAiAdapterResult> };
}
