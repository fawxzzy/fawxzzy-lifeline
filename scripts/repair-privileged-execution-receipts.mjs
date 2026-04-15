import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { repairPrivilegedActionReceipt } from "../dist/core/privileged-execution.js";

function stableCanonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableCanonicalStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableCanonicalStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestJson(value) {
  return `sha256:${createHash("sha256").update(stableCanonicalStringify(value), "utf8").digest("hex")}`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function findAtlasRoot(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    try {
      await readFile(path.join(current, "stack.yaml"), "utf8");
      return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not locate ATLAS root from the current working directory.");
    }
    current = parent;
  }
}

function parseArgs(argv) {
  const options = {
    atlasRoot: undefined,
    receiptRefs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--atlas-root") {
      options.atlasRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--receipt-ref") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --receipt-ref.");
      }
      options.receiptRefs.push(nextArg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function loadRegistryDigest(atlasRoot) {
  const toolRegistry = await readJson(path.join(atlasRoot, "docs", "registry", "ATLAS-TOOL-REGISTRY.json"));
  const extensionRegistry = await readJson(path.join(atlasRoot, "docs", "registry", "ATLAS-EXTENSION-REGISTRY.json"));
  return digestJson({
    tool_registry: {
      schema_version: toolRegistry.schema_version ?? "atlas.tool.registry.v1",
      kind: toolRegistry.kind ?? "atlas-tool-registry",
      entries: Array.isArray(toolRegistry.entries) ? [...toolRegistry.entries].sort((left, right) => String(left.tool_id ?? "").localeCompare(String(right.tool_id ?? ""))) : [],
    },
    extension_registry: {
      schema_version: extensionRegistry.schema_version ?? "atlas.extension.registry.v1",
      kind: extensionRegistry.kind ?? "atlas-extension-registry",
      entries: Array.isArray(extensionRegistry.entries) ? [...extensionRegistry.entries].sort((left, right) => String(left.extension_id ?? "").localeCompare(String(right.extension_id ?? ""))) : [],
    },
  });
}

function uniqueRefs(values) {
  return [...new Set(values.filter((entry) => typeof entry === "string" && entry.trim().length > 0))];
}

async function collectRepairTargets(atlasRoot, requestedReceiptRefs) {
  const registryDigest = await loadRegistryDigest(atlasRoot);
  const sessionsRoot = path.join(atlasRoot, "runtime", "atlas", "sessions");
  const sessions = [];
  const stack = [sessionsRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const stats = await stat(current).catch(() => null);
    if (!stats) {
      continue;
    }
    if (stats.isDirectory()) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        stack.push(path.join(current, entry.name));
      }
      continue;
    }
    if (current.endsWith("session.manifest.json")) {
      sessions.push(current);
    }
  }

  const requested = new Set(requestedReceiptRefs);
  const targets = [];
  for (const sessionPath of sessions.sort()) {
    const session = await readJson(sessionPath);
    const refs = session.refs ?? {};
    const worker = session.worker ?? {};
    const receiptRef = refs.execution_receipt_ref;
    const requestRef = refs.request_ref;
    const approvalRef = refs.approval_receipt_ref;
    if (!receiptRef || !requestRef || !approvalRef) {
      continue;
    }
    if (requested.size > 0 && !requested.has(receiptRef)) {
      continue;
    }
    const receiptPath = path.join(atlasRoot, receiptRef);
    const receipt = await readJson(receiptPath).catch(() => null);
    const request = await readJson(path.join(atlasRoot, requestRef)).catch(() => null);
    const approval = await readJson(path.join(atlasRoot, approvalRef)).catch(() => null);
    if (!receipt || receipt.contract_version !== "atlas.privileged-action.receipt.v1") {
      continue;
    }
    if (!request || !approval) {
      continue;
    }
    if (
      typeof receipt.tool_id !== "string" ||
      receipt.tool_id.trim().length === 0 ||
      request.registry_digest !== registryDigest ||
      approval.registry_digest !== registryDigest
    ) {
      continue;
    }
    if (receipt.registry_digest === registryDigest) {
      continue;
    }
    targets.push({
      originalReceiptPath: receiptPath,
      requestPath: path.join(atlasRoot, requestRef),
      approvalReceiptPath: path.join(atlasRoot, approvalRef),
      sessionManifestPath: sessionPath,
      workerArtifactPaths: uniqueRefs([
        worker.assignment_ref,
        worker.context_ref,
        ...(Array.isArray(refs.status_refs) ? refs.status_refs : []),
      ]).map((entry) => path.join(atlasRoot, entry)),
    });
  }
  return targets;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const atlasRoot = await findAtlasRoot(options.atlasRoot ?? process.cwd());
  const targets = await collectRepairTargets(atlasRoot, options.receiptRefs);
  const results = [];
  for (const target of targets) {
    results.push(
      await repairPrivilegedActionReceipt(target),
    );
  }
  const report = {
    atlasRoot,
    targetCount: targets.length,
    repairedCount: results.filter((item) => item.status === "repaired").length,
    replayRequiredCount: results.filter((item) => item.status === "replay_required").length,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.replayRequiredCount > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
