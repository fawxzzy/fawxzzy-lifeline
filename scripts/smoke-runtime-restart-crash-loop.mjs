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
const appName = `runtime-smoke-restart-crash-loop-${uniqueSuffix}`;
const runtimePort = 9100 + Math.floor(Math.random() * 600);

let manifestPath = "fixtures/runtime-smoke-app/runtime-smoke-app.lifeline.yml";
let tempRootDir;
let baseManifestRaw = "";

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

async function waitForRuntime(predicate, label) {
  for (let i = 0; i < 700; i += 1) {
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

async function waitForCrashLoopState() {
  return waitForRuntime(
    (state) => state.lastKnownStatus === "crash-loop" && state.crashLoopDetected,
    "crash-loop runtime state",
  );
}

async function waitForHealthyRunningState() {
  return waitForRuntime(
    (state) =>
      state.lastKnownStatus === "running" &&
      isPidAlive(state.supervisorPid) &&
      isPidAlive(state.childPid) &&
      isPidAlive(state.portOwnerPid),
    "healthy running runtime state",
  );
}

async function prepareFixtureConfig() {
  tempRootDir = await mkdtemp(path.join(tmpdir(), "lifeline-runtime-restart-crash-loop-smoke-"));
  const tempFixtureDir = path.join(tempRootDir, "runtime-smoke-app");

  await cp("fixtures/runtime-smoke-app", tempFixtureDir, { recursive: true });

  const envPath = path.join(tempFixtureDir, ".env.runtime");
  const envRaw = await readFile(envPath, "utf8");
  await writeFile(envPath, envRaw.replace(/^PORT=.*$/m, `PORT=${runtimePort}`), "utf8");

  const tempManifestPath = path.join(tempFixtureDir, "runtime-smoke-app.lifeline.yml");
  baseManifestRaw = await readFile(tempManifestPath, "utf8");

  const crashLoopManifest = baseManifestRaw
    .replace(/^name: .*$/m, `name: ${appName}`)
    .replace(/^port: .*$/m, `port: ${runtimePort}`)
    .replace(
      /^startCommand: .*$/m,
      "startCommand: node -e \"const s=require('node:net').createServer();s.listen(Number(process.env.PORT||0),'127.0.0.1',()=>setTimeout(()=>process.exit(17),100));\"",
    )
    .replace(/^  restartPolicy: .*$/m, "  restartPolicy: on-failure");

  await writeFile(tempManifestPath, crashLoopManifest, "utf8");
  manifestPath = tempManifestPath;
}

async function writeHealthyManifestConfig() {
  const healthyManifest = baseManifestRaw
    .replace(/^name: .*$/m, `name: ${appName}`)
    .replace(/^port: .*$/m, `port: ${runtimePort}`);

  await writeFile(manifestPath, healthyManifest, "utf8");
}

async function cleanup() {
  await run(["down", appName], { allowFailure: true });
}

try {
  await prepareFixtureConfig();
  await cleanup();

  await run(["up", manifestPath], { allowFailure: true });

  const crashLoopState = await waitForCrashLoopState();
  if (crashLoopState.lastExitCode !== 17) {
    throw new Error(`Expected deterministic crash-loop exit code 17, found ${crashLoopState.lastExitCode}`);
  }

  await writeHealthyManifestConfig();

  const restartResult = await run(["restart", appName], { allowFailure: true });
  if (restartResult.code !== 0) {
    throw new Error(
      `Expected restart to recover crash-loop app successfully.\nstdout:\n${restartResult.stdout}\nstderr:\n${restartResult.stderr}`,
    );
  }

  if (restartResult.stderr.includes(`No runtime state found for app ${appName}.`)) {
    throw new Error(
      `Expected restart not to take no-history path for crash-loop app.\nstdout:\n${restartResult.stdout}\nstderr:\n${restartResult.stderr}`,
    );
  }

  const restartedState = await waitForHealthyRunningState();
  if (restartedState.crashLoopDetected === true) {
    throw new Error(`Expected crash-loop residue to be cleared after restart, found ${restartedState.crashLoopDetected}`);
  }

  if (path.resolve(restartedState.manifestPath) !== path.resolve(manifestPath)) {
    throw new Error(
      `Expected restart to reuse persisted manifest path ${path.resolve(manifestPath)}, found ${restartedState.manifestPath}`,
    );
  }

  if (await canBindPort(runtimePort)) {
    throw new Error(`Expected managed runtime port ${runtimePort} to be owned after restart`);
  }

  const statusAfterRestart = await run(["status", appName], { allowFailure: true });
  if (statusAfterRestart.code !== 0) {
    throw new Error(
      `Expected status to report healthy/running after crash-loop restart recovery.\nstdout:\n${statusAfterRestart.stdout}\nstderr:\n${statusAfterRestart.stderr}`,
    );
  }

  if (!statusAfterRestart.stdout.includes(`App ${appName} is running.`)) {
    throw new Error(
      `Expected status output to report running after restart recovery.\nstdout:\n${statusAfterRestart.stdout}\nstderr:\n${statusAfterRestart.stderr}`,
    );
  }

  if (!statusAfterRestart.stdout.includes("- health: ok")) {
    throw new Error(
      `Expected status output to report healthy state after restart recovery.\nstdout:\n${statusAfterRestart.stdout}\nstderr:\n${statusAfterRestart.stderr}`,
    );
  }

  if (!statusAfterRestart.stdout.includes(`- portOwner: ${restartedState.portOwnerPid}`)) {
    throw new Error(
      `Expected status output port owner to match persisted state (${restartedState.portOwnerPid}).\nstdout:\n${statusAfterRestart.stdout}\nstderr:\n${statusAfterRestart.stderr}`,
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
