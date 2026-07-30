import { createHash } from "node:crypto";

import { stableJsonStringify } from "./receipt-store.js";
import {
  SUPABASE_EXECUTION_PROFILE_CONTRACT,
  SUPABASE_EXECUTOR_IDENTITY,
  getCanonicalSupabaseExecutionProfile,
  validateSupabaseExecutionProfile,
} from "./supabase-execution-profile.js";

const isNativeProxy = (
  process as unknown as {
    getBuiltinModule(name: "node:util"): {
      types: { isProxy(value: unknown): boolean };
    };
  }
).getBuiltinModule("node:util").types.isProxy;

export const SUPABASE_BUNDLE_EXECUTOR_CONTRACT =
  "atlas.supabase.bundle-executor.offline-plan.v1";
export const SUPABASE_BUNDLE_BLOCKED_RECEIPT_CONTRACT =
  "atlas.supabase.bundle-executor.blocked-receipt.v1";

const EXECUTOR_IMPLEMENTATION_STATE =
  "OFFLINE_BUNDLE_EXECUTOR_SOURCE_IMPLEMENTED_LIVE_ADAPTER_UNINSTALLED";

const PLATFORM_BUNDLE = {
  artifacts: [
    {
      byte_identical: true,
      bytes: 16_387,
      ordinal: 1,
      promoted_path:
        "bootstrap/artifacts/executable-sql/00000000000001_mazer_schema.sql",
      promoted_sha256:
        "fbea0ff8306f0a0f2f577fa0c259649329a183644673ab1a3bc282e081755313",
      source_path:
        "bootstrap/artifacts/inert-sql/00000000000001_mazer_schema_inert.sql",
      source_sha256:
        "fbea0ff8306f0a0f2f577fa0c259649329a183644673ab1a3bc282e081755313",
    },
    {
      byte_identical: true,
      bytes: 148_809,
      ordinal: 2,
      promoted_path:
        "bootstrap/artifacts/executable-sql/00000000000002_fitness_schema.sql",
      promoted_sha256:
        "5fe4ef8fbd9a1e873cd0f8f385b4128d3450c01f6a4d0e6eaae1c6943a1c4c9b",
      source_path:
        "bootstrap/artifacts/inert-sql/00000000000002_fitness_schema_inert.sql",
      source_sha256:
        "5fe4ef8fbd9a1e873cd0f8f385b4128d3450c01f6a4d0e6eaae1c6943a1c4c9b",
    },
    {
      byte_identical: true,
      bytes: 20_670,
      ordinal: 3,
      promoted_path:
        "bootstrap/artifacts/executable-sql/00000000000003_discordos_schema.sql",
      promoted_sha256:
        "5b2783d8f6a78a2a9898c94559b31c168dcb1b5deebc1546365c1c8f09ade79f",
      source_path:
        "bootstrap/artifacts/inert-sql/00000000000003_discordos_schema_inert.sql",
      source_sha256:
        "5b2783d8f6a78a2a9898c94559b31c168dcb1b5deebc1546365c1c8f09ade79f",
    },
    {
      byte_identical: true,
      bytes: 2_507,
      ordinal: 4,
      promoted_path:
        "bootstrap/artifacts/executable-sql/00000000000004_platform_security_overlay.sql",
      promoted_sha256:
        "f3cf571b37a6aa756c72ec398fa0f24f26b3d93bff2a768a318ceb87aa9ece64",
      source_path:
        "bootstrap/artifacts/inert-sql/00000000000004_platform_security_overlay_inert.sql",
      source_sha256:
        "f3cf571b37a6aa756c72ec398fa0f24f26b3d93bff2a768a318ceb87aa9ece64",
    },
  ],
  contract_binding_set_sha256:
    "83ece73a522f1843616d781fdd99d595128c75a30d7267d1eab82cb0189da1b0",
  contract_bindings: [
    {
      bytes: 20_850,
      observed_sha256:
        "d217f31885f995e939d8e37c07ef5201bef43934227564a9083b662b2054c869",
      path: "contracts/v1/bootstrap/disposable-target-bootstrap-contract.json",
      role: "DISPOSABLE_TARGET_BOOTSTRAP",
      sha256:
        "d217f31885f995e939d8e37c07ef5201bef43934227564a9083b662b2054c869",
    },
    {
      bytes: 24_361,
      observed_sha256:
        "47db976f08e98e8d7821e1007e942355f912af86a3ef6c229b3b7772e91b6402",
      path: "contracts/v1/rehearsal/auth-app-data-rehearsal-contract.json",
      role: "AUTH_APP_DATA_REHEARSAL",
      sha256:
        "47db976f08e98e8d7821e1007e942355f912af86a3ef6c229b3b7772e91b6402",
    },
    {
      bytes: 31_498,
      observed_sha256:
        "6b49d8b06f80b7bd28f2ee446c73119e72ab78360e4346008b725cb561e67f97",
      path: "contracts/v1/rehearsal/storage-edge-realtime-execution-denominator-contract.json",
      role: "STORAGE_EDGE_REALTIME_EXECUTION_DENOMINATOR",
      sha256:
        "6b49d8b06f80b7bd28f2ee446c73119e72ab78360e4346008b725cb561e67f97",
    },
    {
      bytes: 11_060,
      observed_sha256:
        "a627535f8f48d0c14b81a6bb611bf4f36935af96a66beb1d6a23096df4c2fd10",
      path: "contracts/v1/recovery/independent-backup-contract.json",
      role: "INDEPENDENT_BACKUP",
      sha256:
        "a627535f8f48d0c14b81a6bb611bf4f36935af96a66beb1d6a23096df4c2fd10",
    },
    {
      bytes: 10_389,
      observed_sha256:
        "c309ab9e1c4c5313e4817f8b6eccaaeb186886141cb3d65da9b8a5dc4740856e",
      path: "contracts/v1/security/rls-grant-function-matrix.json",
      role: "RLS_GRANT_FUNCTION_MATRIX",
      sha256:
        "c309ab9e1c4c5313e4817f8b6eccaaeb186886141cb3d65da9b8a5dc4740856e",
    },
  ],
  executable_bundle_manifest_raw_sha256:
    "10b616019af3edad152f7a1cc922cbab20e5add81405f1f542053b54dacb2a54",
  executable_bundle_manifest_version: "1.0.0",
  expected_effects_and_rollback_bindings: [
    {
      bytes: 253_261,
      observed_sha256:
        "1d28080e416eb59f639c9db4514d9c9e4e978d8650c2137f0a170440eba25d85",
      path: "bootstrap/manifests/data-effects.v1.json",
      role: "EXPECTED_DATA_EFFECTS",
      sha256:
        "1d28080e416eb59f639c9db4514d9c9e4e978d8650c2137f0a170440eba25d85",
    },
    {
      bytes: 519_712,
      observed_sha256:
        "129ff967d9333c38c5356a1c5309361c368c6ee0552bfc9f2c84624defbc396c",
      path: "bootstrap/manifests/dispositions.v1.json",
      role: "STATEMENT_DISPOSITIONS",
      sha256:
        "129ff967d9333c38c5356a1c5309361c368c6ee0552bfc9f2c84624defbc396c",
    },
    {
      bytes: 377_924,
      observed_sha256:
        "1e26a2c50f5415ced0a5100556d85c5f0f66e12baede0b705771e570906d369e",
      path: "bootstrap/manifests/source-objects.v1.json",
      role: "EXPECTED_SOURCE_OBJECTS",
      sha256:
        "1e26a2c50f5415ced0a5100556d85c5f0f66e12baede0b705771e570906d369e",
    },
  ],
  expected_effects_and_rollback_set_sha256:
    "a152afa30437e5e163bb0cfbeab7168330830c696289225089f40c1ddd47a4a9",
  governance_manifest_sha256:
    "82e7ecad9a68addff14c43c3bc237c54af2dd5d48cda454c0e1c121a3e4536ec",
  migration_count: 122,
  migration_package_sha256:
    "b65d1c0b73607218cc37826d9bb77c25704ea18f957abba7b5667a79d0a2c8db",
  ordered_artifact_set_sha256:
    "899adf8cab5d5e7a7ece1806022aefccc562e0c21513cdb009310985b399ccfc",
  platform_main: "2a871f8a9a7f3c030d7dca259de9ca88d336ec04",
  platform_tree: "718b816d262f05486c6692c67629e57a4846469e",
  statement_denominator: {
    executable_statement_count: 721,
    held_statement_count: 532,
    source_statement_count: 1_253,
  },
  toolchain: [
    {
      bytes: 10_229,
      observed_sha256:
        "edb6ea206647e7649ff0ac1cf693ab409e9485ddd8c783ebbdd4ad575ffd128b",
      path: "scripts/generate-executable-bundle.mjs",
      role: "GENERATOR",
      sha256:
        "edb6ea206647e7649ff0ac1cf693ab409e9485ddd8c783ebbdd4ad575ffd128b",
    },
    {
      bytes: 4_327,
      observed_sha256:
        "6600b8a85d35529f73519247c00864a1d3281453a3eb64494ded5a216e0351a3",
      path: "scripts/verify-executable-bundle.mjs",
      role: "VERIFIER",
      sha256:
        "6600b8a85d35529f73519247c00864a1d3281453a3eb64494ded5a216e0351a3",
    },
  ],
  toolchain_set_sha256:
    "0400f7536a3238c08c0d7c1c577ec67b983eeaf63ec177a50ad6e6f2bb9f2659",
} as const;

