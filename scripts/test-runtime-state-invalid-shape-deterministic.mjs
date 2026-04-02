import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ensureBuilt } from "./lib/ensure-built.mjs";

await ensureBuilt();
const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(args, { cwd, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 && !allowFailure) {
        reject(
          new Error(
            `Command failed: ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }

      resolve({ code, stdout, stderr });
    });
  });
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lifeline-invalid-runtime-shape-"));
const lifelineDir = path.join(tempRoot, ".lifeline");
await mkdir(lifelineDir, { recursive: true });

const appName = "invalid-runtime-state-shape-check";
const invalidPersistedState = {
  apps: {
    [appName]: {
      name: appName,
      manifestPath: "/tmp/manifest.mjs",
      workingDirectory: "/tmp",
      supervisorPid: "not-a-number",
      port: 4010,
      healthcheckPath: "/health",
      logPath: 77,
      startedAt: new Date(0).toISOString(),
      lastKnownStatus: "running",
      restartPolicy: "on-failure",
      restartCount: 0,
      restorable: true,
      crashLoopDetected: false,
    },
  },
};

await writeFile(
  path.join(lifelineDir, "state.json"),
  `${JSON.stringify(invalidPersistedState, null, 2)}\n`,
  "utf8",
);

const logsResult = await run(["logs", appName], { cwd: tempRoot, allowFailure: true });
if (logsResult.code === 0) {
  throw new Error(
    `Expected logs to fail without trusted runtime history for ${appName}.\nstdout:\n${logsResult.stdout}\nstderr:\n${logsResult.stderr}`,
  );
}

if (!logsResult.stderr.includes(`No runtime state found for app ${appName}.`)) {
  throw new Error(
    `Expected invalid persisted runtime app entry to be treated as missing state.\nstdout:\n${logsResult.stdout}\nstderr:\n${logsResult.stderr}`,
  );
}

if (/TypeError|SyntaxError/i.test(logsResult.stderr)) {
  throw new Error(
    `Expected invalid persisted runtime state shape to be handled without runtime parser/access exceptions.\nstderr:\n${logsResult.stderr}`,
  );
}

console.log("Invalid runtime state shape deterministic recovery verification passed.");
