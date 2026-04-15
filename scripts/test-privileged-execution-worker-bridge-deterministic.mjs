import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGovernedRegistry } from "../dist/core/tool-registry.js";

const scriptsDir = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const distCli = path.join(repoRoot, "dist", "cli.js");
const examplesRoot = path.join(repoRoot, "examples", "privileged-execution");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = stableJsonValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(stableJsonValue(value), null, 2);
}

function digestValue(value) {
  return `sha256:${createHash("sha256").update(stableJsonStringify(value), "utf8").digest("hex")}`;
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function currentRegistryDigest() {
  const atlasRoot = path.resolve(repoRoot, "..", "..");
  const registry = await loadGovernedRegistry(atlasRoot);
  return registry.registryDigest;
}

function normalizeScenarioPayloads({ request, approval, capability, registryDigest }) {
  request.registry_digest = registryDigest;
  request.automation_level = "request_action";

  approval.request_id = request.request_id;
  approval.worker_id = request.worker_id;
  approval.assignment_id = request.assignment_id;
  approval.stack_lock_digest = request.stack_lock_digest;
  approval.tool_id = request.tool_id;
  approval.extension_id = request.extension_id;
  approval.registry_digest = registryDigest;
  approval.automation_level = "approved_action";
  approval.request_digest = digestValue(request);

  if (approval.approval_status === "approved") {
    approval.granted_scope = request.requested_capability;
  }

  return { request, approval, capability };
}

function parseReceiptPath(stdout) {
  const match = stdout.match(/Receipt written:\s*(.+)\s*$/m);
  return match ? match[1].trim() : null;
}

async function runScenario({
  name,
  requestPath,
  approvalPath,
  capabilityProfilePath,
  skipNormalize,
  expectedExitCode,
}) {
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  let preparedRequestPath = requestPath;
  let preparedApprovalPath = approvalPath;
  let preparedCapabilityPath = capabilityProfilePath;
  let cleanupDir = null;
  if (!skipNormalize) {
    const registryDigest = await currentRegistryDigest();
    const approval = JSON.parse(await readFile(approvalPath, "utf8"));
    const capability = JSON.parse(await readFile(capabilityProfilePath, "utf8"));
    normalizeScenarioPayloads({ request, approval, capability, registryDigest });
    cleanupDir = path.join(
      os.tmpdir(),
      `lifeline-worker-bridge-inputs-${name}-${Date.now()}`,
    );
    preparedRequestPath = path.join(cleanupDir, "request.json");
    preparedApprovalPath = path.join(cleanupDir, "approval.json");
    preparedCapabilityPath = path.join(cleanupDir, "capability.json");
    await writeJson(preparedRequestPath, request);
    await writeJson(preparedApprovalPath, approval);
    await writeJson(preparedCapabilityPath, capability);
  }
  const receiptDir = path.join(
    os.tmpdir(),
    `lifeline-worker-bridge-receipts-${name}-${Date.now()}`,
  );
  const result = spawnSync(
    "node",
    [
      distCli,
      "execute",
      preparedRequestPath,
      "--capability-profile",
      preparedCapabilityPath,
      "--approval-receipt",
      preparedApprovalPath,
      "--receipt-dir",
      receiptDir,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ATLAS_ROOT: path.resolve(repoRoot, "..", ".."),
      },
    },
  );

  if (result.error) {
    throw result.error;
  }

  assert(
    result.status === expectedExitCode,
    `${name}: expected exit ${expectedExitCode}, got ${result.status}\n${result.stdout}\n${result.stderr}`,
  );

  const output = `${result.stdout}\n${result.stderr}`;
  const receiptPath = parseReceiptPath(output);
  const receipt = receiptPath
    ? JSON.parse(await readFile(receiptPath, "utf8"))
    : null;
  return { receipt, receiptPath, receiptDir, request, cleanupDir, output };
}

