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
const appStopped = `runtime-smoke-restore-mixed-stopped-${uniqueSuffix}`;
const appCrashLoop = `runtime-smoke-restore-mixed-crash-loop-${uniqueSuffix}`;
const appBlocked = `runtime-smoke-restore-mixed-blocked-${uniqueSuffix}`;

const portBase = 8200 + Math.floor(Math.random() * 400);
const portStopped = portBase;
const portCrashLoop = portBase + 1;
const portBlocked = portBase + 2;

let tempRootDir;
let blockedManifestPath;
let crashLoopManifestPath;
let stoppedManifestPath;
let foreignServer;

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

async function readState() {
  const raw = await readFile(statePath, "utf8").catch(() => "");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw)?.apps ?? {};
}

async function readRuntimeState(appName) {
  const apps = await readState();
  return apps[appName];
}

async function waitForState(appName, predicate, label) {
  for (let i = 0; i < 120; i += 1) {
    const state = await readRuntimeState(appName);
    if (state && predicate(state)) {
      return state;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const status = await run(["status", appName], { allowFailure: true });
  throw new Error(
    `Timed out waiting for ${label} on ${appName}.\nstdout:\n${status.stdout}\nstderr:\n${status.stderr}`,
  );
}

async function waitForPidExit(pid) {
  for (let i = 0; i < 80; i += 1) {
    if (!isPidAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for pid ${pid} to exit`);
}

async function writeManifest({ appName, port, restartPolicy, startCommand }) {
  const fixtureDir = path.join(tempRootDir, appName);
  await cp("fixtures/runtime-smoke-app", fixtureDir, { recursive: true });

  const envPath = path.join(fixtureDir, ".env.runtime");
  const envRaw = await readFile(envPath, "utf8");
  await writeFile(envPath, envRaw.replace(/^PORT=.*$/m, `PORT=${port}`), "utf8");

  const manifestPath = path.join(fixtureDir, "runtime-smoke-app.lifeline.yml");
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifestUpdated = manifestRaw
    .replace(/^name: .*$/m, `name: ${appName}`)
    .replace(/^port: .*$/m, `port: ${port}`)
    .replace(/^  restartPolicy: .*$/m, `  restartPolicy: ${restartPolicy}`)
    .replace(/^startCommand: .*$/m, `startCommand: ${startCommand}`);

  await writeFile(manifestPath, manifestUpdated, "utf8");
  return manifestPath;
}

async function waitForRunning(appName) {
  return waitForState(
    appName,
    (state) =>
      state.lastKnownStatus === "running" &&
      isPidAlive(state.supervisorPid) &&
      isPidAlive(state.childPid),
    "running state with live supervisor and child",
  );
}

async function waitForStopped(appName) {
  return waitForState(
    appName,
    (state) => state.lastKnownStatus === "stopped",
    "stopped state",
  );
}

async function waitForCrashLoop(appName) {
  return waitForState(
    appName,
    (state) => state.lastKnownStatus === "crash-loop" && state.crashLoopDetected,
    "crash-loop state",
  );
}

async function waitForBlocked(appName, portOwnerPid) {
  for (let i = 0; i < 120; i += 1) {
    const state = await readRuntimeState(appName);
    const status = await run(["status", appName], { allowFailure: true });

    if (
      state?.lastKnownStatus === "blocked" &&
      state.portOwnerPid === portOwnerPid &&
      status.stdout.includes(`App ${appName} is blocked.`) &&
      status.stdout.includes(`- portOwner: pid ${portOwnerPid}`)
    ) {
      return state;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const status = await run(["status", appName], { allowFailure: true });
  throw new Error(
    `Timed out waiting for blocked state on ${appName}.\nstdout:\n${status.stdout}\nstderr:\n${status.stderr}`,
  );
}

async function startForeignServer() {
  foreignServer = spawn(
    process.execPath,
    [
      "-e",
      `const http=require(\"node:http\");const port=${portBlocked};http.createServer((req,res)=>{if(req.url===\"/health\"){res.writeHead(200);res.end(\"ok\");return;}res.writeHead(200);res.end(\"foreign\");}).listen(port,\"127.0.0.1\");setInterval(()=>{},1000);`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const stderrChunks = [];
  foreignServer.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!foreignServer.pid || !isPidAlive(foreignServer.pid)) {
    throw new Error(`Failed to start foreign server on ${portBlocked}. stderr:\n${stderrChunks.join("")}`);
  }

  return foreignServer.pid;
}

async function assertForeignServing() {
  const response = await fetch(`http://127.0.0.1:${portBlocked}/`);
  const body = await response.text();
  if (response.status !== 200 || body !== "foreign") {
    throw new Error(`Expected foreign server on ${portBlocked}, got status=${response.status}, body=${body}`);
  }
}

async function stopForeignServer() {
  if (!foreignServer?.pid) {
    return;
  }

  if (isPidAlive(foreignServer.pid)) {
    process.kill(foreignServer.pid, "SIGTERM");
    await waitForPidExit(foreignServer.pid).catch(async () => {
      process.kill(foreignServer.pid, "SIGKILL");
      await waitForPidExit(foreignServer.pid);
    });
  }

  foreignServer = undefined;
}

async function cleanup() {
  await stopForeignServer();
  await run(["down", appStopped], { allowFailure: true });
  await run(["down", appCrashLoop], { allowFailure: true });
  await run(["down", appBlocked], { allowFailure: true });
}

try {
  tempRootDir = await mkdtemp(path.join(tmpdir(), "lifeline-runtime-restore-mixed-all-skipped-smoke-"));

  stoppedManifestPath = await writeManifest({
    appName: appStopped,
    port: portStopped,
    restartPolicy: "never",
    startCommand: "node fixtures/runtime-smoke-app/server.js",
  });

  crashLoopManifestPath = await writeManifest({
    appName: appCrashLoop,
    port: portCrashLoop,
    restartPolicy: "on-failure",
    startCommand:
      'node -e "const s=require(\'node:net\').createServer();s.listen(Number(process.env.PORT||0),\'127.0.0.1\',()=>setTimeout(()=>process.exit(17),100));"',
  });

  blockedManifestPath = await writeManifest({
    appName: appBlocked,
    port: portBlocked,
    restartPolicy: "never",
    startCommand: "node fixtures/runtime-smoke-app/server.js",
  });

  await cleanup();

  await run(["up", stoppedManifestPath]);
  const stoppedRunning = await waitForRunning(appStopped);
  process.kill(stoppedRunning.childPid, "SIGKILL");
  await waitForPidExit(stoppedRunning.childPid);
  const stoppedBeforeRestore = await waitForStopped(appStopped);

  await run(["up", crashLoopManifestPath], { allowFailure: true });
  const crashLoopBeforeRestore = await waitForCrashLoop(appCrashLoop);

  await run(["up", blockedManifestPath]);
  const blockedRunning = await waitForRunning(appBlocked);
  process.kill(blockedRunning.childPid, "SIGKILL");
  await waitForPidExit(blockedRunning.childPid);

  const foreignPid = await startForeignServer();
  const blockedBeforeRestore = await waitForBlocked(appBlocked, foreignPid);

  if (!(await canBindPort(portStopped))) {
    throw new Error(`Expected stopped app port ${portStopped} to be free before restore`);
  }

  if (!(await canBindPort(portCrashLoop))) {
    throw new Error(`Expected crash-loop app port ${portCrashLoop} to be free before restore`);
  }

  if (await canBindPort(portBlocked)) {
    throw new Error(`Expected blocked app port ${portBlocked} to remain occupied by foreign owner before restore`);
  }

  const restoreResult = await run(["restore"], { allowFailure: true });
  if (restoreResult.code !== 0) {
    throw new Error(
      `Expected restore to succeed for all-skipped mixed batch.\nstdout:\n${restoreResult.stdout}\nstderr:\n${restoreResult.stderr}`,
    );
  }

  const requiredSkipLines = [
    `Skipping ${appStopped}: last known status is stopped; not restorable as running.`,
    `Skipping ${appCrashLoop}: last known status is crash-loop; not restorable as running.`,
    `Skipping ${appBlocked}: last known status is blocked; not restorable as running.`,
  ];

  for (const line of requiredSkipLines) {
    if (!restoreResult.stdout.includes(line)) {
      throw new Error(`Expected restore output to include skip line: ${line}\nstdout:\n${restoreResult.stdout}`);
    }
  }

  if (!restoreResult.stdout.includes("No restorable apps required restart.")) {
    throw new Error(
      `Expected restore output to summarize all-skipped batch.\nstdout:\n${restoreResult.stdout}\nstderr:\n${restoreResult.stderr}`,
    );
  }

  if (restoreResult.stdout.includes("No managed apps found in .lifeline/state.json.")) {
    throw new Error(
      `Expected restore not to misclassify all-skipped batch as missing state.\nstdout:\n${restoreResult.stdout}\nstderr:\n${restoreResult.stderr}`,
    );
  }

  for (const appName of [appStopped, appCrashLoop, appBlocked]) {
    if (restoreResult.stdout.includes(`Restored ${appName} with supervisor pid`)) {
      throw new Error(`Expected ${appName} not to be relaunched during all-skipped restore.`);
    }
  }

  const stoppedAfterRestore = await readRuntimeState(appStopped);
  const crashLoopAfterRestore = await readRuntimeState(appCrashLoop);
  const blockedAfterRestore = await readRuntimeState(appBlocked);

  if (stoppedAfterRestore?.lastKnownStatus !== "stopped") {
    throw new Error(`Expected stopped app status to persist as stopped, found ${stoppedAfterRestore?.lastKnownStatus}`);
  }

  if (crashLoopAfterRestore?.lastKnownStatus !== "crash-loop") {
    throw new Error(
      `Expected crash-loop app status to persist as crash-loop, found ${crashLoopAfterRestore?.lastKnownStatus}`,
    );
  }

  if (blockedAfterRestore?.lastKnownStatus !== "blocked") {
    throw new Error(`Expected blocked app status to persist as blocked, found ${blockedAfterRestore?.lastKnownStatus}`);
  }

  if (stoppedAfterRestore.supervisorPid !== stoppedBeforeRestore.supervisorPid) {
    throw new Error("Expected stopped app supervisor pid not to change after restore");
  }

  if (crashLoopAfterRestore.supervisorPid !== crashLoopBeforeRestore.supervisorPid) {
    throw new Error("Expected crash-loop app supervisor pid not to change after restore");
  }

  if (blockedAfterRestore.supervisorPid !== blockedBeforeRestore.supervisorPid) {
    throw new Error("Expected blocked app supervisor pid not to change after restore");
  }

  if (stoppedAfterRestore.childPid && isPidAlive(stoppedAfterRestore.childPid)) {
    throw new Error(`Expected stopped app child pid ${stoppedAfterRestore.childPid} to remain offline`);
  }

  if (crashLoopAfterRestore.childPid && isPidAlive(crashLoopAfterRestore.childPid)) {
    throw new Error(`Expected crash-loop app child pid ${crashLoopAfterRestore.childPid} to remain offline`);
  }

  if (blockedAfterRestore.childPid && isPidAlive(blockedAfterRestore.childPid)) {
    throw new Error(`Expected blocked app child pid ${blockedAfterRestore.childPid} to remain offline`);
  }

  if (!(await canBindPort(portStopped))) {
    throw new Error(`Expected stopped app port ${portStopped} to remain free after restore`);
  }

  if (!(await canBindPort(portCrashLoop))) {
    throw new Error(`Expected crash-loop app port ${portCrashLoop} to remain free after restore`);
  }

  if (await canBindPort(portBlocked)) {
    throw new Error(`Expected blocked app port ${portBlocked} to remain owned by foreign process after restore`);
  }

  await assertForeignServing();
} catch (error) {
  await cleanup();
  throw error;
} finally {
  await cleanup();
  if (tempRootDir) {
    await rm(tempRootDir, { recursive: true, force: true });
  }
}
