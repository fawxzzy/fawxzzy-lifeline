import {
  validateAppManifest,
  validateOptionalAppManifestDefaults,
  validatePartialManifest,
} from '../dist/contracts/app-manifest.js';

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

function makeValidManifest() {
  return {
    name: 'demo',
    archetype: 'node-web',
    repo: 'https://example.com/repo.git',
    branch: 'main',
    installCommand: 'pnpm install',
    buildCommand: 'pnpm build',
    startCommand: 'node dist/server.js',
    port: 4301,
    healthcheckPath: '/health',
    env: {
      mode: 'inline',
      requiredKeys: ['API_KEY'],
    },
    deploy: {
      strategy: 'restart',
    },
    runtime: {
      restartPolicy: 'on-failure',
      restorable: true,
    },
  };
}

const valid = validateAppManifest(makeValidManifest());
assertExactIssues(valid.issues, []);
assert(valid.manifest?.archetype === 'node-web', 'Expected supported node-web archetype to validate.');

const alsoSupportedArchetype = validateAppManifest({
  ...makeValidManifest(),
  archetype: 'next-web',
});
assertExactIssues(alsoSupportedArchetype.issues, []);
assert(alsoSupportedArchetype.manifest?.archetype === 'next-web', 'Expected supported next-web archetype to validate.');

const unsupportedArchetype = validateAppManifest({
  ...makeValidManifest(),
  archetype: 'python-web',
});
assertExactIssues(unsupportedArchetype.issues, [
  { path: 'archetype', message: 'must be one of: next-web, node-web' },
]);

const invalidHealthcheckPath = validateAppManifest({
  ...makeValidManifest(),
  healthcheckPath: 'health',
});
assertExactIssues(invalidHealthcheckPath.issues, [
  { path: 'healthcheckPath', message: "must start with '/'" },
]);

for (const port of [0, 65536, 12.5, '4301']) {
  const result = validateAppManifest({ ...makeValidManifest(), port });
  assertExactIssues(result.issues, [
    { path: 'port', message: 'must be an integer between 1 and 65535' },
  ]);
}

assertExactIssues(
  validateAppManifest({ ...makeValidManifest(), port: 1 }).issues,
  [],
);
assertExactIssues(
  validateAppManifest({ ...makeValidManifest(), port: 65535 }).issues,
  [],
);

const legacyRequired = validateAppManifest({
  ...makeValidManifest(),
  env: {
    mode: 'inline',
    required: ['LEGACY_KEY'],
  },
});
assertExactIssues(legacyRequired.issues, [
  { path: 'env.required', message: 'has been renamed to env.requiredKeys' },
]);

const requiredKeysPreferredOverLegacy = validateAppManifest({
  ...makeValidManifest(),
  env: {
    mode: 'inline',
    requiredKeys: ['CANONICAL'],
    required: ['LEGACY_IGNORED'],
  },
});
assertExactIssues(requiredKeysPreferredOverLegacy.issues, []);
assert(
  JSON.stringify(requiredKeysPreferredOverLegacy.manifest?.env.requiredKeys) === JSON.stringify(['CANONICAL']),
  'Expected env.requiredKeys to win when both env.requiredKeys and env.required are provided.',
);

const invalidRequiredKeysShape = validateAppManifest({
  ...makeValidManifest(),
  env: {
    mode: 'inline',
    requiredKeys: [42],
  },
});
assertExactIssues(invalidRequiredKeysShape.issues, [
  {
    path: 'env.requiredKeys',
    message: 'must be an array when provided, and each key must be a non-empty string',
  },
]);

const fileModeMissingFile = validateAppManifest({
  ...makeValidManifest(),
  env: {
    mode: 'file',
    requiredKeys: [],
  },
});
assertExactIssues(fileModeMissingFile.issues, [
  { path: 'env.file', message: "is required when env.mode is 'file'" },
]);

const invalidRuntimeRestartPolicy = validateAppManifest({
  ...makeValidManifest(),
  runtime: {
    restartPolicy: 'always',
    restorable: true,
  },
});
assertExactIssues(invalidRuntimeRestartPolicy.issues, [
  { path: 'runtime.restartPolicy', message: 'must be one of: on-failure, never' },
]);

const invalidRuntimeRestorable = validateAppManifest({
  ...makeValidManifest(),
  runtime: {
    restartPolicy: 'never',
    restorable: 'sometimes',
  },
});
assertExactIssues(invalidRuntimeRestorable.issues, [
  { path: 'runtime.restorable', message: 'must be a boolean' },
]);

const runtimeStringBooleans = validateAppManifest({
  ...makeValidManifest(),
  runtime: {
    restartPolicy: 'never',
    restorable: 'false',
  },
});
assertExactIssues(runtimeStringBooleans.issues, []);
assert(runtimeStringBooleans.manifest?.runtime.restorable === false, 'Expected runtime.restorable string false to normalize.');

const defaultedRuntime = validateAppManifest({
  ...makeValidManifest(),
  runtime: undefined,
});
assertExactIssues(defaultedRuntime.issues, []);
assert(defaultedRuntime.manifest?.runtime.restartPolicy === 'on-failure', 'Expected runtime.restartPolicy default when runtime is omitted.');
assert(defaultedRuntime.manifest?.runtime.restorable === true, 'Expected runtime.restorable default when runtime is omitted.');

const partialDefaultsWithoutRunnableFields = validatePartialManifest({
  runtime: {
    restorable: 'false',
  },
});
assertExactIssues(partialDefaultsWithoutRunnableFields.issues, []);
assert(
  partialDefaultsWithoutRunnableFields.manifest === undefined,
  'Expected partial validation without runnable fields to report no issues and no runnable manifest payload.',
);

const partialWithLegacyRequired = validatePartialManifest({
  env: {
    required: ['LEGACY_KEY'],
  },
});
assertExactIssues(partialWithLegacyRequired.issues, [
  { path: 'env.required', message: 'has been renamed to env.requiredKeys' },
]);

const partialDefaultsWithRunnableFields = validatePartialManifest({
  ...makeValidManifest(),
  runtime: {
    restorable: 'false',
  },
});
assertExactIssues(partialDefaultsWithRunnableFields.issues, []);
assert(partialDefaultsWithRunnableFields.manifest?.runtime.restorable === false, 'Expected partial manifest runtime.restorable to normalize to false.');
assert(partialDefaultsWithRunnableFields.manifest?.runtime.restartPolicy === 'on-failure', 'Expected partial manifest runtime.restartPolicy default.');

const optionalDefaultsAlias = validateOptionalAppManifestDefaults({
  ...makeValidManifest(),
  runtime: {
    restorable: 'true',
  },
});
assertExactIssues(optionalDefaultsAlias.issues, []);
assert(optionalDefaultsAlias.manifest?.runtime.restorable === true, 'Expected optional defaults alias to normalize runtime.restorable true.');

const optionalDefaultsPreservePartialContract = validateOptionalAppManifestDefaults({
  env: {
    mode: 'file',
  },
});
assertExactIssues(optionalDefaultsPreservePartialContract.issues, [
  { path: 'env.file', message: "is required when env.mode is 'file'" },
]);

console.log('app-manifest contract deterministic checks passed');
