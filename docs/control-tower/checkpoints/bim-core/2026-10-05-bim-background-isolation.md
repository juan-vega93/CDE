FRONT: BIM CORE
PHASE: Background isolation corrective patch
BRANCH: feat/bim-frag-pipeline
BASE: daa144c059b63694e266d56745deaa320967307e
HEAD: daa144c059b63694e266d56745deaa320967307e (patch uncommitted)

STATUS: PARTIAL

IMPLEMENTED:
- Server FRAG preparation/hashing and index extraction/persistence dispatched to worker_threads through one shared FIFO CPU slot; four admitted tasks maximum, excess rejected.
- Existing source acquisition/Nextcloud upload/derivative cache remain in HTTP process. IFC snapshot/revision preserved across conversion and indexing; no second source download. Observations are not serialized back to HTTP; prepared IFC buffer transferred back rather than cloned again.
- Worker errors/exits reject; failed building generation and its processing job reconciled without downgrading completed publication. Existing index timeout/cancellation retained inside worker.
- Native diagnostic forwarding bounded to16KiB per worker with suppressed byte count. No inline CPU fallback.

FILES/DOMAINS TOUCHED:
- apps/bff/src/services/bim-background-runner.ts: bounded sequential worker lifecycle/log forwarding.
- apps/bff/src/services/bim-background-processing.ts: task contracts, wrappers and generation-specific failure recovery.
- apps/bff/src/services/bim-processing.worker.ts: actual IFC/FRAG/hash/index execution.
- apps/bff/src/services/documents.service.ts: route both heavy entry points through background wrappers.
- apps/bff/src/services/bim-property-indexer.service.ts: optional generation-created notification for crash recovery.
- apps/bff/src/services/bim-background-runner.test.ts and bim-background-processing.test.ts: seven new tests/subtests.
- apps/bff/src/services/bim-provenance.integration.test.ts: hash-spy assertion adapted to new thread boundary; exact IFC/FRAG digest and HTTP assertions retained.
- BIM CORE live front and this checkpoint only. No frontend/PDF/domain integration changes.

DATABASE CHANGES:
- No migration/schema change. Existing generation/job failure recovery only.
- Tests used isolated PostgreSQL container bim-worker-patch-test-db; removed after completion. No server DB mutation.

API/CONTRACT CHANGES:
- No public endpoint or quantity-policy change. Existing generation/index calls retain results; queued execution is serial across conversion and indexing. Over-capacity background work rejects explicitly.

TESTS:
- Full BIM regression from apps/bff: node --import tsx --test --test-concurrency=1 over src/**/bim-*.test.ts; actual disposable PostgreSQL:296 tests,293 passed,0 failed,3 canonical-data skips. Those three were not run against server/local canonical DB in this patch.
- Final Linux image cde-bim-worker:validation: worker/processing/provenance tests15 passed,0 failed,0 skipped; covers BFF /health while CPU worker spins, valid IFC to real FRAG, source-revision changes, PostgreSQL publication/AE/QP, crash recovery and guarded HTTP delivery.
- Compiled-JS worker tests on host:7 passed,0 failed,0 skipped. Typecheck/lint/build BFF passed (lint script is tsc --noEmit); Docker Linux build passed; diff/check and cached/check passed.
- Initial attempts failed on sandbox tsx startup, wrong fixture cwd and old main-thread hash-count expectations. Corrected validation environment/test expectations; final runs above pass. Fixture teardown emits a caught asynchronous derivative FK warning; no claim that all log warnings are eliminated.
- Logs: local TEMP/bim-worker-regression-verified.log; bim-worker-linux-final.log; bim-worker-docker-build.log.

KNOWN RISKS:
- No deployment or real EST benchmark of patch yet. Workers isolate JS event loop, not process OOM/native crash; queued IFC snapshots have memory cost. Queue not durable across restart; existing startup orphan recovery remains.
- Separate server Nextcloud createFolder fetch failure is not fixed. FRAG legacy provenance limitations remain. Thread isolation does not promise faster extraction.
- Before patch, server EST published37060 entities/199929 properties in about56 minutes. /health13.038911s during processing vs0.004363s afterwards; strong load association, no exact hot-path profile.

DEPENDENCIES:
- Server operator performs SSH actions; controlled rollout and manual FRAG/5D smoke pending.
- Control Tower coordinates eventual PDF integration separately; no merge/rebase/cherry-pick here.

DEFERRED:
- Durable distributed worker service; server performance validation; PDF integration; unrelated feature backlog.

WORKING TREE:
- Uncommitted BFF patch and BIM CORE docs. No staged changes. Protected docs/diagnostico-integracion-avance-geobim.md remains untracked and untouched.

PUSH STATUS: No new commit or push; deployed baseline remains daa144c.

READY FOR INTEGRATION: NO
- Local patch validated and ready for review/checkpoint; commit/rollout coordination and server acceptance pending.
