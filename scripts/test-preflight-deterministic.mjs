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

const rejectionFixtures = [
  {
    name: 'node-version',
    input: {
      env: pnpmEnv,
      nodeVersion: 'v20.10.0',
      shellProbe: () => ({ ok: true }),
    },
    expected: {
      category: 'node-version',
      code: 'NODE_VERSION_OUT_OF_RANGE',
      messageIncludes: 'outside the supported range',
      remediationIncludes: 'Node 22.14.x',
    },
  },
  {
    name: 'package-manager',
    input: {
      env: {
        ...process.env,
        npm_config_user_agent: 'npm/10.8.2 node/v22.14.0',
        npm_execpath: 'npm',
      },
      nodeVersion: 'v22.14.0',
      shellProbe: () => ({ ok: true }),
    },
    expected: {
      category: 'package-manager',
      code: 'PACKAGE_MANAGER_MISMATCH',
      messageIncludes: 'Detected npm@10.8.2',
      remediationIncludes: 'Run Lifeline through pnpm',
    },
  },
  {
    name: 'shell-runtime',
    input: {
      env: pnpmEnv,
      nodeVersion: 'v22.14.0',
      shellProbe: () => ({ ok: false, detail: 'cmd.exe unavailable' }),
    },
    expected: {
      category: 'shell-runtime',
      code: 'SHELL_RUNTIME_UNAVAILABLE',
      messageIncludes: 'cmd.exe unavailable',
      remediationIncludes: 'Fix the platform shell/runtime setup',
    },
  },
  {
    name: 'repo-prerequisite',
    input: {
      env: pnpmEnv,
      nodeVersion: 'not-a-semver',
      shellProbe: () => ({ ok: true }),
    },
    expected: {
      category: 'repo-prerequisite',
      code: 'REPO_PREREQUISITE_MISSING',
      messageIncludes: 'Unable to parse current Node version',
      remediationIncludes: 'Restore the missing repository prerequisite',
    },
  },
];

for (const fixture of rejectionFixtures) {
  const report = await preflightModule.runPreflightChecks(fixture.input);
  assert(!report.ok, `${fixture.name} fixture should fail preflight`);
  assert(
    report.findings.length === 1,
    `${fixture.name} fixture should surface exactly one finding, got ${report.findings.length}`,
  );
  assert(
    report.findings[0]?.category === fixture.expected.category,
    `${fixture.name} fixture should classify as ${fixture.expected.category}, got ${report.findings[0]?.category}`,
  );
  assert(
    report.findings[0]?.code === fixture.expected.code,
    `${fixture.name} fixture should use code ${fixture.expected.code}, got ${report.findings[0]?.code}`,
  );
  assert(
    report.findings[0]?.message.includes(fixture.expected.messageIncludes),
    `${fixture.name} fixture should mention ${fixture.expected.messageIncludes}:\n${report.findings[0]?.message}`,
  );
  assert(
    report.findings[0]?.remediation.includes(fixture.expected.remediationIncludes),
    `${fixture.name} fixture should explain remediation ${fixture.expected.remediationIncludes}:\n${report.findings[0]?.remediation}`,
  );

  const failureLines = preflightModule.formatPreflightFailure(report, 'Preflight');
  const failureSurface = failureLines.join('\n');
  assert(
    failureSurface.includes(`[${fixture.expected.category}]`),
    `${fixture.name} failure surface should include the category banner:\n${failureSurface}`,
  );
  assert(
    failureSurface.includes(`remediation: ${report.findings[0]?.remediation}`),
    `${fixture.name} failure surface should include the remediation line:\n${failureSurface}`,
  );
}

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
  combinedOutput.includes('remediation: Run Lifeline through pnpm'),
  `validation should preserve the package-manager remediation text:\n${combinedOutput}`,
);
assert(
  !combinedOutput.includes('Manifest is valid:'),
  `validation should stop before manifest parsing:\n${combinedOutput}`,
);

console.log('Preflight deterministic verification passed.');
