import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function createFixtureTempDir(atlasRoot, prefix) {
  const tempRoot = path.join(atlasRoot, "tmp");
  await mkdir(tempRoot, { recursive: true });
  return mkdtemp(path.join(tempRoot, `${prefix}-`));
}

async function createAtlasFixtureRoot() {
  const atlasRoot = await mkdtemp(
    path.join(os.tmpdir(), "lifeline-atlas-fixture-"),
  );
  const readOnlyCapability = JSON.parse(
    await readFile(path.join(examplesRoot, "capability-profile.json"), "utf8"),
  );
  const dryRunCapability = JSON.parse(
    await readFile(
      path.join(examplesRoot, "capability-profile.scoped-write-dry-run.json"),
      "utf8",
    ),
  );
  const workspaceCapability = {
    contract_version: "atlas.capability.profile.v1",
    capability_profile_id: "cap-atlas-workspace-file-apply-v1",
    description: "ATLAS bounded workspace file apply capability profile.",
    filesystem_scopes: {
      read: ["runtime/atlas/session-workspaces/**"],
      write: ["runtime/atlas/session-workspaces/**"],
      create: ["runtime/atlas/session-workspaces/**"],
      deny: ["secrets/**", "repos/Verta-Core/**"],
    },
    network_scopes: {
      mode: "none",
      allowed_domains: [],
      blocked_domains: [],
    },
    process_execution_permissions: {
      allow_spawn: false,
      allow_shell: false,
      allow_python: false,
      allowed_commands: [],
      denied_commands: ["powershell", "cmd", "git", "node", "python"],
    },
    package_manager_permissions: {
      allow_install: false,
      allow_update: false,
      allowed_managers: [],
      blocked_managers: ["npm", "pnpm", "yarn"],
    },
    elevation_requirement: "per_action_approval",
    resource_budgets: {
      wall_clock_seconds: 120,
      cpu_seconds: 30,
      memory_mb: 256,
      disk_mb: 50,
    },
    allowed_data_classes: ["public", "internal", "machine_state"],
    audit_class: "standard",
  };

  const toolRegistry = {
    schema_version: "atlas.tool.registry.v1",
    kind: "atlas-tool-registry",
    entries: [
      {
        contract_version: "atlas.tool.catalog.entry.v1",
        tool_id: "read_only_scan",
        extension_id: null,
        trust_class: "trusted",
        release_eligible: true,
        max_automation_level: "approved_action",
        capability_profile: readOnlyCapability,
        approval: {
          required: true,
          approver_kind: "system",
          required_status: "approved",
          granted_scope_required: true,
        },
        invocation: {
          action_operation: "read_only_scan",
          execution_mode: "read_only_scan",
        },
      },
      {
        contract_version: "atlas.tool.catalog.entry.v1",
        tool_id: "scoped_write.dry_run",
        extension_id: null,
        trust_class: "trusted",
        release_eligible: true,
        max_automation_level: "approved_action",
        capability_profile: dryRunCapability,
        approval: {
          required: true,
          approver_kind: "system",
          required_status: "approved",
          granted_scope_required: true,
        },
        invocation: {
          action_operation: "scoped_write",
          execution_mode: "dry_run_command",
        },
      },
      {
        contract_version: "atlas.tool.catalog.entry.v1",
        tool_id: "workspace_file_apply",
        extension_id: null,
        trust_class: "trusted",
        release_eligible: true,
        max_automation_level: "approved_action",
        capability_profile: workspaceCapability,
        approval: {
          required: true,
          approver_kind: "system",
          required_status: "approved",
          granted_scope_required: true,
        },
        invocation: {
          action_operation: "scoped_write",
          execution_mode: "workspace_file_apply",
        },
      },
    ],
  };

  await writeFile(path.join(atlasRoot, "stack.yaml"), "stack_id: atlas-test\n", "utf8");
  await writeFile(path.join(atlasRoot, "README.md"), "# Fixture root\n", "utf8");
  await mkdir(path.join(atlasRoot, "docs"), { recursive: true });
  await mkdir(path.join(atlasRoot, "ops", "atlas"), { recursive: true });
  await writeFile(
    path.join(atlasRoot, "docs", "privileged-execution.md"),
    "# Privileged execution fixture\n",
    "utf8",
  );
  await writeFile(
    path.join(atlasRoot, "ops", "atlas", "observations.py"),
    "if __name__ == '__main__':\n    raise SystemExit(0)\n",
    "utf8",
  );
  await writeJson(
    path.join(atlasRoot, "docs", "registry", "ATLAS-TOOL-REGISTRY.json"),
    toolRegistry,
  );
  await writeJson(
    path.join(atlasRoot, "docs", "registry", "ATLAS-EXTENSION-REGISTRY.json"),
    {
      schema_version: "atlas.extension.registry.v1",
      kind: "atlas-extension-registry",
      entries: [],
    },
  );
  await mkdir(path.join(atlasRoot, "runtime", "atlas", "session-workspaces"), {
    recursive: true,
  });
  return atlasRoot;
}

