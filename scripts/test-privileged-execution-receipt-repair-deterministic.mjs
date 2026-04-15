import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { repairPrivilegedActionReceipt } from "../dist/core/privileged-execution.js";
import { loadGovernedRegistry } from "../dist/core/tool-registry.js";

function stableCanonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableCanonicalValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableCanonicalValue(entry)]),
    );
  }
  return value;
}

function digestJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableCanonicalValue(value), null, 2), "utf8").digest("hex")}`;
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lifeline-repair-"));
  await writeFile(path.join(root, "stack.yaml"), "name: ATLAS\n", "utf8");
  await mkdir(path.join(root, "ops", "atlas"), { recursive: true });
  await writeFile(path.join(root, "ops", "atlas", "observations.py"), "pass\n", "utf8");
  process.env.ATLAS_ROOT = root;

  const toolRegistry = {
    schema_version: "atlas.tool.registry.v1",
    kind: "atlas-tool-registry",
    entries: [
      {
        tool_id: "read_only_scan",
        extension_id: null,
        trust_class: "trusted",
        release_eligible: true,
        max_automation_level: "approved_action",
        capability_profile: {
          contract_version: "atlas.capability.profile.v1",
          capability_profile_id: "cap-read-only",
          filesystem_scopes: { read: ["."], write: [], create: [], deny: ["secrets/**"] },
          network_scopes: { mode: "none", allowed_domains: [], blocked_domains: [] },
          process_execution_permissions: {
            allow_spawn: true,
            allow_shell: false,
            allow_python: false,
            allowed_commands: ["node"],
            denied_commands: ["powershell", "cmd"],
          },
          package_manager_permissions: {
            allow_install: false,
            allow_update: false,
            allowed_managers: [],
            blocked_managers: ["pnpm"],
          },
          elevation_requirement: "per_action_approval",
          resource_budgets: { wall_clock_seconds: 60, cpu_seconds: 30, memory_mb: 128, disk_mb: 32 },
          allowed_data_classes: ["public"],
          audit_class: "standard",
        },
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
    ],
  };
  const extensionRegistry = {
    schema_version: "atlas.extension.registry.v1",
    kind: "atlas-extension-registry",
    entries: [],
  };
  await writeJson(path.join(root, "docs", "registry", "ATLAS-TOOL-REGISTRY.json"), toolRegistry);
  await writeJson(path.join(root, "docs", "registry", "ATLAS-EXTENSION-REGISTRY.json"), extensionRegistry);
  const registryDigest = (await loadGovernedRegistry(root)).registryDigest;

  const sessionRef = "runtime/atlas/sessions/session-1/session.manifest.json";
  const requestRef = "runtime/atlas/sessions/session-1/artifacts/privileged-action.request.json";
  const approvalRef = "runtime/atlas/sessions/session-1/artifacts/approval.receipt.json";
  const assignmentRef = "runtime/atlas/sessions/session-1/artifacts/worker.assignment.json";
  const statusRef = "runtime/atlas/sessions/session-1/artifacts/worker.status.running.json";
  const originalReceiptRef = "runtime/lifeline/worker-execution/session-1-assignment/receipt-1.json";

  const request = {
    contract_version: "atlas.privileged-action.request.v1",
    request_id: "request-1",
    requested_at: "2026-04-14T08:08:43.652026Z",
    worker_id: "worker-1",
    assignment_id: "assignment-1",
    stack_lock_digest: "sha256:stack",
    tool_id: "read_only_scan",
    extension_id: null,
    registry_digest: registryDigest,
    automation_level: "request_action",
    source_refs: [sessionRef, assignmentRef, statusRef],
    action: {
      summary: "Inspect the stack root.",
      operation: "read_only_scan",
      command: ["node", "--version"],
      cwd: ".",
    },
    target_paths: ["README-STACK.md"],
    target_resources: ["node"],
    requested_capability: toolRegistry.entries[0].capability_profile,
  };
  const approval = {
    contract_version: "atlas.approval.receipt.v1",
    approval_receipt_id: "approval-1",
    request_id: "request-1",
    worker_id: "worker-1",
    assignment_id: "assignment-1",
    stack_lock_digest: "sha256:stack",
    tool_id: "read_only_scan",
    extension_id: null,
    registry_digest: registryDigest,
    automation_level: "approved_action",
    approver: { kind: "system", name: "gate" },
    approval_status: "approved",
    granted_scope: toolRegistry.entries[0].capability_profile,
    request_digest: digestJson(request),
    issued_at: "2026-04-14T08:08:43.652093Z",
  };
  const originalReceipt = {
    contract_version: "atlas.privileged-action.receipt.v1",
    receipt_id: "receipt-1",
    executed_at: "2026-04-14T08:08:44.391Z",
    worker_id: "worker-1",
    assignment_id: "assignment-1",
    stack_lock_digest: "sha256:stack",
    tool_id: "read_only_scan",
    extension_id: null,
    registry_digest: "sha256:old-registry",
    automation_level: "approved_action",
    capability_profile_id: "cap-read-only",
    request_id: "request-1",
    approval_receipt_id: "approval-1",
    approval_status: "approved",
    execution_mode: "read_only_scan",
    host: { name: "test-host", platform: "win32" },
    requested_action: request.action,
    target_paths: request.target_paths,
    target_resources: request.target_resources,
    source_refs: request.source_refs,
    request_digest: digestJson(request),
    capability_profile_digest: digestJson(toolRegistry.entries[0].capability_profile),
    approval_digest: digestJson(approval),
    result: "succeeded",
    execution_notes: "Read-only filesystem inspection completed.",
  };
  const session = {
    contract_version: "atlas.session.v1",
    session_id: "session-1",
    governed_surfaces: {
      registry_digest: registryDigest,
      execution: { tool_id: "read_only_scan", extension_id: null },
    },
    worker: {
      worker_id: "worker-1",
      assignment_id: "assignment-1",
      assignment_ref: assignmentRef,
    },
    refs: {
      request_ref: requestRef,
      approval_receipt_ref: approvalRef,
      execution_receipt_ref: originalReceiptRef,
      status_refs: [statusRef],
    },
  };

  await writeJson(path.join(root, requestRef), request);
  await writeJson(path.join(root, approvalRef), approval);
  await writeJson(path.join(root, assignmentRef), {
    contract_version: "atlas.worker.assignment.v1",
    assignment_id: "assignment-1",
    worker_id: "worker-1",
  });
  await writeJson(path.join(root, statusRef), {
    contract_version: "atlas.worker.status.v1",
    assignment_id: "assignment-1",
    worker_id: "worker-1",
    state: "running",
  });
  await writeJson(path.join(root, sessionRef), session);
  await writeJson(path.join(root, originalReceiptRef), originalReceipt);

  const repaired = await repairPrivilegedActionReceipt({
    originalReceiptPath: path.join(root, originalReceiptRef),
    requestPath: path.join(root, requestRef),
    approvalReceiptPath: path.join(root, approvalRef),
    sessionManifestPath: path.join(root, sessionRef),
    workerArtifactPaths: [path.join(root, assignmentRef), path.join(root, statusRef)],
    reconciledAt: "2026-04-14T09:00:00Z",
  });

  if (repaired.status !== "repaired") {
    console.error(JSON.stringify(repaired, null, 2));
  }
  assert.equal(repaired.status, "repaired");
  assert.equal(repaired.repairedReceipt?.registry_digest, registryDigest);
  assert.equal(repaired.repairedReceipt?.supersedes_receipt_ref, originalReceiptRef);
  assert.equal(repaired.repairedReceipt?.reconciled_by_tool_version, "lifeline.privileged-execution-repair.v1");

  const repairedPayload = JSON.parse(await readFile(repaired.repairedReceiptPath, "utf8"));
  assert.equal(repairedPayload.registry_digest, registryDigest);

  const legacyReceiptRef = "runtime/lifeline/worker-execution/session-1-assignment/receipt-legacy.json";
  await writeJson(path.join(root, legacyReceiptRef), {
    ...originalReceipt,
    receipt_id: "receipt-legacy",
    automation_level: undefined,
  });
  const legacyRepaired = await repairPrivilegedActionReceipt({
    originalReceiptPath: path.join(root, legacyReceiptRef),
    requestPath: path.join(root, requestRef),
    approvalReceiptPath: path.join(root, approvalRef),
    sessionManifestPath: path.join(root, sessionRef),
    workerArtifactPaths: [path.join(root, assignmentRef), path.join(root, statusRef)],
    reconciledAt: "2026-04-14T09:00:00Z",
  });
  assert.equal(legacyRepaired.status, "repaired");
  assert.equal(legacyRepaired.repairedReceipt?.automation_level, "approved_action");

  const mismatchedRequest = {
    ...request,
    action: {
      ...request.action,
      summary: "Mismatched action",
    },
  };
  await writeJson(path.join(root, requestRef), mismatchedRequest);
  const replayRequired = await repairPrivilegedActionReceipt({
    originalReceiptPath: path.join(root, originalReceiptRef),
    requestPath: path.join(root, requestRef),
    approvalReceiptPath: path.join(root, approvalRef),
    sessionManifestPath: path.join(root, sessionRef),
    workerArtifactPaths: [path.join(root, assignmentRef)],
    reconciledAt: "2026-04-14T09:00:00Z",
  });
  assert.equal(replayRequired.status, "replay_required");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
