import { createHash } from "node:crypto";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildWave1ReleasePlan,
  parseWave1ReleaseMetadata,
  serializeWave1ReleaseMetadata,
} from "./wave1-deploy-contract.mjs";

export const WAVE1_RELEASE_POINTER_VERSION =
  "atlas.lifeline.release-pointer.v1";
export const WAVE1_RELEASE_RECEIPT_VERSION =
  "atlas.lifeline.release-receipt.v1";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }

  if (isRecord(value)) {
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

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function normalizeRelativePath(rootDir, filePath) {
  return normalizePath(path.relative(rootDir, filePath));
}

function releaseRoot(rootDir) {
  return path.join(rootDir, ".lifeline", "releases");
}

function appReleaseRoot(rootDir, appName) {
  return path.join(releaseRoot(rootDir), appName);
}

function hasPathEscape(relativePath) {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  );
}

function assertPathWithinRoot(rootPath, candidatePath, label) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (relativePath === "" || !hasPathEscape(relativePath)) {
    return candidatePath;
  }

  throw new Error(`${label} must stay within ${rootPath}`);
}

function validateReleaseId(releaseId) {
  if (typeof releaseId !== "string" || releaseId.trim().length === 0) {
    throw new Error("Release id must be a non-empty string.");
  }

  if (path.isAbsolute(releaseId)) {
    throw new Error(`Invalid releaseId "${releaseId}": absolute paths are not allowed.`);
  }

  if (releaseId.includes("/") || releaseId.includes("\\")) {
    throw new Error(
      `Invalid releaseId "${releaseId}": path separators are not allowed.`,
    );
  }

  if (releaseId === "." || releaseId === "..") {
    throw new Error(
      `Invalid releaseId "${releaseId}": dot-segment values are not allowed.`,
    );
  }

  return releaseId;
}

function resolveReleaseScopedPath(rootDir, appName, releaseId, ...segments) {
  const appRoot = path.resolve(appReleaseRoot(rootDir, appName));
  const validatedReleaseId = validateReleaseId(releaseId);
  const releaseDir = assertPathWithinRoot(
    appRoot,
    path.resolve(appRoot, validatedReleaseId),
    `Release directory for ${appName}/${releaseId}`,
  );

  if (segments.length === 0) {
    return releaseDir;
  }

  return assertPathWithinRoot(
    appRoot,
    path.resolve(releaseDir, ...segments),
    `Release path for ${appName}/${releaseId}`,
  );
}

function releaseDirectory(rootDir, appName, releaseId) {
  return resolveReleaseScopedPath(rootDir, appName, releaseId);
}

function releaseMetadataPath(rootDir, appName, releaseId) {
  return resolveReleaseScopedPath(rootDir, appName, releaseId, "metadata.json");
}

function currentPointerPath(rootDir, appName) {
  return path.join(appReleaseRoot(rootDir, appName), "current.json");
}

function previousPointerPath(rootDir, appName) {
  return path.join(appReleaseRoot(rootDir, appName), "previous.json");
}

function receiptsDirectory(rootDir, appName) {
  return path.join(appReleaseRoot(rootDir, appName), "receipts");
}