async function currentRegistryDigest(atlasRoot) {
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
  atlasRoot,
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
    const registryDigest = await currentRegistryDigest(atlasRoot);
    const approval = JSON.parse(await readFile(approvalPath, "utf8"));
    const capability = JSON.parse(await readFile(capabilityProfilePath, "utf8"));
    normalizeScenarioPayloads({ request, approval, capability, registryDigest });
    cleanupDir = await createFixtureTempDir(
      atlasRoot,
      `lifeline-worker-bridge-inputs-${name}`,
    );
    preparedRequestPath = path.join(cleanupDir, "request.json");
    preparedApprovalPath = path.join(cleanupDir, "approval.json");
    preparedCapabilityPath = path.join(cleanupDir, "capability.json");
    await writeJson(preparedRequestPath, request);
    await writeJson(preparedApprovalPath, approval);
    await writeJson(preparedCapabilityPath, capability);
  }
  const receiptDir = await createFixtureTempDir(
    atlasRoot,
    `lifeline-worker-bridge-receipts-${name}`,
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
      cwd: atlasRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ATLAS_ROOT: atlasRoot,
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
  atlasRoot,
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
    registryDigest: await currentRegistryDigest(atlasRoot),
  });
  if (typeof afterNormalize === "function") {
    afterNormalize({ request, approval, capability });
    approval.request_digest = digestValue(request);
  }

  const tempDir = await createFixtureTempDir(
    atlasRoot,
    `lifeline-governed-surface-${name}`,
  );
  const requestPath = path.join(tempDir, "request.json");
  const approvalPath = path.join(tempDir, "approval.json");
  const capabilityProfilePath = path.join(tempDir, "capability.json");
  await writeJson(requestPath, request);
  await writeJson(approvalPath, approval);
  await writeJson(capabilityProfilePath, capability);

  return {
    atlasRoot,
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
  atlasRoot,
  name,
  mutate,
  afterNormalize,
  expectedExitCode,
  expectedBlockedReasonContains,
}) {
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
    expiry_at: "2099-12-31T23:59:59Z",
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

  const tempDir = await createFixtureTempDir(
    atlasRoot,
    `lifeline-workspace-write-${name}`,
  );
  await writeJson(path.join(tempDir, "request.json"), request);
  await writeJson(path.join(tempDir, "approval.json"), approval);
  await writeJson(path.join(tempDir, "capability.json"), capability);

  return {
    atlasRoot,
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

  const atlasRoot = await createAtlasFixtureRoot();

  try {
    const scenarios = [
      {
        atlasRoot,
        name: "read-only",
        requestPath: path.join(examplesRoot, "read-only-scan.request.json"),
        approvalPath: path.join(examplesRoot, "read-only-scan.approval.json"),
        capabilityProfilePath: path.join(examplesRoot, "capability-profile.json"),
        expectedExitCode: 0,
      },
      {
        atlasRoot,
        name: "dry-run-approved",
        requestPath: path.join(examplesRoot, "dry-run-command.request.json"),
        approvalPath: path.join(examplesRoot, "dry-run-command.approval.json"),
        capabilityProfilePath: path.join(
          examplesRoot,
          "capability-profile.scoped-write-dry-run.json",
        ),
        expectedExitCode: 0,
      },
      await createMutatedScenario({
        atlasRoot,
        name: "dry-run-crlf-output",
        baseRequestName: "dry-run-command.request.json",
        baseApprovalName: "dry-run-command.approval.json",
        baseCapabilityName: "capability-profile.scoped-write-dry-run.json",
        mutate: ({ request }) => {
          request.action.command = [
            "node",
            "-e",
            "process.stdout.write('line1\\r\\nline2\\r\\n')",
          ];
        },
        expectedExitCode: 0,
      }),
      {
        atlasRoot,
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
        atlasRoot,
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
        atlasRoot,
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
        atlasRoot,
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
        atlasRoot,
        name: "workspace-write-approved",
        expectedExitCode: 0,
      }),
      await createWorkspaceWriteScenario({
        atlasRoot,
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
        atlasRoot,
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
          receipt.receipt_id.startsWith("sha256:"),
          `${scenario.name}: receipt_id should be deterministic`,
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
        assert(
          !receipt.failure,
          `${scenario.name}: successful receipts should not carry failure metadata`,
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
            if (scenario.name === "dry-run-crlf-output") {
              assert(
                receipt.command_result.stdout === "line1\nline2\n",
                `${scenario.name}: expected normalized stdout`,
              );
              assert(!receipt.command_result.stdout.includes("\r"));
            }
          }
        }
      } else {
        if (receipt) {
          assert(
            receipt.result === "blocked",
            `${scenario.name}: expected blocked receipt`,
          );
          assert(
            receipt.receipt_id.startsWith("sha256:"),
            `${scenario.name}: blocked receipt_id should be deterministic`,
          );
          assert(
            receipt.failure &&
              receipt.failure.category === "config_error" &&
              receipt.failure.first_remediation_step.length > 0,
            `${scenario.name}: blocked receipt missing failure surface`,
          );
          assert(
            typeof receipt.blocked_reason === "string" &&
              receipt.blocked_reason.length > 0,
            `${scenario.name}: blocked receipt missing reason`,
          );
          if (scenario.expectedBlockedReasonContains) {
            assert(
              receipt.blocked_reason.includes(
                scenario.expectedBlockedReasonContains,
              ),
              `${scenario.name}: blocked reason did not mention ${scenario.expectedBlockedReasonContains}`,
            );
          }
        } else if (scenario.expectedBlockedReasonContains) {
          assert(
            output.includes(scenario.expectedBlockedReasonContains),
            `${scenario.name}: expected failure output to mention ${scenario.expectedBlockedReasonContains}`,
          );
        } else {
          throw new Error(
            `${scenario.name}: expected a receipt or explicit failure output.`,
          );
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
        await rm(scenario.workspaceRootAbsolute, {
          recursive: true,
          force: true,
        });
      }
      console.log(`${scenario.name}: ${receiptPath ?? "no-receipt"}`);
    }
  } finally {
    await rm(atlasRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
