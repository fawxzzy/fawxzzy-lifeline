import { createHash } from "node:crypto";

import { stableJsonStringify } from "./receipt-store.js";
import {
  SUPABASE_BUNDLE_EXECUTOR_CONTRACT,
  getCanonicalSupabaseBundleExecutionRequest,
  validateSupabaseBundleExecutionRequest,
} from "./supabase-bundle-executor.js";
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

export const SUPABASE_LIVE_ADAPTER_INSTALLATION_EVIDENCE_CONTRACT =
  "atlas.supabase.live-adapter-installation-evidence.v1";
export const SUPABASE_LIVE_ADAPTER_INSTALLATION_BLOCKED_RECEIPT_CONTRACT =
  "atlas.supabase.live-adapter-installation-evidence.blocked-receipt.v1";

const EXPECTED_PROFILE_SHA256 =
  "8f83651c8fd3ec90b90c8e7784be2ea083e8a64e780a52a5a17b9233d8993071";
const EXPECTED_BUNDLE_REQUEST_SHA256 =
  "0d5a0e6892a63dbf8bcf51c5a302cda7aded67db01c94d54efbdecc881ed70bd";

const LIFELINE_SOURCE = {
  main: "26be66ab22c6b7b469da69315b038dd478bfa71c",
  tree: "e15c05c864a0554918dbc8b1d6e8fb37a009ad28",
} as const;

const PLATFORM_SOURCE = {
  contract_binding_set_sha256:
    "83ece73a522f1843616d781fdd99d595128c75a30d7267d1eab82cb0189da1b0",
  executable_bundle_manifest_raw_sha256:
    "10b616019af3edad152f7a1cc922cbab20e5add81405f1f542053b54dacb2a54",
  expected_effects_and_rollback_set_sha256:
    "a152afa30437e5e163bb0cfbeab7168330830c696289225089f40c1ddd47a4a9",
  governance_manifest_sha256:
    "82e7ecad9a68addff14c43c3bc237c54af2dd5d48cda454c0e1c121a3e4536ec",
  main: "2a871f8a9a7f3c030d7dca259de9ca88d336ec04",
  migration_count: 122,
  migration_package_sha256:
    "b65d1c0b73607218cc37826d9bb77c25704ea18f957abba7b5667a79d0a2c8db",
  ordered_artifact_set_sha256:
    "899adf8cab5d5e7a7ece1806022aefccc562e0c21513cdb009310985b399ccfc",
  toolchain_set_sha256:
    "0400f7536a3238c08c0d7c1c577ec67b983eeaf63ec177a50ad6e6f2bb9f2659",
  tree: "718b816d262f05486c6692c67629e57a4846469e",
} as const;

type JsonRecord = Record<string, unknown>;

export interface SupabaseLiveAdapterInstaller {
  installReadyEvidence(evidence: JsonRecord): unknown;
}

