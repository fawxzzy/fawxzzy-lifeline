import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runValidate(manifestPath) {
  return spawnSync('node', ['dist/cli.js', 'validate', manifestPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function normalizeOutput(output, manifestPath) {
  return output.replaceAll(manifestPath, '<manifest-path>');
}

const build = spawnSync('pnpm', ['build'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert(build.status === 0, `build failed:\n${build.stdout}\n${build.stderr}`);

const relativePath = 'examples/fitness-app.lifeline.yml';
const absolutePath = resolve(relativePath);

const relativeResult = runValidate(relativePath);
const absoluteResult = runValidate(absolutePath);

assert(relativeResult.status === 0, `relative validation failed:\n${relativeResult.stdout}\n${relativeResult.stderr}`);
assert(absoluteResult.status === 0, `absolute validation failed:\n${absoluteResult.stdout}\n${absoluteResult.stderr}`);

const relativeCombined = `${relativeResult.stdout}${relativeResult.stderr}`;
const absoluteCombined = `${absoluteResult.stdout}${absoluteResult.stderr}`;

assert(
  relativeCombined.includes('Fitness mirror manifest is valid'),
  `relative path should use fitness mirror boundary:\n${relativeCombined}`,
);
assert(
  absoluteCombined.includes('Fitness mirror manifest is valid'),
  `absolute path should use fitness mirror boundary:\n${absoluteCombined}`,
);
assert(
  relativeCombined.includes('- boundary: fitness manifest mirror'),
  `relative path should include boundary marker:\n${relativeCombined}`,
);
assert(
  absoluteCombined.includes('- boundary: fitness manifest mirror'),
  `absolute path should include boundary marker:\n${absoluteCombined}`,
);

const normalizedRelative = normalizeOutput(relativeCombined, relativePath);
const normalizedAbsolute = normalizeOutput(absoluteCombined, absolutePath);

assert(
  normalizedRelative === normalizedAbsolute,
  [
    'relative and absolute path invocations should have identical boundary-specific output surface',
    `relative:\n${relativeCombined}`,
    `absolute:\n${absoluteCombined}`,
  ].join('\n\n'),
);

console.log('validate fitness mirror path parity checks passed');