const BLOCKERS = [
  {
    category: "AUTHORITY",
    code: "ACTION_TIME_AUTHORITY_MISSING",
    path: "request.action_time_gates.authority",
  },
  {
    category: "TRUST",
    code: "TRUST_ANCHORS_UNPROVISIONED",
    path: "request.action_time_gates.trust",
  },
  {
    category: "DATA_API",
    code: "SANITIZED_DATA_API_SCOPE_PROOF_MISSING",
    path: "request.action_time_gates.data_api",
  },
  {
    category: "CREDENTIAL",
    code: "CREDENTIAL_SCOPE_AND_TRANSPORT_PROOF_MISSING",
    path: "request.action_time_gates.credentials",
  },
  {
    category: "INVERSE",
    code: "INVERSE_CAPABILITY_PROOFS_MISSING",
    path: "request.action_time_gates.inverse",
  },
  {
    category: "APPLY",
    code: "APPLY_NOT_ADMITTED",
    path: "request.action_time_gates.apply",
  },
] as const;

const CANONICAL_REQUEST = {
  action_time_gates: {
    apply: {
      apply_admitted: false,
      state: "BLOCKED",
    },
    authority: {
      authority_event_id_present: false,
      consumption_receipt_present: false,
      state: "MISSING",
      trusted_action_time_present: false,
    },
    credentials: {
      database_scope_receipt_present: false,
      management_scope_receipt_present: false,
      selected_transport: "ACTION_TIME_REQUIRED",
      state: "UNAVAILABLE",
      values_present: false,
    },
    data_api: {
      fine_grained_permission: "data_api_config_read",
      oauth_scope: "rest:read",
      sanitized_config_digest_present: false,
      scope_proof_present: false,
      state: "UNAVAILABLE",
      write_scope_present: false,
    },
    inverse: {
      proven_count: 0,
      required_count: 7,
      state: "BLOCKED_UNPROVEN",
    },
    trust: {
      expected_count: 12,
      installed_count: 0,
      state: "UNPROVISIONED_BLOCKED",
    },
  },
  bundle: PLATFORM_BUNDLE,
  contract_version: SUPABASE_BUNDLE_EXECUTOR_CONTRACT,
  executor: {
    identity: SUPABASE_EXECUTOR_IDENTITY,
    implementation_state: EXECUTOR_IMPLEMENTATION_STATE,
    live_adapter_installed: false,
    provider_connectivity_included: false,
    sql_execution_authorized: false,
    version: "1.0.0",
  },
  lifecycle: {
    apply_admitted: false,
    execution: "EXECUTION_BLOCKED",
    source: "SOURCE_READY",
  },
  profile: {
    canonical_profile_sha256:
      "8f83651c8fd3ec90b90c8e7784be2ea083e8a64e780a52a5a17b9233d8993071",
    contract_version: SUPABASE_EXECUTION_PROFILE_CONTRACT,
    validation_failures: 0,
  },
  redaction: {
    aggregate_and_digest_only: true,
    credential_values_forbidden: true,
    key_material_forbidden: true,
    machine_paths_forbidden: true,
    project_refs_forbidden: true,
    raw_provider_responses_forbidden: true,
    sql_bytes_forbidden: true,
    unknown_provider_fields_forbidden: true,
  },
} as const;

