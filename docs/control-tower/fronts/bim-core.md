# BIM CORE

Updated: 2026-10-05 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: b0f92f5081a5c59cd7fd497f0f20296e8abdbb7a
HEAD: functional code 74dc5aed932ec17c5a2c9367751ec6f851781fc3; documentation carrier resolved with git log -1 --format=%H -- docs/control-tower/fronts/bim-core.md.

## Current phase

3K.1 — authoring-v2 deployed locally; one controlled canonical MBM reindex published and validated. Closed; no next phase started.

## Status

COMPLETE

## Completed

- Verified initial branch/HEAD and clean tracked tree. Old BFF was authoring-v1; rebuilt and restarted only BFF/frontend. Final frontend BUILD_ID d0lcWB6NSTr3MbqAiNf2e.
- Inspected canonical DDL before applying migrations twice successfully. Enabled corroborated_export_split constraint and previously absent QuantityObservation schema; retained existing publication/data.
- Verified exact 46104979 IFC bytes: sha256:6f991deefc1b895555992219490f877930db38fe968efac6e64a350787c01cdd.
- Exactly one real reindex of /AR3173/100021-JYS01-000-ZZZ-MBM-OCI-E3-000100.ifc. Generation 634cf258-d6e7-47aa-b4d6-edeb7d0b46cb published; job ready, error null, 46/46 batches, 11362 entities, 212375 properties, 191481 observations, 10920 AE. Old generation remained visible while building, then superseded.
- Seven export splits: 40 IFC entities -> 7 AE. 1020025 = export-split:173301, two members/geometries, Metrado 116.076 m2 once. 0.2.1.8 = 1255.662 m2 (previously 1371.738). 0.2.1.3 unchanged: 7 AE, 112 graphics, 1842.105 m3.
- Live Schedule single row, logical tree with two members, individual member inspection and ghost sequences verified. Viewport click restores opacity.
- Demonstrated missing rootless Inspector header in deployed 3K; minimal fix in separate commit 74dc5ae. Shows logical key/authoring ID/representative/member count separately from native IFC member. No ghost/resolver/quantity behavior changes.

## In progress

None. Awaiting review; no further phase authorized.

## Blocked

Manual CSV evidence only: browser download event timed out after 20s for 386 filtered logical rows with Datos_Partida.Metrado active. Requires an accessible downloaded CSV/user manual verification. Does not block the completed deployment gates; no export implementation change.

## Decisions

- Preserve IFC entity identity; export split has no native root. Representative is not a fabricated root. Native quantities retained, consolidation remains stored-authoring-replicas@1.
- No reindex retry; one canonical publication only. No new algorithms, endpoint contracts or schema definitions in this phase.
- 0.2.1.7 remains ambiguous/null; resolved subtotal 7499.866 m2 is not a contractual total.

## Dependencies

- CONTROL TOWER/user review before further phases/integration; no push/merge performed.
- Manual CSV inspection requires browser download access. Documents, Platform and SmartView receive no new responsibilities.
- Local DB uses existing canonical migrations; schema gate satisfied. No external DB operation pending for this local deployment.

## Contracts / API changes

None new in 3K.1. Existing v2 corroborated_export_split and representativeLocalId contracts now run on canonical local data.

## Database changes

Applied existing db:migrate twice: authoring method constraint updated; cde_bim_quantity_observations and its canonical indexes/schema installed. Generation schema already existed. No ad-hoc SQL writes, destructive resets or backfill; issue source_id backfill candidate count was zero. Single authorized MBM generation replacement; old data retained.

## Tests / Evidence

- Real DB/API/Schedule + split tests: 25 PASS, 0 failures/skips (bim-oci-3k.integration.test.ts + bim-authoring-export-split.test.ts, BIM_OCI_3K_CONTEXT_READY=1).
- Frontend Inspector/Schedule + logical selection: 54 PASS, 0 failures/skips. New SSR test covers rootless identity and preserves clicked member; existing Roof/Slab test passes.
- Node24 context/visibility tests: 31 PASS, 0 failures/skips. Initial direct Node20 attempt could not load .ts (three loader failures); rerun with host Node24.21.0 passed without source changes.
- Frontend typecheck PASS; directed lint 0 errors, one pre-existing unused extractContainment warning. BFF/frontend Docker builds PASS; frontend rebuilt/deployed again for Inspector fix.
- Runtime visual checks: A5 -> A4 -> A3 -> A5; 1020025 -> 965198 -> 1020025; ghost stable; viewport click ghost OFF. Corrected Inspector verified live.
- Reindex publication duration 283.731s. Post-publication Schedule measurements: .3 734ms, .7 1134ms, .8 849ms (individual samples, not benchmark).
- Detailed immutable operational evidence: checkpoint linked below. Diff and staged diff checks PASS before documentation commit.

## Risks

- CSV actual downloaded file remains unverified; earlier Blob/export tests are not manual evidence.
- Three existing .7 fallbacks (385943/386762/387948) remain uncorroborated. 1020025 Zona TERCERA ETAPA vs partida ETAPA 2 unchanged.
- Web-IFC triangulation/invalid-line warnings and unavailable mock Nextcloud metadata endpoint occurred; exact IFC bytes verified and publication succeeded.
- 191481 observations include 191478 member-linked plus three IfcProject #32 observations intentionally without authoring membership. Zero member authoring-key mismatches.
- Job started_at is historical due to reuse; duration measured from current generation creation to publication.
- Split inference remains conservative, export-specific and revision-scoped; no matching across revisions.

## Next milestone

Review 3K.1 and close manual CSV evidence. Do not initiate another phase automatically.

## Last checkpoint

Commit: documentation carrier; resolve with git log -1 --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-05-fase-3k1.md.
Checkpoint document: [2026-10-05-fase-3k1.md](../checkpoints/bim-core/2026-10-05-fase-3k1.md)