function deriveReceiptId(payload) {
  return createHash("sha256")
    .update(stableJsonStringify(payload))
    .digest("hex")
    .slice(0, 16);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeStableJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${stableJsonStringify(payload)}\n`, "utf8");
}

async function writeImmutableJson(filePath, payload) {
  if (await pathExists(filePath)) {
    const existing = await readFile(filePath, "utf8");
    const next = `${stableJsonStringify(payload)}\n`;
    if (existing !== next) {
      throw new Error(`Refusing to rewrite immutable release file: ${filePath}`);
    }
    return;
  }

  await writeStableJson(filePath, payload);
}

async function readPointer(filePath) {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  if (!raw) {
    return undefined;
  }

  const parsed = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    parsed.contractVersion !== WAVE1_RELEASE_POINTER_VERSION ||
    typeof parsed.appName !== "string" ||
    typeof parsed.releaseId !== "string" ||
    typeof parsed.updatedAt !== "string"
  ) {
    throw new Error(`Invalid release pointer at ${filePath}`);
  }

  return parsed;
}

async function writePointer(filePath, payload) {
  await writeStableJson(filePath, payload);
}

async function clearPointer(filePath) {
  await unlink(filePath).catch(() => undefined);
}

async function loadReleaseMetadata(rootDir, appName, releaseId) {
  const metadataFilePath = releaseMetadataPath(rootDir, appName, releaseId);
  const parsed = parseWave1ReleaseMetadata(
    await readFile(metadataFilePath, "utf8"),
  );

  if (parsed.issues.length > 0 || !parsed.metadata) {
    throw new Error(
      `Invalid release metadata at ${metadataFilePath}: ${JSON.stringify(parsed.issues)}`,
    );
  }

  return {
    metadata: parsed.metadata,
    metadataFilePath,
  };
}

async function writeReceipt(rootDir, appName, payload) {
  const receiptId = payload.receiptId ?? deriveReceiptId(payload);
  const fullPayload = {
    ...payload,
    contractVersion: WAVE1_RELEASE_RECEIPT_VERSION,
    receiptId,
  };
  const receiptPath = path.join(receiptsDirectory(rootDir, appName), `${receiptId}.json`);
  await writeImmutableJson(receiptPath, fullPayload);
  return {
    receiptId,
    receiptPath,
    receipt: fullPayload,
  };
}

export function getWave1ReleaseLayout(rootDir, appName, releaseId) {
  const metadataPath = releaseMetadataPath(rootDir, appName, releaseId);
  const releaseDir = releaseDirectory(rootDir, appName, releaseId);

  return {
    releaseRoot: releaseRoot(rootDir),
    appReleaseRoot: appReleaseRoot(rootDir, appName),
    releaseDirectory: releaseDir,
    releaseMetadataPath: metadataPath,
    currentPointerPath: currentPointerPath(rootDir, appName),
    previousPointerPath: previousPointerPath(rootDir, appName),
    receiptsDirectory: receiptsDirectory(rootDir, appName),
  };
}

export function getWave1ReleaseStatePaths(rootDir, appName) {
  return {
    currentPointerPath: currentPointerPath(rootDir, appName),
    previousPointerPath: previousPointerPath(rootDir, appName),
    receiptsDirectory: receiptsDirectory(rootDir, appName),
  };
}

export async function readWave1ReleaseState(rootDir, appName) {
  return {
    current: await readPointer(currentPointerPath(rootDir, appName)),
    previous: await readPointer(previousPointerPath(rootDir, appName)),
  };
}

export function planWave1Release(manifest, options = {}) {
  const releasePlan = buildWave1ReleasePlan(manifest, options);
  if (!releasePlan.releaseMetadata) {
    return releasePlan;
  }

  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const layout = getWave1ReleaseLayout(
    rootDir,
    releasePlan.appName,
    releasePlan.releaseId,
  );

  return {
    ...releasePlan,
    rootDir: normalizePath(rootDir),
    layout: {
      releaseDirectory: normalizeRelativePath(rootDir, layout.releaseDirectory),
      releaseMetadataPath: normalizeRelativePath(rootDir, layout.releaseMetadataPath),
      currentPointerPath: normalizeRelativePath(rootDir, layout.currentPointerPath),
      previousPointerPath: normalizeRelativePath(rootDir, layout.previousPointerPath),
      receiptsDirectory: normalizeRelativePath(rootDir, layout.receiptsDirectory),
    },
  };
}

export async function persistWave1Release(manifest, options = {}) {
  const releasePlan = planWave1Release(manifest, options);
  if (!releasePlan.releaseMetadata) {
    return releasePlan;
  }

  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const layout = getWave1ReleaseLayout(
    rootDir,
    releasePlan.appName,
    releasePlan.releaseId,
  );
  await mkdir(layout.releaseDirectory, { recursive: true });
  await mkdir(layout.receiptsDirectory, { recursive: true });
  await writeImmutableJson(
    layout.releaseMetadataPath,
    JSON.parse(serializeWave1ReleaseMetadata(releasePlan.releaseMetadata)),
  );

  const receiptAt =
    options.receiptAt ?? releasePlan.releaseMetadata.createdAt;
  const receiptResult = await writeReceipt(rootDir, releasePlan.appName, {
    action: "planned",
    status: "planned",
    appName: releasePlan.appName,
    releaseId: releasePlan.releaseId,
    createdAt: receiptAt,
    releaseDirectory: releasePlan.layout.releaseDirectory,
    releaseMetadataPath: releasePlan.layout.releaseMetadataPath,
    currentPointerPath: releasePlan.layout.currentPointerPath,
    previousPointerPath: releasePlan.layout.previousPointerPath,
    releaseTarget: releasePlan.releaseMetadata.releaseTarget,
    rollbackTarget: releasePlan.releaseMetadata.rollbackTarget,
    sourceAdapter: releasePlan.releaseMetadata.sourceAdapter,
  });

  return {
    ...releasePlan,
    receipt: {
      ...receiptResult.receipt,
      receiptPath: normalizeRelativePath(rootDir, receiptResult.receiptPath),
    },
  };
}

export async function activateWave1Release(
  rootDir,
  appName,
  releaseId,
  options = {},
) {
  const resolvedRoot = path.resolve(rootDir);
  const layout = getWave1ReleaseLayout(resolvedRoot, appName, releaseId);
  const { metadata } = await loadReleaseMetadata(resolvedRoot, appName, releaseId);
  const current = await readPointer(layout.currentPointerPath);
  const previous = await readPointer(layout.previousPointerPath);
  const health =
    (await options.checkHealth?.({
      metadata,
      current,
      previous,
    })) ?? { ok: true, status: 200 };
  const receiptAt = options.receiptAt ?? metadata.createdAt;

  if (!health.ok) {
    const failedReceipt = await writeReceipt(resolvedRoot, appName, {
      action: "activate",
      status: "failed",
      appName,
      releaseId,
      previousReleaseId: current?.releaseId,
      createdAt: receiptAt,
      releaseDirectory: normalizeRelativePath(resolvedRoot, layout.releaseDirectory),
      releaseMetadataPath: normalizeRelativePath(
        resolvedRoot,
        layout.releaseMetadataPath,
      ),
      currentPointerPath: normalizeRelativePath(
        resolvedRoot,
        layout.currentPointerPath,
      ),
      previousPointerPath: normalizeRelativePath(
        resolvedRoot,
        layout.previousPointerPath,
      ),
      releaseTarget: metadata.releaseTarget,
      rollbackTarget: metadata.rollbackTarget,
      health,
      preservedCurrentReleaseId: current?.releaseId,
      preservedPreviousReleaseId: previous?.releaseId,
    });

    return {
      ok: false,
      health,
      current,
      previous,
      receipt: {
        ...failedReceipt.receipt,
        receiptPath: normalizeRelativePath(resolvedRoot, failedReceipt.receiptPath),
      },
    };
  }

  const nextPrevious = current && current.releaseId !== releaseId
    ? {
        contractVersion: WAVE1_RELEASE_POINTER_VERSION,
        appName,
        releaseId: current.releaseId,
        updatedAt: receiptAt,
        reason: "activation",
      }
    : previous;
  const nextCurrent = {
    contractVersion: WAVE1_RELEASE_POINTER_VERSION,
    appName,
    releaseId,
    updatedAt: receiptAt,
    reason: "activation",
  };

  await writePointer(layout.currentPointerPath, nextCurrent);
  if (nextPrevious) {
    await writePointer(layout.previousPointerPath, nextPrevious);
  } else {
    await clearPointer(layout.previousPointerPath);
  }

  const activationReceipt = await writeReceipt(resolvedRoot, appName, {
    action: "activate",
    status: "succeeded",
    appName,
    releaseId,
    previousReleaseId: current?.releaseId,
    createdAt: receiptAt,
    releaseDirectory: normalizeRelativePath(resolvedRoot, layout.releaseDirectory),
    releaseMetadataPath: normalizeRelativePath(
      resolvedRoot,
      layout.releaseMetadataPath,
    ),
    currentPointerPath: normalizeRelativePath(
      resolvedRoot,
      layout.currentPointerPath,
    ),
    previousPointerPath: normalizeRelativePath(
      resolvedRoot,
      layout.previousPointerPath,
    ),
    releaseTarget: metadata.releaseTarget,
    rollbackTarget: metadata.rollbackTarget,
    health,
    lineage: {
      promotedFromReleaseId: current?.releaseId,
      promotedToReleaseId: releaseId,
    },
  });

  return {
    ok: true,
    health,
    current: nextCurrent,
    previous: nextPrevious,
    receipt: {
      ...activationReceipt.receipt,
      receiptPath: normalizeRelativePath(resolvedRoot, activationReceipt.receiptPath),
    },
  };
}

export async function rollbackWave1Release(rootDir, appName, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const current = await readPointer(currentPointerPath(resolvedRoot, appName));
  const previous = await readPointer(previousPointerPath(resolvedRoot, appName));

  if (!current || !previous) {
    throw new Error(
      `Rollback requires both current and previous releases for ${appName}.`,
    );
  }

  const targetLayout = getWave1ReleaseLayout(
    resolvedRoot,
    appName,
    previous.releaseId,
  );
  const { metadata } = await loadReleaseMetadata(
    resolvedRoot,
    appName,
    previous.releaseId,
  );
  const health =
    (await options.checkHealth?.({
      metadata,
      current,
      previous,
    })) ?? { ok: true, status: 200 };
  const receiptAt = options.receiptAt ?? metadata.createdAt;

  if (!health.ok) {
    const failedReceipt = await writeReceipt(resolvedRoot, appName, {
      action: "rollback",
      status: "failed",
      appName,
      releaseId: previous.releaseId,
      previousReleaseId: current.releaseId,
      createdAt: receiptAt,
      releaseDirectory: normalizeRelativePath(
        resolvedRoot,
        targetLayout.releaseDirectory,
      ),
      releaseMetadataPath: normalizeRelativePath(
        resolvedRoot,
        targetLayout.releaseMetadataPath,
      ),
      currentPointerPath: normalizeRelativePath(
        resolvedRoot,
        targetLayout.currentPointerPath,
      ),
      previousPointerPath: normalizeRelativePath(
        resolvedRoot,
        targetLayout.previousPointerPath,
      ),
      releaseTarget: metadata.releaseTarget,
      rollbackTarget: metadata.rollbackTarget,
      health,
      preservedCurrentReleaseId: current.releaseId,
      preservedPreviousReleaseId: previous.releaseId,
    });

    return {
      ok: false,
      health,
      current,
      previous,
      receipt: {
        ...failedReceipt.receipt,
        receiptPath: normalizeRelativePath(resolvedRoot, failedReceipt.receiptPath),
      },
    };
  }

  const nextCurrent = {
    contractVersion: WAVE1_RELEASE_POINTER_VERSION,
    appName,
    releaseId: previous.releaseId,
    updatedAt: receiptAt,
    reason: "rollback",
  };
  const nextPrevious = {
    contractVersion: WAVE1_RELEASE_POINTER_VERSION,
    appName,
    releaseId: current.releaseId,
    updatedAt: receiptAt,
    reason: "rollback",
  };

  await writePointer(targetLayout.currentPointerPath, nextCurrent);
  await writePointer(targetLayout.previousPointerPath, nextPrevious);

  const rollbackReceipt = await writeReceipt(resolvedRoot, appName, {
    action: "rollback",
    status: "succeeded",
    appName,
    releaseId: previous.releaseId,
    previousReleaseId: current.releaseId,
    createdAt: receiptAt,
    releaseDirectory: normalizeRelativePath(
      resolvedRoot,
      targetLayout.releaseDirectory,
    ),
    releaseMetadataPath: normalizeRelativePath(
      resolvedRoot,
      targetLayout.releaseMetadataPath,
    ),
    currentPointerPath: normalizeRelativePath(
      resolvedRoot,
      targetLayout.currentPointerPath,
    ),
    previousPointerPath: normalizeRelativePath(
      resolvedRoot,
      targetLayout.previousPointerPath,
    ),
    releaseTarget: metadata.releaseTarget,
    rollbackTarget: metadata.rollbackTarget,
    health,
    lineage: {
      promotedFromReleaseId: current.releaseId,
      promotedToReleaseId: previous.releaseId,
    },
  });

  return {
    ok: true,
    health,
    current: nextCurrent,
    previous: nextPrevious,
    receipt: {
      ...rollbackReceipt.receipt,
      receiptPath: normalizeRelativePath(resolvedRoot, rollbackReceipt.receiptPath),
    },
  };
}
