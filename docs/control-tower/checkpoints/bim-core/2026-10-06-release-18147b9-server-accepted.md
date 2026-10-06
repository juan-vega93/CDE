# BIM CORE — release 18147b9 accepted on server

FRONT: BIM CORE
PHASE: Post-deployment closure — release 18147b9
BRANCH: feat/bim-frag-pipeline
BASE: BFF 90d8a030ca100f6f88d9ceebf57b040334d5a717; frontend daa144c059b63694e266d56745deaa320967307e
HEAD: 18147b96ada46bfd26dd44bff49a11458c1726e0 (functional source; documentary closure is the commit carrying this checkpoint)

STATUS: COMPLETE

IMPLEMENTED:

- Release 18147b9 deployed as cde-portal-bff:release-18147b9 and cde-portal-frontend:release-18147b9.
- POST_SWITCH_TECHNICAL_GATE = PASS per operator/user acceptance: exact images, BFF /health 200, preserved state bind, KEYCLOAK_INTERNAL_URL and PostgreSQL, clean startup for both services, no migration, reindex or FRAG regeneration.
- Prior background processing acceptance retained: heavy IFC processing outside HTTP thread; /health stayed 200; BFF responded; job progressed; no OOM/restarts. No heavy processing repeated during documentary closure.
- GRAPHICAL_REPRESENTATION_SERVER_GATE = PASS. User manually validated color, hide/show, selection, active graphical resolution, functional SmartView and Parameters.
- Graphical representation and Authoring identity remain separate. Authoring corroboration and singleton_fallback unchanged; Quantity Provenance, quantity policies, 5D totals and Metrados semantics unchanged. Graphical target counts are not new semantic element counts or quantities.

SERVER EVIDENCE (supplied by user; not independently re-executed in this closure):
- Model: 100021-JYS01-000-ZZZ-IFC-EST-E3-100300.ifc.
- Revision: sha256:02bdd48c83ae23f6514c5ec99dde75bfad20b016e1facee1d6a8fa04da892fc0.
- Muro de contencion before: 107 semantic elements / 0 geometries.
- Muro de contencion after: 107 semantic elements / 563 geometries.
- Anclaje: 163 semantic elements / 163 geometries.
- These observed counts replace the pending full-bucket acceptance in the implementation checkpoint; that immutable checkpoint is preserved unchanged.

STRUCTURAL EVIDENCE (previously checked IFC + web-ifc + FRAG):

| Semantic parent | Graphical child | IfcRelAggregates |
| ---: | ---: | ---: |
|125|145|147|
|697|710|711|
|758|771|772|
|819|832|833|
|1246|1291|1293|

All five: IfcWall semantic parent without Representation/direct mesh, FRAG item non-graphical; child IfcBuildingElementPart has valid Representation, positive StreamMeshes and GetFlatMesh, FRAG geometry and correct GUID/localId mapping.
GRAPHICAL_DELEGATION_GATE = CONFIRMED.

OPERATIONAL MILESTONE:
IFC = operational
FRAG = operational
federation = operational
selection = operational
measurement = operational
properties = operational
Parameters = operational
SmartViews = operational
AuthoringElement = operational
Quantity Provenance = operational
5D = operational with documented pending/ambiguous cases
Metrados = operational
background processing = operational
graphical representation = operational
Quality = excluded; separate future front

FILES/DOMAINS TOUCHED:

- docs/control-tower/fronts/bim-core.md
- docs/control-tower/checkpoints/bim-core/2026-10-06-release-18147b9-server-accepted.md
- Documentary closure only; no functional source changes. Prior checkpoints preserved. Protected GeoBIM document not opened, modified or staged.

DATABASE CHANGES: NONE. No migration, reindex, FRAG regeneration or server writes in this closure.

API/CONTRACT CHANGES: NONE in closure. Release uses revision-aware POST /api/bim-index/graphical-representation; no changes to Authoring or quantity contracts.

TESTS:

- Prior pre-deploy validation on exact source 18147b96: 304 BIM BFF tests, 301 pass, 0 fail, 3 skipped with real temporary PostgreSQL; 135 frontend viewer tests, all pass.
- Skips: real OCI Authoring/5D/Schedule integration; rootless resolve/tree transport; published OCI observations/policy@2. Not represented as passing in that run.
- npm run typecheck -w bff; npm run typecheck -w frontend; npm run build -w bff; npm run build -w frontend: PASS in pre-deploy gate.
- npm run lint -w bff and directed graphical library/test ESLint: PASS. Canvas baseline 7 errors/13 warnings; source HEAD 7 errors/12 warnings; new violations 0. Control Tower: LINT_GATE=PASS_WITH_BASELINE_DEBT; CONTROL_TOWER_DEPLOY_GATE=APPROVED_WITH_OBSERVATIONS.
- This documentary phase does not rerun application tests or builds. git diff --check and git diff --cached --check: PASS before commit; branch, sourceHEAD and tracked cleanliness checked before editing.

KNOWN RISKS:

- EST/Revit Parts: semantic parent -> IfcRelAggregates -> one/multiple IfcBuildingElementPart; properties may be on parent, Part or both. Some 5D partidas remain Pendiente. Do not classify them as CDE bugs without a subsequent audit through Revit -> IFC parent/Parts -> property location -> QuantityObservation -> AuthoringElement -> 5D policy. OCI has demonstrated correct 5D behavior with sufficient authoring/quantity evidence; this is not a universal completeness guarantee.
- BIM INDEX READ PERFORMANCE / COLD-WARM CACHE ANALYSIS: initial SmartViews/Parameters/5D reads may be slow; later improvement is observed but no sufficient production benchmark exists. No optimization implemented.
- has_geometry remains known debt; not authoritative for geometry. No correction here.
- Prior worker lifecycle/cache-refresh limitations and historical lint debt remain documented; server acceptance does not assert their removal.

DEPENDENCIES:

- Operator/user evidence establishes this server acceptance.
- Control Tower must authorize planning for subsequent development.
- Model owner/Revit evidence required for future EST Parts audit.
- Existing Documents/storage, authentication and IFC/FRAG provenance dependencies unchanged; no other-front responsibility changes.

DEFERRED:

- EST Parts/quantity-location audit.
- Production cold-warm read benchmark and any resulting optimization.
- has_geometry correction.
- Quality and any other development until a new planning gate.

WORKING TREE:

- Initial branch feat/bim-frag-pipeline; HEAD 18147b96ada46bfd26dd44bff49a11458c1726e0; tracked and staging clean.
- Only two BIM CORE documents included in this closure commit.
- docs/diagnostico-integracion-avance-geobim.md remains unrelated, untracked, untouched and outside commit.

PUSH STATUS:

- Functional source 18147b96ada46bfd26dd44bff49a11458c1726e0 previously pushed; local and origin/feat/bim-frag-pipeline equality verified in remote-checkpoint phase and cached remote ref checked again before closure.
- This documentary commit: NOT PUSHED by instruction. No new remote commands or deployment performed during closure.

RELEASE: 18147b9
SOURCE: 18147b96ada46bfd26dd44bff49a11458c1726e0
DEPLOYMENT STATUS: ACCEPTED
ROLLBACK REQUIRED: NO
REINDEX REQUIRED: NO
FRAG REGEN REQUIRED: NO
BRANCH STRATEGY: retain feat/bim-frag-pipeline for stabilization; no merge, rebase, cherry-pick or new branch.
READY FOR INTEGRATION: YES (accepted BIM CORE milestone; does not authorize merge or further development).

VEREDICT: BIM CORE RELEASE 18147b9 = ACCEPTED
