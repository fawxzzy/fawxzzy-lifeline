import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureBuilt } from "./lib/ensure-built.mjs";

await ensureBuilt();

const repoRoot = process.cwd();
const cliPath = resolve(repoRoot, "dist/cli.js");

const fixtureManifestPath = "fixtures/runtime-smoke-app/runtime-smoke-app.lifeline.yml";
const fixturePlaybookManifestPath = "fixtures/runtime-smoke-app/runtime-smoke-app.playbook.lifeline.yml";
const fixtureDir = resolve(repoRoot, "fixtures/runtime-smoke-app");
const playbookPath = "fixtures/playbook-export";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNode(args) {
  const result = spawnSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const validateFixture = runNode([cliPath, "validate", fixtureManifestPath]);
assert(
  validateFixture.status === 0,
  `Runtime smoke fixture validate failed.\nstdout:\n${validateFixture.stdout}\nstderr:\n${validateFixture.stderr}`,
);
assert(
  validateFixture.stdout.includes("Manifest is valid:"),
  `Expected runtime smoke fixture validate success banner.\n${validateFixture.stdout}`,
);

const validatePlaybookFixture = runNode([
  cliPath,
  "validate",
  fixturePlaybookManifestPath,
  "--playbook-path",
  playbookPath,
]);
assert(
  validatePlaybookFixture.status === 0,
  `Runtime playbook fixture validate failed.\nstdout:\n${validatePlaybookFixture.stdout}\nstderr:\n${validatePlaybookFixture.stderr}`,
);
assert(
  validatePlaybookFixture.stdout.includes("Resolved manifest is valid:"),
  `Expected playbook fixture validate success banner.\n${validatePlaybookFixture.stdout}`,
);

const resolvedPlaybookFixture = runNode([
  cliPath,
  "resolve",
  fixturePlaybookManifestPath,
  "--playbook-path",
  playbookPath,
]);
assert(
  resolvedPlaybookFixture.status === 0,
  `Runtime playbook fixture resolve failed.\nstdout:\n${resolvedPlaybookFixture.stdout}\nstderr:\n${resolvedPlaybookFixture.stderr}`,
);

const resolved = JSON.parse(resolvedPlaybookFixture.stdout);

assert(resolved.name === "runtime-smoke-app", `Unexpected fixture app name: ${resolved.name}`);
assert(resolved.archetype === "node-web", `Unexpected fixture archetype: ${resolved.archetype}`);
assert(resolved.startCommand === "node server.js", `Unexpected startCommand: ${resolved.startCommand}`);
assert(resolved.port === 4387, `Unexpected playbook fixture port: ${resolved.port}`);
assert(resolved.healthcheckPath === "/healthz", `Unexpected healthcheckPath: ${resolved.healthcheckPath}`);

assert(resolved.env?.mode === "file", `Expected env.mode=file, got ${resolved.env?.mode}`);
assert(resolved.env?.file === ".env.runtime", `Expected env.file=.env.runtime, got ${resolved.env?.file}`);
assert(Array.isArray(resolved.env?.requiredKeys), "Expected env.requiredKeys array in resolved fixture.");
assert(
  resolved.env.requiredKeys.length === 0,
  `Expected resolved playbook requiredKeys to be empty default, got ${JSON.stringify(resolved.env.requiredKeys)}`,
);

const envPath = resolve(fixtureDir, resolved.env.file);
assert(existsSync(envPath), `Expected fixture env file to exist: ${envPath}`);

const fixtureYamlRaw = readFileSync(resolve(repoRoot, fixtureManifestPath), "utf8");
assert(
  fixtureYamlRaw.includes("requiredKeys:") &&
    fixtureYamlRaw.includes("- PORT") &&
    fixtureYamlRaw.includes("- SMOKE_TOKEN"),
  "Expected runtime smoke fixture manifest to pin required env keys PORT and SMOKE_TOKEN.",
);

assert(resolved.deploy?.workingDirectory === ".", `Expected deploy.workingDirectory='.', got ${resolved.deploy?.workingDirectory}`);
const resolvedWorkingDir = resolve(fixtureDir, resolved.deploy.workingDirectory);
assert(existsSync(resolvedWorkingDir), `Expected resolved workingDirectory to exist: ${resolvedWorkingDir}`);
assert(existsSync(resolve(resolvedWorkingDir, "server.js")), "Expected server.js to exist in resolved workingDirectory.");

assert(
  resolved.runtime?.restartPolicy === "on-failure",
  `Expected runtime.restartPolicy=on-failure, got ${resolved.runtime?.restartPolicy}`,
);
assert(resolved.runtime?.restorable === true, `Expected runtime.restorable=true, got ${resolved.runtime?.restorable}`);

console.log("Runtime smoke fixture deterministic verification passed.");
