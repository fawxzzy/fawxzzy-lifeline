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
  .filter((name) => name !== 'lib');

assert(
  directlyInvokedHelpers.length === 1 && directlyInvokedHelpers[0] === 'validate-fitness-mirror.mjs',
  `unexpected directly-invoked helper set: ${JSON.stringify(directlyInvokedHelpers)}`,
);

const relativeScriptPath = 'scripts/validate-fitness-mirror.mjs';
const absoluteScriptPath = resolve(repoRoot, relativeScriptPath);

const relativeRun = runNode([relativeScriptPath], repoRoot);
const externalCwd = mkdtempSync(resolve(tmpdir(), 'lifeline-direct-script-parity-'));
const absoluteRun = runNode([absoluteScriptPath], externalCwd);

assert(relativeRun.status === 0, `relative invocation failed:\n${relativeRun.stdout}\n${relativeRun.stderr}`);
assert(absoluteRun.status === 0, `absolute invocation failed:\n${absoluteRun.stdout}\n${absoluteRun.stderr}`);

assert(
  relativeRun.stdout === absoluteRun.stdout,
  [
    'direct invocation stdout mismatch',
    `relative: ${JSON.stringify(relativeRun.stdout)}`,
    `absolute: ${JSON.stringify(absoluteRun.stdout)}`,
  ].join('\n'),
);
assert(
  relativeRun.stderr === absoluteRun.stderr,
  [
    'direct invocation stderr mismatch',
    `relative: ${JSON.stringify(relativeRun.stderr)}`,
    `absolute: ${JSON.stringify(absoluteRun.stderr)}`,
  ].join('\n'),
);

console.log('direct script invocation deterministic checks passed');
