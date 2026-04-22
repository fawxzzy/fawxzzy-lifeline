import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

type RuntimePlatform = string;

export type PreflightCategory =
  | "node-version"
  | "package-manager"
  | "repo-prerequisite"
  | "shell-runtime";

export interface PreflightFinding {
  category: PreflightCategory;
  code: string;
  message: string;
  remediation: string;
}

export interface PreflightContract {
  repoRoot: string;
  packageJsonPath: string;
  lockfilePath: string;
  nodeEngine: string;
  packageManager: string;
}

export interface PreflightObservation {
  platform: RuntimePlatform;
  nodeVersion: string;
  packageManager?: {
    name: string;
    version?: string;
    source: "npm_config_user_agent" | "npm_execpath";
  };
  shellProbe: {
    ok: boolean;
    detail?: string;
  };
}

export interface PreflightReport {
  ok: boolean;
  contract: PreflightContract;
  observation: PreflightObservation;
  findings: PreflightFinding[];
}

export interface PreflightRuntimeInput {
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  execPath?: string;
  platform?: RuntimePlatform;
  shellProbe?: () => {
    ok: boolean;
    detail?: string;
  };
}

interface NodeEngineBounds {
  minimum: [number, number, number];
  maximum?: [number, number, number];
}

interface RepoContract {
  repoRoot: string;
  packageJsonPath: string;
  lockfilePath: string;
  nodeEngine: string;
  packageManager: string;
}

const REPO_ROOT = path.resolve(
  path.dirname(filePathFromImportMetaUrl(import.meta.url)),
  "../..",
);
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
const LOCKFILE_PATH = path.join(REPO_ROOT, "pnpm-lock.yaml");

let repoContractPromise: Promise<RepoContract | undefined> | undefined;

function toOutputPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function filePathFromImportMetaUrl(moduleUrl: string): string {
  const pathname = decodeURIComponent(new URL(moduleUrl).pathname);

  if (process.platform === "win32" && /^\/[A-Za-z]:/.test(pathname)) {
    return pathname.slice(1);
  }

  return pathname;
}

