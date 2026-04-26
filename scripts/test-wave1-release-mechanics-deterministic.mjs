import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  activateWave1Release,
  persistWave1Release,
  readWave1ReleaseState,
  rollbackWave1Release,
} from "../control-plane/wave1-release-engine.mjs";

function createManifest({
  appName,
  artifactRef,
  rollbackReleaseId,
  rollbackArtifactRef,
}) {
  return {
    contractVersion: "atlas.lifeline.deploy-contract.v1",
    appName,
    artifactRef,
    route: {
      domain: `${appName}.lifeline.internal`,
      path: "/",
    },
    envRefs: [],
    healthcheckPath: "/healthz",
    migrationHooks: {
      preDeploy: ["pnpm verify"],
      postDeploy: ["pnpm smoke:release"],
      rollback: ["pnpm rollback:release"],
    },
    rollbackTarget: {
      releaseId: rollbackReleaseId,
      artifactRef: rollbackArtifactRef,
      strategy: "restore",
    },
  };
}

async function readJson(rootDir, relativePath) {
  return JSON.parse(await readFile(path.join(rootDir, relativePath), "utf8"));
}

const tempRoot = await mkdtemp(
  path.join(os.tmpdir(), "lifeline-release-mechanics-"),
);

try {
  const appName = "lifeline-pilot";

  const releaseA = await persistWave1Release(
    createManifest({
      appName,
      artifactRef: "ghcr.io/fawxzzy/lifeline-pilot@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rollbackReleaseId: "bootstrap-release",
      rollbackArtifactRef:
        "ghcr.io/fawxzzy/lifeline-pilot@sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    {
      rootDir: tempRoot,
      releaseId: "release-20260425-0001",
      createdAt: "2026-04-25T18:00:00.000Z",
      receiptAt: "2026-04-25T18:00:00.000Z",
    },
  );
  assert.equal(releaseA.validation.status, "passed");
  assert.equal(releaseA.receipt.action, "planned");
  assert.equal(releaseA.receipt.releaseId, "release-20260425-0001");
  assert.equal(
    releaseA.receipt.releaseMetadataPath,
    ".lifeline/releases/lifeline-pilot/release-20260425-0001/metadata.json",
  );
  assert.equal(
    releaseA.receipt.releaseDirectory,
    ".lifeline/releases/lifeline-pilot/release-20260425-0001",
  );

  const activationA = await activateWave1Release(
    tempRoot,
    appName,
    releaseA.releaseId,
    {
      receiptAt: "2026-04-25T18:05:00.000Z",
      checkHealth: async () => ({ ok: true, status: 200 }),
    },
  );
  assert.equal(activationA.ok, true);
  assert.equal(activationA.current.releaseId, releaseA.releaseId);
  assert.equal(activationA.previous, undefined);

  const releaseB = await persistWave1Release(
    createManifest({
      appName,
      artifactRef: "ghcr.io/fawxzzy/lifeline-pilot@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      rollbackReleaseId: releaseA.releaseId,
      rollbackArtifactRef: releaseA.releaseMetadata.artifactRef,
    }),
    {
      rootDir: tempRoot,
      releaseId: "release-20260425-0002",
      createdAt: "2026-04-25T18:10:00.000Z",
      receiptAt: "2026-04-25T18:10:00.000Z",
    },
  );
  const activationB = await activateWave1Release(
    tempRoot,
    appName,
    releaseB.releaseId,
    {
      receiptAt: "2026-04-25T18:15:00.000Z",
      checkHealth: async () => ({ ok: true, status: 200 }),
    },
  );
  assert.equal(activationB.ok, true);
  assert.equal(activationB.current.releaseId, releaseB.releaseId);
  assert.equal(activationB.previous.releaseId, releaseA.releaseId);
  assert.equal(
    activationB.receipt.lineage.promotedFromReleaseId,
    releaseA.releaseId,
  );
  assert.equal(
    activationB.receipt.lineage.promotedToReleaseId,
    releaseB.releaseId,
  );
  assert.equal(activationB.receipt.health.status, 200);

  const stateAfterSuccess = await readWave1ReleaseState(tempRoot, appName);
  assert.equal(stateAfterSuccess.current.releaseId, releaseB.releaseId);
  assert.equal(stateAfterSuccess.previous.releaseId, releaseA.releaseId);

  const releaseC = await persistWave1Release(
    createManifest({
      appName,
      artifactRef: "ghcr.io/fawxzzy/lifeline-pilot@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      rollbackReleaseId: releaseB.releaseId,
      rollbackArtifactRef: releaseB.releaseMetadata.artifactRef,
    }),
    {
      rootDir: tempRoot,
      releaseId: "release-20260425-0003",
      createdAt: "2026-04-25T18:20:00.000Z",
      receiptAt: "2026-04-25T18:20:00.000Z",
    },
  );
  const failedActivation = await activateWave1Release(
    tempRoot,
    appName,
    releaseC.releaseId,
    {
      receiptAt: "2026-04-25T18:25:00.000Z",
      checkHealth: async () => ({
        ok: false,
        status: 503,
        error: "health gate rejected candidate",
      }),
    },
  );
  assert.equal(failedActivation.ok, false);
  assert.equal(failedActivation.current.releaseId, releaseB.releaseId);
  assert.equal(failedActivation.previous.releaseId, releaseA.releaseId);
  assert.equal(failedActivation.receipt.status, "failed");
  assert.equal(
    failedActivation.receipt.preservedCurrentReleaseId,
    releaseB.releaseId,
  );

  const stateAfterFailedActivation = await readWave1ReleaseState(tempRoot, appName);
  assert.equal(stateAfterFailedActivation.current.releaseId, releaseB.releaseId);
  assert.equal(stateAfterFailedActivation.previous.releaseId, releaseA.releaseId);

  const rollbackResult = await rollbackWave1Release(tempRoot, appName, {
    receiptAt: "2026-04-25T18:30:00.000Z",
    checkHealth: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(rollbackResult.ok, true);
  assert.equal(rollbackResult.current.releaseId, releaseA.releaseId);
  assert.equal(rollbackResult.previous.releaseId, releaseB.releaseId);
  assert.equal(rollbackResult.receipt.action, "rollback");
  assert.equal(rollbackResult.receipt.status, "succeeded");
  assert.equal(rollbackResult.receipt.previousReleaseId, releaseB.releaseId);

  const finalState = await readWave1ReleaseState(tempRoot, appName);
  assert.equal(finalState.current.releaseId, releaseA.releaseId);
  assert.equal(finalState.previous.releaseId, releaseB.releaseId);

  const activationReceipt = await readJson(
    tempRoot,
    activationB.receipt.receiptPath,
  );
  assert.equal(activationReceipt.releaseId, releaseB.releaseId);
  assert.equal(activationReceipt.action, "activate");
  assert.equal(
    activationReceipt.releaseMetadataPath,
    ".lifeline/releases/lifeline-pilot/release-20260425-0002/metadata.json",
  );

  const rollbackReceipt = await readJson(
    tempRoot,
    rollbackResult.receipt.receiptPath,
  );
  assert.equal(rollbackReceipt.releaseId, releaseA.releaseId);
  assert.equal(rollbackReceipt.previousReleaseId, releaseB.releaseId);
  assert.equal(rollbackReceipt.health.status, 200);

  console.log("Wave 1 release mechanics deterministic verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