const CANONICAL_REQUEST_JSON = stableJsonStringify(CANONICAL_REQUEST);

type JsonRecord = Record<string, unknown>;

export interface SupabaseBundleExecutionAdapter {
  invokeReadyPlan(plan: JsonRecord): unknown;
}

export interface SupabaseBundleExecutionResult {
  adapter_invocations: number;
  failures: string[];
  plan: JsonRecord | null;
  receipt: JsonRecord | null;
  request_valid: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProxyRepresentation(value: unknown): boolean {
  return (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    isNativeProxy(value)
  );
}

function ownKeysEqual(
  expected: readonly PropertyKey[],
  actual: readonly PropertyKey[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((key, index) => actual[index] === key)
  );
}

function isCanonicalDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
  enumerable: boolean,
): descriptor is PropertyDescriptor & { value: unknown } {
  return (
    descriptor !== undefined &&
    Object.prototype.hasOwnProperty.call(descriptor, "value") &&
    !Object.prototype.hasOwnProperty.call(descriptor, "get") &&
    !Object.prototype.hasOwnProperty.call(descriptor, "set") &&
    descriptor.writable === true &&
    descriptor.enumerable === enumerable &&
    descriptor.configurable === true
  );
}

function isCanonicalArrayLengthDescriptor(
  descriptor: PropertyDescriptor | undefined,
  expectedLength: number,
): boolean {
  return (
    descriptor !== undefined &&
    Object.prototype.hasOwnProperty.call(descriptor, "value") &&
    descriptor.value === expectedLength &&
    descriptor.writable === true &&
    descriptor.enumerable === false &&
    descriptor.configurable === false &&
    !Object.prototype.hasOwnProperty.call(descriptor, "get") &&
    !Object.prototype.hasOwnProperty.call(descriptor, "set")
  );
}

