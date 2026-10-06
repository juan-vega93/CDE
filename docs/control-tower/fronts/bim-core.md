# BIM CORE

Updated: 2026-10-06 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 9cf51d4149da04d5d22140e5d999e4e9656d64e8 (phase baseline)
HEAD: daa144c059b63694e266d56745deaa320967307e (validated and pushed release; deployed server images). Functional checkpoint: 9c24abaaacf857aead81b568eca627d5f66fab40.

## Current phase

BIM background isolation patch prepared locally after server responsiveness incident. Release daa144c remains deployed; server acceptance remains open. Control Tower decision: GO WITH CONDITIONS; Git closure authorized on 2026-10-06. Push and deployment remain unauthorized. The closure commit is the commit carrying this live-state update; daa144c remains the deployed baseline.

## Status

IN PROGRESS

## Completed

- Phase 3K.2: stored-authoring-replicas@2 added alongside immutable @1. Exhaustive local MBM audit resolved 263 quantities; 1709 AEs lack native stored Metrado. Detailed evidence remains in phase checkpoint.
- Release gates and push to feat/bim-frag-pipeline completed. No merge or source changes during deployment.
- Server /opt/cde-portal detached at release daa144c. BFF/frontend release images running; frontend BUILD_ID F7oMOv43M9fo8qjuCef4P.
- Private backup at /home/userubuntu/cde-release-backups/20261005T164302: DB, configuration, old images and BFF data. Isolated restore succeeded. Migration rehearsal twice preserved counts in all 21 existing tables; production applied all five migration files.
- Authentication URL failure traced to absent KEYCLOAK_INTERNAL_URL. External release override now supplies server Keycloak URL; temporary frontend providers/session preflight passed before redeployment.
- One server OCI pilot generated /AR3173/_derived/_frags/36581418e8753f095c35d4930ed547b7.frag and published generation bf3ccda7-21c0-4627-a93e-a1be75727794: 7678 entities, 157327 properties, error_message null.

- Local corrective patch: FRAG preparation/hashing and property/authoring/quantity indexing execute in worker_threads, sharing one CPU slot and at most four admitted tasks (including active). Native diagnostics forwarding capped at16KiB per worker, suppressed byte count reported. Worker exit rejects the request; recovery targets only its failed building generation and processing job. Existing publication and quantity semantics unchanged.
- Final local verification: 296 BIM tests:293 passed/0 failed/3 canonical-data skips. Final Linux image:15 passed/0 failed/0 skipped, including actual BFF health under synchronous worker CPU load, valid IFC conversion, PostgreSQL publication, crash handling and guarded real FRAG HTTP delivery. Temporary PostgreSQL removed; existing services untouched.

## In progress

Review/commit coordination and controlled server deployment of isolation patch; real EST load/health benchmark and browser FRAG logical selection, visibility/ghost, 5D/schedule/CSV smoke. Full browser acceptance has not yet been supplied. No further model processing planned before pilot acceptance.

## Blocked

Closing audit 2026-10-06 originally recommended READY TO COMMIT=NO. Subsequent explicit Control Tower decision GO WITH CONDITIONS authorizes committing the existing patch without redesign. READY TO DEPLOY=NO; the following audit limitations remain recorded and are not represented as fixed. HTTP CPU isolation verified, but lifecycle guarantees require a narrow BIM correction/review: startup recovery marks stale jobs failed without reconciling building generations; publication and final job-ready update are separate transactions, leaving a published/processing window on abrupt worker exit; background admission failure after FRAG upload is only logged and does not persist an index failure/retry. No shutdown drain/cancellation handler or durable queue. These are distinguished from tested worker-error recovery with a known generation ID. Some windows predate this patch; no broad redesign required. Audit made no source changes. Control Tower accepted the private BIM-worker architecture for this phase; shared Documents integration and these limitations remain relevant to later rollout authorization.

Server EST completed37060 entities/199929 properties; health recovered from13.038911s to0.004363s. Separate Nextcloud createFolder failure remains unresolved. Original application-only rollback remains incompatible with the migrated schema. Server FRAG/5D smoke and EST benchmark of the new patch remain pending.
## Decisions

- Separate stored parameters, IFC quantities and viewer geometry. No QTO substitution, unit conversion or cross-revision matching.
- @2 quantity evidence requires one finite stored observation across the complete native component and one unequivocal unit; authoring membership/confidence unchanged.
- Server operator executes commands manually. Only portal BFF/frontend targeted; unrelated infrastructure untouched. No global reindex.
- Legacy FRAG metadata is not upgraded by assumption; two existing ARQ/EQM derivatives lack revision/hash provenance. New OCI pilot has explicit revision and FRAG hash.
- Server OCI is a different file/revision from the validated local MBM: do not transplant local totals or entity counts.

## Dependencies

- Server operator: browser smoke, read-only verification output and consistent rollback readiness.
- Model owner: contractual completeness, suspicious classifications, mixed units and placeholders.
- Documents/source storage and Keycloak are existing runtime dependencies; no changes to their domain responsibilities.

## Contracts / API changes

