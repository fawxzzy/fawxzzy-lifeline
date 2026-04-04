import { resolveStartupBackend } from '../dist/core/startup-backend.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyUnsupportedSelection(platform) {
  const backend = resolveStartupBackend(platform);
  const inspection = await backend.inspect();

  assert(backend.id === 'unsupported', `Expected unsupported backend id for ${platform}, got ${backend.id}.`);
  assert(inspection.supported === false, `Expected unsupported backend for ${platform} to be unsupported.`);
  assert(inspection.status === 'unsupported', `Expected unsupported status for ${platform}, got ${inspection.status}.`);
  assert(
    inspection.detail.includes(platform),
    `Expected inspection detail to reference ${platform}, got: ${inspection.detail}`,
  );
}

async function main() {
  await verifyUnsupportedSelection('win32');
  await verifyUnsupportedSelection('linux');
  await verifyUnsupportedSelection('darwin');
  console.log('Deterministic startup backend selection verification passed.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Deterministic startup backend selection verification failed: ${message}`);
  process.exitCode = 1;
});
