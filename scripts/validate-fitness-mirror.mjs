import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { validateFitnessMirrorManifestFile } from '../dist/contracts/fitness-mirror.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mirrorDisplayPath = 'examples/fitness-app.lifeline.yml';
const mirrorPath = resolve(scriptDir, '..', mirrorDisplayPath);
const issues = await validateFitnessMirrorManifestFile(mirrorPath);

if (issues.length > 0) {
  console.error(`Fitness mirror validation failed for ${mirrorDisplayPath}:`);
  for (const issue of issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(`Fitness mirror validation passed for ${mirrorDisplayPath}.`);
