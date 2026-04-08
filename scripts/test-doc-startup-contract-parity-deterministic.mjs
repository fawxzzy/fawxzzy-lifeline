import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseStringLiteralUnion(source, typeName) {
  const match = source.match(new RegExp(`type ${typeName} = ([^;]+);`));
  assert(match, `Could not find ${typeName} union in startup contract source.`);
  const values = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  assert(values.length > 0, `${typeName} union appears empty.`);
  return values;
}

function parseDefaultStartupRegistryBlock(source) {
  const registryBlockMatch = source.match(
    /DEFAULT_STARTUP_BACKEND_REGISTRY:[\s\S]*?byPlatform:\s*{([\s\S]*?)}\s*,\s*};/,
  );
  assert(
    registryBlockMatch,
    'Could not parse DEFAULT_STARTUP_BACKEND_REGISTRY.byPlatform from startup backend source.',
  );
  return registryBlockMatch[1];
}

function parseDefaultStartupRegistryPlatforms(source) {
  const registryBlock = parseDefaultStartupRegistryBlock(source);
  const platforms = [...registryBlock.matchAll(/^\s*([a-z0-9_-]+)\s*:/gm)].map(
    (entry) => entry[1],
  );
  assert(platforms.length > 0, 'Startup backend registry platform list appears empty.');
  return platforms;
}

function parseDefaultStartupRegistryEntries(source) {
  const registryBlock = parseDefaultStartupRegistryBlock(source);
  const entries = [
    ...registryBlock.matchAll(
      /^\s*([a-z0-9_-]+)\s*:\s*\(\)\s*=>\s*([A-Za-z0-9_]+)\(\),?/gm,
    ),
  ].map((entry) => ({
    platform: entry[1],
    factoryName: entry[2],
  }));
  assert(entries.length > 0, 'Startup backend registry entries appear empty.');
  return entries;
}

function parseStartupBackendImports(source) {
  const imports = [
    ...source.matchAll(
      /import \{\s*(create[A-Za-z0-9_]+)\s*\} from "\.\/startup-backends\/([^"]+)\.js";/g,
    ),
  ].map((entry) => ({
    factoryName: entry[1],
    sourceFile: entry[2],
  }));
  assert(imports.length > 0, 'Startup backend source appears to have no startup-backends imports.');
  return imports;
}

function parseBackendId(source, sourceFile) {
  const idReferenceMatch = source.match(/id:\s*([A-Z0-9_]+),/);
  assert(idReferenceMatch, `Could not find backend id reference in ${sourceFile}.`);

  const backendIdConst = idReferenceMatch[1];
  const backendIdMatch = source.match(new RegExp(`const ${backendIdConst} = "([^"]+)";`));
  assert(backendIdMatch, `Could not resolve backend id constant ${backendIdConst} in ${sourceFile}.`);
  return backendIdMatch[1];
}

function formatQuotedList(values) {
  const quotedValues = values.map((value) => `\`${value}\``);
  if (quotedValues.length === 1) {
    return quotedValues[0];
  }
  if (quotedValues.length === 2) {
    return `${quotedValues[0]} and ${quotedValues[1]}`;
  }
  return `${quotedValues.slice(0, -1).join(', ')}, and ${quotedValues.at(-1)}`;
}

