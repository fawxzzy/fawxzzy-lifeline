import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureBuiltCli() {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  try {
    await access(cliPath);
  } catch {
    await execFileAsync('pnpm', ['build'], {
      cwd: repoRoot,
      env: process.env,
    });
  }
}

async function verifyRestoreEntrypointWiring() {
  const cliSource = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8');

  assert(
    cliSource.includes('runRestoreCommand') && cliSource.includes('case "restore":'),
    'Expected src/cli.ts to keep restore entrypoint wired through runRestoreCommand.',
  );

  assert(
    cliSource.includes('lifeline restore'),
    'Expected CLI usage output to keep the restore command discoverable.',
  );
}

async function verifyContractSurfaceWiring() {
  const startupCommandSource = await readFile(new URL('../src/commands/startup.ts', import.meta.url), 'utf8');
  const startupCoreSource = await readFile(new URL('../src/core/startup-contract.ts', import.meta.url), 'utf8');
  const startupBackendSource = await readFile(new URL('../src/core/startup-backend.ts', import.meta.url), 'utf8');

  assert(
    startupCommandSource.includes('--dry-run'),
    'Expected startup command to expose --dry-run planning support.',
  );

  assert(
    startupCoreSource.includes('resolveStartupBackend'),
    'Expected startup core to route planning/status through startup backend resolution.',
  );

  assert(
    startupCommandSource.includes('backend.install') && startupCommandSource.includes('backend.uninstall'),
    'Expected startup command to wire enable/disable through backend install and uninstall calls.',
  );

  assert(
    startupBackendSource.includes('status: "unsupported"'),
    'Expected default startup backend to report unsupported status cleanly.',
  );

  assert(
    startupCoreSource.includes('restoreEntrypoint: "lifeline restore"'),
    'Expected startup core to keep restore entrypoint as lifeline restore.',
  );
}

async function verifySeamInstallDisableStatusAndDryRun() {
  await ensureBuiltCli();

  const tempDir = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), 'lifeline-wave2-startup-')),
  );
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  try {
    const startupContractModule = await import(
      new URL('../dist/core/startup-contract.js', import.meta.url)
    );
    const {
      planStartupAction,
      createStartupMutationRequest,
      setStartupIntent,
      getStartupStatus,
    } = startupContractModule;

    const statePath = path.join(tempDir, '.lifeline', 'startup.json');
    const fakeBackendState = {
      installed: false,
      installRequests: [],
      uninstallRequests: [],
    };

    const fakeBackend = {
      id: 'deterministic-fake-backend',
      capabilities: ['inspect', 'install', 'uninstall'],
      inspect: async () => ({
        supported: true,
        status: fakeBackendState.installed ? 'installed' : 'not-installed',
        mechanism: 'deterministic-fake-backend',
        detail: fakeBackendState.installed
          ? 'Fake backend reports startup registration installed.'
          : 'Fake backend reports startup registration not installed.',
      }),
      install: async (request) => {
        fakeBackendState.installRequests.push(request);
        if (request.dryRun) {
          return {
            status: 'not-installed',
            detail: 'Dry-run: fake backend would install startup registration.',
          };
        }

        fakeBackendState.installed = true;
        return {
          status: 'installed',
          detail: 'Fake backend installed startup registration.',
        };
      },
      uninstall: async (request) => {
        fakeBackendState.uninstallRequests.push(request);
        if (request.dryRun) {
          return {
            status: fakeBackendState.installed ? 'installed' : 'not-installed',
            detail: 'Dry-run: fake backend would remove startup registration.',
          };
        }

        fakeBackendState.installed = false;
        return {
          status: 'not-installed',
          detail: 'Fake backend removed startup registration.',
        };
      },
    };

    const dryRunEnablePlan = await planStartupAction('enable', fakeBackend);
    assert(dryRunEnablePlan.backendStatus === 'not-installed', 'Expected enable dry-run plan to stay not-installed.');
    assert(
      fakeBackendState.installRequests.length === 1 && fakeBackendState.installRequests[0].dryRun === true,
      'Expected enable plan to call backend install through dry-run seam request.',
    );
    await access(statePath).then(
      () => {
        throw new Error('Dry-run planning must not create .lifeline/startup.json.');
      },
      () => undefined,
    );

    const enableResult = await fakeBackend.install(createStartupMutationRequest());
    await setStartupIntent('enabled', enableResult.status);
    const statusAfterEnable = await getStartupStatus(fakeBackend);
    assert(statusAfterEnable.enabled === true, 'Expected startup status to report enabled after install mutation.');
    assert(
      statusAfterEnable.detail.includes('installed'),
      `Expected enabled startup status detail to include installed signal, got: ${statusAfterEnable.detail}`,
    );

    const dryRunDisablePlan = await planStartupAction('disable', fakeBackend);
    assert(
      dryRunDisablePlan.backendStatus === 'installed',
      `Expected disable dry-run plan to reflect installed backend state, got ${dryRunDisablePlan.backendStatus}.`,
    );
    assert(
      fakeBackendState.uninstallRequests.length === 1 && fakeBackendState.uninstallRequests[0].dryRun === true,
      'Expected disable plan to call backend uninstall through dry-run seam request.',
    );

    const disableResult = await fakeBackend.uninstall(createStartupMutationRequest());
    await setStartupIntent('disabled', disableResult.status);
    const statusAfterDisable = await getStartupStatus(fakeBackend);
    assert(statusAfterDisable.enabled === false, 'Expected startup status to report disabled after uninstall mutation.');
    assert(
      statusAfterDisable.detail.includes('not installed'),
      `Expected disabled startup status detail to include not-installed signal, got: ${statusAfterDisable.detail}`,
    );
  } finally {
    process.chdir(previousCwd);
  }
}

async function verifyUnsupportedBackendPath() {
  await ensureBuiltCli();
  const startupBackendModule = await import(new URL('../dist/core/startup-backend.js', import.meta.url));
  const { resolveStartupBackend } = startupBackendModule;
  const backend = resolveStartupBackend({ platform: 'linux' });
  const inspection = await backend.inspect();
  const installResult = await backend.install({
    scope: 'machine-local',
    restoreEntrypoint: 'lifeline restore',
    dryRun: false,
  });

  assert(inspection.supported === false, 'Expected linux unsupported backend path to report supported=false.');
  assert(inspection.mechanism === 'contract-only', `Expected contract-only mechanism, got ${inspection.mechanism}.`);
  assert(
    inspection.detail.includes('No startup installer backend is available on linux yet.'),
    `Expected unsupported inspection detail to be explicit, got: ${inspection.detail}`,
  );
  assert(
    installResult.detail.includes('Intent can still be recorded'),
    `Expected unsupported install path to explain contract-only state persistence, got: ${installResult.detail}`,
  );
}

async function main() {
  await verifyRestoreEntrypointWiring();
  await verifyContractSurfaceWiring();
  await verifySeamInstallDisableStatusAndDryRun();
  await verifyUnsupportedBackendPath();
  console.log('Wave 2 startup deterministic verification passed.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Wave 2 startup deterministic verification failed: ${message}`);
  process.exitCode = 1;
});
