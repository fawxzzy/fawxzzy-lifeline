import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createSchedulerHarness() {
  const state = { installed: false };

  return async (args) => {
    const command = args.join(" ");
    if (command.startsWith("/Query")) {
      if (!state.installed) {
        return { code: 1, stdout: "", stderr: "ERROR: task not found." };
      }

      return {
        code: 0,
        stdout: "TaskName: \\LifelineRestoreAtLogon\nTask To Run: lifeline restore",
        stderr: "",
      };
    }

    if (command.startsWith("/Create")) {
      state.installed = true;
      return { code: 0, stdout: "SUCCESS: task created.", stderr: "" };
    }

    if (command.startsWith("/Delete")) {
      state.installed = false;
      return { code: 0, stdout: "SUCCESS: task deleted.", stderr: "" };
    }

    return { code: 1, stdout: "", stderr: `Unexpected command: ${command}` };
  };
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lifeline-startup-command-win-"));
  const previousCwd = process.cwd();
  process.chdir(tempRoot);
  const { createWindowsTaskSchedulerBackend } = await import(
    "../dist/core/startup-backends/windows-task-scheduler.js"
  );
  const { runStartupCommand } = await import("../dist/commands/startup.js");

  const backend = createWindowsTaskSchedulerBackend(createSchedulerHarness());
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values) => logs.push(values.join(" "));
  console.error = (...values) => errors.push(values.join(" "));

  try {
    const enableCode = await runStartupCommand("enable", undefined, backend);
    assert(enableCode === 0, `Expected startup enable to succeed, got ${enableCode}.`);
    assert(logs.some((line) => line.includes("Startup enabled: yes")), "Expected status after enable to be yes.");

    const statusCode = await runStartupCommand("status", undefined, backend);
    assert(statusCode === 0, `Expected startup status to succeed, got ${statusCode}.`);
    assert(logs.some((line) => line.includes("Startup backend status: installed")), "Expected installed backend status.");

    const disableCode = await runStartupCommand("disable", undefined, backend);
    assert(disableCode === 0, `Expected startup disable to succeed, got ${disableCode}.`);
    assert(logs.some((line) => line.includes("Startup enabled: no")), "Expected status after disable to be no.");

    const persistedState = JSON.parse(await readFile(path.join(tempRoot, ".lifeline", "startup.json"), "utf8"));
    assert(persistedState.intent === "disabled", `Expected persisted intent disabled, got ${persistedState.intent}.`);
    assert(
      persistedState.backendStatus === "not-installed",
      `Expected persisted backendStatus not-installed, got ${persistedState.backendStatus}.`,
    );
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.chdir(previousCwd);
  }

  assert(errors.length === 0, `Expected no stderr output, got:\n${errors.join("\n")}`);
  console.log("Deterministic startup command Windows backend harness verification passed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Deterministic startup command Windows backend harness verification failed: ${message}`);
  process.exitCode = 1;
});