Existing 5D/metering routes accept @2 alongside @1; UI defaults @2, CSV retains policy version. Additional evidence: evaluationBasis=exclusive_entity_observation; quantityEvidence={localId,occurrenceIndex,componentLocalIds}. No new release endpoints.

## Database changes

Production migrations installed authoring contexts/elements/members, index scopes/generations and quantity observations. Generation publication constraints replace legacy global uniqueness with partial indexes; old BFF conflict targets are incompatible. Pre-pilot 41 models/47 jobs preserved; stale processing job was marked failed by startup recovery. Pilot published and operator SQL confirms 1 context, 7232 AEs, 7678 semantic members, 7115 graphical-present members, 142791 quantity observations, including 3268 numeric Datos_Partida.Metrado observations. Three stored observations lack entity_role; cause not yet investigated.

Pilot context: AR3173; modelKey /AR3173/3-WIPR/3-2-GRPH/3-2-6-BM/WORK/100021-JYS01-000-ZZZ-IFC-OCI-E3-000100.ifc; revisionId sha256:0d8ad1f2084df8e2cf5c52d40bda6435c02c6327c234d864ea49eae69e12068b.
FRAG SHA-256: fea5c8f2b9673d1b783e1d42189f0dc37c96b578879c98f0ee1b7cb7ca709230.

## Tests / Evidence

- BFF release suites on isolated PostgreSQL: 289 tests, 286 passed, 0 failed, 3 gated skips. Three canonical OCI gated tests separately: 3 passed, 0 failed/skipped. Typecheck/build passed.
- Frontend 16 viewer test files on Node24: 128 passed, 0 failed/skipped. Typecheck/build and both Docker builds passed. Initial Node20 runner lacked stripTypeScriptTypes; not counted as passing.
- Directed lint: canvas 7 errors/13 warnings matching baseline; Inspector and bff-client one warning each. No clean global lint claim. Diff/staged checks passed before release push.
- Server RESTORE_CHECK=OK; MIGRATION_REHEARSAL=OK twice; AUTH_PREFLIGHT=OK; DEPLOY_AUTH_CONFIG=OK (operator outputs).
- Pilot log: published generation above; elapsed 287.891 seconds including FRAG generation/upload and publication wait. Child process peak RSS 699264 KiB (682.875 MiB); not aggregate container peak. DB grew from 247790615 to 356531223 bytes (108740608 bytes); not a per-table size measurement.
- Pilot emitted zero-length geometry, BRep basis and Invalid IFC Line diagnostics. Publication success does not establish complete geometry or semantic extraction.

- Patch commands: npm run typecheck -w bff; npm run lint -w bff (tsc --noEmit); npm run build -w bff:PASS. git diff --check and git diff --cached --check:PASS. Linux BFF image build:PASS. Full BIM tests:node --import tsx --test --test-concurrency=1 over src/**/bim-*.test.ts from apps/bff against disposable PostgreSQL. Logs in local TEMP/bim-worker-regression-verified.log and bim-worker-linux-final.log.
- Initial validation attempts: tsx blocked by sandbox, rerun outside sandbox; wrong working directory caused missing fixtures, corrected; provenance hash-count test adapted to worker boundary. Final regression passes. Provenance fixture cleanup can log a background derivative foreign-key warning after its assertions; not represented as an assertion failure or as a production diagnosis.

## Risks

- Worker isolation patch is not deployed. No real EST memory/latency benchmark yet. Worker threads isolate the event loop, not total process memory or native-process crashes. Input IPC snapshots and queued buffers consume additional memory; return IFC snapshot is transferred, observations remain in worker/DB. Queue is bounded but not durable across process restart; existing orphan recovery remains in use. Does not solve the separate Nextcloud createFolder fetch failure or make IFC extraction faster by itself.

- Geometry completeness and actual browser FRAG logical behavior remain unverified; inspect affected model visually before closure.
- Legacy ARQ/EQM FRAGs have no verified canonical provenance; pilot success does not validate those artifacts.
- Old application-only rollback caused ON CONFLICT errors against new schema; do not reuse it as a functional fallback. Original backups remain available.
- Node engine/dependency warnings and historical lint debt remain; no npm audit fix performed.
- Local MBM policy results are not universal classification/contract validation. Server quantities require their own revision-specific evidence.

## Next milestone

Review and deploy the isolated-processing patch, measure HTTP responsiveness during EST processing, complete server UI smoke, then determine deployment verdict. No automatic next phase. Deferred: BIM Quality, workspace full-screen UX, advanced QTO/saved schedules/4D.

## Last checkpoint

Commit: functional 9c24abaaacf857aead81b568eca627d5f66fab40; release carrier daa144c059b63694e266d56745deaa320967307e.
Checkpoint document: [2026-10-05-bim-background-isolation.md](../checkpoints/bim-core/2026-10-05-bim-background-isolation.md), PARTIAL/uncommitted patch. Previous release checkpoint: [2026-10-05-fase-3k2.md](../checkpoints/bim-core/2026-10-05-fase-3k2.md). Server release closure remains pending.
