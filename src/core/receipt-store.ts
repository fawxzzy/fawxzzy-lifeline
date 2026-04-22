import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type FailureCategory =
  | "config_error"
  | "environment_error"
  | "runtime_error";

export interface OperatorFailureSurface {
  category: FailureCategory;
  first_remediation_step: string;
}

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

export function normalizeReceiptPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function normalizeCapturedText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function formatOperatorFailureSurface(
  surface: OperatorFailureSurface,
  message?: string,
): string {
  const lines = [
    `Failure category: ${surface.category}`,
    `First remediation step: ${surface.first_remediation_step}`,
  ];

  if (message) {
    lines.push(`Details: ${message}`);
  }

  return lines.join("\n");
}

export async function writeJsonFile(
  filePath: string,
  payload: unknown,
): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, `${stableJsonStringify(payload)}\n`, "utf8");
}
