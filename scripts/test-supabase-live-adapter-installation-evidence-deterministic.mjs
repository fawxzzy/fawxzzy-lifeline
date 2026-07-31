import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  getCanonicalSupabaseLiveAdapterInstallationBlockedResult,
  getCanonicalSupabaseLiveAdapterInstallationEvidenceRequest,
  planSupabaseLiveAdapterInstallation,
  validateSupabaseLiveAdapterInstallationEvidenceRequest,
} from "../dist/core/supabase-live-adapter-installation-evidence.js";

const fixturePath = fileURLToPath(
  new URL(
    "../examples/privileged-execution/supabase-live-adapter-installation-evidence.blocked.json",
    import.meta.url,
  ),
);

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(stable(value), null, 2);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getAt(root, path) {
  let cursor = root;
  for (const segment of path) {
    cursor = cursor[segment];
  }
  return cursor;
}

function setAt(root, path, value) {
  const parent = getAt(root, path.slice(0, -1));
  parent[path.at(-1)] = value;
}

function collectLocations(value, path = [], locations = []) {
  if (Array.isArray(value)) {
    locations.push({ kind: "array", path });
    value.forEach((entry, index) =>
      collectLocations(entry, [...path, index], locations),
    );
    return locations;
  }
  if (value !== null && typeof value === "object") {
    locations.push({ kind: "object", path });
    for (const [key, entry] of Object.entries(value)) {
      collectLocations(entry, [...path, key], locations);
    }
    return locations;
  }
  locations.push({ kind: "leaf", path });
  return locations;
}

function replacementFor(value, marker) {
  if (value === null) {
    return marker;
  }
  if (typeof value === "boolean") {
    return !value;
  }
  if (typeof value === "number") {
    return value + 1;
  }
  if (typeof value === "string") {
    return `${value}-${marker}`;
  }
  throw new Error("Unsupported leaf type.");
}

let assertions = 0;

