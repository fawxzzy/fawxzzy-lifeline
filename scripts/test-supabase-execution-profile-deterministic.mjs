import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getCanonicalSupabaseExecutionProfile,
  validateSupabaseExecutionProfile,
} from "../dist/core/supabase-execution-profile.js";

const scriptsDir = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const fixturePath = path.join(
  repoRoot,
  "examples",
  "privileged-execution",
  "supabase-execution-profile.blocked.json",
);

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableJsonValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(stableJsonValue(value), null, 2);
}

function clone(value) {
  return structuredClone(value);
}

let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function expectRejected(name, mutate) {
  const candidate = clone(profile);
  mutate(candidate);
  const failures = validateSupabaseExecutionProfile(candidate);
  check(failures.length > 0, `${name}: malformed profile was accepted`);
}

function expectSafelyRejected(
  name,
  candidate,
  forbiddenMarkers = [],
  expectedFailure = null,
) {
  let failures;
  let threw = false;
  try {
    failures = validateSupabaseExecutionProfile(candidate);
  } catch {
    threw = true;
  }
  check(!threw, `${name}: validator threw instead of failing closed`);
  check(failures.length > 0, `${name}: malformed profile was accepted`);
  const failureText = failures.join("\n");
  if (expectedFailure !== null) {
    check(
      failureText.includes(expectedFailure),
      `${name}: rejection did not prove the expected boundary`,
    );
  }
  for (const marker of forbiddenMarkers) {
    check(
      !failureText.includes(marker),
      `${name}: validator echoed rejected candidate material`,
    );
  }
}

const fixtureRaw = await readFile(fixturePath, "utf8");
const profile = JSON.parse(fixtureRaw);
const canonical = getCanonicalSupabaseExecutionProfile();

check(
  fixtureRaw === `${stableJsonStringify(profile)}\n`,
  "blocked fixture is not canonical recursively key-sorted JSON",
);
check(
  stableJsonStringify(profile) === stableJsonStringify(canonical),
  "blocked fixture does not equal the source-frozen canonical profile",
);
check(
  validateSupabaseExecutionProfile(profile).length === 0,
  "canonical blocked fixture did not validate",
);
check(
  profile.lifecycle.source === "SOURCE_READY" &&
    profile.lifecycle.execution === "EXECUTION_BLOCKED" &&
    profile.lifecycle.apply_admitted === false,
  "canonical lifecycle is not SOURCE_READY / EXECUTION_BLOCKED / apply false",
);
check(
  profile.trust_anchors.length === 12,
  "canonical trust-anchor denominator is not exactly 12",
);
check(
  new Set(profile.trust_anchors.map((anchor) => anchor.signature_domain))
    .size === 12,
  "canonical trust-anchor signature domains are not distinct",
);
check(
  profile.trust_anchors.every(
    (anchor) =>
      anchor.state === "UNPROVISIONED_BLOCKED" &&
      anchor.algorithm === "Ed25519" &&
      anchor.key_id === null &&
      anchor.public_key_spki_sha256 === null &&
      anchor.installation_ref === null,
  ),
  "canonical trust anchors include provisioned or caller-supplied key material",
);
check(
  profile.credentials.values_present === false &&
    Object.values(profile.credentials)
      .filter((value) => typeof value === "string")
      .every(
        (value) =>
          value === "ACTION_TIME_REQUIRED" || value.startsWith("secret://"),
      ),
  "canonical credential contract contains a value instead of a reference",
);
check(
  profile.data_api_reader.method === "GET" &&
    profile.data_api_reader.oauth_scope === "rest:read" &&
    profile.data_api_reader.fine_grained_permission ===
      "data_api_config_read" &&
    profile.data_api_reader.write_scope === "ABSENT_SEPARATELY_GATED",
  "canonical Data API reader is not read-only and separately write-gated",
);
check(
  profile.data_api_reader.forbidden_persisted_fields.includes("jwt_secret") &&
    !profile.data_api_reader.allowed_persisted_fields.includes("jwt_secret"),
  "canonical Data API redaction does not exclude jwt_secret",
);
check(
  profile.executor.implementation_state ===
    "OFFLINE_BUNDLE_EXECUTOR_SOURCE_IMPLEMENTED_LIVE_ADAPTER_UNINSTALLED" &&
    profile.executor.provider_connectivity_included === false &&
    profile.executor.sql_execution_authorized === false,
  "canonical executor profile misstates offline source, live-adapter, connectivity, or SQL authority",
);
check(
  profile.inverse_capabilities.every(
    (entry) => entry.state === "BLOCKED_UNPROVEN" || entry.state === "REQUIRED",
  ),
  "canonical inverse capability is improperly promoted",
);

