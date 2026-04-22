import { spawnSync } from 'node:child_process';
import process from 'node:process';

const pnpmEnv = {
  ...process.env,
  npm_config_user_agent: 'pnpm/10.6.5 node/v22.14.0',
  npm_execpath: 'pnpm',
};

function runCliValidate(manifestPath, env = pnpmEnv) {
  return spawnSync('node', ['dist/cli.js', 'validate', manifestPath], {
    encoding: 'utf8',
    env,
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const canonicalPartial = runCliValidate(
  'fixtures/runtime-smoke-app/runtime-smoke-app.playbook.lifeline.yml',
);
assert(canonicalPartial.status === 1, 'canonical partial manifest should fail raw validation');
assert(
  (canonicalPartial.stderr + canonicalPartial.stdout).includes('installCommand: must be a non-empty string'),
  'canonical failure should mention missing required runtime fields',
);

const fitnessMirror = runCliValidate('examples/fitness-app.lifeline.yml');
assert(fitnessMirror.status === 0, 'fitness mirror should pass via narrow validation path');
assert(
  (fitnessMirror.stderr + fitnessMirror.stdout).includes('Fitness mirror manifest is valid'),
  'fitness mirror success should identify narrow boundary path',
);
assert(
  (fitnessMirror.stderr + fitnessMirror.stdout).includes('- boundary: fitness manifest mirror'),
  'fitness mirror success should include the runtime validation boundary marker',
);

const mirrorHelper = spawnSync('node', ['scripts/validate-fitness-mirror.mjs'], {
  encoding: 'utf8',
  env: pnpmEnv,
});
assert(mirrorHelper.status === 0, `fitness mirror helper should delegate to validate successfully:\n${mirrorHelper.stdout}\n${mirrorHelper.stderr}`);
assert(
  mirrorHelper.stdout === fitnessMirror.stdout,
  [
    'fitness mirror helper should emit the same stdout surface as the canonical validate boundary',
    `validate stdout: ${JSON.stringify(fitnessMirror.stdout)}`,
    `helper stdout: ${JSON.stringify(mirrorHelper.stdout)}`,
  ].join('\n'),
);
assert(
  mirrorHelper.stderr === fitnessMirror.stderr,
  [
    'fitness mirror helper should emit the same stderr surface as the canonical validate boundary',
    `validate stderr: ${JSON.stringify(fitnessMirror.stderr)}`,
    `helper stderr: ${JSON.stringify(mirrorHelper.stderr)}`,
  ].join('\n'),
);

console.log('validate boundary checks passed');
