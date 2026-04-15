import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = stableJsonValue(
          (value as Record<string, unknown>)[key],
        );
        return accumulator;
      }, {});
  }

  return value;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value), null, 2);
}

export async function writeJsonFile(
  filePath: string,
  payload: unknown,
): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, `${stableJsonStringify(payload)}\n`, "utf8");
}
