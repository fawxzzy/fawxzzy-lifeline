import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export interface GovernedToolEntry {
  tool_id: string;
  extension_id: string | null;
  trust_class: string;
  release_eligible: boolean;
  max_automation_level: string;
  capability_profile: JsonRecord;
  approval: {
    required: boolean;
    approver_kind: string | null;
    required_status: string | null;
    granted_scope_required: boolean;
  };
  invocation: {
    action_operation: string | null;
    execution_mode: string | null;
  };
}

export interface GovernedExtensionEntry {
  extension_id: string;
  trust_class: string;
  release_eligible: boolean;
}

export interface GovernedRegistryBundle {
  rootPath: string;
  registryDigest: string;
  tools: Map<string, GovernedToolEntry>;
  extensions: Map<string, GovernedExtensionEntry>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function stableCanonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableCanonicalStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableCanonicalStringify(entry)}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableCanonicalStringify(value), "utf8").digest("hex")}`;
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonObject(absolutePath: string): Promise<JsonRecord> {
  const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object at ${absolutePath}.`);
  }
  return parsed;
}

function normalizeToolEntry(value: unknown): GovernedToolEntry | undefined {
  if (!isRecord(value)) return undefined;

  const toolId = asString(value.tool_id);
  const trustClass = asString(value.trust_class);
  const capabilityProfile = value.capability_profile;
  const approval = value.approval;
  const invocation = value.invocation;
  if (
    !toolId ||
    !trustClass ||
    !isRecord(capabilityProfile) ||
    !isRecord(approval) ||
    !isRecord(invocation)
  ) {
    return undefined;
  }

  const normalized: GovernedToolEntry = {
    tool_id: toolId,
    extension_id:
      value.extension_id === null ? null : (asString(value.extension_id) ?? null),
    trust_class: trustClass,
    release_eligible: value.release_eligible === true,
    max_automation_level: asString(value.max_automation_level) ?? "observe",
    capability_profile: capabilityProfile,
    approval: {
      required: approval.required === true,
      approver_kind:
        approval.approver_kind === null
          ? null
          : (asString(approval.approver_kind) ?? null),
      required_status:
        approval.required_status === null
          ? null
          : (asString(approval.required_status) ?? null),
      granted_scope_required: approval.granted_scope_required === true,
    },
    invocation: {
      action_operation:
        invocation.action_operation === null
          ? null
          : (asString(invocation.action_operation) ?? null),
      execution_mode:
        invocation.execution_mode === null
          ? null
          : (asString(invocation.execution_mode) ?? null),
    },
  };
  if (normalized.invocation.execution_mode === "workspace_file_apply") {
    const filesystemScopes = normalized.capability_profile
      .filesystem_scopes as JsonRecord | undefined;
    const processPermissions = normalized.capability_profile
      .process_execution_permissions as JsonRecord | undefined;
    const packagePermissions = normalized.capability_profile
      .package_manager_permissions as JsonRecord | undefined;
    if (normalized.invocation.action_operation !== "scoped_write") {
      throw new Error(
        `workspace_file_apply tool '${normalized.tool_id}' must use invocation.action_operation 'scoped_write'.`,
      );
    }
    if (normalized.max_automation_level !== "approved_action") {
      throw new Error(
        `workspace_file_apply tool '${normalized.tool_id}' must cap at approved_action.`,
      );
    }
    if (
      !normalized.approval.required ||
      !normalized.approval.granted_scope_required
    ) {
      throw new Error(
        `workspace_file_apply tool '${normalized.tool_id}' must require approval with granted_scope.`,
      );
    }
    if (
      !filesystemScopes ||
      !Array.isArray(filesystemScopes.write) ||
      !Array.isArray(filesystemScopes.create) ||
      !filesystemScopes.write.includes("runtime/atlas/session-workspaces/**") ||
      !filesystemScopes.create.includes("runtime/atlas/session-workspaces/**")
    ) {
      throw new Error(
        `workspace_file_apply tool '${normalized.tool_id}' must scope writes and creates to runtime/atlas/session-workspaces/**.`,
      );
    }
    if (
      processPermissions?.allow_spawn === true ||
      processPermissions?.allow_shell === true ||
      processPermissions?.allow_python === true
    ) {
      throw new Error(
        `workspace_file_apply tool '${normalized.tool_id}' may not allow process execution.`,
      );
    }
    if (
      packagePermissions?.allow_install === true ||
      packagePermissions?.allow_update === true
    ) {
      throw new Error(
        `workspace_file_apply tool '${normalized.tool_id}' may not allow package mutation.`,
      );
    }
  }
  return normalized;
}

