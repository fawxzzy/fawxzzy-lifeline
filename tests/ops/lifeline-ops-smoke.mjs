import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ensureBuilt } from "../../scripts/lib/ensure-built.mjs";

await ensureBuilt();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureSourceDir = path.join(repoRoot, "fixtures", "runtime-smoke-app");
const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const appName = "runtime-smoke-app";

function runCli(args, { cwd, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, ...args], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
            `Command failed: node ${cliPath} ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }

      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function assertIncludes(output, fragment, label) {
  assert(
    output.includes(fragment),
    `${label}; expected to find ${JSON.stringify(fragment)} in output:\n${output}`,
  );
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Expected a numeric local port.")));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function createDisposableFixtureRoot(port) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lifeline-ops-smoke-"));
  const manifestPath = path.join(tempRoot, `${appName}.lifeline.yml`);

  await copyFile(path.join(fixtureSourceDir, "server.js"), path.join(tempRoot, "server.js"));

  const envSource = await readFile(path.join(fixtureSourceDir, ".env.runtime"), "utf8");
  const envContent = envSource.replace(/^PORT=.*$/m, `PORT=${port}`);
  await writeFile(path.join(tempRoot, ".env.runtime"), envContent, "utf8");

  const manifestSource = await readFile(
    path.join(fixtureSourceDir, `${appName}.lifeline.yml`),
    "utf8",
  );
  const manifestContent = manifestSource.replace(/^port:\s*\d+$/m, `port: ${port}`);
  await writeFile(manifestPath, manifestContent, "utf8");

  return { tempRoot, manifestPath };
}

function assertLine(lines, fragment, label) {
  assert(
    lines.some((line) => line.includes(fragment)),
    `${label}; expected a line containing ${JSON.stringify(fragment)}, got:\n${lines.join("\n")}`,
  );
}

const tempWorkspace = await mkdtemp(path.join(os.tmpdir(), "lifeline-ops-workspace-"));
const port = await getFreePort();
const { tempRoot: fixtureRoot, manifestPath } = await createDisposableFixtureRoot(port);

let cleanupNeeded = true;

try {
  const upResult = await runCli(["up", manifestPath], {
    cwd: tempWorkspace,
    allowFailure: true,
  });
  assert.equal(upResult.code, 0, `up: expected exit 0, got ${upResult.code}\n${upResult.stdout}\n${upResult.stderr}`);
  assertIncludes(upResult.stdout, `App ${appName} is running.`, "up: missing running summary");
  assertIncludes(
    upResult.stdout,
    `- log: ${path.join(tempWorkspace, ".lifeline", "logs", `${appName}.log`)}`,
    "up: missing log path",
  );

  const statusResult = await runCli(["status", appName], {
    cwd: tempWorkspace,
    allowFailure: true,
  });
  assert.equal(
    statusResult.code,
    0,
    `status: expected exit 0, got ${statusResult.code}\n${statusResult.stdout}\n${statusResult.stderr}`,
  );
  assertIncludes(statusResult.stdout, `App ${appName} is running.`, "status: missing running summary");
  assertIncludes(
    statusResult.stdout,
    `- healthcheck: http://127.0.0.1:${port}/healthz`,
    "status: missing healthcheck URL",
  );
  assertIncludes(statusResult.stdout, "- health: ok (200)", "status: missing healthy signal");
  assertIncludes(statusResult.stdout, "- log:", "status: missing log path line");

  const logsResult = await runCli(["logs", appName, "20"], {
    cwd: tempWorkspace,
    allowFailure: true,
  });
  assert.equal(
    logsResult.code,
    0,
    `logs: expected exit 0, got ${logsResult.code}\n${logsResult.stdout}\n${logsResult.stderr}`,
  );
  const logLines = logsResult.stdout.trimEnd().split("\n");
  assertLine(logLines, "=== lifeline up ", "logs: missing startup header");
  assertLine(logLines, `runtime-smoke-app listening on ${port}`, "logs: missing app startup line");

  const rollbackResult = await runCli(["down", appName], {
    cwd: tempWorkspace,
    allowFailure: true,
  });
  assert.equal(
    rollbackResult.code,
    0,
    `down: expected exit 0, got ${rollbackResult.code}\n${rollbackResult.stdout}\n${rollbackResult.stderr}`,
  );
  assertIncludes(
    rollbackResult.stdout,
    `App ${appName} has been stopped.`,
    "down: missing stop confirmation",
  );

  const stoppedStatus = await runCli(["status", appName], {
    cwd: tempWorkspace,
    allowFailure: true,
  });
  assert.equal(
    stoppedStatus.code,
    1,
    `post-down status: expected exit 1, got ${stoppedStatus.code}\n${stoppedStatus.stdout}\n${stoppedStatus.stderr}`,
  );
  assertIncludes(stoppedStatus.stdout, `App ${appName} is stopped.`, "post-down status: missing stopped summary");
  assertIncludes(
    stoppedStatus.stdout,
    "- health: managed app process not running",
    "post-down status: missing stop health signal",
  );

  const smokeDoc = await readFile(path.join(repoRoot, "docs", "ops", "lifeline-operator-surface.md"), "utf8");
  assertIncludes(smokeDoc, "node tests/ops/lifeline-ops-smoke.mjs", "doc: missing smoke path");
  assertIncludes(smokeDoc, "lifeline status <app-name>", "doc: missing status contract");
  assertIncludes(smokeDoc, "lifeline logs <app-name>", "doc: missing logs contract");

  cleanupNeeded = false;
  console.log("lifeline ops smoke verification passed.");
} finally {
  if (cleanupNeeded) {
    await runCli(["down", appName], { cwd: tempWorkspace, allowFailure: true }).catch(() => undefined);
  }

  await rm(tempWorkspace, { recursive: true, force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
}
