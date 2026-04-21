import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureBuilt } from './lib/ensure-built.mjs';

await ensureBuilt();

const pnpmEnv = {
  ...process.env,
  npm_config_user_agent: 'pnpm/10.6.5 node/v22.14.0',
  npm_execpath: 'pnpm',
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCli(repoRoot, args, env = process.env) {
  const cliPath = path.join(repoRoot, 'dist', 'cli.js');
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
  });
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const preflightModule = await import(new URL('../dist/core/preflight.js', import.meta.url));

const nodeFailure = await preflightModule.runPreflightChecks({
  env: {
    npm_config_user_agent: 'pnpm/10.6.5 node/v22.14.0',
  },
  nodeVersion: 'v20.10.0',
  shellProbe: () => ({ ok: true }),
});

assert(!nodeFailure.ok, 'node override should fail preflight');
assert(
  nodeFailure.findings.some((finding) => finding.category === 'node-version'),
  'node override should surface a node-version finding',
);
assert(
  nodeFailure.findings[0]?.remediation.includes('Node 22.14.x'),
  'node override should explain the first remediation step',
);

const doctorResult = runCli(repoRoot, ['doctor'], pnpmEnv);
assert(
  doctorResult.status === 0,
  `doctor should pass in the pnpm-shaped environment, got ${doctorResult.status}`,
);
assert(
  doctorResult.stdout.includes('Doctor preflight passed.'),
  `doctor output should include the success banner:\nstdout:\n${doctorResult.stdout}\nstderr:\n${doctorResult.stderr}`,
);

const packageManagerMismatch = runCli(
  repoRoot,
  ['validate', 'examples/fitness-app.lifeline.yml'],
  {
    ...process.env,
    npm_config_user_agent: 'npm/10.8.2 node/v22.14.0',
    npm_execpath: 'npm',
  },
);

assert(
  packageManagerMismatch.status === 1,
  `package-manager mismatch should fail validation, got ${packageManagerMismatch.status}`,
);

const combinedOutput = `${packageManagerMismatch.stdout}\n${packageManagerMismatch.stderr}`;
assert(
  combinedOutput.includes('Validation preflight failed.'),
  `validation should fail in the shared preflight stage:\n${combinedOutput}`,
);
assert(
  combinedOutput.includes('[package-manager]'),
  `validation should surface the package-manager finding:\n${combinedOutput}`,
);
assert(
  !combinedOutput.includes('Manifest is valid:'),
  `validation should stop before manifest parsing:\n${combinedOutput}`,
);

console.log('Preflight deterministic verification passed.');