expectRejected("extra top-level field", (candidate) => {
  candidate.provider_response = {};
});
expectRejected("lifecycle source promotion", (candidate) => {
  candidate.lifecycle.source = "CURRENT";
});
expectRejected("execution promotion", (candidate) => {
  candidate.lifecycle.execution = "EXECUTION_READY";
});
expectRejected("apply promotion", (candidate) => {
  candidate.lifecycle.apply_admitted = true;
});
expectRejected("executor implementation promotion", (candidate) => {
  candidate.executor.implementation_state = "LIVE_ADAPTER_INSTALLED";
});
expectRejected("provider connectivity promotion", (candidate) => {
  candidate.executor.provider_connectivity_included = true;
});
expectRejected("SQL authority promotion", (candidate) => {
  candidate.executor.sql_execution_authorized = true;
});
expectRejected("credential inclusion promotion", (candidate) => {
  candidate.executor.credentials_included = true;
});
expectRejected("Platform main rebinding", (candidate) => {
  candidate.platform_binding.main = "f".repeat(40);
});
expectRejected("bundle manifest rebinding", (candidate) => {
  candidate.platform_binding.executable_bundle_manifest_raw_sha256 = "f".repeat(
    64,
  );
});
expectRejected("ordered artifact rebinding", (candidate) => {
  candidate.platform_binding.ordered_artifact_set_sha256 = "e".repeat(64);
});
expectRejected("package rebinding", (candidate) => {
  candidate.platform_binding.migration_package_sha256 = "d".repeat(64);
});
expectRejected("missing trust anchor", (candidate) => {
  candidate.trust_anchors.pop();
});
expectRejected("duplicate trust anchor", (candidate) => {
  candidate.trust_anchors[1] = clone(candidate.trust_anchors[0]);
});
expectRejected("reordered trust anchors", (candidate) => {
  candidate.trust_anchors.reverse();
});
expectRejected("cross-role signature domain", (candidate) => {
  candidate.trust_anchors[0].signature_domain =
    candidate.trust_anchors[1].signature_domain;
});
expectRejected("installed trust anchor", (candidate) => {
  candidate.trust_anchors[0].state = "INSTALLED";
});
expectRejected("caller key id", (candidate) => {
  candidate.trust_anchors[0].key_id = "caller-key";
});
expectRejected("caller SPKI digest", (candidate) => {
  candidate.trust_anchors[0].public_key_spki_sha256 = "a".repeat(64);
});
expectRejected("caller installation ref", (candidate) => {
  candidate.trust_anchors[0].installation_ref = "secret://caller/anchor.pem";
});
expectRejected("caller verifier", (candidate) => {
  candidate.trust_anchors[0].source_verifier_reference = "caller-verifier";
});

for (let index = 0; index < profile.trust_anchors.length; index += 1) {
  expectRejected(`trust domain substitution ${index + 1}`, (candidate) => {
    candidate.trust_anchors[index].signature_domain =
      `caller.supabase.domain.${index}`;
  });
}

expectRejected("Data API method mutation", (candidate) => {
  candidate.data_api_reader.method = "PATCH";
});
expectRejected("Data API path mutation", (candidate) => {
  candidate.data_api_reader.path_template = "/v1/projects/{ref}";
});
expectRejected("Data API OAuth write scope", (candidate) => {
  candidate.data_api_reader.oauth_scope = "rest:write";
});
expectRejected("Data API fine-grained write scope", (candidate) => {
  candidate.data_api_reader.fine_grained_permission = "data_api_config_write";
});
expectRejected("Data API write-scope promotion", (candidate) => {
  candidate.data_api_reader.write_scope = "PRESENT";
});
expectRejected("jwt_secret allowlisting", (candidate) => {
  candidate.data_api_reader.allowed_persisted_fields.push("jwt_secret");
});
expectRejected("jwt_secret redaction removal", (candidate) => {
  candidate.data_api_reader.forbidden_persisted_fields =
    candidate.data_api_reader.forbidden_persisted_fields.filter(
      (field) => field !== "jwt_secret",
    );
});
expectRejected("raw provider payload allowlisting", (candidate) => {
  candidate.data_api_reader.allowed_persisted_fields.push(
    "raw_provider_response",
  );
});
expectRejected("credential value flag", (candidate) => {
  candidate.credentials.values_present = true;
});
expectRejected("credential value injection", (candidate) => {
  candidate.credentials.database_password = "not-a-real-secret";
});
expectRejected("database transport selection", (candidate) => {
  candidate.credentials.selected_transport =
    "DIRECT_POSTGRES_5432_SSL_REQUIRED";
});
expectRejected("unsafe reset permission", (candidate) => {
  candidate.credentials.permitted_future_operations.push("RESET");
});
expectRejected("missing prohibited operation", (candidate) => {
  candidate.credentials.prohibited_operations =
    candidate.credentials.prohibited_operations.filter(
      (operation) => operation !== "MIGRATION_REPAIR",
    );
});
expectRejected("missing inverse capability", (candidate) => {
  candidate.inverse_capabilities.shift();
});
expectRejected("reordered inverse capabilities", (candidate) => {
  candidate.inverse_capabilities.reverse();
});
expectRejected("inverse capability promotion", (candidate) => {
  candidate.inverse_capabilities[0].state = "CURRENT";
});
expectRejected("source system retirement", (candidate) => {
  candidate.inverse_capabilities.at(-1).state = "RETIRED";
});
expectRejected("project ref serialization", (candidate) => {
  candidate.target_project_ref = "project-ref-forbidden";
});
expectRejected("machine path serialization", (candidate) => {
  candidate.executor.installation_path = "C:/machine-specific/path";
});
expectRejected("raw SQL serialization", (candidate) => {
  candidate.sql = "select 1";
});