function normalizeExtensionEntry(
  value: unknown,
): GovernedExtensionEntry | undefined {
  if (!isRecord(value)) return undefined;

  const extensionId = asString(value.extension_id);
  const trustClass = asString(value.trust_class);
  if (!extensionId || !trustClass) {
    return undefined;
  }

  return {
    extension_id: extensionId,
    trust_class: trustClass,
    release_eligible: value.release_eligible === true,
  };
}

async function findAtlasRoot(startPath: string): Promise<string | null> {
  const atlasRootOverride = asString(process.env.ATLAS_ROOT);
  if (
    atlasRootOverride &&
    (await fileExists(path.join(path.resolve(atlasRootOverride), "stack.yaml")))
  ) {
    return path.resolve(atlasRootOverride);
  }

  let current = path.resolve(startPath);
  while (true) {
    if (await fileExists(path.join(current, "stack.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function loadGovernedRegistry(
  startPath: string,
): Promise<GovernedRegistryBundle> {
  const atlasRoot = await findAtlasRoot(startPath);
  if (!atlasRoot) {
    throw new Error("Could not locate ATLAS stack root for governed tool registry validation.");
  }

  const toolRegistryPath = path.join(
    atlasRoot,
    "docs",
    "registry",
    "ATLAS-TOOL-REGISTRY.json",
  );
  const extensionRegistryPath = path.join(
    atlasRoot,
    "docs",
    "registry",
    "ATLAS-EXTENSION-REGISTRY.json",
  );
  if (
    !(await fileExists(toolRegistryPath)) ||
    !(await fileExists(extensionRegistryPath))
  ) {
    throw new Error("ATLAS governed tool or extension registry is missing at the stack root.");
  }

  const toolRegistry = await readJsonObject(toolRegistryPath);
  const extensionRegistry = await readJsonObject(extensionRegistryPath);
  const rawToolEntries = Array.isArray(toolRegistry.entries)
    ? toolRegistry.entries
        .filter((entry): entry is JsonRecord => isRecord(entry))
        .sort((left, right) =>
          (asString(left.tool_id) ?? "").localeCompare(asString(right.tool_id) ?? ""),
        )
    : [];
  const rawExtensionEntries = Array.isArray(extensionRegistry.entries)
    ? extensionRegistry.entries
        .filter((entry): entry is JsonRecord => isRecord(entry))
        .sort((left, right) =>
          (asString(left.extension_id) ?? "").localeCompare(
            asString(right.extension_id) ?? "",
          ),
        )
    : [];
  const toolEntries = Array.isArray(toolRegistry.entries)
    ? toolRegistry.entries
        .map((entry) => normalizeToolEntry(entry))
        .filter((entry): entry is GovernedToolEntry => Boolean(entry))
    : [];
  const extensionEntries = Array.isArray(extensionRegistry.entries)
    ? extensionRegistry.entries
        .map((entry) => normalizeExtensionEntry(entry))
        .filter((entry): entry is GovernedExtensionEntry => Boolean(entry))
    : [];

  const normalizedToolRegistry = {
    schema_version: asString(toolRegistry.schema_version) ?? "atlas.tool.registry.v1",
    kind: asString(toolRegistry.kind) ?? "atlas-tool-registry",
    entries: rawToolEntries,
  };
  const normalizedExtensionRegistry = {
    schema_version:
      asString(extensionRegistry.schema_version) ?? "atlas.extension.registry.v1",
    kind: asString(extensionRegistry.kind) ?? "atlas-extension-registry",
    entries: rawExtensionEntries,
  };

  return {
    rootPath: atlasRoot,
    registryDigest: digestJson({
      tool_registry: normalizedToolRegistry,
      extension_registry: normalizedExtensionRegistry,
    }),
    tools: new Map(toolEntries.map((entry) => [entry.tool_id, entry])),
    extensions: new Map(extensionEntries.map((entry) => [entry.extension_id, entry])),
  };
}
