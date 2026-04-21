import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const cliPath = resolve(repoRoot, "dist", "cli.js");
const mirrorDisplayPath = "examples/fitness-app.lifeline.yml";

const result = spawnSync(process.execPath, [cliPath, "validate", mirrorDisplayPath], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

process.exit(result.status ?? 1);
