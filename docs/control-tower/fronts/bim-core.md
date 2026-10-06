# BIM CORE

Updated: 2026-10-06 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 90d8a030ca100f6f88d9ceebf57b040334d5a717 (this phase)
HEAD: 90d8a030ca100f6f88d9ceebf57b040334d5a717 (pre-commit snapshot; closure is the commit carrying this document)

## Current phase

BIM Graphical Representation — Minimal. Local implementation complete; server deployment and visual acceptance require Control Tower gate. No push or deployment performed in this phase.

## Status

READY FOR CHECKPOINT

## Completed

- Pure batch semantic-to-graphical resolver: direct geometry first, otherwise persisted IfcRelAggregates; deterministic targets, deduplication, cycle rejection and explicit evidence.
- Read-only revision-aware endpoint reuses authoring composition evidence and geometry status without changing Authoring membership, corroboration, quantities or Property Index.
- Parameters and SmartView share the runtime resolver. Color/hide use full resolved target sets, including overlaps; semantic counts and Sin valor remain unchanged.
- Context-scoped promise cache coalesces bucket requests, limits batches to 2048 IDs and retries failed reads. Runtime geometry intersects returned targets.
- Local PostgreSQL integration and regression gates completed on a disposable database. Both application builds/typechecks pass. No production data accessed or changed.

## In progress

Control Tower review and subsequent operator-run EST/OCI visual acceptance. No claim of server deployment or full 107-wall/163-anchor reproduction in this phase.

## Blocked

None for local implementation. Server acceptance depends on Control Tower authorization and operator evidence.

## Decisions

- Graphical representation is separate from Authoring identity. Rejected Authoring compositions remain rejected.
- Only IfcRelAggregates is supported; no class/name/Tag/spatial heuristics and no IfcRelNests.
- Backend evidence is restricted to the currently published revision; 409 for unavailable/mismatched context. Frontend further confirms runtime membership.
- No global cache. Resolver cache lasts for the loaded-model resolver instance and is keyed by project/model/revision.
- 5D visual fallback and unconditional legacy has_geometry correction deferred; neither is needed for this scoped change.

## Dependencies

- Control Tower and server operator: coordinated BFF/frontend release and manual acceptance. Deploying the new frontend against old BFF would leave the new endpoint unavailable.
- Existing canonical FRAG/IFC provenance and published authoring context must be available. Legacy FRAGs without verified context retain direct-only rendering.
- Documents/source storage and authentication remain external runtime dependencies. No Issues/PDF/GIS/Quality/Platform changes.

## Contracts / API changes

POST /api/bim-index/graphical-representation accepts projectCode, canonical modelKey, revisionId and up to 2048 localIds. Returns context, generationId and per-semantic resolution (direct/structural_delegate/unresolved), graphicalLocalIds and relation evidence. Read-only; existing application authentication/project access wrapper applies. Invalid input:400; no matching published context:409.

## Database changes

None in this phase. Reads existing authoring contexts/members/composition_evidence and published generation elements in one read-only snapshot; three queries per batch. No migration, backfill or reindex.

## Tests / Evidence

- BFF: node --import tsx --test --test-concurrency=1 over src/**/bim-*.test.ts from apps/bff with disposable PostgreSQL:304 tests,301 passed,0 failed,3 gated real-OCI skips.
- Frontend: node --test --test-concurrency=1 over viewer-ifc *.test.mjs:135 passed,0 failed,0 skipped.
- npm run typecheck -w bff; npm run typecheck -w frontend; npm run build -w bff; npm run build -w frontend:PASS.
- npm run lint -w bff:PASS. Directed ESLint on the four graphical library/test files:PASS. Canvas:7 pre-existing errors/12 warnings; no new diagnostics compared with HEAD (7 errors/13 warnings).
- git diff --check:PASS before documentation closure; final staged check recorded with commit delivery.
- User-provided EST evidence reproduced as tests:125->145,697->710,758->771,819->832,1246->1291; standalone83541 direct. This does not re-run real IFC/FRAG extraction.
- Local two-entity fixture graphics read:first observed6.631ms,warm5.433ms,return5.467ms. Not a cold-database or server-scale benchmark.

## Risks

- All 107 Muro de contención mappings and 163 Anclaje results still require server confirmation; only supplied five pairs and one direct example are represented by tests.
- Shared targets may receive colors from multiple semantic buckets; visual color precedence needs manual validation. Hidden policies continue composing through the existing coordinator.
- Each uncached batch reads model-wide facts/evidence; query count is bounded, row volume scales with model size. EST latency/memory not measured here.
- A changed publication for the same loaded revision can leave the local resolver cache stale until model/resolver reload. No global invalidation service introduced.
- Background isolation lifecycle limitations from the previous checkpoint remain deferred; this phase does not alter worker recovery. Historical frontend lint debt remains.
- Legacy application rollback against migrated schema remains unsafe; do not reuse old BFF as a schema-compatible rollback assumption.

## Next milestone

Control Tower release gate, then manual EST Parameters/SmartView color-hide-select/ghost/federation checks and server cold/warm timing. No automatic next phase.

## Last checkpoint

Commit: the commit carrying this document (parent90d8a030ca100f6f88d9ceebf57b040334d5a717).
Checkpoint document: [2026-10-06-graphical-representation-minimal.md](../checkpoints/bim-core/2026-10-06-graphical-representation-minimal.md).
