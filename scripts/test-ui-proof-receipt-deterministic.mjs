import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const distCli = path.join(repoRoot, "dist", "cli.js");

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseReceiptPath(stdout) {
  const match = stdout.match(/Receipt written:\s*(.+)\s*$/m);
  return match ? match[1].trim() : null;
}

function runCli(args, atlasRoot) {
  const result = spawnSync("node", [distCli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ATLAS_ROOT: atlasRoot,
    },
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

async function seedProofRoot(root, overrides = {}) {
  await writeFile(path.join(root, "stack.yaml"), "name: ATLAS\n", "utf8");

  const semanticRef = "runtime\\atlas\\ui-observe\\drift\\fitness\\latest.json";
  const visualRef = "runtime\\atlas\\ui-visual-proof\\fitness\\latest.json";
  const summaryRef = "runtime\\atlas\\ui-proof\\fitness\\latest.json";

  await writeJson(path.join(root, semanticRef), {
    contract_version: "atlas.ui.drift-report.v1",
    report_id: "sha256:semantic-proof-clean",
    status: "clean",
    finding_count: 0,
  });
  await writeJson(path.join(root, visualRef), {
    contract_version: "atlas.ui.visual-proof.v1",
    report_id: "sha256:visual-proof-clean",
    status: "clean",
    gated_capture_count: 2,
    failed_capture_ids: [],
  });

  const summary = {
    contract_version: "atlas.ui.proof-summary.v1",
    report_id: "sha256:proof-summary-clean",
    generated_at: "2026-04-21T14:37:56.988018Z",
    runner_version: "atlas.ui.proof-summary.fitness.v1",
    owner_repo_id: "fitness",
    completion_ready: true,
    failed_capture_ids: [],
    blocking_reasons: [],
    summary: {
      status: "completion_ready",
      semantic_status: "clean",
      visual_status: "clean",
      gated_capture_count: 2,
      failed_capture_count: 0,
    },
    semantic_proof: {
      status: "clean",
      report_ref: semanticRef,
      report_id: "sha256:semantic-proof-clean",
      finding_count: 0,
      failed_capture_ids: [],
      errors: [],
    },
    visual_proof: {
      status: "clean",
      report_ref: visualRef,
      report_id: "sha256:visual-proof-clean",
      gated_capture_count: 2,
      failed_capture_ids: [],
      errors: [],
    },
    operator_summary: [
      "Semantic drift clean and visual proof clean across 2 gated captures.",
    ],
    ...overrides,
  };
  await writeJson(path.join(root, summaryRef), summary);

  return {
    semanticRef,
    visualRef,
    summaryPath: path.join(root, summaryRef),
  };
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lifeline-ui-proof-"));
  try {
    const { summaryPath, semanticRef, visualRef } = await seedProofRoot(tempRoot);
    const successReceiptDir = path.join(tempRoot, "proof-receipts-success");
    const success = runCli(
      [
        "proof-pass",
        summaryPath,
        "--source-repo",
        "fitness",
        "--tranche",
        "F11",
        "--receipt-dir",
        successReceiptDir,
      ],
      tempRoot,
    );

    assert.equal(
      success.status,
      0,
      `expected successful proof-pass exit 0, got ${success.status}\n${success.stdout}\n${success.stderr}`,
    );
    const receiptPath = parseReceiptPath(success.stdout);
    assert(receiptPath, "proof-pass success did not print a receipt path");
    assert(!receiptPath.includes("\\"), "receipt path should be normalized");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.contract_version, "atlas.ui.proof-passed.receipt.v1");
    assert.equal(receipt.status, "proof_passed");
    assert.equal(receipt.source_repo_id, "fitness");
    assert.equal(receipt.tranche_id, "F11");
    assert.equal(
      receipt.proof_summary.summary_ref,
      "runtime/atlas/ui-proof/fitness/latest.json",
    );
    assert.equal(
      receipt.proof_refs.semantic_report_ref,
      "runtime/atlas/ui-observe/drift/fitness/latest.json",
    );
    assert.equal(
      receipt.proof_refs.visual_report_ref,
      "runtime/atlas/ui-visual-proof/fitness/latest.json",
    );
    assert.deepEqual(receipt.source_refs, [
      "runtime/atlas/ui-proof/fitness/latest.json",
      "runtime/atlas/ui-observe/drift/fitness/latest.json",
      "runtime/atlas/ui-visual-proof/fitness/latest.json",
    ]);

    const repeat = runCli(
      [
        "proof-pass",
        summaryPath,
        "--source-repo",
        "fitness",
        "--tranche",
        "F11",
        "--receipt-dir",
        successReceiptDir,
      ],
      tempRoot,
    );
    assert.equal(repeat.status, 0);
    const repeatReceiptPath = parseReceiptPath(repeat.stdout);
    assert.equal(repeatReceiptPath, receiptPath);
    const repeatReceipt = JSON.parse(await readFile(repeatReceiptPath, "utf8"));
    assert.equal(repeatReceipt.receipt_id, receipt.receipt_id);

    const missingSummary = runCli(
      [
        "proof-pass",
        path.join(tempRoot, "runtime", "atlas", "ui-proof", "fitness", "missing.json"),
        "--source-repo",
        "fitness",
        "--tranche",
        "F11",
      ],
      tempRoot,
    );
    assert.equal(missingSummary.status, 1);
    assert.match(
      missingSummary.stderr,
      /Failure category: environment_error[\s\S]*First remediation step:/i,
      "missing summary should fail with a read error",
    );

    const semanticBlockedRoot = await mkdtemp(
      path.join(os.tmpdir(), "lifeline-ui-proof-semantic-"),
    );
    try {
      const semanticSeed = await seedProofRoot(semanticBlockedRoot, {
        completion_ready: false,
        blocking_reasons: ["semantic drift detected"],
        summary: {
          status: "proof_blocked",
          semantic_status: "drift_detected",
          visual_status: "clean",
          gated_capture_count: 2,
          failed_capture_count: 1,
        },
        semantic_proof: {
          status: "drift_detected",
          report_ref: "runtime/atlas/ui-observe/drift/fitness/latest.json",
          report_id: "sha256:semantic-proof-drift",
          finding_count: 1,
          failed_capture_ids: ["curated-onboarding-shell"],
          errors: [],
        },
      });
      const semanticBlocked = runCli(
        [
          "proof-pass",
          semanticSeed.summaryPath,
          "--source-repo",
          "fitness",
          "--tranche",
          "F11",
        ],
        semanticBlockedRoot,
      );
      assert.equal(semanticBlocked.status, 1);
      assert.match(
        semanticBlocked.stderr,
        /Failure category: config_error[\s\S]*First remediation step:/i,
        "red semantic proof should block receipt emission",
      );
    } finally {
      await rm(semanticBlockedRoot, { recursive: true, force: true });
    }

    const visualBlockedRoot = await mkdtemp(
      path.join(os.tmpdir(), "lifeline-ui-proof-visual-"),
    );
    try {
      const visualSeed = await seedProofRoot(visualBlockedRoot, {
        completion_ready: false,
        blocking_reasons: ["visual proof failed"],
        summary: {
          status: "proof_blocked",
          semantic_status: "clean",
          visual_status: "proof_failed",
          gated_capture_count: 2,
          failed_capture_count: 1,
        },
        visual_proof: {
          status: "proof_failed",
          report_ref: "runtime/atlas/ui-visual-proof/fitness/latest.json",
          report_id: "sha256:visual-proof-failed",
          gated_capture_count: 2,
          failed_capture_ids: ["today-overview-default"],
          errors: ["unexpected visual delta"],
        },
      });
      const visualBlocked = runCli(
        [
          "proof-pass",
          visualSeed.summaryPath,
          "--source-repo",
          "fitness",
          "--tranche",
          "F11",
        ],
        visualBlockedRoot,
      );
      assert.equal(visualBlocked.status, 1);
      assert.match(
        visualBlocked.stderr,
        /Failure category: config_error[\s\S]*First remediation step:/i,
        "red visual proof should block receipt emission",
      );
    } finally {
      await rm(visualBlockedRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