function check(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

function expectRejected(candidate, label, marker) {
  let adapterCalls = 0;
  let result;
  assert.doesNotThrow(() => {
    result = planSupabaseLiveAdapterInstallation(candidate, {
      installReadyEvidence() {
        adapterCalls += 1;
      },
    });
  }, `${label} must not throw`);
  check(result.request_valid === false, `${label} must be invalid`);
  check(result.plan === null, `${label} must not produce a plan`);
  check(result.receipt === null, `${label} must not produce a receipt`);
  check(result.failures.length > 0, `${label} must return failures`);
  check(adapterCalls === 0, `${label} must not invoke the adapter`);
  check(result.adapter_invocations === 0, `${label} must report zero calls`);
  if (marker !== undefined) {
    check(
      !result.failures.join("\n").includes(marker),
      `${label} must not echo candidate content`,
    );
  }
}

const request = getCanonicalSupabaseLiveAdapterInstallationEvidenceRequest();
const expectedResult =
  getCanonicalSupabaseLiveAdapterInstallationBlockedResult();
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const expectedFixture = {
  blocker_codes: expectedResult.plan.blockers.map(({ code }) => code),
  contract_version: request.contract_version,
  evidence_denominator: expectedResult.plan.evidence_denominator,
  lifecycle: expectedResult.plan.lifecycle,
  live_facts: {
    adapter_installation: request.adapter.current_installation_state,
    credentials: request.credentials.current_live_state,
    data_api_reader: request.data_api_reader.current_live_state,
    inverse_capabilities: [
      ...new Set(
        request.inverse_capabilities.map(
          ({ current_live_state }) => current_live_state,
        ),
      ),
    ],
    trust_domains: [
      ...new Set(
        request.trust_domains.map(
          ({ current_installation_state }) => current_installation_state,
        ),
      ),
    ],
  },
  receipt_sha256: expectedResult.receipt.receipt_sha256,
  status: expectedResult.plan.status,
};

check(
  `${stableJsonStringify(fixture)}\n` ===
    `${stableJsonStringify(expectedFixture)}\n`,
  "blocked fixture must exactly match the canonical blocked projection",
);
check(
  validateSupabaseLiveAdapterInstallationEvidenceRequest(request).length === 0,
  "canonical request must validate",
);

let adapterCalls = 0;
const validResult = planSupabaseLiveAdapterInstallation(request, {
  installReadyEvidence() {
    adapterCalls += 1;
  },
});
check(
  stableJsonStringify(validResult) === stableJsonStringify(expectedResult),
  "canonical request must return the canonical BLOCKED result",
);
check(adapterCalls === 0, "canonical BLOCKED request must not invoke adapter");
check(
  validResult.request_valid,
  "canonical request must be structurally valid",
);
check(validResult.plan?.status === "BLOCKED", "plan must remain BLOCKED");
check(
  validResult.plan?.lifecycle?.execution === "EXECUTION_BLOCKED",
  "execution must remain blocked",
);
check(
  validResult.plan?.lifecycle?.apply_admitted === false,
  "apply authority must remain false",
);
check(
  validResult.plan?.evidence_denominator?.trust_domain_count === 12,
  "trust denominator must remain 12",
);
check(
  validResult.plan?.evidence_denominator?.inverse_capability_count === 7,
  "inverse denominator must remain 7",
);
check(
  validResult.plan?.blockers?.length === 7,
  "all seven blocker categories must remain present",
);

const isolationBaseline =
  getCanonicalSupabaseLiveAdapterInstallationBlockedResult();
const isolationPlanJson = stableJsonStringify(isolationBaseline.plan);
const isolationReceiptJson = stableJsonStringify(isolationBaseline.receipt);
const isolationReceiptSha256 = isolationBaseline.receipt.receipt_sha256;
const isolationBlockersJson = stableJsonStringify(
  isolationBaseline.plan.blockers,
);

const mutationIsolationCases = [
  {
    label: "blocker array pop",
    mutate(result) {
      result.plan.blockers.pop();
    },
  },
  {
    label: "blocker array push",
    mutate(result) {
      result.plan.blockers.push({
        category: "MUTATED",
        code: "DO_NOT_PERSIST",
        path: "result.plan.blockers",
      });
    },
  },
  {
    label: "blocker array splice",
    mutate(result) {
      result.plan.blockers.splice(1, 2);
    },
  },
  {
    label: "blocker object mutation",
    mutate(result) {
      result.plan.blockers[0].code = "DO_NOT_PERSIST";
    },
  },
  {
    label: "nested result mutation",
    mutate(result) {
      result.plan.evidence_denominator.trust_domain_count = 0;
      result.plan.lifecycle.execution = "DO_NOT_PERSIST";
      result.receipt.lifecycle.execution = "DO_NOT_PERSIST";
    },
  },
];

for (const { label, mutate } of mutationIsolationCases) {
  const mutableResult =
    getCanonicalSupabaseLiveAdapterInstallationBlockedResult();
  mutate(mutableResult);

  let isolationAdapterCalls = 0;
  const laterResult = planSupabaseLiveAdapterInstallation(request, {
    installReadyEvidence() {
      isolationAdapterCalls += 1;
    },
  });

  check(laterResult.request_valid === true, `${label} must preserve validity`);
  check(
    stableJsonStringify(laterResult.plan?.blockers) === isolationBlockersJson,
    `${label} must preserve later blocker count and contents`,
  );
  check(
    stableJsonStringify(laterResult.plan) === isolationPlanJson,
    `${label} must preserve later canonical plan bytes`,
  );
  check(
    stableJsonStringify(laterResult.receipt) === isolationReceiptJson,
    `${label} must preserve later canonical receipt bytes`,
  );
  check(
    laterResult.receipt?.receipt_sha256 === isolationReceiptSha256,
    `${label} must preserve later canonical receipt digest`,
  );
  check(
    laterResult.adapter_invocations === 0 && isolationAdapterCalls === 0,
    `${label} must preserve zero installer calls`,
  );
}

const locations = collectLocations(request);
const leaves = locations.filter(({ kind }) => kind === "leaf");
const containers = locations.filter(({ kind }) => kind !== "leaf");

leaves.forEach(({ path }, index) => {
  const candidate = clone(request);
  const marker = `leaf-marker-${index}`;
  const original = getAt(candidate, path);
  setAt(candidate, path, replacementFor(original, marker));
  expectRejected(candidate, `leaf mutation ${index}`, marker);
});

containers.forEach(({ kind, path }, index) => {
  const marker = `container-marker-${index}`;

  const extra = clone(request);
  getAt(extra, path)[marker] = marker;
  expectRejected(extra, `${kind} extra key ${index}`, marker);

  const nonEnumerable = clone(request);
  Object.defineProperty(getAt(nonEnumerable, path), marker, {
    configurable: true,
    enumerable: false,
    value: marker,
    writable: true,
  });
  expectRejected(nonEnumerable, `${kind} non-enumerable key ${index}`, marker);

  const symbolic = clone(request);
  Object.defineProperty(getAt(symbolic, path), Symbol(marker), {
    configurable: true,
    enumerable: true,
    value: marker,
    writable: true,
  });
  expectRejected(symbolic, `${kind} symbol key ${index}`, marker);

  if (path.length === 0) {
    expectRejected(new Proxy(clone(request), {}), `${kind} proxy ${index}`);
  } else {
    const proxied = clone(request);
    setAt(proxied, path, new Proxy(getAt(proxied, path), {}));
    expectRejected(proxied, `${kind} proxy ${index}`, marker);
  }
});

const inherited = clone(request);
Object.setPrototypeOf(inherited.adapter, { inherited_marker: "do-not-echo" });
expectRejected(inherited, "inherited property representation", "do-not-echo");

const accessor = clone(request);
let getterInvoked = false;
Object.defineProperty(accessor.credentials, "connection_secret_ref", {
  configurable: true,
  enumerable: true,
  get() {
    getterInvoked = true;
    throw new Error("do-not-echo-accessor");
  },
});
expectRejected(accessor, "throwing canonical accessor", "do-not-echo-accessor");
check(getterInvoked === false, "descriptor rejection must not invoke getters");

const descriptorDrift = clone(request);
Object.defineProperty(descriptorDrift.adapter, "identity", {
  configurable: false,
  enumerable: true,
  value: descriptorDrift.adapter.identity,
  writable: true,
});
expectRejected(descriptorDrift, "descriptor drift");

const cyclic = clone(request);
cyclic.adapter.build_sha256 = cyclic;
expectRejected(cyclic, "cyclic candidate");

const bigint = clone(request);
bigint.adapter.build_sha256 = 1n;
expectRejected(bigint, "BigInt candidate");

const throwingProxy = new Proxy(clone(request), {
  ownKeys() {
    throw new Error("do-not-echo-proxy-trap");
  },
});
expectRejected(throwingProxy, "throwing root proxy", "do-not-echo-proxy-trap");

process.stdout.write(
  `Supabase live-adapter installation evidence verification passed (${assertions}/${assertions}).\n`,
);
