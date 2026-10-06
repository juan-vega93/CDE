# BIM Graphical Representation — Minimal

FRONT: BIM CORE
PHASE: Graphical Representation — Minimal
BRANCH: feat/bim-frag-pipeline
BASE: 90d8a030ca100f6f88d9ceebf57b040334d5a717
HEAD: 90d8a030ca100f6f88d9ceebf57b040334d5a717 (verified pre-commit snapshot; closure commit carries this checkpoint)

STATUS: COMPLETE (local implementation; server acceptance pending)

IMPLEMENTED:
- Pure batch resolver with direct/structural_delegate/unresolved results, context and relation evidence.
- Direct geometry wins; only IfcRelAggregates delegation, deduplicated confirmed targets and cycle rejection.
- Three read-only queries per batch reuse published revision and persisted composition evidence, including rejected Authoring fallback relations. No Authoring relaxation.
- Authenticated/project-scoped POST /api/bim-index/graphical-representation;2048 IDs maximum;409 for unavailable published revision/context.
- Shared Parameters/SmartView runtime resolution; full color/hide target sets. Runtime universe confirms API targets. Semantic counts, Sin valor and original property membership remain unchanged.
- Per-resolver revision-scoped cache and bounded/coalesced batches; failed requests retryable.

FILES/DOMAINS TOUCHED:
- BFF:services/bim-graphical-representation.ts and .test.ts;db/bim-graphical-representation.ts and .integration.test.ts;routes/bim-graphical-representation.routes.ts;routes/bim-index.routes.ts.
- Frontend viewer-ifc:lib/parameter-graphics.ts and .test.mjs;lib/load-graphical-representation.ts and .test.mjs;components/ifc-viewer-canvas.tsx.
- BIM CORE front state and this checkpoint only. GeoBIM document excluded and untouched.

DATABASE CHANGES: NONE. No production writes, schema changes, reindex, backfill or FRAG regeneration. Integration fixture used disposable local PostgreSQL only.

API/CONTRACT CHANGES:
- Request:projectCode,canonical modelKey,revisionId,localIds.
- Response:context,generationId,results[{semanticLocalId,resolution,graphicalLocalIds,evidence:{relations,reason?}}]. Relations retain IFC relation type/localId,parent and children.
- Bad input400; missing/mismatched published context409. Existing endpoint contracts unchanged.
- New frontend requires new BFF endpoint. IFC and verified FRAG use the same runtime graphical-membership contract; legacy unverified context remains direct-only.

TESTS:
- node --import tsx --test --test-concurrency=1 over BFF src/**/bim-*.test.ts, cwd apps/bff, temporary DATABASE_URL:304 total;301 pass;0 fail;3 skip (gated real OCI). PostgreSQL integration actually executed.
- node --test --test-concurrency=1 over frontend viewer-ifc *.test.mjs:135 pass;0 fail;0 skip.
- npm run typecheck -w bff / -w frontend:PASS.
- npm run build -w bff / -w frontend:PASS.
- npm run lint -w bff:PASS(tsc). Directed ESLint on graphical libraries/tests:PASS. Canvas7 errors/12 warnings;all diagnostics pre-existing;baseline7/13. No clean canvas lint claim.
- git diff --check:PASS before closure. Staged check must pass before commit.
- Tests cover five supplied EST pairs, direct83541, mixed children, repeated edges, unsupported nests, missing facts, cycles, diamond, deterministic output,direct precedence,model/revision isolation,4500IDs in2048/2048/404 batches,retry,HTTP validation,published revision gating and unchanged Authoring rows.
- Existing regressions cover Authoring,visibility,logical selection,5D selection,quantity provenance/policies and metering. Wiring assertions cover Parameters/SmartView and unchanged summary counts; they do not substitute for a browser smoke test.
- Initial runs with incorrect cwd produced fixture ENOENT; corrected. New test project normalization mismatch corrected. Final suite above passed.

LOCAL LATENCY EVIDENCE (milliseconds; two-entity synthetic DB fixture, not server EST; first observed is not a flushed cold database):
| Phase | Catalog | Summary | Query | Graphics |
| --- | ---: | ---: | ---: | ---: |
| First observed |19.585|7.453|5.655|6.631|
| Same property warm |8.034|5.279|5.478|5.433|
| Other property |8.938|5.823|4.912|4.349|
| Return previous |7.166|4.932|4.900|5.467|

KNOWN RISKS:
- No real-server full bucket count/latency/memory or color overlap precedence validation in this phase. Backend reads model-wide facts/evidence per uncached batch;bounded query count does not imply constant data volume.
- Same-revision republishing can require loaded-model refresh to discard cached resolutions.
- Historical canvas lint debt and previously documented background-worker lifecycle/rollback limitations remain.

DEPENDENCIES:
- Control Tower deployment gate and operator-run manual acceptance; no independent server execution.
- Published canonical context and persisted geometry evidence,plus matching runtime graphical IDs.
- No changes in Documents,Issues/PDF,GIS,Quality or Platform responsibilities.

DEFERRED:
- 5D visual fallback;5D policies/totals remain unchanged.
- Legacy unconditional has_geometry correction;it is not used as graphical truth here.
- IfcRelNests,global SQL optimization,cache invalidation service and full server measurement.

MANUAL SERVER VALIDATION PREPARED (do not execute before deployment gate):
1. Confirm paired BFF/frontend release and verified EST FRAG context match published revision sha256:02bdd48c83ae23f6514c5ec99dde75bfad20b016e1facee1d6a8fa04da892fc0,project AR3173,model /AR3173/3-WIPR/3-2-GRPH/3-2-2-SE/WORK/100021-JYS01-000-ZZZ-IFC-EST-E3-100300.ifc.
2. Batch resolve125,697,758,819,1246,83541;check targets145,710,771,832,1291,83541 and preserved Authoring fallback identity.
3. Parameters:Muro de contención semantic107 unchanged;derive actual graphical count from complete evidence,do not assume107. Confirm Anclaje163 semantic/163 graphical on the full dataset;only example83541 is locally fixture-tested.
4. Color/hide/show/select same bucket;check Sin valor and overlapping targets,previous hidden states,ghost,manual picking and federated models. SmartView should resolve the same targets. Check existing5D totals/selection unchanged.
5. Capture catalog/summary/query/graphics first visit,same property,and return timings through browser Network;compare with runtime state. No production reindex or FRAG regeneration needed for this verification.

WORKING TREE: pre-commit eleven implementation/test files plus BIM CORE live state/checkpoint;only pre-existing unrelated untracked docs/diagnostico-integracion-avance-geobim.md must remain outside commit.

PUSH STATUS: NOT PUSHED. No deployment,merge,rebase or cherry-pick. No npm audit fix or docker compose down -v.

READY FOR INTEGRATION: NO (Control Tower release gate and real-server visual acceptance pending;local implementation ready for review).
