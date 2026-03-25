import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type AppArchetype,
  type AppManifest,
  validateOptionalAppManifestDefaults,
} from "../contracts/app-manifest.js";
import { ManifestLoadError, ValidationError } from "./errors.js";
import { parseSimpleYaml } from "./load-manifest.js";

export const SUPPORTED_PLAYBOOK_SCHEMA_VERSION = 1;
export const CANONICAL_PLAYBOOK_EXPORT_FAMILY = "lifeline-archetypes";
export const LEGACY_PLAYBOOK_EXPORT_FAMILY = "lifeline";
const ACCEPTED_PLAYBOOK_EXPORT_FAMILIES = new Set([
  CANONICAL_PLAYBOOK_EXPORT_FAMILY,
  LEGACY_PLAYBOOK_EXPORT_FAMILY,
]);

export type PlaybookArchetypeDefaults = Partial<
  Pick<
    AppManifest,
    | "installCommand"
    | "buildCommand"
    | "startCommand"
    | "port"
    | "healthcheckPath"
    | "env"
    | "deploy"
  >
>;

export interface PlaybookExports {
  playbookPath: string;
  exportPath: string;
  schemaVersion: number;
  exportFamily: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSchemaVersion(
  parsedSchema: Record<string, unknown>,
  schemaVersionPath: string,
): number {
  const schemaVersionRaw = parsedSchema.schemaVersion ?? parsedSchema.version;
  if (schemaVersionRaw === undefined) {
    throw new ValidationError(
      `Playbook schema version file is invalid: ${schemaVersionPath}. Expected {"schemaVersion": <number|string>, "exportFamily": "lifeline-archetypes"} (or compatibility value "lifeline", or legacy {"version": <number>}).`,
    );
  }

  const normalizedVersion =
    typeof schemaVersionRaw === "string"
      ? Number.parseInt(schemaVersionRaw, 10)
      : schemaVersionRaw;

  if (
    typeof normalizedVersion !== "number" ||
    !Number.isInteger(normalizedVersion) ||
    Number.isNaN(normalizedVersion)
  ) {
    throw new ValidationError(
      `Playbook schema version file is invalid: ${schemaVersionPath}. schemaVersion/version must be an integer number or numeric string.`,
    );
  }

  return normalizedVersion;
}

function parseExportFamily(
  parsedSchema: Record<string, unknown>,
  schemaVersionPath: string,
): string {
  const exportFamilyRaw = parsedSchema.exportFamily;
  if (exportFamilyRaw === undefined) {
    return CANONICAL_PLAYBOOK_EXPORT_FAMILY;
  }

  if (
    typeof exportFamilyRaw !== "string" ||
    exportFamilyRaw.trim().length === 0
  ) {
    throw new ValidationError(
      `Playbook schema version file is invalid: ${schemaVersionPath}. exportFamily must be a non-empty string when present.`,
    );
  }

  if (!ACCEPTED_PLAYBOOK_EXPORT_FAMILIES.has(exportFamilyRaw)) {
    throw new ValidationError(
      `Unsupported Playbook export family ${exportFamilyRaw} at ${schemaVersionPath}. Expected one of: ${CANONICAL_PLAYBOOK_EXPORT_FAMILY}, ${LEGACY_PLAYBOOK_EXPORT_FAMILY}.`,
    );
  }

  return CANONICAL_PLAYBOOK_EXPORT_FAMILY;
}

async function readYamlFile(filePath: string): Promise<unknown> {
  let raw: string;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown read error";
    throw new ManifestLoadError(
      `Could not read Playbook export at ${filePath}: ${message}`,
    );
  }

  try {
    return parseSimpleYaml(raw);
  } catch (error) {
    if (error instanceof ManifestLoadError) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new ManifestLoadError(
      `Could not parse Playbook export YAML at ${filePath}: ${message}`,
    );
  }
}

