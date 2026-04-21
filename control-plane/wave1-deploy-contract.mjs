export const WAVE1_DEPLOY_CONTRACT_VERSION = "atlas.lifeline.deploy-contract.v1";
export const WAVE1_RELEASE_METADATA_VERSION =
  "atlas.lifeline.release-metadata.v1";
export const WAVE1_DRY_RUN_PLAN_VERSION = "atlas.lifeline.deploy-dry-run.v1";

export const SUPPORTED_ROLLBACK_STRATEGIES = ["redeploy", "restore"];
export const SUPPORTED_HOOK_NAMES = ["preDeploy", "postDeploy", "rollback"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function pushIssue(issues, path, message) {
  issues.push({ path, message });
}

function normalizeStringList(value) {
  return [...value];
}

function validateRoute(route, issues) {
  if (!isRecord(route)) {
    pushIssue(issues, "route", "must be an object");
    return undefined;
  }

  if (!isNonEmptyString(route.domain)) {
    pushIssue(issues, "route.domain", "must be a non-empty string");
  }

  if (route.path !== undefined) {
    if (!isNonEmptyString(route.path)) {
      pushIssue(issues, "route.path", "must be a non-empty string");
    } else if (!route.path.startsWith("/")) {
      pushIssue(issues, "route.path", "must start with '/'");
    }
  }

  if (!isNonEmptyString(route.domain)) {
    return undefined;
  }

  return {
    domain: route.domain,
    ...(isNonEmptyString(route.path) ? { path: route.path } : {}),
  };
}

function validateHooks(hooks, issues) {
  if (hooks === undefined) {
    pushIssue(issues, "migrationHooks", "must be an object");
    return undefined;
  }

  if (!isRecord(hooks)) {
    pushIssue(issues, "migrationHooks", "must be an object");
    return undefined;
  }

  const normalized = {
    preDeploy: [],
    postDeploy: [],
    rollback: [],
  };

  for (const hookName of SUPPORTED_HOOK_NAMES) {
    const hookValue = hooks[hookName];
    if (hookValue === undefined) {
      continue;
    }

    if (!isStringArray(hookValue)) {
      pushIssue(
        issues,
        `migrationHooks.${hookName}`,
        "must be an array of non-empty strings",
      );
      continue;
    }

    normalized[hookName] = normalizeStringList(hookValue);
  }

  return normalized;
}

function validateArtifactRef(manifest, issues) {
  const artifactRef =
    isNonEmptyString(manifest.artifactRef) ? manifest.artifactRef : undefined;
  const imageRef = isNonEmptyString(manifest.imageRef)
    ? manifest.imageRef
    : undefined;

  if (!artifactRef && !imageRef) {
    pushIssue(
      issues,
      "artifactRef",
      "must be provided as artifactRef or imageRef",
    );
    return undefined;
  }

  return artifactRef ?? imageRef;
}

function validateRollbackTarget(target, issues) {
  if (!isRecord(target)) {
    pushIssue(issues, "rollbackTarget", "must be an object");
    return undefined;
  }

  if (!isNonEmptyString(target.releaseId)) {
    pushIssue(issues, "rollbackTarget.releaseId", "must be a non-empty string");
  }

  if (!isNonEmptyString(target.artifactRef)) {
    pushIssue(
      issues,
      "rollbackTarget.artifactRef",
      "must be a non-empty string",
    );
  }

  if (
    !isNonEmptyString(target.strategy) ||
    !SUPPORTED_ROLLBACK_STRATEGIES.includes(target.strategy)
  ) {
    pushIssue(
      issues,
      "rollbackTarget.strategy",
      `must be one of: ${SUPPORTED_ROLLBACK_STRATEGIES.join(", ")}`,
    );
  }

  if (
    !isNonEmptyString(target.releaseId) ||
    !isNonEmptyString(target.artifactRef) ||
    !SUPPORTED_ROLLBACK_STRATEGIES.includes(target.strategy)
  ) {
    return undefined;
  }

  return {
    releaseId: target.releaseId,
    artifactRef: target.artifactRef,
    strategy: target.strategy,
    ...(isNonEmptyString(target.note) ? { note: target.note } : {}),
  };
}

export function validateWave1DeployManifest(value) {
  const issues = [];

  if (!isRecord(value)) {
    return {
      issues: [{ path: "$", message: "manifest must be a JSON object" }],
    };
  }

  if (value.contractVersion !== WAVE1_DEPLOY_CONTRACT_VERSION) {
    pushIssue(
      issues,
      "contractVersion",
      `must equal ${WAVE1_DEPLOY_CONTRACT_VERSION}`,
    );
  }

  if (!isNonEmptyString(value.appName)) {
    pushIssue(issues, "appName", "must be a non-empty string");
  }

  const artifactRef = validateArtifactRef(value, issues);
  const route = validateRoute(value.route, issues);
  if (value.envRefs === undefined) {
    pushIssue(issues, "envRefs", "must be an array of non-empty strings");
  }
  const envRefs = value.envRefs ?? [];

  if (!isStringArray(envRefs)) {
    pushIssue(issues, "envRefs", "must be an array of non-empty strings");
  }

  if (!isNonEmptyString(value.healthcheckPath)) {
    pushIssue(issues, "healthcheckPath", "must be a non-empty string");
  } else if (!value.healthcheckPath.startsWith("/")) {
    pushIssue(issues, "healthcheckPath", "must start with '/'");
  }

  const migrationHooks = validateHooks(value.migrationHooks, issues);
  const rollbackTarget = validateRollbackTarget(value.rollbackTarget, issues);

  if (issues.length > 0) {
    return { issues };
  }

  return {
    issues,
    manifest: {
      contractVersion: WAVE1_DEPLOY_CONTRACT_VERSION,
      appName: value.appName,
      artifactRef,
      route,
      envRefs: normalizeStringList(envRefs),
      healthcheckPath: value.healthcheckPath,
      migrationHooks,
      rollbackTarget,
    },
  };
}

export function validateWave1ReleaseMetadata(value) {
  const issues = [];

  if (!isRecord(value)) {
    return {
      issues: [{ path: "$", message: "release metadata must be a JSON object" }],
    };
  }

  if (value.contractVersion !== WAVE1_RELEASE_METADATA_VERSION) {
    pushIssue(
      issues,
      "contractVersion",
      `must equal ${WAVE1_RELEASE_METADATA_VERSION}`,
    );
  }

  if (!isNonEmptyString(value.releaseId)) {
    pushIssue(issues, "releaseId", "must be a non-empty string");
  }

  if (!isNonEmptyString(value.appName)) {
    pushIssue(issues, "appName", "must be a non-empty string");
  }

  if (!isNonEmptyString(value.artifactRef)) {
    pushIssue(issues, "artifactRef", "must be a non-empty string");
  }

  const route = validateRoute(value.route, issues);

  if (!isStringArray(value.envRefs)) {
    pushIssue(issues, "envRefs", "must be an array of non-empty strings");
  }

  if (!isNonEmptyString(value.healthcheckPath)) {
    pushIssue(issues, "healthcheckPath", "must be a non-empty string");
  } else if (!value.healthcheckPath.startsWith("/")) {
    pushIssue(issues, "healthcheckPath", "must start with '/'");
  }

  const migrationHooks = validateHooks(value.migrationHooks, issues);
  const rollbackTarget = validateRollbackTarget(value.rollbackTarget, issues);

  if (
    !isRecord(value.validation) ||
    !["passed", "failed"].includes(value.validation.status)
  ) {
    pushIssue(
      issues,
      "validation.status",
      "must be one of: passed, failed",
    );
  }

  if (
    !isRecord(value.validation) ||
    !Array.isArray(value.validation.issues) ||
    value.validation.issues.some((issue) => {
      return (
        !isRecord(issue) ||
        !isNonEmptyString(issue.path) ||
        !isNonEmptyString(issue.message)
      );
    })
  ) {
    pushIssue(
      issues,
      "validation.issues",
      "must be an array of { path, message } issues",
    );
  }

  if (typeof value.dryRun !== "boolean") {
    pushIssue(issues, "dryRun", "must be a boolean");
  }

  if (!isNonEmptyString(value.createdAt)) {
    pushIssue(issues, "createdAt", "must be a non-empty string");
  }

  if (issues.length > 0) {
    return { issues };
  }

  return {
    issues,
    metadata: {
      contractVersion: WAVE1_RELEASE_METADATA_VERSION,
      releaseId: value.releaseId,
      appName: value.appName,
      artifactRef: value.artifactRef,
      route,
      envRefs: normalizeStringList(value.envRefs),
      healthcheckPath: value.healthcheckPath,
      migrationHooks,
      rollbackTarget,
      dryRun: value.dryRun,
      createdAt: value.createdAt,
      validation: {
        status: value.validation.status,
        issues: value.validation.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    },
  };
}

export function buildWave1DryRunPlan(manifest, options) {
  const validation = validateWave1DeployManifest(manifest);
  const releaseId = options?.releaseId ?? "wave1-dry-run-release";
  const createdAt = options?.createdAt ?? "1970-01-01T00:00:00.000Z";

  if (validation.issues.length > 0 || !validation.manifest) {
    return {
      contractVersion: WAVE1_DRY_RUN_PLAN_VERSION,
      releaseId,
      appName: isRecord(manifest) && isNonEmptyString(manifest.appName)
        ? manifest.appName
        : "unknown",
      steps: [
        {
          step: "validate-manifest",
          status: "failed",
          detail: "validation failed before dry-run planning",
        },
      ],
      validation: {
        status: "failed",
        issues: validation.issues,
      },
      releaseMetadata: null,
    };
  }

  const releaseMetadata = {
    contractVersion: WAVE1_RELEASE_METADATA_VERSION,
    releaseId,
    appName: validation.manifest.appName,
    artifactRef: validation.manifest.artifactRef,
    route: validation.manifest.route,
    envRefs: validation.manifest.envRefs,
    healthcheckPath: validation.manifest.healthcheckPath,
    migrationHooks: validation.manifest.migrationHooks,
    rollbackTarget: validation.manifest.rollbackTarget,
    dryRun: true,
    createdAt,
    validation: {
      status: "passed",
      issues: [],
    },
  };

  return {
    contractVersion: WAVE1_DRY_RUN_PLAN_VERSION,
    releaseId,
    appName: validation.manifest.appName,
    steps: [
      {
        step: "validate-manifest",
        status: "passed",
        detail: "deploy manifest is valid",
      },
      {
        step: "canonicalize-artifact-ref",
        status: "passed",
        detail: "artifactRef is ready for persistence",
      },
      {
        step: "prepare-release-metadata",
        status: "passed",
        detail: "release metadata preview is ready",
      },
      {
        step: "preserve-rollback-target",
        status: "passed",
        detail: "rollback target metadata is unchanged in dry-run mode",
      },
    ],
    validation: {
      status: "passed",
      issues: [],
    },
    releaseMetadata,
  };
}

export function serializeWave1ReleaseMetadata(metadata) {
  return JSON.stringify(metadata, null, 2);
}

export function parseWave1ReleaseMetadata(raw) {
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      issues: [
        {
          path: "$",
          message:
            error instanceof Error ? error.message : "could not parse JSON",
        },
      ],
    };
  }

  return validateWave1ReleaseMetadata(parsed);
}
