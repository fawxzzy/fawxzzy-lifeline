import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { ensureBuilt } from "./lib/ensure-built.mjs";

await ensureBuilt();

const cli = ["node", "dist/cli.js"];
const statePath = ".lifeline/state.json";

const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const appName = `runtime-smoke-crash-loop-${uniqueSuffix}`;
const runtimePort = 8000 + Math.floor(Math.random() * 1000);

let manifestPath = "fixtures/runtime-smoke-app/runtime-smoke-app.lifeline.yml";
let tempRootDir;

function run(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli[0], [...cli.slice(1), ...args], {
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

function isPidAlive(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function readRuntimeState() {
  const raw = await readFile(statePath, "utf8").catch(() => "");
  if (!raw) {
    return undefined;
  }

  const parsed = JSON.parse(raw);
  return parsed?.apps?.[appName];
}

async function waitForCrashLoopState() {
  for (let i = 0; i < 700; i += 1) {
    const state = await readRuntimeState();
    if (state?.lastKnownStatus === "crash-loop" && state.crashLoopDetected) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const latestStatus = await run(["status", appName], { allowFailure: true });
  throw new Error(
    `Timed out waiting for crash-loop state.\nstatus:\n${latestStatus.stdout}\n${latestStatus.stderr}`,
  );
}

async function prepareFixtureConfig() {
  tempRootDir = await mkdtemp(path.join(tmpdir(), "lifeline-runtime-crash-loop-smoke-"));
  const tempFixtureDir = path.join(tempRootDir, "runtime-smoke-app");

  await cp("fixtures/runtime-smoke-app", tempFixtureDir, { recursive: true });

  const envPath = path.join(tempFixtureDir, ".env.runtime");
  const envRaw = await readFile(envPath, "utf8");
  await writeFile(envPath, envRaw.replace(/^PORT=.*$/m, `PORT=${runtimePort}`), "utf8");

  const tempManifestPath = path.join(tempFixtureDir, "runtime-smoke-app.lifeline.yml");
  const manifestRaw = await readFile(tempManifestPath, "utf8");
  const manifestForCrashLoop = manifestRaw
    .replace(/^name: .*$/m, `name: ${appName}`)
    .replace(/^port: .*$/m, `port: ${runtimePort}`)
    .replace(
      /^startCommand: .*$/m,
      "startCommand: node -e \"const s=require('node:net').createServer();s.listen(Number(process.env.PORT||0),'127.0.0.1',()=>setTimeout(()=>process.exit(17),100));\"",
    )
    .replace(/^  restartPolicy: .*$/m, "  restartPolicy: on-failure");

  await writeFile(tempManifestPath, manifestForCrashLoop, "utf8");
  manifestPath = tempManifestPath;
}

async function cleanup() {
  await run(["down", appName], { allowFailure: true });
}

try {
  await prepareFixtureConfig();
  await cleanup();

  await run(["up", manifestPath], { allowFailure: true });

  const crashLoopState = await waitForCrashLoopState();

  if (crashLoopState.lastKnownStatus !== "crash-loop" || !crashLoopState.crashLoopDetected) {
    throw new Error(`Expected persisted crash-loop state, found ${JSON.stringify(crashLoopState)}`);
  }

  if (crashLoopState.lastExitCode !== 17) {
    throw new Error(`Expected lastExitCode=17 for deterministic crash process, found ${crashLoopState.lastExitCode}`);
  }

  if (crashLoopState.childPid && isPidAlive(crashLoopState.childPid)) {
    throw new Error(`Expected no live child process after crash-loop cutoff, found ${crashLoopState.childPid}`);
  }

  if (crashLoopState.portOwnerPid) {
    throw new Error(`Expected no managed port owner after crash-loop cutoff, found pid ${crashLoopState.portOwnerPid}`);
  }

  if (!(await canBindPort(runtimePort))) {
    throw new Error(`Expected managed port ${runtimePort} to be free after crash-loop cutoff`);
  }

  const settledRestartCount = crashLoopState.restartCount;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const stateAfterSettle = await readRuntimeState();
  if (!stateAfterSettle) {
    throw new Error("Expected persisted runtime state after crash-loop settle window");
  }

  if (stateAfterSettle.restartCount !== settledRestartCount) {
    throw new Error(
      `Expected restartCount to stop increasing after crash-loop cutoff, was ${settledRestartCount}, now ${stateAfterSettle.restartCount}`,
    );
  }

  const statusResult = await run(["status", appName], { allowFailure: true });
  if (statusResult.code === 0) {
    throw new Error(
      `Expected non-zero status exit for crash-loop app.\n${statusResult.stdout}\n${statusResult.stderr}`,
    );
  }

  if (!statusResult.stdout.includes(`App ${appName} is crash-loop.`)) {
    throw new Error(
      `Expected status output to surface crash-loop state.\n${statusResult.stdout}\n${statusResult.stderr}`,
    );
  }

  if (statusResult.stdout.includes(`App ${appName} is running.`)) {
    throw new Error(
      `Expected status output not to report running for crash-loop app.\n${statusResult.stdout}\n${statusResult.stderr}`,
    );
  }

  if (statusResult.stdout.includes(`App ${appName} is unhealthy.`)) {
    throw new Error(
      `Expected status output not to report unhealthy for crash-loop app.\n${statusResult.stdout}\n${statusResult.stderr}`,
    );
  }

  if (!statusResult.stdout.includes("- child: stopped")) {
    throw new Error(
      `Expected status output to report no live managed child.\n${statusResult.stdout}\n${statusResult.stderr}`,
    );
  }

  if (!statusResult.stdout.includes("- portOwner: none")) {
    throw new Error(
      `Expected status output to report no port owner in crash-loop state.\n${statusResult.stdout}\n${statusResult.stderr}`,
    );
  }

  const persistedAfterStatus = await readRuntimeState();
  if (!persistedAfterStatus) {
    throw new Error("Expected persisted runtime state after status refresh");
  }

  if (persistedAfterStatus.lastKnownStatus !== "crash-loop") {
    throw new Error(
      `Expected persisted state to end with lastKnownStatus=crash-loop, found ${persistedAfterStatus.lastKnownStatus}`,
    );
  }

  if (persistedAfterStatus.restartCount !== settledRestartCount) {
    throw new Error(
      `Expected restartCount to remain stable after status refresh, was ${settledRestartCount}, now ${persistedAfterStatus.restartCount}`,
    );
  }
} catch (error) {
  await cleanup();
  throw error;
} finally {
  await cleanup();
  if (tempRootDir) {
    await rm(tempRootDir, { recursive: true, force: true });
  }
}
