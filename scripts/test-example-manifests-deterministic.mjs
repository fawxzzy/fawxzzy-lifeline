import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ensureBuilt } from "./lib/ensure-built.mjs";

await ensureBuilt();

const repoRoot = process.cwd();
const cliPath = resolve(repoRoot, "dist/cli.js");
const externalCwd = mkdtempSync(resolve(tmpdir(), "lifeline-example-manifest-deterministic-"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runValidate(manifestPath, cwd = repoRoot) {
  const result = spawnSync("node", [cliPath, "validate", manifestPath], {
    cwd,
    encoding: "utf8",
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assertValidateSuccess(result, label) {
  assert(
    result.status === 0,
    `${label} validate failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

const fitnessRelativePath = "examples/fitness-app.lifeline.yml";
const fitnessAbsolutePath = resolve(repoRoot, fitnessRelativePath);

const fitnessRelative = runValidate(fitnessRelativePath, repoRoot);
const fitnessAbsolute = runValidate(fitnessAbsolutePath, externalCwd);

assertValidateSuccess(fitnessRelative, "fitness relative path");
assertValidateSuccess(fitnessAbsolute, "fitness absolute path");

const fitnessRelativeOutput = `${fitnessRelative.stdout}${fitnessRelative.stderr}`;
const fitnessAbsoluteOutput = `${fitnessAbsolute.stdout}${fitnessAbsolute.stderr}`;

assert(
  fitnessRelativeOutput.includes("Fitness mirror manifest is valid"),
  `Expected fitness relative validate to use mirror path.\n${fitnessRelativeOutput}`,
);
assert(
  fitnessAbsoluteOutput.includes("Fitness mirror manifest is valid"),
  `Expected fitness absolute validate to use mirror path.\n${fitnessAbsoluteOutput}`,
);
assert(
  fitnessRelativeOutput.includes("- boundary: fitness manifest mirror"),
  `Expected fitness relative validate boundary marker.\n${fitnessRelativeOutput}`,
);
assert(
  fitnessAbsoluteOutput.includes("- boundary: fitness manifest mirror"),
  `Expected fitness absolute validate boundary marker.\n${fitnessAbsoluteOutput}`,
);

const playbookRelativePath = "examples/playbook-ui.lifeline.yml";
const playbookAbsolutePath = resolve(repoRoot, playbookRelativePath);

const playbookRelative = runValidate(playbookRelativePath, repoRoot);
const playbookAbsolute = runValidate(playbookAbsolutePath, externalCwd);

assertValidateSuccess(playbookRelative, "playbook-ui relative path");
assertValidateSuccess(playbookAbsolute, "playbook-ui absolute path");

const playbookRelativeOutput = `${playbookRelative.stdout}${playbookRelative.stderr}`;
const playbookAbsoluteOutput = `${playbookAbsolute.stdout}${playbookAbsolute.stderr}`;

for (const output of [playbookRelativeOutput, playbookAbsoluteOutput]) {
  assert(
    output.includes("Manifest is valid:"),
    `Expected playbook example validate success banner.\n${output}`,
  );
  assert(output.includes("- app: playbook-ui"), `Missing app output for playbook example.\n${output}`);
  assert(output.includes("- archetype: next-web"), `Missing archetype output for playbook example.\n${output}`);
  assert(output.includes("- port: 3100"), `Missing port output for playbook example.\n${output}`);
}

console.log("Example manifest deterministic verification passed.");
