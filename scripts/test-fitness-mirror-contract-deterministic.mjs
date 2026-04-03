import { validateFitnessMirrorManifest } from '../dist/contracts/fitness-mirror.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertExactIssues(issues, expectedIssues) {
  const actual = JSON.stringify(issues);
  const expected = JSON.stringify(expectedIssues);
  assert(
    actual === expected,
    [
      'Issue mismatch.',
      `Expected: ${JSON.stringify(expectedIssues, null, 2)}`,
      `Actual: ${JSON.stringify(issues, null, 2)}`,
    ].join('\n'),
  );
}

function makeValidMirror() {
  return {
    name: 'fitness',
    archetype: 'node-web',
    port: 4301,
    healthcheckPath: '/login',
    deploy: {
      workingDirectory: '..',
    },
  };
}

assertExactIssues(validateFitnessMirrorManifest(makeValidMirror()), []);

assertExactIssues(validateFitnessMirrorManifest('not-an-object'), [
  { path: '$', message: 'manifest must be a YAML object' },
]);

const wrongTopLevelKeys = validateFitnessMirrorManifest({
  ...makeValidMirror(),
  runtime: { restorable: true },
});
assertExactIssues(wrongTopLevelKeys, [
  {
    path: '$',
    message: 'expected top-level keys: archetype, deploy, healthcheckPath, name, port',
  },
]);

const missingDeploy = validateFitnessMirrorManifest({
  name: 'fitness',
  archetype: 'node-web',
  port: 4301,
  healthcheckPath: '/login',
});
assertExactIssues(missingDeploy, [
  {
    path: '$',
    message: 'expected top-level keys: archetype, deploy, healthcheckPath, name, port',
  },
  { path: 'deploy', message: 'must be an object' },
]);

const wrongFieldValues = validateFitnessMirrorManifest({
  ...makeValidMirror(),
  name: 'fitness-mirror',
  archetype: 'next-web',
  port: 4400,
  healthcheckPath: '/health',
});
assertExactIssues(wrongFieldValues, [
  { path: 'name', message: "must equal 'fitness' for Fitness mirror boundary" },
  { path: 'archetype', message: "must equal 'node-web' for Fitness mirror boundary" },
  { path: 'port', message: 'must equal 4301 for Fitness mirror boundary' },
  { path: 'healthcheckPath', message: "must equal '/login' for Fitness mirror boundary" },
]);

const wrongEverything = validateFitnessMirrorManifest({
  name: 'x',
  archetype: 'y',
  port: 1,
  healthcheckPath: '/',
  deploy: null,
});
assertExactIssues(wrongEverything, [
  { path: 'name', message: "must equal 'fitness' for Fitness mirror boundary" },
  { path: 'archetype', message: "must equal 'node-web' for Fitness mirror boundary" },
  { path: 'port', message: 'must equal 4301 for Fitness mirror boundary' },
  { path: 'healthcheckPath', message: "must equal '/login' for Fitness mirror boundary" },
  { path: 'deploy', message: 'must be an object' },
]);

const deployWrongKeys = validateFitnessMirrorManifest({
  ...makeValidMirror(),
  deploy: {
    workingDirectory: '..',
    extra: 'value',
  },
});
assertExactIssues(deployWrongKeys, [{ path: 'deploy', message: 'expected deploy keys: workingDirectory' }]);

const deployWrongWorkingDirectory = validateFitnessMirrorManifest({
  ...makeValidMirror(),
  deploy: {
    workingDirectory: '.',
  },
});
assertExactIssues(deployWrongWorkingDirectory, [
  {
    path: 'deploy.workingDirectory',
    message: "must equal '..' for Fitness mirror boundary",
  },
]);

const deployNestedMismatches = validateFitnessMirrorManifest({
  ...makeValidMirror(),
  deploy: {
    wrongKey: 'x',
  },
});
assertExactIssues(deployNestedMismatches, [
  { path: 'deploy', message: 'expected deploy keys: workingDirectory' },
  {
    path: 'deploy.workingDirectory',
    message: "must equal '..' for Fitness mirror boundary",
  },
]);

console.log('fitness-mirror contract deterministic checks passed');
