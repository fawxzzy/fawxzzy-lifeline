import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildWave1DryRunPlan,
  parseWave1ReleaseMetadata,
  serializeWave1ReleaseMetadata,
  validateWave1DeployManifest,
  validateWave1ReleaseMetadata,
  WAVE1_DEPLOY_CONTRACT_VERSION,
  WAVE1_DRY_RUN_PLAN_VERSION,
  WAVE1_RELEASE_METADATA_VERSION,
} from "../../control-plane/wave1-deploy-contract.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = path.join(
  repoRoot,
  "control-plane/fixtures/wave1-pilot-deploy.manifest.json",
);
const deploySchemaPath = path.join(
  repoRoot,
  "schemas/wave1-deploy-contract.schema.json",
);
const metadataSchemaPath = path.join(
  repoRoot,
  "schemas/wave1-release-metadata.schema.json",
);
const docsPath = path.join(
  repoRoot,
  "docs/contracts/wave1-deploy-contract.md",
);

function readJson(filePath) {
  return readFile(filePath, "utf8").then((content) => JSON.parse(content));
}

const sampleManifest = await readJson(fixturePath);
const deploySchema = await readJson(deploySchemaPath);
const metadataSchema = await readJson(metadataSchemaPath);
const docs = await readFile(docsPath, "utf8");

const originalManifestSnapshot = JSON.stringify(sampleManifest);
const validation = validateWave1DeployManifest(sampleManifest);

assert.equal(validation.issues.length, 0, `unexpected deploy issues: ${JSON.stringify(validation.issues, null, 2)}`);
assert.equal(validation.manifest?.contractVersion, WAVE1_DEPLOY_CONTRACT_VERSION);
assert.equal(validation.manifest?.artifactRef, sampleManifest.imageRef);
assert.equal(JSON.stringify(sampleManifest), originalManifestSnapshot, "dry-run validation must not mutate the input manifest");

const dryRunPlan = buildWave1DryRunPlan(sampleManifest, {
  releaseId: "release-20260421-0002",
  createdAt: "2026-04-21T12:00:00.000Z",
});

assert.equal(dryRunPlan.contractVersion, WAVE1_DRY_RUN_PLAN_VERSION);
assert.equal(dryRunPlan.validation.status, "passed");
assert.deepEqual(
  dryRunPlan.steps.map((step) => step.step),
  [
    "validate-manifest",
    "canonicalize-artifact-ref",
    "prepare-release-metadata",
    "preserve-rollback-target",
  ],
);
assert.equal(dryRunPlan.releaseMetadata?.contractVersion, WAVE1_RELEASE_METADATA_VERSION);
assert.equal(dryRunPlan.releaseMetadata?.artifactRef, sampleManifest.imageRef);
assert.equal(dryRunPlan.releaseMetadata?.dryRun, true);

const roundTripped = parseWave1ReleaseMetadata(
  serializeWave1ReleaseMetadata(dryRunPlan.releaseMetadata),
);
assert.equal(roundTripped.issues.length, 0, `unexpected release metadata issues: ${JSON.stringify(roundTripped.issues, null, 2)}`);
assert.deepEqual(roundTripped.metadata, dryRunPlan.releaseMetadata);

const invalidManifest = validateWave1DeployManifest({
  ...sampleManifest,
  healthcheckPath: "health",
  rollbackTarget: {
    ...sampleManifest.rollbackTarget,
    strategy: "rollback-now",
  },
});

assert.deepEqual(invalidManifest.issues, [
  { path: "healthcheckPath", message: "must start with '/'" },
  {
    path: "rollbackTarget.strategy",
    message: "must be one of: redeploy, restore",
  },
]);

const invalidMetadata = validateWave1ReleaseMetadata({
  ...dryRunPlan.releaseMetadata,
  validation: {
    status: "pending",
    issues: [],
  },
});

assert(invalidMetadata.issues.some((issue) => issue.path === "validation.status"));

assert.equal(
  deploySchema.properties.contractVersion.const,
  WAVE1_DEPLOY_CONTRACT_VERSION,
);
assert.equal(
  metadataSchema.properties.contractVersion.const,
  WAVE1_RELEASE_METADATA_VERSION,
);
assert.equal(
  deploySchema.properties.rollbackTarget.properties.strategy.enum.join(","),
  "redeploy,restore",
);
assert.ok(
  docs.includes("artifactRef") &&
    docs.includes("imageRef") &&
    docs.includes("rollbackTarget.strategy"),
  "docs/contracts/wave1-deploy-contract.md should describe the canonical deploy and metadata fields",
);

console.log("Wave 1 deploy contract deterministic checks passed");