function parseVersionParts(
  version: string,
): [number, number, number] | undefined {
  const match = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(
  left: [number, number, number],
  right: [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function parseNodeEngineBounds(
  nodeEngine: string,
): NodeEngineBounds | undefined {
  const compact = nodeEngine.trim().replace(/\s+/g, " ");
  const withUpperBound = compact.match(
    /^>=\s*(\d+)\.(\d+)\.(\d+)\s+<\s*(\d+)(?:\.(\d+)\.(\d+))?$/,
  );
  if (withUpperBound) {
    return {
      minimum: [
        Number(withUpperBound[1]),
        Number(withUpperBound[2]),
        Number(withUpperBound[3]),
      ],
      maximum: [
        Number(withUpperBound[4]),
        Number(withUpperBound[5] ?? 0),
        Number(withUpperBound[6] ?? 0),
      ],
    };
  }

  const lowerBoundOnly = compact.match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
  if (lowerBoundOnly) {
    return {
      minimum: [
        Number(lowerBoundOnly[1]),
        Number(lowerBoundOnly[2]),
        Number(lowerBoundOnly[3]),
      ],
    };
  }

  return undefined;
}

function parsePackageManagerContract(
  packageManager: string,
): { name: string; version?: string } | undefined {
  const match = packageManager.trim().match(/^([a-z0-9_-]+)@(.+)$/i);
  if (!match) {
    return undefined;
  }

  return {
    name: match[1] ?? "",
    ...(match[2] ? { version: match[2] } : {}),
  };
}

function detectPackageManager(
  env: NodeJS.ProcessEnv,
): PreflightObservation["packageManager"] | undefined {
  const userAgent = env.npm_config_user_agent?.trim();
  if (userAgent) {
    const [firstToken] = userAgent.split(" ");
    const [name, version] = firstToken?.split("/") ?? [];
    if (name) {
      return {
        name,
        ...(version ? { version } : {}),
        source: "npm_config_user_agent",
      };
    }
  }

  const execPath = env.npm_execpath?.toLowerCase();
  if (execPath) {
    if (execPath.includes("pnpm")) {
      return { name: "pnpm", source: "npm_execpath" };
    }
    if (execPath.includes("yarn")) {
      return { name: "yarn", source: "npm_execpath" };
    }
    if (execPath.includes("npm")) {
      return { name: "npm", source: "npm_execpath" };
    }
  }

  return undefined;
}

async function loadRepoContract(): Promise<RepoContract | undefined> {
  if (!repoContractPromise) {
    repoContractPromise = (async () => {
      let rawPackageJson: string;
      try {
        rawPackageJson = await readFile(PACKAGE_JSON_PATH, "utf8");
      } catch {
        return undefined;
      }

      let parsedPackageJson: unknown;
      try {
        parsedPackageJson = JSON.parse(rawPackageJson);
      } catch {
        return undefined;
      }

      if (
        typeof parsedPackageJson !== "object" ||
        parsedPackageJson === null ||
        Array.isArray(parsedPackageJson)
      ) {
        return undefined;
      }

      const packageJson = parsedPackageJson as Record<string, unknown>;
      const packageManager = packageJson.packageManager;
      const engines = packageJson.engines;
      if (
        typeof packageManager !== "string" ||
        typeof engines !== "object" ||
        engines === null ||
        Array.isArray(engines)
      ) {
        return undefined;
      }

      const nodeEngine = (engines as Record<string, unknown>).node;
      if (typeof nodeEngine !== "string") {
        return undefined;
      }

      return {
        repoRoot: REPO_ROOT,
        packageJsonPath: PACKAGE_JSON_PATH,
        lockfilePath: LOCKFILE_PATH,
        nodeEngine,
        packageManager,
      };
    })();
  }

  return repoContractPromise;
}

function createRepoPrerequisiteFinding(message: string): PreflightFinding {
  return {
    category: "repo-prerequisite",
    code: "REPO_PREREQUISITE_MISSING",
    message,
    remediation:
      "Restore the missing repository prerequisite and rerun `pnpm install` if the lockfile or package metadata changed.",
  };
}

function createNodeVersionFinding(
  nodeVersion: string,
  nodeEngine: string,
): PreflightFinding {
  return {
    category: "node-version",
    code: "NODE_VERSION_OUT_OF_RANGE",
    message: `Node ${nodeVersion} is outside the supported range ${nodeEngine}.`,
    remediation:
      "Use Node 22.14.x or any newer 22.x release that still satisfies the repository engine range.",
  };
}

function createPackageManagerFinding(
  detected: NonNullable<PreflightObservation["packageManager"]>,
  expected: string,
): PreflightFinding {
  const expectedContract = parsePackageManagerContract(expected);
  const expectedName = expectedContract?.name ?? expected;
  const expectedVersion = expectedContract?.version;
  const detectedVersion = detected.version ? `@${detected.version}` : "";
  const expectedVersionText = expectedVersion ? `@${expectedVersion}` : "";

  return {
    category: "package-manager",
    code: "PACKAGE_MANAGER_MISMATCH",
    message: `Detected ${detected.name}${detectedVersion} via ${detected.source}, expected ${expectedName}${expectedVersionText}.`,
    remediation:
      "Run Lifeline through pnpm so the package-manager contract matches the repository packageManager field.",
  };
}

function createShellRuntimeFinding(detail: string): PreflightFinding {
  return {
    category: "shell-runtime",
    code: "SHELL_RUNTIME_UNAVAILABLE",
    message: `Shell runtime probe failed: ${detail}.`,
    remediation:
      "Fix the platform shell/runtime setup before retrying validation or doctor.",
  };
}

function shellProbe(
  execPath: string,
  platform: RuntimePlatform,
): { ok: boolean; detail?: string } {
  const probe =
    platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "exit 0"], {
          encoding: "utf8",
          windowsHide: true,
        })
      : spawnSync(process.env.SHELL ?? "sh", ["-lc", "true"], {
          encoding: "utf8",
        });

  if (probe.error) {
    return {
      ok: false,
      detail: probe.error.message,
    };
  }

  if (probe.status !== 0) {
    return {
      ok: false,
      detail: `exit code ${probe.status ?? "unknown"}`,
    };
  }

  const nodeProbe = spawnSync(execPath, ["-e", "process.exit(0)"], {
    encoding: "utf8",
    windowsHide: platform === "win32",
  });

  if (nodeProbe.error) {
    return {
      ok: false,
      detail: nodeProbe.error.message,
    };
  }

  if (nodeProbe.status !== 0) {
    return {
      ok: false,
      detail: `node probe exit code ${nodeProbe.status ?? "unknown"}`,
    };
  }

  return { ok: true };
}

function formatSuccessSummary(report: PreflightReport): string[] {
  const packageManager = report.observation.packageManager;
  const packageManagerLine = packageManager
    ? `- package manager: ${packageManager.name}${packageManager.version ? `@${packageManager.version}` : ""} detected via ${packageManager.source}`
    : `- package manager: not detected; expected ${report.contract.packageManager} when launched through pnpm`;

  return [
    `- node: ${report.observation.nodeVersion} satisfies ${report.contract.nodeEngine}`,
    packageManagerLine,
    `- shell: shell execution probe passed on ${report.observation.platform}`,
    `- repo prerequisites: ${toOutputPath(
      path.relative(report.contract.repoRoot, report.contract.packageJsonPath),
    )}, ${toOutputPath(path.relative(report.contract.repoRoot, report.contract.lockfilePath))}`,
  ];
}

export function formatPreflightFailure(
  report: PreflightReport,
  label: string,
): string[] {
  const lines = [`${label} failed.`];

  for (const finding of report.findings) {
    lines.push(
      `- [${finding.category}] ${finding.message}`,
      `  remediation: ${finding.remediation}`,
    );
  }

  return lines;
}

export function formatPreflightSuccess(
  report: PreflightReport,
  label: string,
): string[] {
  return [`${label} passed.`, ...formatSuccessSummary(report)];
}

export async function runPreflightChecks(
  input: PreflightRuntimeInput = {},
): Promise<PreflightReport> {
  const contract = await loadRepoContract();
  const env = input.env ?? process.env;
  const nodeVersion = input.nodeVersion ?? process.version;
  const execPath = input.execPath ?? process.execPath;
  const platform = input.platform ?? process.platform;
  const shell = input.shellProbe ?? (() => shellProbe(execPath, platform));
  const shellProbeResult = shell();
  const findings: PreflightFinding[] = [];

  if (!contract) {
    const fallbackContract: PreflightContract = {
      repoRoot: REPO_ROOT,
      packageJsonPath: PACKAGE_JSON_PATH,
      lockfilePath: LOCKFILE_PATH,
      nodeEngine: "unknown",
      packageManager: "unknown",
    };

    return {
      ok: false,
      contract: fallbackContract,
      observation: {
        platform,
        nodeVersion,
        shellProbe: shellProbeResult,
      },
      findings: [
        createRepoPrerequisiteFinding(
          `Unable to load repository package contract from ${toOutputPath(
            path.relative(REPO_ROOT, PACKAGE_JSON_PATH),
          )}.`,
        ),
      ],
    };
  }

  const packageManager = detectPackageManager(env);
  const observation: PreflightObservation = {
    platform,
    nodeVersion,
    ...(packageManager ? { packageManager } : {}),
    shellProbe: shellProbeResult,
  };

  const nodeBounds = parseNodeEngineBounds(contract.nodeEngine);
  if (!nodeBounds) {
    findings.push(
      createRepoPrerequisiteFinding(
        `Unsupported Node engine contract in ${toOutputPath(
          path.relative(REPO_ROOT, contract.packageJsonPath),
        )}: ${contract.nodeEngine}.`,
      ),
    );
  } else {
    const currentParts = parseVersionParts(nodeVersion);
    if (!currentParts) {
      findings.push(
        createRepoPrerequisiteFinding(
          `Unable to parse current Node version: ${nodeVersion}.`,
        ),
      );
    } else {
      if (compareVersions(currentParts, nodeBounds.minimum) < 0) {
        findings.push(createNodeVersionFinding(nodeVersion, contract.nodeEngine));
      }

      if (
        nodeBounds.maximum &&
        compareVersions(currentParts, nodeBounds.maximum) >= 0
      ) {
        findings.push(createNodeVersionFinding(nodeVersion, contract.nodeEngine));
      }
    }
  }

  const expectedPackageManager = parsePackageManagerContract(
    contract.packageManager,
  );
  if (expectedPackageManager && packageManager) {
    const namesMatch = packageManager.name === expectedPackageManager.name;
    const versionsMatch =
      !expectedPackageManager.version ||
      !packageManager.version ||
      packageManager.version === expectedPackageManager.version;

    if (!namesMatch || !versionsMatch) {
      findings.push(
        createPackageManagerFinding(packageManager, contract.packageManager),
      );
    }
  }

  if (!observation.shellProbe.ok) {
    findings.push(
      createShellRuntimeFinding(
        observation.shellProbe.detail ?? "unknown shell failure",
      ),
    );
  }

  try {
    await access(contract.lockfilePath);
  } catch {
    findings.push(
      createRepoPrerequisiteFinding(
        `Missing repository lockfile at ${toOutputPath(
          path.relative(REPO_ROOT, contract.lockfilePath),
        )}.`,
      ),
    );
  }

  return {
    ok: findings.length === 0,
    contract,
    observation,
    findings,
  };
}
