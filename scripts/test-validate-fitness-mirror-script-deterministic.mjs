import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

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

const repoRoot = process.cwd();
const tempRoot = mkdtempSync(resolve(tmpdir(), 'lifeline-validate-fitness-script-'));
const tempScriptDir = resolve(tempRoot, 'scripts');
const tempExamplesDir = resolve(tempRoot, 'examples');
const tempDistDir = resolve(tempRoot, 'dist');

mkdirSync(tempScriptDir, { recursive: true });
mkdirSync(tempExamplesDir, { recursive: true });
mkdirSync(tempDistDir, { recursive: true });

copyFileSync(resolve(repoRoot, 'scripts/validate-fitness-mirror.mjs'), resolve(tempScriptDir, 'validate-fitness-mirror.mjs'));
copyFileSync(resolve(repoRoot, 'examples/fitness-app.lifeline.yml'), resolve(tempExamplesDir, 'fitness-app.lifeline.yml'));

const cliStub = `'use strict';
const { readFileSync } = require('node:fs');

const args = process.argv.slice(2);
if (args[0] !== 'validate' || args[1] !== 'examples/fitness-app.lifeline.yml') {
  console.error(\`Unexpected validation invocation: \${args.join(' ')}\`);
  process.exit(1);
}

const contents = readFileSync(args[1], 'utf8');
const nameLine = contents.split(/\\r?\\n/).find((line) => line.startsWith('name:')) ?? '';
if (nameLine.trim() !== 'name: fitness') {
  process.stderr.write(
    "Fitness mirror manifest is invalid: examples/fitness-app.lifeline.yml\\n" +
      "- name: must equal 'fitness' for Fitness mirror boundary\\n",
  );
  process.exit(1);
}

process.stdout.write(
  "Fitness mirror manifest is valid: examples/fitness-app.lifeline.yml\\n" +
    "- boundary: fitness manifest mirror\\n",
);
`;

writeFileSync(resolve(tempDistDir, 'cli.js'), cliStub, 'utf8');

const scriptRelativePath = 'scripts/validate-fitness-mirror.mjs';
const scriptAbsolutePath = resolve(tempRoot, scriptRelativePath);
const expectedSuccessStdout = [
  'Fitness mirror manifest is valid: examples/fitness-app.lifeline.yml',
  '- boundary: fitness manifest mirror',
  '',
].join('\n');
const expectedFailureStderr = [
  'Fitness mirror manifest is invalid: examples/fitness-app.lifeline.yml',
  "- name: must equal 'fitness' for Fitness mirror boundary",
  '',
].join('\n');

try {
  assert(
    !existsSync(resolve(tempRoot, 'package.json')),
    'temp validation root should stay typeless for module-boundary regression coverage',
  );

  const successRelative = runNode([scriptRelativePath], tempRoot);
  assert(successRelative.status === 0, `relative success run failed:\n${successRelative.stdout}\n${successRelative.stderr}`);
  assert(
    successRelative.stdout === expectedSuccessStdout,
    `relative success stdout drifted:\n${JSON.stringify(successRelative.stdout)}`,
  );
  assert(successRelative.stderr === '', `relative success should not write stderr:\n${successRelative.stderr}`);

  const externalCwd = mkdtempSync(resolve(tmpdir(), 'lifeline-validate-fitness-script-external-cwd-'));
  const successAbsolute = runNode([scriptAbsolutePath], externalCwd);
  assert(successAbsolute.status === 0, `absolute success run failed:\n${successAbsolute.stdout}\n${successAbsolute.stderr}`);
  assert(
    successAbsolute.stdout === expectedSuccessStdout,
    `absolute success stdout drifted:\n${JSON.stringify(successAbsolute.stdout)}`,
  );
  assert(successAbsolute.stderr === '', `absolute success should not write stderr:\n${successAbsolute.stderr}`);

  const corruptedMirror = [
    'name: fitness-mirror',
    'archetype: node-web',
    'port: 4301',
    'healthcheckPath: /login',
    'deploy:',
    '  workingDirectory: ..',
    '',
  ].join('\n');

  const tempMirrorPath = resolve(tempExamplesDir, 'fitness-app.lifeline.yml');
  const originalMirror = readFileSync(tempMirrorPath, 'utf8');
  assert(originalMirror.includes('name: fitness'), 'expected baseline temp mirror to be canonical before corruption');
  writeFileSync(tempMirrorPath, corruptedMirror, 'utf8');

  const failureRun = runNode([scriptRelativePath], tempRoot);
  assert(failureRun.status === 1, `failure run should exit 1:\n${failureRun.stdout}\n${failureRun.stderr}`);
  assert(failureRun.stdout === '', `failure run should not write stdout:\n${failureRun.stdout}`);

  assert(
    failureRun.stderr === expectedFailureStderr,
    [
      'failure stderr drifted',
      `expected: ${JSON.stringify(expectedFailureStderr)}`,
      `actual: ${JSON.stringify(failureRun.stderr)}`,
    ].join('\n'),
  );
  assert(
    !failureRun.stderr.includes('Cannot use import statement outside a module'),
    `failure run regressed to module-boundary drift:\n${failureRun.stderr}`,
  );
  assert(
    !failureRun.stderr.includes('MODULE_TYPELESS_PACKAGE_JSON'),
    `failure run should avoid typeless-package noise:\n${failureRun.stderr}`,
  );

  console.log('validate-fitness-mirror script deterministic checks passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
