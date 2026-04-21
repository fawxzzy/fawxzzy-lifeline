# Wave 1 deploy contract

Wave 1 defines a narrow deploy contract for Lifeline release planning. It does not widen Lifeline into a hosted control plane. The contract exists so ops and rollback tooling can read one stable release record and so dry-run planning can be deterministic.

## Contract versions

- `atlas.lifeline.deploy-contract.v1`
- `atlas.lifeline.release-metadata.v1`
- `atlas.lifeline.deploy-dry-run.v1`

## Deploy manifest shape

The deploy manifest is a JSON object with:

- `contractVersion`
- `appName`
- `artifactRef` or `imageRef`
- `route.domain`
- `route.path` when the route is not rooted
- `envRefs`
- `healthcheckPath`
- `migrationHooks.preDeploy`
- `migrationHooks.postDeploy`
- `migrationHooks.rollback`
- `rollbackTarget.releaseId`
- `rollbackTarget.artifactRef`
- `rollbackTarget.strategy`

Canonical validation accepts `artifactRef` or `imageRef` on input and normalizes to `artifactRef` for downstream use.

## Release metadata shape

Release metadata is the persisted record ops and rollback tooling consume after a deploy decision. It keeps the normalized deploy contract plus:

- `releaseId`
- `dryRun`
- `createdAt`
- `validation.status`
- `validation.issues`

The persisted metadata stays JSON only, with no runtime-only state embedded.

## Dry-run path

The dry-run path is a pure planning path:

1. validate the deploy manifest
2. canonicalize `artifactRef`
3. assemble release metadata
4. preserve rollback target metadata unchanged

Dry-run planning must not mutate the input manifest or write state. It only emits a plan object and a release metadata preview.

## Schema files

- [`../../schemas/wave1-deploy-contract.schema.json`](../../schemas/wave1-deploy-contract.schema.json)
- [`../../schemas/wave1-release-metadata.schema.json`](../../schemas/wave1-release-metadata.schema.json)