async function createMutatedScenario({
  name,
  baseRequestName,
  baseApprovalName,
  baseCapabilityName,
  mutate,
  afterNormalize,
  expectedExitCode,
  expectedBlockedReasonContains,
}) {
  const request = JSON.parse(
    await readFile(path.join(examplesRoot, baseRequestName), "utf8"),
  );
  const approval = JSON.parse(
    await readFile(path.join(examplesRoot, baseApprovalName), "utf8"),
  );
  const capability = JSON.parse(
    await readFile(path.join(examplesRoot, baseCapabilityName), "utf8"),
  );

  mutate({ request, approval, capability });
  normalizeScenarioPayloads({
    request,
    approval,
    capability,
    registryDigest: await currentRegistryDigest(),
  });
  if (typeof afterNormalize === "function") {
    afterNormalize({ request, approval, capability });
    approval.request_digest = digestValue(request);
  }

  const tempDir = path.join(
    os.tmpdir(),
    `lifeline-governed-surface-${name}-${Date.now()}`,
  );
  const requestPath = path.join(tempDir, "request.json");
  const approvalPath = path.join(tempDir, "approval.json");
  const capabilityProfilePath = path.join(tempDir, "capability.json");
  await writeJson(requestPath, request);
  await writeJson(approvalPath, approval);
  await writeJson(capabilityProfilePath, capability);

  return {
    name,
    requestPath,
    approvalPath,
    capabilityProfilePath,
    skipNormalize: true,
    expectedExitCode,
    expectedBlockedReasonContains,
    cleanupDir: tempDir,
  };
}

async function createWorkspaceWriteScenario({
  name,
  mutate,
  afterNormalize,
  expectedExitCode,
  expectedBlockedReasonContains,
}) {
  const atlasRoot = path.resolve(repoRoot, "..", "..");
  const registry = await loadGovernedRegistry(atlasRoot);
  const tool = registry.tools.get("workspace_file_apply");
  if (!tool) {
    throw new Error("workspace_file_apply is missing from the governed registry.");
  }

  const workspaceRoot = `runtime/atlas/session-workspaces/${name}`;
  const request = {
    contract_version: "atlas.privileged-action.request.v1",
    request_id: `workspace-write-${name}`,
    requested_at: "2026-04-14T12:00:00Z",
    worker_id: "worker-lifeline-01",
    assignment_id: `assignment-lifeline-${name}`,
    stack_lock_digest: "sha256:lifeline-stack-lock-001",
    tool_id: "workspace_file_apply",
    extension_id: null,
    registry_digest: registry.registryDigest,
    source_refs: [
      "runtime/atlas/sessions/session-bridge-test/session.manifest.json",
      "runtime/atlas/sessions/session-bridge-test/artifacts/worker.assignment.json",
      "runtime/atlas/sessions/session-bridge-test/artifacts/worker.status.running.json",
    ],
    action: {
      summary: "Apply one bounded file write inside the declared session workspace.",
      operation: "scoped_write",
      command: [],
      cwd: ".",
      workspace_root: workspaceRoot,
      write_target: "governed-write.txt",
      write_content: `scenario=${name}\n`,
    },
    target_paths: [
      workspaceRoot,
      `${workspaceRoot}/governed-write.txt`,
    ],
    target_resources: ["filesystem"],
    requested_capability: tool.capability_profile,
  };
  const approval = {
    contract_version: "atlas.approval.receipt.v1",
    approval_receipt_id: `approval-${name}`,
    request_id: request.request_id,
    worker_id: request.worker_id,
    assignment_id: request.assignment_id,
    stack_lock_digest: request.stack_lock_digest,
    tool_id: request.tool_id,
    extension_id: null,
    registry_digest: registry.registryDigest,
    approver: {
      kind: "system",
      name: "lifeline-policy-gate",
    },
    approval_status: "approved",
    granted_scope: tool.capability_profile,
    expiry_at: "2026-04-15T23:59:59Z",
    issued_at: "2026-04-14T12:00:05Z",
    request_digest: "",
  };
  const capability = structuredClone(tool.capability_profile);

  if (typeof mutate === "function") {
    mutate({ request, approval, capability });
  }
  normalizeScenarioPayloads({
    request,
    approval,
    capability,
    registryDigest: registry.registryDigest,
  });
  if (typeof afterNormalize === "function") {
    afterNormalize({ request, approval, capability });
    approval.request_digest = digestValue(request);
  }

  const tempDir = path.join(
    os.tmpdir(),
    `lifeline-workspace-write-${name}-${Date.now()}`,
  );
  await writeJson(path.join(tempDir, "request.json"), request);
  await writeJson(path.join(tempDir, "approval.json"), approval);
  await writeJson(path.join(tempDir, "capability.json"), capability);

  return {
    name,
    requestPath: path.join(tempDir, "request.json"),
    approvalPath: path.join(tempDir, "approval.json"),
    capabilityProfilePath: path.join(tempDir, "capability.json"),
    skipNormalize: true,
    expectedExitCode,
    expectedBlockedReasonContains,
    cleanupDir: tempDir,
    workspaceRootAbsolute: path.join(atlasRoot, request.action.workspace_root),
  };
}

