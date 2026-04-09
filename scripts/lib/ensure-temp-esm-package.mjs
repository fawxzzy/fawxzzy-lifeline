import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const TEMP_ESM_PACKAGE_JSON = `${JSON.stringify({ type: "module" }, null, 2)}\n`;

export async function ensureTempEsmPackage(rootDir) {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    TEMP_ESM_PACKAGE_JSON,
    "utf8",
  );
}
