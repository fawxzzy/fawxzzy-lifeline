import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  StartupBackend,
  StartupBackendInspection,
  StartupBackendRequest,
  StartupBackendResult,
} from "../startup-backend.js";

const LAUNCHD_LABEL = "io.lifeline.restore";
const LAUNCHD_MECHANISM = "launchd-agent";
const EXPECTED_RESTORE_ENTRYPOINT = "lifeline restore";

interface LaunchctlCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

type LaunchctlRunner = (args: string[]) => Promise<LaunchctlCommandResult>;

interface LaunchdBackendOptions {
  homeDirectory?: string;
  uid?: number;
}

function normalizeOutput(value: string): string {
  return value.trim();
}

async function runLaunchctl(args: string[]): Promise<LaunchctlCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("launchctl", args, {
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: unknown) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk: unknown) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      resolve({
        code: -1,
        stdout: normalizeOutput(stdout),
        stderr: normalizeOutput(`Unable to execute launchctl: ${error.message}`),
      });
    });

    child.on("exit", (code: number | null) => {
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout: normalizeOutput(stdout),
        stderr: normalizeOutput(stderr),
      });
    });
  });
}

function resolvePlistPath(homeDirectory: string): string {
  return path.join(homeDirectory, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function buildLaunchdDomainTarget(uid: number): string {
  return `gui/${uid}`;
}

function buildLaunchdServiceTarget(uid: number): string {
  return `${buildLaunchdDomainTarget(uid)}/${LAUNCHD_LABEL}`;
}

function buildPlistContents(): string {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    <string>lifeline</string>",
    "    <string>restore</string>",
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function isLaunchctlUnavailable(result: LaunchctlCommandResult): boolean {
  return result.code === -1;
}

function isMissingService(result: LaunchctlCommandResult): boolean {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    combined.includes("could not find service") ||
    combined.includes("no such process") ||
    combined.includes("service is disabled") ||
    combined.includes("not found")
  );
}

function hasCanonicalEntrypoint(plist: string): boolean {
  return (
    plist.includes(`<string>${LAUNCHD_LABEL}</string>`) &&
    plist.includes("<string>lifeline</string>") &&
    plist.includes("<string>restore</string>")
  );
}

async function inspectLaunchAgent(
  runner: LaunchctlRunner,
  plistPath: string,
  uid: number | undefined,
): Promise<StartupBackendInspection> {
  if (typeof uid !== "number") {
    return {
      supported: false,
      status: "unsupported",
      mechanism: LAUNCHD_MECHANISM,
      detail:
        "launchd user domain could not be resolved because uid is unavailable, so startup registration cannot be inspected.",
    };
  }

  const plistContents = await readFile(plistPath, "utf8").catch(() => "");
  if (!plistContents) {
    return {
      supported: true,
      status: "not-installed",
      mechanism: LAUNCHD_MECHANISM,
      detail: `LaunchAgent ${LAUNCHD_LABEL} is not currently registered for Lifeline startup.`,
    };
  }

  if (!hasCanonicalEntrypoint(plistContents)) {
    return {
      supported: true,
      status: "not-installed",
      mechanism: LAUNCHD_MECHANISM,
      detail: `LaunchAgent ${LAUNCHD_LABEL} exists but is not configured for the canonical restore entrypoint ${EXPECTED_RESTORE_ENTRYPOINT}.`,
    };
  }

  const printResult = await runner(["print", buildLaunchdServiceTarget(uid)]);
  if (isLaunchctlUnavailable(printResult)) {
    return {
      supported: false,
      status: "unsupported",
      mechanism: LAUNCHD_MECHANISM,
      detail: "launchctl is unavailable, so launchd startup registration cannot be inspected.",
    };
  }

  if (printResult.code !== 0) {
    return {
      supported: true,
      status: "not-installed",
      mechanism: LAUNCHD_MECHANISM,
      detail: `LaunchAgent plist exists at ${plistPath}, but ${LAUNCHD_LABEL} is not bootstrapped in ${buildLaunchdDomainTarget(uid)}.`,
    };
  }

  return {
    supported: true,
    status: "installed",
    mechanism: LAUNCHD_MECHANISM,
    detail: `LaunchAgent ${LAUNCHD_LABEL} is installed and configured to execute ${EXPECTED_RESTORE_ENTRYPOINT} via launchd.`,
  };
}

function resolveCurrentUid(): number | undefined {
  const rawUid = process.env.UID;
  if (typeof rawUid !== "string") {
    return undefined;
  }

  const parsedUid = Number.parseInt(rawUid, 10);
  return Number.isFinite(parsedUid) ? parsedUid : undefined;
}

export function createLaunchdBackend(
  runner: LaunchctlRunner = runLaunchctl,
  options: LaunchdBackendOptions = {},
): StartupBackend {
  const homeDirectory = options.homeDirectory ?? process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const uid = options.uid ?? resolveCurrentUid();
  const plistPath = resolvePlistPath(homeDirectory);

  return {
    id: LAUNCHD_MECHANISM,
    capabilities: ["inspect", "install", "uninstall"],
    inspect: async () => inspectLaunchAgent(runner, plistPath, uid),
    install: async (request: StartupBackendRequest): Promise<StartupBackendResult> => {
      if (request.dryRun) {
        const inspection = await inspectLaunchAgent(runner, plistPath, uid);
        return {
          status: inspection.status,
          detail:
            inspection.status === "installed"
              ? `Dry-run: LaunchAgent ${LAUNCHD_LABEL} is already configured for ${request.restoreEntrypoint}; no mutation required.`
              : `Dry-run: would write ${plistPath} and bootstrap ${LAUNCHD_LABEL} in ${typeof uid === "number" ? buildLaunchdDomainTarget(uid) : "launchd user domain"} for ${request.restoreEntrypoint}.`,
        };
      }

      if (typeof uid !== "number") {
        return {
          status: "unsupported",
          detail:
            "launchd user domain could not be resolved because uid is unavailable, so startup registration cannot be installed.",
        };
      }

      const plistDirectory = path.dirname(plistPath);
      await mkdir(plistDirectory, { recursive: true });
      await writeFile(plistPath, buildPlistContents(), "utf8");

      await runner(["bootout", buildLaunchdServiceTarget(uid)]).catch(() => undefined);

      const bootstrapResult = await runner(["bootstrap", buildLaunchdDomainTarget(uid), plistPath]);
      if (isLaunchctlUnavailable(bootstrapResult)) {
        return {
          status: "unsupported",
          detail: "launchctl is unavailable, so launchd startup registration cannot be installed.",
        };
      }

      if (bootstrapResult.code !== 0) {
        return {
          status: "not-installed",
          detail: `Failed to bootstrap LaunchAgent ${LAUNCHD_LABEL}: ${bootstrapResult.stderr || bootstrapResult.stdout || "unknown launchd error"}.`,
        };
      }

      return {
        status: "installed",
        detail: `Installed LaunchAgent ${LAUNCHD_LABEL} at ${plistPath} and bootstrapped it in ${buildLaunchdDomainTarget(uid)} to run ${request.restoreEntrypoint}.`,
      };
    },
    uninstall: async (request: StartupBackendRequest): Promise<StartupBackendResult> => {
      if (request.dryRun) {
        const inspection = await inspectLaunchAgent(runner, plistPath, uid);
        return {
          status: inspection.status,
          detail:
            inspection.status === "installed"
              ? `Dry-run: would bootout LaunchAgent ${LAUNCHD_LABEL} and remove ${plistPath}.`
              : `Dry-run: LaunchAgent ${LAUNCHD_LABEL} is not present; no mutation required.`,
        };
      }

      if (typeof uid !== "number") {
        return {
          status: "unsupported",
          detail:
            "launchd user domain could not be resolved because uid is unavailable, so startup registration cannot be removed.",
        };
      }

      const bootoutResult = await runner(["bootout", buildLaunchdServiceTarget(uid)]);
      if (isLaunchctlUnavailable(bootoutResult)) {
        return {
          status: "unsupported",
          detail: "launchctl is unavailable, so launchd startup registration cannot be removed.",
        };
      }

      if (bootoutResult.code !== 0 && !isMissingService(bootoutResult)) {
        return {
          status: "not-installed",
          detail: `Failed to bootout LaunchAgent ${LAUNCHD_LABEL}: ${bootoutResult.stderr || bootoutResult.stdout || "unknown launchd error"}.`,
        };
      }

      const fsPromises = (await import("node:fs/promises")) as unknown as {
        unlink(path: string): Promise<void>;
      };
      await fsPromises.unlink(plistPath).catch(() => undefined);

      return {
        status: "not-installed",
        detail: `Booted out LaunchAgent ${LAUNCHD_LABEL} and removed ${plistPath}.`,
      };
    },
  };
}
