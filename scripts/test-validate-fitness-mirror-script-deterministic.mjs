import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
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
const scriptRelativePath = 'scripts/validate-fitness-mirror.mjs';
const scriptAbsolutePath = resolve(repoRoot, scriptRelativePath);
const expectedSuccessStdout = 'Fitness mirror validation passed for examples/fitness-app.lifeline.yml.\n';

const successRelative = runNode([scriptRelativePath], repoRoot);
assert(successRelative.status === 0, `relative success run failed:\n${successRelative.stdout}\n${successRelative.stderr}`);
assert(
  successRelative.stdout === expectedSuccessStdout,
  `relative success stdout drifted:\n${JSON.stringify(successRelative.stdout)}`,
);
assert(successRelative.stderr === '', `relative success should not write stderr:\n${successRelative.stderr}`);

const externalCwd = mkdtempSync(resolve(tmpdir(), 'lifeline-validate-fitness-script-'));
const successAbsolute = runNode([scriptAbsolutePath], externalCwd);
assert(successAbsolute.status === 0, `absolute success run failed:\n${successAbsolute.stdout}\n${successAbsolute.stderr}`);
assert(
  successAbsolute.stdout === expectedSuccessStdout,
  `absolute success stdout drifted:\n${JSON.stringify(successAbsolute.stdout)}`,
);
assert(successAbsolute.stderr === '', `absolute success should not write stderr:\n${successAbsolute.stderr}`);

const mirrorPath = resolve(repoRoot, 'examples/fitness-app.lifeline.yml');
const originalMirror = readFileSync(mirrorPath, 'utf8');
const corruptedMirror = [
  'name: fitness-mirror',
  'archetype: node-web',
  'port: 4301',
  'healthcheckPath: /login',
  'deploy:',
  '  workingDirectory: ..',
  '',
].join('\n');

try {
  writeFileSync(mirrorPath, corruptedMirror, 'utf8');

  const failureRun = runNode([scriptRelativePath], repoRoot);
  assert(failureRun.status === 1, `failure run should exit 1:\n${failureRun.stdout}\n${failureRun.stderr}`);
  assert(failureRun.stdout === '', `failure run should not write stdout:\n${failureRun.stdout}`);

  const expectedFailureStderr = [
    'Fitness mirror validation failed for examples/fitness-app.lifeline.yml:',
    "- name: must equal 'fitness' for Fitness mirror boundary",
    '',
  ].join('\n');

  assert(
    failureRun.stderr === expectedFailureStderr,
    [
      'failure stderr drifted',
      `expected: ${JSON.stringify(expectedFailureStderr)}`,
      `actual: ${JSON.stringify(failureRun.stderr)}`,
    ].join('\n'),
  );
} finally {
  writeFileSync(mirrorPath, originalMirror, 'utf8');
}

console.log('validate-fitness-mirror script deterministic checks passed');