async function main() {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const startupBackendsDir = path.join(repoRoot, 'src/core/startup-backends');
  const [
    startupSource,
    startupBackendSource,
    startupDocs,
    architectureDocs,
    readme,
    startupBackendsDirEntries,
  ] = await Promise.all([
    readFile(path.join(repoRoot, 'src/core/startup-contract.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'src/core/startup-backend.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'docs/startup-contract.md'), 'utf8'),
    readFile(path.join(repoRoot, 'docs/architecture.md'), 'utf8'),
    readFile(path.join(repoRoot, 'README.md'), 'utf8'),
    readdir(startupBackendsDir),
  ]);

  const startupBackendImports = parseStartupBackendImports(startupBackendSource);
  const startupRegistryEntries = parseDefaultStartupRegistryEntries(startupBackendSource);
  const startupBackendTsFiles = startupBackendsDirEntries
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => entry.replace(/\.ts$/, ''));

  assert(
    startupBackendImports.length === startupBackendTsFiles.length,
    `Startup backend import/file count mismatch: startup-backend.ts imports ${startupBackendImports.length} backend modules, but src/core/startup-backends has ${startupBackendTsFiles.length} TypeScript backend files.`,
  );

  for (const backendImport of startupBackendImports) {
    assert(
      startupBackendTsFiles.includes(backendImport.sourceFile),
      `startup-backend.ts imports startup backend "${backendImport.sourceFile}" that does not exist in src/core/startup-backends/*.ts.`,
    );
  }

  const importSourceByFactoryName = new Map(
    startupBackendImports.map((backendImport) => [backendImport.factoryName, backendImport.sourceFile]),
  );
  const backendIdByPlatform = new Map();

  for (const registryEntry of startupRegistryEntries) {
    const sourceFile = importSourceByFactoryName.get(registryEntry.factoryName);
    assert(
      sourceFile,
      `Startup backend registry entry "${registryEntry.platform}" references unknown factory ${registryEntry.factoryName}.`,
    );
    const backendSource = await readFile(
      path.join(startupBackendsDir, `${sourceFile}.ts`),
      'utf8',
    );
    backendIdByPlatform.set(
      registryEntry.platform,
      parseBackendId(backendSource, `src/core/startup-backends/${sourceFile}.ts`),
    );
  }

  const actions = ['status', 'enable', 'disable'];
  const scope = 'machine-local';
  const restoreEntrypoint = 'lifeline restore';
  const backendStatus = 'not-installed';
  const startupIntents = parseStringLiteralUnion(startupSource, 'StartupIntent');
  const registryPlatforms = parseDefaultStartupRegistryPlatforms(startupBackendSource);
  const exactPlatformSetSentence =
    `Shipped startup backend platform set is exactly ${formatQuotedList(registryPlatforms)}.`;

  for (const platform of registryPlatforms) {
    assert(
      startupDocs.includes(`\`${platform}\``),
      `docs/startup-contract.md must list startup backend registry platform \`${platform}\`.`,
    );
    assert(
      readme.includes(`\`${platform}\``),
      `README.md must list startup backend registry platform \`${platform}\`.`,
    );
    assert(
      architectureDocs.includes(`\`${platform}\``),
      `docs/architecture.md must list startup backend registry platform \`${platform}\`.`,
    );
  }

  assert(
    readme.includes(exactPlatformSetSentence),
    'README.md must include the exact shipped startup backend platform set sentence derived from src/core/startup-backend.ts.',
  );
  assert(
    startupDocs.includes(exactPlatformSetSentence),
    'docs/startup-contract.md must include the exact shipped startup backend platform set sentence derived from src/core/startup-backend.ts.',
  );

  for (const registryEntry of startupRegistryEntries) {
    const backendId = backendIdByPlatform.get(registryEntry.platform);
    assert(backendId, `Could not resolve backend id for registry platform ${registryEntry.platform}.`);
    assert(
      readme.includes(`- \`${registryEntry.platform}\` -> \`${backendId}\``),
      `README.md must document exact startup backend mapping \`${registryEntry.platform}\` -> \`${backendId}\`.`,
    );
    assert(
      startupDocs.includes(`- \`${registryEntry.platform}\` → \`${backendId}\``),
      `docs/startup-contract.md must document exact startup backend mapping \`${registryEntry.platform}\` → \`${backendId}\`.`,
    );
  }

  for (const action of actions) {
    assert(
      startupDocs.includes(`lifeline startup ${action}`),
      `docs/startup-contract.md is missing startup action ${action} from CLI contract.`,
    );
    assert(
      readme.includes(`pnpm lifeline startup ${action}`),
      `README.md is missing startup action ${action} from CLI contract.`,
    );
  }

  assert(
    startupDocs.includes('enable [--dry-run]') && startupDocs.includes('disable [--dry-run]'),
    'docs/startup-contract.md must document --dry-run support for enable/disable.',
  );
  assert(
    readme.includes('startup enable --dry-run') && readme.includes('startup disable --dry-run'),
    'README.md must document --dry-run support for startup enable/disable.',
  );

  for (const surface of [startupSource, startupDocs, architectureDocs, readme]) {
    assert(
      surface.includes(scope),
      `Startup contract parity drift: missing scope value \`${scope}\` in one startup contract surface.`,
    );
    assert(
      surface.includes(restoreEntrypoint),
      `Startup contract parity drift: missing restore entrypoint \`${restoreEntrypoint}\` in one startup contract surface.`,
    );
  }

  assert(
    startupSource.includes(`backendStatus: "${backendStatus}"`) ||
      startupSource.includes(`backendStatus': '${backendStatus}'`),
    `startup-contract.ts is expected to persist backendStatus \`${backendStatus}\`.`,
  );
  assert(
    startupDocs.includes(`\`${backendStatus}\``),
    `docs/startup-contract.md must mention backend readiness marker \`${backendStatus}\`.`,
  );

  const persistedFields = [
    'version',
    'scope',
    'restoreEntrypoint',
    'intent',
    'backendStatus',
    'updatedAt',
  ];

  for (const field of persistedFields) {
    assert(
      startupDocs.includes(`\`${field}\``),
      `docs/startup-contract.md missing persisted startup metadata field \`${field}\`.`,
    );
  }

  for (const intent of startupIntents) {
    assert(
      startupDocs.includes(`\`${intent}\``) || startupDocs.includes(intent),
      `docs/startup-contract.md must document startup intent value \`${intent}\`.`,
    );
  }

  assert(
    readme.includes('mechanism (`contract-only`)') || readme.includes('mechanism (\\`contract-only\\`)'),
    'README.md must document startup status mechanism contract value contract-only.',
  );

  assert(
    startupDocs.includes('contract-only') &&
      architectureDocs.includes('contract-only') &&
      readme.includes('contract-only'),
    'Startup docs, architecture docs, and README must all explain contract-only startup behavior.',
  );
  assert(
    readme.includes(
      'Any non-registered platform still resolves through the explicit `unsupported` `contract-only` fallback backend.',
    ),
    'README.md must explicitly document unsupported fallback for non-registered platforms.',
  );
  assert(
    startupDocs.includes(
      'Any non-registered platform resolves to the explicit `unsupported` contract-only fallback backend.',
    ),
    'docs/startup-contract.md must explicitly document unsupported fallback for non-registered platforms.',
  );

  assert(
    startupDocs.includes('win32') && readme.includes('win32'),
    'Startup docs and README must both document current Windows (win32) backend status.',
  );

  assert(
    startupDocs.includes('without writing state') && readme.includes('without mutating'),
    'Startup docs and README must both explain dry-run as non-mutating behavior.',
  );

  console.log('Doc/code startup contract parity deterministic verification passed.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Doc/code startup parity deterministic verification failed: ${message}`);
  process.exitCode = 1;
});
