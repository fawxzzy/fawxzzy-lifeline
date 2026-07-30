import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getCanonicalSupabaseBundleBlockedResult,
  getCanonicalSupabaseBundleExecutionRequest,
  planSupabaseBundleExecution,
  validateSupabaseBundleExecutionRequest,
} from "../dist/core/supabase-bundle-executor.js";
import { getCanonicalSupabaseExecutionProfile } from "../dist/core/supabase-execution-profile.js";

const scriptsDir = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const fixturePath = path.join(
  repoRoot,
  "examples",
  "privileged-execution",
  "supabase-bundle-execution.blocked.json",
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

function sha256(value) {
  return `sha256:${createHash("sha256")
    .update(stableJsonStringify(value), "utf8")
    .digest("hex")}`;
}

function clone(value) {
  return structuredClone(value);
}

function getAtPath(root, pathParts) {
  return pathParts.reduce((value, key) => value[key], root);
}

function setAtPath(root, pathParts, value) {
  const parent = getAtPath(root, pathParts.slice(0, -1));
  parent[pathParts.at(-1)] = value;
}

function collectLocations(value, pathParts = [], result = []) {
  if (Array.isArray(value)) {
    result.push({ kind: "array", path: pathParts });
    for (let index = 0; index < value.length; index += 1) {
      collectLocations(value[index], [...pathParts, index], result);
    }
    return result;
  }
  if (value && typeof value === "object") {
    result.push({ kind: "object", path: pathParts });
    for (const key of Object.keys(value)) {
      collectLocations(value[key], [...pathParts, key], result);
    }
    return result;
  }
  result.push({ kind: "leaf", path: pathParts, value });
  return result;
}

function replacementFor(value, marker) {
  if (typeof value === "string") return marker;
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  if (value === null) return marker;
  throw new Error("unsupported leaf type in canonical fixture");
}

let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function expectRejected(
  name,
  candidate,
  forbiddenMarkers = [],
  expectedFailure = null,
) {
  let adapterCalls = 0;
  const adapter = {
    invokeReadyPlan() {
      adapterCalls += 1;
    },
  };
  let result;
  let threw = false;
  try {
    result = planSupabaseBundleExecution(candidate, adapter);
  } catch {
    threw = true;
  }
  check(!threw, `${name}: planner threw instead of failing closed`);
  check(
    result.request_valid === false,
    `${name}: malformed request was accepted`,
  );
  check(result.failures.length > 0, `${name}: rejection had no failure`);
  check(result.plan === null, `${name}: rejected request returned a plan`);
  check(
    result.receipt === null,
    `${name}: rejected request returned a receipt`,
  );
  check(adapterCalls === 0, `${name}: adapter was invoked before rejection`);
  const failureText = result.failures.join("\n");
  if (expectedFailure !== null) {
    check(
      failureText.includes(expectedFailure),
      `${name}: rejection did not prove the expected boundary`,
    );
  }
  for (const marker of forbiddenMarkers) {
    check(
      !failureText.includes(marker),
      `${name}: failure echoed rejected candidate material`,
    );
  }
}

const fixtureRaw = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(fixtureRaw);
const request = getCanonicalSupabaseBundleExecutionRequest();
const expectedResult = getCanonicalSupabaseBundleBlockedResult();
const profile = getCanonicalSupabaseExecutionProfile();

check(
  fixtureRaw === `${stableJsonStringify(fixture)}\n`,
  "blocked fixture is not canonical recursively key-sorted JSON",
);
check(
  stableJsonStringify(fixture.request) === stableJsonStringify(request),
  "blocked fixture request differs from the source-frozen request",
);
check(
  stableJsonStringify(fixture.result) === stableJsonStringify(expectedResult),
  "blocked fixture result differs from the source-frozen result",
);
check(
  validateSupabaseBundleExecutionRequest(request).length === 0,
  "canonical blocked request did not validate",
);

let canonicalAdapterCalls = 0;
const canonicalResult = planSupabaseBundleExecution(request, {
  invokeReadyPlan() {
    canonicalAdapterCalls += 1;
  },
});
check(canonicalResult.request_valid === true, "canonical request was rejected");
check(canonicalResult.failures.length === 0, "canonical request has failures");
check(
  canonicalResult.plan?.status === "BLOCKED",
  "canonical plan is not blocked",
);
check(
  canonicalResult.receipt?.status === "BLOCKED",
  "canonical receipt is not blocked",
);
check(
  canonicalAdapterCalls === 0,
  "canonical blocked plan invoked the adapter",
);
check(
  canonicalResult.adapter_invocations === 0 &&
    canonicalResult.plan?.adapter_invocations === 0,
  "canonical result does not prove zero adapter invocations",
);

const { receipt_sha256: receiptSha256, ...receiptSubject } =
  canonicalResult.receipt;
check(
  receiptSha256 === sha256(receiptSubject),
  "blocked receipt content digest is invalid",
);
check(
  canonicalResult.receipt.input_sha256 === sha256(request),
  "blocked receipt is not bound to the canonical request",
);
check(
  canonicalResult.receipt.plan_sha256 === sha256(canonicalResult.plan),
  "blocked receipt is not bound to the canonical plan",
);
check(
  canonicalResult.plan.blockers.length === 6,
  "canonical plan does not contain the six blocked action-time gates",
);
check(
  new Set(canonicalResult.plan.blockers.map((entry) => entry.category)).size ===
    6,
  "canonical blocker categories are incomplete or duplicated",
);
check(
  request.bundle.artifacts.length === 4 &&
    request.bundle.contract_bindings.length === 5 &&
    request.bundle.expected_effects_and_rollback_bindings.length === 3 &&
    request.bundle.toolchain.length === 2,
  "bundle binding denominator is not 4/5/3/2",
);
check(
  request.bundle.statement_denominator.executable_statement_count === 721 &&
    request.bundle.migration_count === 122,
  "bundle statement or migration denominator drifted",
);
check(
  request.bundle.artifacts.every(
    (entry, index) =>
      entry.ordinal === index + 1 &&
      entry.byte_identical === true &&
      entry.source_sha256 === entry.promoted_sha256,
  ),
  "ordered artifact byte identities are inconsistent",
);
check(
  profile.executor.implementation_state ===
    "OFFLINE_BUNDLE_EXECUTOR_SOURCE_IMPLEMENTED_LIVE_ADAPTER_UNINSTALLED" &&
    profile.executor.provider_connectivity_included === false &&
    profile.executor.sql_execution_authorized === false,
  "execution profile is inconsistent with offline source implementation",
);
check(
  profile.lifecycle.source === "SOURCE_READY" &&
    profile.lifecycle.execution === "EXECUTION_BLOCKED" &&
    profile.lifecycle.apply_admitted === false,
  "execution profile lifecycle was promoted",
);

const locations = collectLocations(request);
let mutationOrdinal = 0;
for (const location of locations.filter((entry) => entry.kind === "leaf")) {
  mutationOrdinal += 1;
  const marker = `candidate-leaf-marker-${mutationOrdinal}`;
  const candidate = clone(request);
  setAtPath(candidate, location.path, replacementFor(location.value, marker));
  expectRejected(`leaf mutation ${mutationOrdinal}`, candidate, [marker]);
}

let omissionOrdinal = 0;
for (const location of locations.filter((entry) => entry.kind === "object")) {
  const source = getAtPath(request, location.path);
  for (const key of Object.keys(source)) {
    omissionOrdinal += 1;
    const candidate = clone(request);
    const target = getAtPath(candidate, location.path);
    delete target[key];
    expectRejected(`field omission ${omissionOrdinal}`, candidate);
  }

  const marker = `candidate-extra-marker-${omissionOrdinal}`;
  const candidate = clone(request);
  getAtPath(candidate, location.path).candidate_extra_field = marker;
  expectRejected(`extra field at object ${omissionOrdinal}`, candidate, [
    marker,
  ]);
}

let arrayOrdinal = 0;
for (const location of locations.filter((entry) => entry.kind === "array")) {
  const source = getAtPath(request, location.path);
  arrayOrdinal += 1;

  const extraMarker = `candidate-array-marker-${arrayOrdinal}`;
  {
    const candidate = clone(request);
    getAtPath(candidate, location.path).push(extraMarker);
    expectRejected(`array addition ${arrayOrdinal}`, candidate, [extraMarker]);
  }

  for (let index = 0; index < source.length; index += 1) {
    const candidate = clone(request);
    getAtPath(candidate, location.path).splice(index, 1);
    expectRejected(`array omission ${arrayOrdinal}.${index}`, candidate);
  }

  if (source.length > 1) {
    const candidate = clone(request);
    getAtPath(candidate, location.path).reverse();
    expectRejected(`array reordering ${arrayOrdinal}`, candidate);

    const duplicate = clone(request);
    const target = getAtPath(duplicate, location.path);
    target[1] = clone(target[0]);
    expectRejected(`array duplication ${arrayOrdinal}`, duplicate);
  }
}

for (const groupName of [
  "contract_bindings",
  "expected_effects_and_rollback_bindings",
  "toolchain",
]) {
  for (let index = 0; index < request.bundle[groupName].length; index += 1) {
    const marker = `${"f".repeat(60)}${String(index).padStart(4, "0")}`;
    const candidate = clone(request);
    candidate.bundle[groupName][index].sha256 = marker;
    candidate.bundle[groupName][index].observed_sha256 = marker;
    expectRejected(`coherent ${groupName} rebinding ${index + 1}`, candidate, [
      marker,
    ]);
  }
}

for (let index = 0; index < request.bundle.artifacts.length; index += 1) {
  const marker = `${"e".repeat(60)}${String(index).padStart(4, "0")}`;
  const candidate = clone(request);
  candidate.bundle.artifacts[index].source_sha256 = marker;
  candidate.bundle.artifacts[index].promoted_sha256 = marker;
  expectRejected(`coherent artifact rebinding ${index + 1}`, candidate, [
    marker,
  ]);
}

for (const [name, mutate] of [
  [
    "authority promotion",
    (candidate) => {
      candidate.action_time_gates.authority.state = "CURRENT";
      candidate.action_time_gates.authority.authority_event_id_present = true;
    },
  ],
  [
    "trust promotion",
    (candidate) => {
      candidate.action_time_gates.trust.state = "INSTALLED";
      candidate.action_time_gates.trust.installed_count = 12;
    },
  ],
  [
    "Data API promotion",
    (candidate) => {
      candidate.action_time_gates.data_api.state = "CURRENT";
      candidate.action_time_gates.data_api.scope_proof_present = true;
    },
  ],
  [
    "credential promotion",
    (candidate) => {
      candidate.action_time_gates.credentials.state = "CURRENT";
      candidate.action_time_gates.credentials.database_scope_receipt_present = true;
    },
  ],
  [
    "inverse promotion",
    (candidate) => {
      candidate.action_time_gates.inverse.state = "CURRENT";
      candidate.action_time_gates.inverse.proven_count = 7;
    },
  ],
  [
    "apply promotion",
    (candidate) => {
      candidate.action_time_gates.apply.state = "ADMITTED";
      candidate.action_time_gates.apply.apply_admitted = true;
    },
  ],
]) {
  const candidate = clone(request);
  mutate(candidate);
  expectRejected(name, candidate);
}

for (const [name, key, marker] of [
  [
    "credential-like marker",
    "connection_secret_ref",
    "secret://candidate/credential-marker",
  ],
  ["key-id marker", "key_id", "candidate-key-id-marker"],
  ["SPKI marker", "public_key_spki_sha256", "candidate-spki-marker"],
  [
    "installation marker",
    "installation_ref",
    "secret://candidate/installation-marker",
  ],
  ["project marker", "target_project_ref", "candidate-project-marker"],
  ["provider marker", "raw_provider_response", "candidate-provider-marker"],
  ["machine path marker", "installation_path", "C:/candidate/machine-path"],
  ["SQL marker", "sql", "candidate-sql-marker"],
]) {
  const candidate = clone(request);
  candidate[key] = marker;
  expectRejected(name, candidate, [marker]);
}

{
  const candidate = clone(request);
  candidate.lifecycle.apply_admitted = 1n;
  expectRejected("BigInt candidate", candidate);
}

{
  const candidate = clone(request);
  candidate.profile = candidate;
  expectRejected("cyclic candidate", candidate);
}

{
  const marker = "throwing-accessor-marker";
  const candidate = clone(request);
  let getterInvoked = false;
  Object.defineProperty(
    candidate.bundle,
    "executable_bundle_manifest_raw_sha256",
    {
      configurable: true,
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error(marker);
      },
    },
  );
  expectRejected(
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
  const candidate = clone(request);
  let trapInvoked = false;
  candidate.action_time_gates = new Proxy(candidate.action_time_gates, {
    ownKeys() {
      trapInvoked = true;
      throw new Error(marker);
    },
  });
  expectRejected(
    "throwing proxy",
    candidate,
    [marker],
    "must not use a Proxy representation",
  );
  check(!trapInvoked, "throwing proxy trap was invoked during validation");
}

{
  const candidate = Object.create({ inherited_marker: "candidate-inherited" });
  Object.assign(candidate, clone(request));
  expectRejected(
    "inherited property candidate",
    candidate,
    ["candidate-inherited"],
    "must use the canonical record prototype",
  );
}

{
  const candidate = new Proxy(clone(request), {});
  expectRejected(
    "transparent root Proxy",
    candidate,
    [],
    "must not use a Proxy representation",
  );
}

{
  const candidate = clone(request);
  candidate.action_time_gates = new Proxy(candidate.action_time_gates, {});
  expectRejected(
    "transparent nested object Proxy",
    candidate,
    [],
    "must not use a Proxy representation",
  );
}

{
  const candidate = clone(request);
  candidate.bundle.artifacts = new Proxy(candidate.bundle.artifacts, {});
  expectRejected(
    "transparent nested array Proxy",
    candidate,
    [],
    "must not use a Proxy representation",
  );
}

{
  const candidate = clone(request);
  const revocable = Proxy.revocable(candidate.action_time_gates, {});
  candidate.action_time_gates = revocable.proxy;
  revocable.revoke();
  expectRejected(
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
  const candidate = clone(request);
  let trapInvoked = false;
  candidate.action_time_gates = new Proxy(candidate.action_time_gates, {
    [trapName]() {
      trapInvoked = true;
      throw new Error(marker);
    },
  });
  expectRejected(
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
  const candidate = Object.create(Object.assign(clone(request), { marker }));
  expectRejected(
    "prototype-only required fields",
    candidate,
    [marker],
    "must use the canonical record prototype",
  );
}

{
  const marker = "secret://candidate/object-symbol-marker";
  const candidate = clone(request);
  candidate.action_time_gates[Symbol(marker)] = marker;
  expectRejected(
    "object symbol key",
    candidate,
    [marker],
    "closed canonical key set",
  );
}

{
  const marker = "secret://candidate/array-symbol-marker";
  const candidate = clone(request);
  candidate.bundle.artifacts[Symbol(marker)] = marker;
  expectRejected(
    "array symbol key",
    candidate,
    [marker],
    "closed canonical array key set",
  );
}

{
  const marker = "secret://candidate/object-hidden-marker";
  const candidate = clone(request);
  Object.defineProperty(candidate.action_time_gates, "hidden_marker", {
    configurable: true,
    enumerable: false,
    value: marker,
    writable: true,
  });
  expectRejected(
    "object non-enumerable addition",
    candidate,
    [marker],
    "closed canonical key set",
  );
}

{
  const marker = "secret://candidate/array-hidden-marker";
  const candidate = clone(request);
  Object.defineProperty(candidate.bundle.artifacts, "hidden_marker", {
    configurable: true,
    enumerable: false,
    value: marker,
    writable: true,
  });
  expectRejected(
    "array non-enumerable addition",
    candidate,
    [marker],
    "closed canonical array key set",
  );
}

{
  const marker = "secret://candidate/array-named-marker";
  const candidate = clone(request);
  candidate.bundle.artifacts.named_marker = marker;
  expectRejected(
    "array named property",
    candidate,
    [marker],
    "closed canonical array key set",
  );
}

{
  const candidate = clone(request);
  Object.defineProperty(candidate.lifecycle, "source", {
    configurable: true,
    enumerable: true,
    value: candidate.lifecycle.source,
    writable: false,
  });
  expectRejected(
    "object noncanonical data descriptor",
    candidate,
    [],
    "canonical own data-property descriptor",
  );
}

{
  const candidate = clone(request);
  Object.defineProperty(candidate.bundle.artifacts, "0", {
    configurable: true,
    enumerable: true,
    value: candidate.bundle.artifacts[0],
    writable: false,
  });
  expectRejected(
    "array index noncanonical data descriptor",
    candidate,
    [],
    "canonical own data-property descriptor",
  );
}

{
  const marker = "secret://candidate/array-accessor-marker";
  const candidate = clone(request);
  let getterInvoked = false;
  Object.defineProperty(candidate.bundle.artifacts, "0", {
    configurable: true,
    enumerable: true,
    get() {
      getterInvoked = true;
      throw new Error(marker);
    },
  });
  expectRejected(
    "array accessor",
    candidate,
    [marker],
    "canonical own data-property descriptor",
  );
  check(!getterInvoked, "array accessor was invoked during validation");
}

{
  const candidate = clone(request);
  Reflect.deleteProperty(candidate.bundle.artifacts, "1");
  expectRejected(
    "sparse array",
    candidate,
    [],
    "closed canonical array key set",
  );
}

{
  const marker = "secret://candidate/extra-numeric-index";
  const candidate = clone(request);
  candidate.bundle.artifacts[candidate.bundle.artifacts.length] = marker;
  expectRejected(
    "extra numeric array index",
    candidate,
    [marker],
    "closed canonical array key set",
  );
}

{
  const candidate = clone(request);
  Object.defineProperty(candidate.bundle.artifacts, "length", {
    writable: false,
  });
  expectRejected(
    "altered array length descriptor",
    candidate,
    [],
    "canonical array descriptor",
  );
}

{
  const candidate = clone(request);
  Object.setPrototypeOf(candidate.action_time_gates, null);
  expectRejected(
    "inconsistent object prototype",
    candidate,
    [],
    "must use the canonical record prototype",
  );
}

{
  const candidate = clone(request);
  Object.setPrototypeOf(candidate.bundle.artifacts, null);
  expectRejected(
    "inconsistent array prototype",
    candidate,
    [],
    "must use the canonical array prototype",
  );
}

console.log(`Supabase bundle executor deterministic checks: ${checks} passed.`);