export async function resolvePlaybookPath(
  explicitPath?: string,
): Promise<string | undefined> {
  const configuredPath = explicitPath ?? process.env.LIFELINE_PLAYBOOK_PATH;
  return configuredPath ? path.resolve(configuredPath) : undefined;
}

export async function loadPlaybookExports(
  playbookPathInput: string,
): Promise<PlaybookExports> {
  const playbookPath = path.resolve(playbookPathInput);
  const exportPath = path.join(playbookPath, "exports", "lifeline");

  try {
    await access(exportPath);
  } catch {
    throw new ValidationError(
      `Playbook export directory does not exist: ${exportPath}. Expected <playbook-path>/exports/lifeline/.`,
    );
  }

  const schemaVersionPath = path.join(exportPath, "schema-version.json");
  let rawSchema: string;
  try {
    rawSchema = await readFile(schemaVersionPath, "utf8");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown read error";
    throw new ManifestLoadError(
      `Could not read Playbook schema version file at ${schemaVersionPath}: ${message}`,
    );
  }

  let parsedSchema: unknown;
  try {
    parsedSchema = JSON.parse(rawSchema);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new ManifestLoadError(
      `Could not parse Playbook schema version file at ${schemaVersionPath}: ${message}`,
    );
  }

  if (!isRecord(parsedSchema)) {
    throw new ValidationError(
      `Playbook schema version file is invalid: ${schemaVersionPath}. Expected a JSON object.`,
    );
  }

  const schemaVersion = parseSchemaVersion(parsedSchema, schemaVersionPath);
  if (schemaVersion !== SUPPORTED_PLAYBOOK_SCHEMA_VERSION) {
    throw new ValidationError(
      `Unsupported Playbook schema version ${schemaVersion} at ${schemaVersionPath}. Supported version: ${SUPPORTED_PLAYBOOK_SCHEMA_VERSION}.`,
    );
  }

  const exportFamily = parseExportFamily(parsedSchema, schemaVersionPath);

  return {
    playbookPath,
    exportPath,
    schemaVersion,
    exportFamily,
  };
}

export async function loadPlaybookArchetypeDefaults(
  playbookPathInput: string,
  archetype: AppArchetype,
): Promise<PlaybookArchetypeDefaults> {
  const exports = await loadPlaybookExports(playbookPathInput);
  const archetypePath = path.join(
    exports.exportPath,
    "archetypes",
    `${archetype}.yml`,
  );

  try {
    await access(archetypePath);
  } catch {
    throw new ValidationError(
      `Playbook archetype export is missing for ${archetype}: ${archetypePath}.`,
    );
  }

  const parsed = await readYamlFile(archetypePath);
  if (!isRecord(parsed)) {
    throw new ValidationError(
      `Playbook archetype export ${archetypePath} must be a YAML object.`,
    );
  }

  const validation = validateOptionalAppManifestDefaults(parsed);
  if (validation.issues.length > 0) {
    const issueLines = validation.issues
      .map(
        (issue: { path: string; message: string }) =>
          `- ${issue.path}: ${issue.message}`,
      )
      .join("\n");
    throw new ValidationError(
      `Playbook export shape is invalid: ${archetypePath}\n${issueLines}`,
    );
  }

  const defaults = parsed as PlaybookArchetypeDefaults;

  return {
    ...(defaults.installCommand
      ? { installCommand: defaults.installCommand }
      : {}),
    ...(defaults.buildCommand ? { buildCommand: defaults.buildCommand } : {}),
    ...(defaults.startCommand ? { startCommand: defaults.startCommand } : {}),
    ...(defaults.port !== undefined ? { port: defaults.port } : {}),
    ...(defaults.healthcheckPath
      ? { healthcheckPath: defaults.healthcheckPath }
      : {}),
    ...(defaults.env ? { env: defaults.env } : {}),
    ...(defaults.deploy ? { deploy: defaults.deploy } : {}),
  };
}