async function main() {
  await access(distCli).catch(() => {
    throw new Error("dist/cli.js is missing. Run `pnpm build` first.");
  });

  const scenarios = [
    {
      name: "read-only",
      requestPath: path.join(examplesRoot, "read-only-scan.request.json"),
      approvalPath: path.join(examplesRoot, "read-only-scan.approval.json"),
      capabilityProfilePath: path.join(examplesRoot, "capability-profile.json"),
      expectedExitCode: 0,
    },
    {
      name: "dry-run-approved",
      requestPath: path.join(examplesRoot, "dry-run-command.request.json"),
      approvalPath: path.join(examplesRoot, "dry-run-command.approval.json"),
      capabilityProfilePath: path.join(
        examplesRoot,
        "capability-profile.scoped-write-dry-run.json",
      ),
      expectedExitCode: 0,
    },
    {
      name: "dry-run-rejected",
      requestPath: path.join(examplesRoot, "dry-run-command.request.json"),
      approvalPath: path.join(
        examplesRoot,
        "dry-run-command.rejected.approval.json",
      ),
      capabilityProfilePath: path.join(
        examplesRoot,
        "capability-profile.scoped-write-dry-run.json",
      ),
      expectedExitCode: 1,
      expectedBlockedReasonContains: "approval_status",
    },
    {
      name: "dry-run-expired",
      requestPath: path.join(examplesRoot, "dry-run-command.request.json"),
      approvalPath: path.join(
        examplesRoot,
        "dry-run-command.expired.approval.json",
      ),
      capabilityProfilePath: path.join(
        examplesRoot,
        "capability-profile.scoped-write-dry-run.json",
      ),
      expectedExitCode: 1,
      expectedBlockedReasonContains: "approval_status",
    },
    await createMutatedScenario({
      name: "unknown-tool",
      baseRequestName: "read-only-scan.request.json",
      baseApprovalName: "read-only-scan.approval.json",
      baseCapabilityName: "capability-profile.json",
      mutate: ({ request, approval }) => {
        request.tool_id = "unknown.tool";
        approval.approval_status = "approved";
      },
      expectedExitCode: 1,
      expectedBlockedReasonContains: "unknown tool_id",
    }),
    await createMutatedScenario({
      name: "capability-mismatch",
      baseRequestName: "read-only-scan.request.json",
      baseApprovalName: "read-only-scan.approval.json",
      baseCapabilityName: "capability-profile.json",
      mutate: ({ request, approval, capability }) => {
        request.requested_capability.allowed_data_classes = ["public"];
        approval.granted_scope = request.requested_capability;
        capability.allowed_data_classes = ["public"];
      },
      expectedExitCode: 1,
      expectedBlockedReasonContains: "registered tool capability",
    }),
    await createWorkspaceWriteScenario({
      name: "workspace-write-approved",
      expectedExitCode: 0,
    }),
    await createWorkspaceWriteScenario({
      name: "workspace-write-out-of-scope",
      mutate: ({ request }) => {
        request.action.write_target = "../outside.txt";
        request.target_paths = [
          request.action.workspace_root,
          `${request.action.workspace_root}/../outside.txt`,
        ];
      },
      expectedExitCode: 1,
      expectedBlockedReasonContains: "escapes the declared workspace root",
    }),
    await createWorkspaceWriteScenario({
      name: "workspace-write-automation-mismatch",
      afterNormalize: ({ request }) => {
        request.automation_level = "approved_action";
      },
      expectedExitCode: 1,
      expectedBlockedReasonContains: "request.automation_level",
    }),
  ];

  for (const scenario of scenarios) {
    const { receipt, receiptPath, receiptDir, request, cleanupDir, output } =
      await runScenario(scenario);
    assert(
      Array.isArray(request.source_refs),
      `${scenario.name}: request.source_refs missing`,
    );
    if (receipt) {
      assert(
        Array.isArray(receipt.source_refs),
        `${scenario.name}: receipt.source_refs missing`,
      );
      assert(
        JSON.stringify(receipt.source_refs) ===
          JSON.stringify(request.source_refs),
        `${scenario.name}: receipt.source_refs did not preserve the request source_refs`,
      );
      assert(
        receipt.worker_id === "worker-lifeline-01",
        `${scenario.name}: worker_id mismatch`,
      );
      assert(
        receipt.assignment_id.startsWith("assignment-lifeline-"),
        `${scenario.name}: assignment_id mismatch`,
      );
      assert(
        receipt.stack_lock_digest === "sha256:lifeline-stack-lock-001",
        `${scenario.name}: stack_lock_digest mismatch`,
      );
      assert(
        receipt.tool_id === request.tool_id,
        `${scenario.name}: tool_id mismatch`,
      );
      assert(
        receipt.extension_id === (request.extension_id ?? null),
        `${scenario.name}: extension_id mismatch`,
      );
      assert(
        receipt.registry_digest === request.registry_digest,
        `${scenario.name}: registry_digest mismatch`,
      );
    }

    if (scenario.expectedExitCode === 0) {
      assert(receipt, `${scenario.name}: expected a receipt`);
      assert(
        receipt.result === "succeeded",
        `${scenario.name}: expected succeeded receipt`,
      );
      if (scenario.name === "read-only") {
        assert(
          receipt.execution_mode === "read_only_scan",
          `${scenario.name}: execution_mode mismatch`,
        );
        assert(
          receipt.inspection && receipt.inspection.records.length === 2,
          `${scenario.name}: expected two inspection records`,
        );
      } else {
        if (scenario.name.startsWith("workspace-write")) {
          assert(
            receipt.execution_mode === "workspace_file_apply",
            `${scenario.name}: execution_mode mismatch`,
          );
          assert(
            Array.isArray(receipt.write_results) &&
              receipt.write_results.length === 1,
            `${scenario.name}: expected one write result`,
          );
        } else {
          assert(
          receipt.execution_mode === "dry_run_command",
          `${scenario.name}: execution_mode mismatch`,
        );
          assert(
          receipt.command_result && receipt.command_result.exit_code === 0,
          `${scenario.name}: expected successful dry-run command`,
        );
        }
      }
    } else {
      if (receipt) {
        assert(
          receipt.result === "blocked",
          `${scenario.name}: expected blocked receipt`,
        );
        assert(
          typeof receipt.blocked_reason === "string" &&
            receipt.blocked_reason.length > 0,
          `${scenario.name}: blocked receipt missing reason`,
        );
        if (scenario.expectedBlockedReasonContains) {
          assert(
            receipt.blocked_reason.includes(scenario.expectedBlockedReasonContains),
            `${scenario.name}: blocked reason did not mention ${scenario.expectedBlockedReasonContains}`,
          );
        }
      } else if (scenario.expectedBlockedReasonContains) {
        assert(
          output.includes(scenario.expectedBlockedReasonContains),
          `${scenario.name}: expected failure output to mention ${scenario.expectedBlockedReasonContains}`,
        );
      } else {
        throw new Error(`${scenario.name}: expected a receipt or explicit failure output.`);
      }
    }

    await rm(receiptDir, { recursive: true, force: true });
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true });
    }
    if (scenario.cleanupDir) {
      await rm(scenario.cleanupDir, { recursive: true, force: true });
    }
    if (scenario.workspaceRootAbsolute) {
      await rm(scenario.workspaceRootAbsolute, { recursive: true, force: true });
    }
    console.log(`${scenario.name}: ${receiptPath ?? "no-receipt"}`);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
