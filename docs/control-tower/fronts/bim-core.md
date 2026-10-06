# BIM CORE

Updated: 2026-10-06 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 90d8a030ca100f6f88d9ceebf57b040334d5a717 (previous BFF); daa144c059b63694e266d56745deaa320967307e (previous frontend)
HEAD: 18147b96ada46bfd26dd44bff49a11458c1726e0 (functional release; documentary closure is the commit carrying this update)

## Current phase

Post-deployment closure of release 18147b9. DEPLOYMENT STATUS: ACCEPTED. BFF and frontend use release-18147b9. Server acceptance below is supplied by the user; this documentary closure performs no remote execution or new processing.

## Status

COMPLETE

## Completed

- POST_SWITCH_TECHNICAL_GATE = PASS: exact Docker images, BFF /health HTTP 200, preserved state bind, KEYCLOAK_INTERNAL_URL and PostgreSQL; clean BFF/frontend startup; no migration, reindex or FRAG regeneration (operator evidence).
- Prior background validation retained: heavy IFC processing outside HTTP thread, /health HTTP 200 throughout processing, BFF responsive, job progressing, no OOM/restarts. Not repeated for this closure.
- GRAPHICAL_REPRESENTATION_SERVER_GATE = PASS: EST Muro de contencion changed from 107 semantic elements/0 geometries to 107/563. Anclaje remains 163/163. User confirms correct color, hide/show, selection and functional Parameters/SmartView.
- Graphical resolver remains separate from Authoring: direct geometry first, otherwise persisted IfcRelAggregates; revision-aware batch endpoint and runtime confirmation. Authoring corroboration, singleton_fallback, Quantity Provenance, quantity policies, 5D totals and Metrados semantics unchanged by this release.
- Operational milestone: IFC, FRAG, federation, selection, measurement, properties, Parameters, SmartViews, AuthoringElement, Quantity Provenance, Metrados, background processing and graphical representation. 5D operational with documented pending/ambiguous cases. This is the scope accepted by the user, not an assertion of universal model correctness.
- Source 18147b96ada46bfd26dd44bff49a11458c1726e0 pushed and verified against origin/feat/bim-frag-pipeline before closure. The documentary closure commit is not yet pushed.

## In progress

None in this phase. Further development requires a new planning gate; no Quality work started.

## Blocked

None.

## Decisions

- Keep feat/bim-frag-pipeline as BIM CORE stabilization branch; no merge, rebase, cherry-pick or new branch.
- Representation and Authoring identity remain different contracts. No relaxation of Authoring corroboration and no quantity consolidation through graphical delegation.
- Only IfcRelAggregates delegates graphics; no IfcRelNests, class/name/Tag heuristics. Legacy unverified FRAG contexts retain direct-only resolution.
- ROLLBACK REQUIRED = NO; REINDEX REQUIRED = NO; FRAG REGEN REQUIRED = NO.
- Control Tower accepted lint baseline debt: 7 errors/13 warnings before, 7 errors/12 warnings after, new violations 0. LINT_GATE = PASS_WITH_BASELINE_DEBT.

## Dependencies

- Control Tower: planning gate for subsequent work; Quality is a separate future front, excluded from this closure.
- Model owner/Revit evidence: future EST Parts audit through Revit -> IFC parent/Parts -> property location -> QuantityObservation -> AuthoringElement -> 5D policy.
- Existing Documents/source storage, authentication and verified IFC/FRAG provenance remain runtime dependencies. No changes to Issues/PDF/GIS/Platform or other-front responsibilities.

## Contracts / API changes

Deployed POST /api/bim-index/graphical-representation accepts projectCode, canonical modelKey, revisionId and up to 2048 localIds. Returns context, generationId and direct/structural_delegate/unresolved results with targets and relation evidence. Existing auth/project access applies. No further API changes in this documentary closure.

## Database changes

None for release 18147b9 or this closure. Existing published generation and authoring composition evidence reused. PostgreSQL preserved; no migration, reindex, backfill or FRAG regeneration.

## Tests / Evidence

- Accepted EST: 100021-JYS01-000-ZZZ-IFC-EST-E3-100300.ifc; revision sha256:02bdd48c83ae23f6514c5ec99dde75bfad20b016e1facee1d6a8fa04da892fc0. User-reported manual server results above.
- Prior IFC+web-ifc+FRAG evidence: 125->145, 697->710, 758->771, 819->832, 1246->1291; semantic IfcWall without Representation/direct mesh, non-graphical FRAG item -> IfcRelAggregates -> graphical IfcBuildingElementPart with Representation, positive StreamMeshes/GetFlatMesh and matching GUID/localId. GRAPHICAL_DELEGATION_GATE = CONFIRMED.
- Pre-deploy BFF tests: node --import tsx --test --test-concurrency=1 over src/**/bim-*.test.ts with disposable PostgreSQL: 304 total, 301 pass, 0 fail, 3 gated real-OCI skips. Frontend viewer *.test.mjs: 135 pass, 0 fail, 0 skipped.
- Pre-deploy npm run typecheck -w bff / -w frontend and npm run build -w bff / -w frontend: PASS. BFF lint and directed graphical library/test lint: PASS. Canvas debt explicitly accepted by Control Tower; not corrected.
- This phase is documentation-only: tests/builds not rerun; git diff --check and git diff --cached --check: PASS before the documentary commit. Historical checkpoints preserved.

## Risks

- EST uses Revit Parts: one/multiple IFC Parts can represent a semantic parent; properties may reside on parent, Part or both. Pending 5D classifications are not yet established CDE bugs. OCI already demonstrated correct 5D behavior when authoring/quantity evidence is sufficient; do not extrapolate totals or completeness across revisions/models.
- BIM INDEX READ PERFORMANCE / COLD-WARM CACHE ANALYSIS: initial SmartViews/Parameters/5D load may be slow; repeat improvement is an observation, not a sufficient production benchmark. No optimization now.
- has_geometry remains known debt and must not be treated as authoritative geometry evidence.
- Previously recorded worker lifecycle and same-revision cache-refresh limitations remain; this acceptance does not claim those were corrected. Legacy pre-migration BFF rollback remains unsafe against current schema.

## Next milestone

New Control Tower planning gate. EST Parts/quantity audit and cold-warm read measurements are deferred debts, not implemented work. Quality excluded.

## Last checkpoint

Commit: documentary closure carrying this document; functional source 18147b96ada46bfd26dd44bff49a11458c1726e0.
Checkpoint document: [2026-10-06-release-18147b9-server-accepted.md](../checkpoints/bim-core/2026-10-06-release-18147b9-server-accepted.md).