export interface SupabaseLiveAdapterInstallationEvidenceResult {
  adapter_invocations: number;
  failures: string[];
  plan: JsonRecord | null;
  receipt: JsonRecord | null;
  request_valid: boolean;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(stableJsonStringify(value), "utf8")
    .digest("hex");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} source contract is invalid.`);
  }
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} source contract is invalid.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} source contract is invalid.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value, label);
}

const PROFILE = getCanonicalSupabaseExecutionProfile();
const PROFILE_SHA256 = sha256(PROFILE);
if (PROFILE_SHA256 !== EXPECTED_PROFILE_SHA256) {
  throw new Error("Supabase execution profile digest drifted.");
}

const BUNDLE_REQUEST = getCanonicalSupabaseBundleExecutionRequest();
const BUNDLE_REQUEST_SHA256 = sha256(BUNDLE_REQUEST);
if (BUNDLE_REQUEST_SHA256 !== EXPECTED_BUNDLE_REQUEST_SHA256) {
  throw new Error("Supabase bundle execution request digest drifted.");
}

const PROFILE_CREDENTIALS = requireRecord(PROFILE.credentials, "credentials");
const PROFILE_DATA_API = requireRecord(PROFILE.data_api_reader, "data_api");
const PROFILE_INVERSE = requireArray(
  PROFILE.inverse_capabilities,
  "inverse_capabilities",
);
const PROFILE_TRUST = requireArray(PROFILE.trust_anchors, "trust_anchors");

const TRUST_DOMAIN_INSTALLATION_EVIDENCE = PROFILE_TRUST.map(
  (candidate, index) => {
    const trust = requireRecord(candidate, `trust_anchors[${index}]`);
    return {
      algorithm: requireString(
        trust.algorithm,
        `trust_anchors[${index}].algorithm`,
      ),
      current_installation_state: "UNKNOWN",
      installation_ref: null,
      key_id: null,
      public_key_spki_sha256: null,
      role: requireString(trust.role, `trust_anchors[${index}].role`),
      signature_domain: requireString(
        trust.signature_domain,
        `trust_anchors[${index}].signature_domain`,
      ),
      source_profile_state: requireString(
        trust.state,
        `trust_anchors[${index}].state`,
      ),
      source_verifier_reference: requireNullableString(
        trust.source_verifier_reference,
        `trust_anchors[${index}].source_verifier_reference`,
      ),
    };
  },
);

const INVERSE_CAPABILITY_EVIDENCE = PROFILE_INVERSE.map((candidate, index) => {
  const inverse = requireRecord(candidate, `inverse_capabilities[${index}]`);
  return {
    capability_receipt_sha256: null,
    current_live_state: "UNKNOWN",
    evidence_observed_at: null,
    mechanism: requireString(
      inverse.mechanism,
      `inverse_capabilities[${index}].mechanism`,
    ),
    source_profile_state: requireString(
      inverse.state,
      `inverse_capabilities[${index}].state`,
    ),
  };
});

const BLOCKERS = [
  {
    category: "ADAPTER",
    code: "LIVE_ADAPTER_INSTALLATION_EVIDENCE_MISSING",
    path: "request.adapter",
  },
  {
    category: "AUTHORITY",
    code: "ACTION_TIME_AUTHORITY_AND_CONSUMPTION_EVIDENCE_MISSING",
    path: "request.authority",
  },
  {
    category: "TRUST",
    code: "TRUST_DOMAIN_INSTALLATION_EVIDENCE_MISSING",
    path: "request.trust_domains",
  },
  {
    category: "DATA_API",
    code: "SANITIZED_DATA_API_READER_EVIDENCE_MISSING",
    path: "request.data_api_reader",
  },
  {
    category: "CREDENTIAL",
    code: "SECRET_REFERENCE_TRANSPORT_AND_SCOPE_EVIDENCE_MISSING",
    path: "request.credentials",
  },
  {
    category: "INVERSE",
    code: "INVERSE_CAPABILITY_EVIDENCE_MISSING",
    path: "request.inverse_capabilities",
  },
  {
    category: "APPLY",
    code: "APPLY_NOT_ADMITTED",
    path: "request.lifecycle.apply_admitted",
  },
] as const;

function buildCanonicalBlockers(): JsonRecord[] {
  return BLOCKERS.map((blocker) => ({ ...blocker }));
}

const CANONICAL_REQUEST = {
  adapter: {
    build_sha256: null,
    current_installation_state: "UNKNOWN",
    identity: SUPABASE_EXECUTOR_IDENTITY,
    implementation_state:
      "OFFLINE_BUNDLE_EXECUTOR_SOURCE_IMPLEMENTED_LIVE_ADAPTER_UNINSTALLED",
    installation_receipt_sha256: null,
    provider_connectivity_included: false,
    registry_entry_id: null,
    source_state: "UNINSTALLED_BLOCKED",
    sql_execution_authorized: false,
    version: "1.0.0",
  },
  authority: {
    authority_event_id: null,
    authority_receipt_sha256: null,
    consumption_receipt_sha256: null,
    current_live_state: "UNKNOWN",
    one_time_consumption_state: "UNPROVEN_BLOCKED",
    trusted_action_time: null,
  },
  bundle: {
    bundle_request_sha256: BUNDLE_REQUEST_SHA256,
    contract_version: SUPABASE_BUNDLE_EXECUTOR_CONTRACT,
    lifeline_main: LIFELINE_SOURCE.main,
    lifeline_tree: LIFELINE_SOURCE.tree,
    platform: PLATFORM_SOURCE,
  },
  contract_version: SUPABASE_LIVE_ADAPTER_INSTALLATION_EVIDENCE_CONTRACT,
  credentials: {
    capability_receipt_sha256: null,
    connection_secret_ref: requireString(
      PROFILE_CREDENTIALS.connection_secret_ref,
      "credentials.connection_secret_ref",
    ),
    current_live_state: "UNKNOWN",
    database_scope_receipt_sha256: null,
    management_scope_receipt_sha256: null,
    management_token_ref: requireString(
      PROFILE_CREDENTIALS.management_api_oauth_token_ref,
      "credentials.management_api_oauth_token_ref",
    ),
    selected_transport: requireString(
      PROFILE_CREDENTIALS.selected_transport,
      "credentials.selected_transport",
    ),
    source_state: "UNAVAILABLE_BLOCKED",
    transport_receipt_sha256: null,
    values_present: false,
  },
  data_api_reader: {
    allowed_sanitized_fields: requireArray(
      PROFILE_DATA_API.allowed_persisted_fields,
      "data_api.allowed_persisted_fields",
    ),
    current_live_state: "UNKNOWN",
    fine_grained_permission: requireString(
      PROFILE_DATA_API.fine_grained_permission,
      "data_api.fine_grained_permission",
    ),
    method: requireString(PROFILE_DATA_API.method, "data_api.method"),
    oauth_scope: requireString(
      PROFILE_DATA_API.oauth_scope,
      "data_api.oauth_scope",
    ),
    path_template: requireString(
      PROFILE_DATA_API.path_template,
      "data_api.path_template",
    ),
    reader_implementation_id: null,
    redactor_implementation_sha256: null,
    sanitized_config_sha256: null,
    scope_receipt_sha256: null,
    source_state: "UNAVAILABLE_BLOCKED",
    write_scope_present: false,
  },
  inverse_capabilities: INVERSE_CAPABILITY_EVIDENCE,
  lifecycle: {
    apply_admitted: false,
    execution: "EXECUTION_BLOCKED",
    source: "SOURCE_READY",
  },
  profile: {
    canonical_profile_sha256: PROFILE_SHA256,
    contract_version: SUPABASE_EXECUTION_PROFILE_CONTRACT,
  },
  redaction: {
    aggregate_and_digest_only: true,
    credential_values_forbidden: true,
    key_material_forbidden: true,
    machine_paths_forbidden: true,
    project_refs_forbidden: true,
    provider_error_content_forbidden: true,
    raw_provider_responses_forbidden: true,
    sql_bytes_forbidden: true,
    unknown_provider_fields_forbidden: true,
  },
  trust_domains: TRUST_DOMAIN_INSTALLATION_EVIDENCE,
} as const;

const CANONICAL_REQUEST_JSON = stableJsonStringify(CANONICAL_REQUEST);

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

function canonicalClone(value: string): JsonRecord {
  return JSON.parse(value) as JsonRecord;
}

export function getCanonicalSupabaseLiveAdapterInstallationEvidenceRequest(): JsonRecord {
  return canonicalClone(CANONICAL_REQUEST_JSON);
}

export function validateSupabaseLiveAdapterInstallationEvidenceRequest(
  value: unknown,
): string[] {
  const failures: string[] = [];
  try {
    compareCanonical(CANONICAL_REQUEST, value, "request", failures);

    const profile = getCanonicalSupabaseExecutionProfile();
    if (validateSupabaseExecutionProfile(profile).length > 0) {
      failures.push("request.profile source contract validation failed.");
    }
    if (sha256(profile) !== EXPECTED_PROFILE_SHA256) {
      failures.push("request.profile source contract digest drifted.");
    }

    const bundle = getCanonicalSupabaseBundleExecutionRequest();
    if (validateSupabaseBundleExecutionRequest(bundle).length > 0) {
      failures.push("request.bundle source contract validation failed.");
    }
    if (sha256(bundle) !== EXPECTED_BUNDLE_REQUEST_SHA256) {
      failures.push("request.bundle source contract digest drifted.");
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
    blockers: buildCanonicalBlockers(),
    contract_version: SUPABASE_LIVE_ADAPTER_INSTALLATION_EVIDENCE_CONTRACT,
    evidence_denominator: {
      inverse_capability_count: INVERSE_CAPABILITY_EVIDENCE.length,
      trust_domain_count: TRUST_DOMAIN_INSTALLATION_EVIDENCE.length,
    },
    executor_identity: SUPABASE_EXECUTOR_IDENTITY,
    lifecycle: {
      apply_admitted: false,
      execution: "EXECUTION_BLOCKED",
      source: "SOURCE_READY",
    },
    operation: "VALIDATE_INSTALLATION_EVIDENCE_ONLY",
    status: "BLOCKED",
  };
}

function buildCanonicalBlockedReceipt(plan: JsonRecord): JsonRecord {
  const subject = {
    blocker_count: BLOCKERS.length,
    contract_version:
      SUPABASE_LIVE_ADAPTER_INSTALLATION_BLOCKED_RECEIPT_CONTRACT,
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

export function getCanonicalSupabaseLiveAdapterInstallationBlockedResult(): SupabaseLiveAdapterInstallationEvidenceResult {
  const plan = buildCanonicalBlockedPlan();
  return {
    adapter_invocations: 0,
    failures: [],
    plan,
    receipt: buildCanonicalBlockedReceipt(plan),
    request_valid: true,
  };
}

export function planSupabaseLiveAdapterInstallation(
  value: unknown,
  installer?: SupabaseLiveAdapterInstaller,
): SupabaseLiveAdapterInstallationEvidenceResult {
  const failures =
    validateSupabaseLiveAdapterInstallationEvidenceRequest(value);
  if (failures.length > 0) {
    return {
      adapter_invocations: 0,
      failures,
      plan: null,
      receipt: null,
      request_valid: false,
    };
  }

  // The canonical contract contains no READY representation. The injected
  // installation boundary is deliberately unreachable while all live facts
  // remain UNKNOWN and apply authority remains false.
  void installer;
  return getCanonicalSupabaseLiveAdapterInstallationBlockedResult();
}
