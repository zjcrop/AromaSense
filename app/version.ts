export const PRODUCT_VERSION = "0.1C" as const;
export const VERSION_STAGE = "alpha" as const;

export const VERSION_POLICY = {
  productVersion: PRODUCT_VERSION,
  stage: VERSION_STAGE,
  majorMustRemainBelowOneBeforeFinal: true,
  incrementPerPatchCommit: false
} as const;