function compareCanonical(
  expected: unknown,
  actual: unknown,
  path: string,
  failures: string[],
): void {
  if (isProxyRepresentation(actual)) {
    failures.push(`${path} must not use a Proxy representation.`);
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push(`${path} must be the canonical ordered array.`);
      return;
    }
    if (Object.getPrototypeOf(actual) !== Array.prototype) {
      failures.push(`${path} must use the canonical array prototype.`);
      return;
    }
    const expectedKeys = Reflect.ownKeys(expected);
    const actualKeys = Reflect.ownKeys(actual);
    if (!ownKeysEqual(expectedKeys, actualKeys)) {
      failures.push(
        `${path} keys must match the closed canonical array key set.`,
      );
    }
    if (
      !isCanonicalArrayLengthDescriptor(
        Object.getOwnPropertyDescriptor(actual, "length"),
        expected.length,
      )
    ) {
      failures.push(`${path}.length must use the canonical array descriptor.`);
    }
    for (let index = 0; index < expected.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(actual, String(index));
      if (!isCanonicalDataDescriptor(descriptor, true)) {
        failures.push(
          `${path}[${index}] must use a canonical own data-property descriptor.`,
        );
        continue;
      }
      compareCanonical(
        expected[index],
        descriptor.value,
        `${path}[${index}]`,
        failures,
      );
    }
    return;
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      failures.push(`${path} must be the canonical object.`);
      return;
    }
    if (Object.getPrototypeOf(actual) !== Object.prototype) {
      failures.push(`${path} must use the canonical record prototype.`);
      return;
    }
    const expectedKeys = Reflect.ownKeys(expected);
    const actualKeys = Reflect.ownKeys(actual);
    if (!ownKeysEqual(expectedKeys, actualKeys)) {
      failures.push(`${path} keys must match the closed canonical key set.`);
    }
    for (const key of expectedKeys) {
      if (typeof key !== "string") {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(actual, key);
      if (!isCanonicalDataDescriptor(descriptor, true)) {
        failures.push(
          `${path}.${key} must use a canonical own data-property descriptor.`,
        );
        continue;
      }
      compareCanonical(
        expected[key],
        descriptor.value,
        `${path}.${key}`,
        failures,
      );
    }
    return;
  }

  if (actual !== expected) {
    failures.push(`${path} must match the canonical primitive category.`);
  }
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(stableJsonStringify(value), "utf8")
    .digest("hex")}`;
}

function canonicalClone(value: string): JsonRecord {
  return JSON.parse(value) as JsonRecord;
}

export function getCanonicalSupabaseBundleExecutionRequest(): JsonRecord {
  return canonicalClone(CANONICAL_REQUEST_JSON);
}

export function validateSupabaseBundleExecutionRequest(
  value: unknown,
): string[] {
  const failures: string[] = [];
  try {
    compareCanonical(CANONICAL_REQUEST, value, "request", failures);
    const profile = getCanonicalSupabaseExecutionProfile();
    const profileFailures = validateSupabaseExecutionProfile(profile);
    if (profileFailures.length > 0) {
      failures.push("request.profile source profile validation failed.");
    }
    if (
      sha256(profile) !==
      `sha256:${CANONICAL_REQUEST.profile.canonical_profile_sha256}`
    ) {
      failures.push("request.profile canonical profile digest drifted.");
    }
    if (
      profile.executor === undefined ||
      !isRecord(profile.executor) ||
      profile.executor.implementation_state !== EXECUTOR_IMPLEMENTATION_STATE
    ) {
      failures.push(
        "request.profile executor implementation state is inconsistent.",
      );
    }
  } catch {
    failures.push(
      "request contains an unsupported or inaccessible candidate value.",
    );
  }
  return failures;
}

function buildCanonicalBlockedPlan(): JsonRecord {
  return {
    adapter_invocations: 0,
    blockers: BLOCKERS,
    bundle: {
      artifact_count: PLATFORM_BUNDLE.artifacts.length,
      contract_binding_count: PLATFORM_BUNDLE.contract_bindings.length,
      executable_bundle_manifest_raw_sha256:
        PLATFORM_BUNDLE.executable_bundle_manifest_raw_sha256,
      executable_statement_count:
        PLATFORM_BUNDLE.statement_denominator.executable_statement_count,
      expected_effects_and_rollback_binding_count:
        PLATFORM_BUNDLE.expected_effects_and_rollback_bindings.length,
      migration_count: PLATFORM_BUNDLE.migration_count,
      ordered_artifact_set_sha256: PLATFORM_BUNDLE.ordered_artifact_set_sha256,
      toolchain_binding_count: PLATFORM_BUNDLE.toolchain.length,
    },
    contract_version: SUPABASE_BUNDLE_EXECUTOR_CONTRACT,
    executor_identity: SUPABASE_EXECUTOR_IDENTITY,
    lifecycle: {
      apply_admitted: false,
      execution: "EXECUTION_BLOCKED",
      source: "SOURCE_READY",
    },
    operation: "OFFLINE_VALIDATE_AND_PLAN_ONLY",
    status: "BLOCKED",
  };
}

function buildCanonicalBlockedReceipt(plan: JsonRecord): JsonRecord {
  const subject = {
    blocker_count: BLOCKERS.length,
    contract_version: SUPABASE_BUNDLE_BLOCKED_RECEIPT_CONTRACT,
    executor_identity: SUPABASE_EXECUTOR_IDENTITY,
    input_sha256: sha256(CANONICAL_REQUEST),
    lifecycle: {
      apply_admitted: false,
      execution: "EXECUTION_BLOCKED",
      source: "SOURCE_READY",
    },
    plan_sha256: sha256(plan),
    status: "BLOCKED",
  };
  return {
    ...subject,
    receipt_sha256: sha256(subject),
  };
}

export function getCanonicalSupabaseBundleBlockedResult(): SupabaseBundleExecutionResult {
  const plan = buildCanonicalBlockedPlan();
  return {
    adapter_invocations: 0,
    failures: [],
    plan,
    receipt: buildCanonicalBlockedReceipt(plan),
    request_valid: true,
  };
}

export function planSupabaseBundleExecution(
  value: unknown,
  adapter?: SupabaseBundleExecutionAdapter,
): SupabaseBundleExecutionResult {
  const failures = validateSupabaseBundleExecutionRequest(value);
  if (failures.length > 0) {
    return {
      adapter_invocations: 0,
      failures,
      plan: null,
      receipt: null,
      request_valid: false,
    };
  }

  // Current source has no ready state. The adapter is deliberately injected
  // but unreachable while the closed canonical request remains BLOCKED.
  void adapter;
  return getCanonicalSupabaseBundleBlockedResult();
}
