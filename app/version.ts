export const PRODUCT_VERSION = "B0.2.a" as const;
export const VERSION_STAGE = "alpha" as const;

export const VERSION_POLICY = {
  productVersion: PRODUCT_VERSION,
  stage: VERSION_STAGE,
  majorMustRemainBelowOneBeforeFinal: true,
  incrementPerPatchCommit: false
} as const;