{
  const marker = "secret://candidate/connection-marker";
  const candidate = clone(profile);
  candidate.credentials.connection_secret_ref = marker;
  expectSafelyRejected("connection credential reference non-echo", candidate, [
    marker,
  ]);
}

{
  const marker = "secret://candidate/management-token-marker";
  const candidate = clone(profile);
  candidate.credentials.management_api_oauth_token_ref = marker;
  expectSafelyRejected(
    "management API credential reference non-echo",
    candidate,
    [marker],
  );
}

{
  const marker = "candidate-key-id-marker";
  const candidate = clone(profile);
  candidate.trust_anchors[0].key_id = marker;
  expectSafelyRejected("trust-anchor key id non-echo", candidate, [marker]);
}

{
  const marker = "candidate-spki-marker";
  const candidate = clone(profile);
  candidate.trust_anchors[0].public_key_spki_sha256 = marker;
  expectSafelyRejected("trust-anchor SPKI non-echo", candidate, [marker]);
}

{
  const marker = "secret://candidate/installation-marker";
  const candidate = clone(profile);
  candidate.trust_anchors[0].installation_ref = marker;
  expectSafelyRejected("trust-anchor installation ref non-echo", candidate, [
    marker,
  ]);
}

{
  const candidate = clone(profile);
  candidate.lifecycle.apply_admitted = 1n;
  expectSafelyRejected("BigInt candidate", candidate);
}

{
  const candidate = clone(profile);
  candidate.profile_id = candidate;
  expectSafelyRejected("cyclic candidate", candidate);
}

{
  const marker = "throwing-accessor-marker";
  const candidate = clone(profile);
  let getterInvoked = false;
  Object.defineProperty(candidate.credentials, "connection_secret_ref", {
    configurable: true,
    enumerable: true,
    get() {
      getterInvoked = true;
      throw new Error(marker);
    },
  });
  expectSafelyRejected(
    "throwing canonical accessor",
    candidate,
    [marker],
    "canonical own data-property descriptor",
  );
  check(
    !getterInvoked,
    "throwing canonical accessor was invoked during validation",
  );
}

{
  const marker = "throwing-proxy-marker";
  const candidate = clone(profile);
  let trapInvoked = false;
  candidate.credentials = new Proxy(candidate.credentials, {
    ownKeys() {
      trapInvoked = true;
      throw new Error(marker);
    },
  });
  expectSafelyRejected(
    "throwing proxy",
    candidate,
    [marker],
    "must not use a Proxy representation",
  );
  check(!trapInvoked, "throwing proxy trap was invoked during validation");
}

{
  const candidate = new Proxy(clone(profile), {});
  expectSafelyRejected(
    "transparent root Proxy",
    candidate,
    [],
    "must not use a Proxy representation",
  );
}

{
  const candidate = clone(profile);
  candidate.credentials = new Proxy(candidate.credentials, {});
  expectSafelyRejected(
    "transparent nested object Proxy",
    candidate,
    [],
    "must not use a Proxy representation",
  );
}

{
  const candidate = clone(profile);
  candidate.trust_anchors = new Proxy(candidate.trust_anchors, {});
  expectSafelyRejected(
    "transparent nested array Proxy",
    candidate,
    [],
    "must not use a Proxy representation",
  );
}

{
  const candidate = clone(profile);
  const revocable = Proxy.revocable(candidate.credentials, {});
  candidate.credentials = revocable.proxy;
  revocable.revoke();
  expectSafelyRejected(
    "revoked Proxy",
    candidate,
    [],
    "must not use a Proxy representation",
  );
}

for (const trapName of [
  "ownKeys",
  "getOwnPropertyDescriptor",
  "getPrototypeOf",
  "get",
]) {
  const marker = `secret://candidate/${trapName}-proxy-marker`;
  const candidate = clone(profile);
  let trapInvoked = false;
  candidate.credentials = new Proxy(candidate.credentials, {
    [trapName]() {
      trapInvoked = true;
      throw new Error(marker);
    },
  });
  expectSafelyRejected(
    `throwing ${trapName} Proxy`,
    candidate,
    [marker],
    "must not use a Proxy representation",
  );
  check(
    !trapInvoked,
    `throwing ${trapName} Proxy trap was invoked during validation`,
  );
}

