import { readdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { ensureBuilt } from './lib/ensure-built.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
  });
}

await ensureBuilt();

const repoRoot = process.cwd();
const directlyInvokedHelpers = readdirSync(resolve(repoRoot, 'scripts'))
  .filter((name) => name.endsWith('.mjs'))
  .filter((name) => !name.startsWith('test-'))
  .filter((name) => !name.startsWith('smoke-'))
  .filter((name) => name !== 'lib')
  .sort();

const expectedDirectlyInvokedHelpers = [
  'validate-fitness-mirror.mjs',
  'verify-esbuild-install.mjs',
];

assert(
  JSON.stringify(directlyInvokedHelpers) === JSON.stringify(expectedDirectlyInvokedHelpers),
  `unexpected directly-invoked helper set: ${JSON.stringify(directlyInvokedHelpers)}`,
);

const externalCwd = mkdtempSync(resolve(tmpdir(), 'lifeline-direct-script-parity-'));

for (const helper of expectedDirectlyInvokedHelpers) {
  const relativeScriptPath = `scripts/${helper}`;
  const absoluteScriptPath = resolve(repoRoot, relativeScriptPath);

  const relativeRun = runNode([relativeScriptPath], repoRoot);
  const absoluteRun = runNode([absoluteScriptPath], externalCwd);

  assert(relativeRun.status === 0, `relative invocation failed for ${helper}:\n${relativeRun.stdout}\n${relativeRun.stderr}`);
  assert(absoluteRun.status === 0, `absolute invocation failed for ${helper}:\n${absoluteRun.stdout}\n${absoluteRun.stderr}`);

  assert(
    relativeRun.stdout === absoluteRun.stdout,
    [
      `direct invocation stdout mismatch for ${helper}`,
      `relative: ${JSON.stringify(relativeRun.stdout)}`,
      `absolute: ${JSON.stringify(absoluteRun.stdout)}`,
    ].join('\n'),
  );
  assert(
    relativeRun.stderr === absoluteRun.stderr,
    [
      `direct invocation stderr mismatch for ${helper}`,
      `relative: ${JSON.stringify(relativeRun.stderr)}`,
      `absolute: ${JSON.stringify(absoluteRun.stderr)}`,
    ].join('\n'),
  );
}


const runnerRelativePath = 'scripts/smoke-runner.mjs';
const runnerAbsolutePath = resolve(repoRoot, runnerRelativePath);

const runnerRelativeUsage = runNode([runnerRelativePath], repoRoot);
const runnerAbsoluteUsage = runNode([runnerAbsolutePath], externalCwd);

assert(runnerRelativeUsage.status === 1, `smoke-runner relative usage exit drifted:
${runnerRelativeUsage.stdout}
${runnerRelativeUsage.stderr}`);
assert(runnerAbsoluteUsage.status === 1, `smoke-runner absolute usage exit drifted:
${runnerAbsoluteUsage.stdout}
${runnerAbsoluteUsage.stderr}`);
assert(
  runnerRelativeUsage.stdout === runnerAbsoluteUsage.stdout,
  [
    'smoke-runner usage stdout mismatch',
    `relative: ${JSON.stringify(runnerRelativeUsage.stdout)}`,
    `absolute: ${JSON.stringify(runnerAbsoluteUsage.stdout)}`,
  ].join('\n'),
);
assert(
  runnerRelativeUsage.stderr === runnerAbsoluteUsage.stderr,
  [
    'smoke-runner usage stderr mismatch',
    `relative: ${JSON.stringify(runnerRelativeUsage.stderr)}`,
    `absolute: ${JSON.stringify(runnerAbsoluteUsage.stderr)}`,
  ].join('\n'),
);
console.log('direct script invocation deterministic checks passed');
