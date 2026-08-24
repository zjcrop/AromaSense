export const PRODUCT_VERSION = "B0.1.a" as const;
export const VERSION_STAGE = "beta" as const;

/**
 * Product-facing version policy:
 * - Pre-release builds use a leading `B`.
 * - The numeric major version remains below 1 until the product is formally finalized.
 * - Versions advance only at coherent development/acceptance milestones, not per patch commit.
 *
 * Tooling that requires SemVer uses the mapped technical version from package.json.
 */
export const VERSION_POLICY = {
  productVersion: PRODUCT_VERSION,
  stage: VERSION_STAGE,
  majorMustRemainBelowOneBeforeFinal: true,
  incrementPerPatchCommit: false
} as const;
