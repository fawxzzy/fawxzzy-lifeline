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
const fixtureDir = "fixtures/runtime-smoke-app";
const fixtureManifest = "runtime-smoke-app.playbook.lifeline.yml";
const fixtureEnv = ".env.runtime";
const fixturePlaybookPath = "fixtures/playbook-export";
const expectedPlaybookPath = path.resolve(fixturePlaybookPath);

const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const appName = `runtime-smoke-restore-playbook-persisted-${uniqueSuffix}`;
const runtimePort = 9800 + Math.floor(Math.random() * 150);

let manifestPath;
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

async function waitForPidExit(pid) {
  for (let i = 0; i < 60; i += 1) {
    if (!isPidAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for pid ${pid} to exit`);
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

async function waitForRuntime(predicate, label) {
  for (let i = 0; i < 60; i += 1) {
    const state = await readRuntimeState();
    if (state && predicate(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const latestStatus = await run(["status", appName], { allowFailure: true });
  throw new Error(
    `Timed out waiting for ${label}.\nstatus:\n${latestStatus.stdout}\n${latestStatus.stderr}`,
  );
}

async function waitForRunning() {
  return waitForRuntime(
    (state) =>
      state.lastKnownStatus === "running" &&
      isPidAlive(state.supervisorPid) &&
      isPidAlive(state.childPid),
    "running state with live managed supervisor and child",
  );
}

async function waitForPortRelease() {
  for (let i = 0; i < 40; i += 1) {
    if (await canBindPort(runtimePort)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Expected managed port ${runtimePort} to be free after runtime loss`);
}

async function prepareFixtureConfig() {
  tempRootDir = await mkdtemp(path.join(tmpdir(), "lifeline-runtime-restore-playbook-smoke-"));
  const tempFixtureDir = path.join(tempRootDir, "runtime-smoke-app");

  await cp(fixtureDir, tempFixtureDir, { recursive: true });

  const envPath = path.join(tempFixtureDir, fixtureEnv);
  const envRaw = await readFile(envPath, "utf8");
  await writeFile(envPath, envRaw.replace(/^PORT=.*$/m, `PORT=${runtimePort}`), "utf8");

  const tempManifestPath = path.join(tempFixtureDir, fixtureManifest);
  const manifestRaw = await readFile(tempManifestPath, "utf8");
  const manifestForRestore = manifestRaw
    .replace(/^name: .*$/m, `name: ${appName}`)
    .replace(/^port: .*$/m, `port: ${runtimePort}`)
    .replace(/^  restartPolicy: .*$/m, "  restartPolicy: never")
    .replace(/^  restorable: .*$/m, "  restorable: true");

  await writeFile(tempManifestPath, manifestForRestore, "utf8");
  manifestPath = tempManifestPath;
}

async function cleanup() {
  await run(["down", appName], { allowFailure: true });
}

try {
  await prepareFixtureConfig();
  await cleanup();

  await run(["up", manifestPath, "--playbook-path", fixturePlaybookPath]);
  const startedState = await waitForRunning();

  if (startedState.playbookPath !== expectedPlaybookPath) {
    throw new Error(
      `Expected persisted playbook path ${expectedPlaybookPath} after initial up, found ${startedState.playbookPath}`,
    );
  }

  process.kill(startedState.supervisorPid, "SIGKILL");
  await waitForPidExit(startedState.supervisorPid);

  process.kill(startedState.childPid, "SIGKILL");
  await waitForPidExit(startedState.childPid);

  await waitForPortRelease();

  const persistedBeforeRestore = await readRuntimeState();
  if (!persistedBeforeRestore) {
    throw new Error("Expected persisted runtime state before restore");
  }

  if (persistedBeforeRestore.playbookPath !== expectedPlaybookPath) {
    throw new Error(
      `Expected persisted playbook path ${expectedPlaybookPath} before restore, found ${persistedBeforeRestore.playbookPath}`,
    );
  }

  const restoreResult = await run(["restore"], { allowFailure: true });
  if (restoreResult.code !== 0) {
    throw new Error(
      `Expected restore command to succeed.\nstdout:\n${restoreResult.stdout}\nstderr:\n${restoreResult.stderr}`,
    );
  }

  if (!restoreResult.stdout.includes(`Restored ${appName} with supervisor pid`)) {
    throw new Error(
      `Expected restore output to confirm relaunch.\nstdout:\n${restoreResult.stdout}\nstderr:\n${restoreResult.stderr}`,
    );
  }

  const restoredRunningState = await waitForRunning();

  if (restoredRunningState.supervisorPid === startedState.supervisorPid) {
    throw new Error(
      `Expected restore to launch a new supervisor pid, still ${restoredRunningState.supervisorPid}`,
    );
  }

  if (restoredRunningState.childPid === startedState.childPid) {
    throw new Error(
      `Expected restore to launch a new child pid, still ${restoredRunningState.childPid}`,
    );
  }

  if (restoredRunningState.playbookPath !== expectedPlaybookPath) {
    throw new Error(
      `Expected restored running state to keep playbook path ${expectedPlaybookPath}, found ${restoredRunningState.playbookPath}`,
    );
  }

  const statusAfterRestore = await run(["status", appName], { allowFailure: true });
  if (statusAfterRestore.code !== 0) {
    throw new Error(
      `Expected healthy running status after restore relaunch.\nstdout:\n${statusAfterRestore.stdout}\nstderr:\n${statusAfterRestore.stderr}`,
    );
  }

  if (!statusAfterRestore.stdout.includes(`- playbook: ${expectedPlaybookPath}`)) {
    throw new Error(
      `Expected status output to report persisted playbook path ${expectedPlaybookPath}.\nstdout:\n${statusAfterRestore.stdout}\nstderr:\n${statusAfterRestore.stderr}`,
    );
  }

  if (!statusAfterRestore.stdout.includes("- health: ok")) {
    throw new Error(
      `Expected healthy status output after restore relaunch.\nstdout:\n${statusAfterRestore.stdout}\nstderr:\n${statusAfterRestore.stderr}`,
    );
  }

  const persistedAfterRestore = await readRuntimeState();
  if (!persistedAfterRestore) {
    throw new Error("Expected persisted runtime state after restore relaunch");
  }

  if (persistedAfterRestore.playbookPath !== expectedPlaybookPath) {
    throw new Error(
      `Expected persisted playbook path ${expectedPlaybookPath} after restore, found ${persistedAfterRestore.playbookPath}`,
    );
  }

  const logsAfterRestore = await run(["logs", appName, "120"]);
  if (!logsAfterRestore.stdout.includes(`runtime-smoke-app listening on ${runtimePort}`)) {
    throw new Error(
      `Expected runtime startup/listening log after restore relaunch.\nstdout:\n${logsAfterRestore.stdout}\nstderr:\n${logsAfterRestore.stderr}`,
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