{
  const marker = "secret://candidate/inherited-required-fields";
  const candidate = Object.create(Object.assign(clone(profile), { marker }));
  expectSafelyRejected(
    "prototype-only required fields",
    candidate,
    [marker],
    "must use the canonical record prototype",
  );
}

{
  const candidate = clone(profile);
  Object.setPrototypeOf(candidate.credentials, null);
  expectSafelyRejected(
    "inconsistent object prototype",
    candidate,
    [],
    "must use the canonical record prototype",
  );
}

{
  const candidate = clone(profile);
  Object.setPrototypeOf(candidate.trust_anchors, null);
  expectSafelyRejected(
    "inconsistent array prototype",
    candidate,
    [],
    "must use the canonical array prototype",
  );
}

{
  const marker = "secret://candidate/object-symbol-marker";
  const candidate = clone(profile);
  candidate.credentials[Symbol(marker)] = marker;
  expectSafelyRejected(
    "object symbol key",
    candidate,
    [marker],
    "closed canonical key set",
  );
}

{
  const marker = "secret://candidate/array-symbol-marker";
  const candidate = clone(profile);
  candidate.trust_anchors[Symbol(marker)] = marker;
  expectSafelyRejected(
    "array symbol key",
    candidate,
    [marker],
    "closed canonical array key set",
  );
}

{
  const marker = "secret://candidate/object-hidden-marker";
  const candidate = clone(profile);
  Object.defineProperty(candidate.credentials, "hidden_marker", {
    configurable: true,
    enumerable: false,
    value: marker,
    writable: true,
  });
  expectSafelyRejected(
    "object non-enumerable addition",
    candidate,
    [marker],
    "closed canonical key set",
  );
}

{
  const marker = "secret://candidate/array-hidden-marker";
  const candidate = clone(profile);
  Object.defineProperty(candidate.trust_anchors, "hidden_marker", {
    configurable: true,
    enumerable: false,
    value: marker,
    writable: true,
  });
  expectSafelyRejected(
    "array non-enumerable addition",
    candidate,
    [marker],
    "closed canonical array key set",
  );
}

{
  const marker = "secret://candidate/array-named-marker";
  const candidate = clone(profile);
  candidate.trust_anchors.named_marker = marker;
  expectSafelyRejected(
    "array named property",
    candidate,
    [marker],
    "closed canonical array key set",
  );
}

{
  const candidate = clone(profile);
  Object.defineProperty(candidate.credentials, "connection_secret_ref", {
    configurable: true,
    enumerable: true,
    value: candidate.credentials.connection_secret_ref,
    writable: false,
  });
  expectSafelyRejected(
    "object noncanonical data descriptor",
    candidate,
    [],
    "canonical own data-property descriptor",
  );
}

{
  const candidate = clone(profile);
  Object.defineProperty(candidate.trust_anchors, "0", {
    configurable: true,
    enumerable: true,
    value: candidate.trust_anchors[0],
    writable: false,
  });
  expectSafelyRejected(
    "array index noncanonical data descriptor",
    candidate,
    [],
    "canonical own data-property descriptor",
  );
}

{
  const marker = "secret://candidate/array-accessor-marker";
  const candidate = clone(profile);
  let getterInvoked = false;
  Object.defineProperty(candidate.trust_anchors, "0", {
    configurable: true,
    enumerable: true,
    get() {
      getterInvoked = true;
      throw new Error(marker);
    },
  });
  expectSafelyRejected(
    "array accessor",
    candidate,
    [marker],
    "canonical own data-property descriptor",
  );
  check(!getterInvoked, "array accessor was invoked during validation");
}

{
  const candidate = clone(profile);
  Reflect.deleteProperty(candidate.trust_anchors, "1");
  expectSafelyRejected(
    "sparse array",
    candidate,
    [],
    "closed canonical array key set",
  );
}

{
  const marker = "secret://candidate/extra-numeric-index";
  const candidate = clone(profile);
  candidate.trust_anchors[candidate.trust_anchors.length] = marker;
  expectSafelyRejected(
    "extra numeric array index",
    candidate,
    [marker],
    "closed canonical array key set",
  );
}

{
  const candidate = clone(profile);
  Object.defineProperty(candidate.trust_anchors, "length", {
    writable: false,
  });
  expectSafelyRejected(
    "altered array length descriptor",
    candidate,
    [],
    "canonical array descriptor",
  );
}

console.log(
  `Supabase execution profile deterministic checks: ${checks} passed.`,
);
