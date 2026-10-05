# BIM CORE

Updated: 2026-10-05 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 9cf51d4149da04d5d22140e5d999e4e9656d64e8 (phase baseline)
HEAD: functional checkpoint 9c24abaaacf857aead81b568eca627d5f66fab40; documentation carrier: git log -1 --format=%H -- docs/control-tower/fronts/bim-core.md.

## Current phase

3K.2 — audit of all pending canonical MBM 5D groups and versioned exclusive stored-quantity owner policy. Phase complete. Global 5D milestone OPEN; no next phase started.

## Status

COMPLETE

## Completed

- Audited 31 groups (ID/name/unit), 23 named codes plus placeholders. Traced all 1972 initially blocked AEs to members, persisted observations and native IFC. Inspected 5063 related native entities: no native Metrado missing from the index in this set.
- Added stored-authoring-replicas@2; @1 unchanged and selectable. The exception requires one finite stored observation across the complete native component and one unequivocal unit. Authoring confidence/membership unchanged; no deduplication by value.
- Resolved 263 quantities: groups 12 resolved/19 pending -> 18 resolved/13 pending. Remaining 1709 AEs lack native stored Metrado: 1551 placeholder-classified, 158 named. Seven named codes still have pending buckets.
- .7 = 7621.600 m2; .11 = 14640.381 kg. .5 remains pending on #182637/#184782. .3 unchanged 1842.105 m3; .8 unchanged 1255.662 m2; 1020025 unchanged one AE/two graphics/116.076 m2.
- User Revit GUID 2oOvFbrJH54vnWU9sjZ86H / ID996843 maps to IFC #165332, stored Metrado43.583m2, already resolved under @1. No full Revit schedule total supplied.
- Local BFF/frontend rebuilt and deployed. Final frontend BUILD_ID T386SVkFmzTwS_4Si-J6b. Browser verifies results; no reindex or canonical DB mutation.

## In progress

None within 3K.2. Global 5D acceptance remains open.

## Blocked

Formal 5D closure requires model-owner correction of missing quantities/units/classifications. Prior manual downloaded-CSV check remains unverified. Full Revit schedule total unavailable; revision equivalence not assumed. These do not block completion of this audit/policy phase.

## Decisions

- Separate quantity evaluability from authoring confidence. Native parent is not necessarily an AE root; singleton identity does not mean native standalone.
- Whole-component evidence includes members outside the selected partida. Missing structure/provenance, multiple quantities even equal, invalid units or duplicate mapping entries fail closed.
- Preserve stored parameter, IFC QTO and viewer geometry separately. No QTO substitution, unit conversion, cross-revision matching or subtotal-as-total.
- No resolver/extractor/schema changes; no reindex required.

## Dependencies

- Model owner: contractual quantities and suspicious classifications, mixed-unit .13/.17, placeholders, 1020025 Zona TERCERA ETAPA versus partida ETAPA 2.
- CONTROL TOWER/user review before integration or 5D closure. No push/merge.
- Manual CSV verification remains external evidence. No new Documents/Platform/SmartView responsibilities.

## Contracts / API changes

Existing 5D/metering routes accept @2 alongside @1. Additional resolved fallback evidence: evaluationBasis=exclusive_entity_observation; quantityEvidence={localId,occurrenceIndex,componentLocalIds}. UI defaults @2; CSV preserves response policy version. No new endpoints.

## Database changes

None. Published snapshot/revision only. Generation 634cf258-d6e7-47aa-b4d6-edeb7d0b46cb unchanged; revision sha256:6f991deefc1b895555992219490f877930db38fe968efac6e64a350787c01cdd. Counts 11362 entities/10920 AE/191481 QP/212375 properties unchanged.

## Tests / Evidence

- Policies @1/@2: 29 pass, zero failures/skips.
- Full BIM with actual migrated isolated PostgreSQL: 289 tests, 286 pass, zero failures, three canonical OCI gated skips. Temporary DB removed; production DB untouched.
- Canonical OCI read-only integration: one pass, zero failures/skips; Schedule/reader/version comparison/generation unchanged.
- Frontend logical rows/selection/Inspector: 57 pass after required BFF fixture mount; initial attempt had three ENOENT fixture failures, corrected environment passed.
- BFF/frontend typechecks and builds PASS. Directed lint: canvas seven errors/thirteen warnings, identical baseline counts/rule histogram; helper/test clean. No clean-global-lint claim.
- Diff/staged-diff checks PASS. Browser confirmed .7/.11/.3/.8 and .5 pending-two on final build.
- Exhaustive observation evidence and group inventory linked from checkpoint below.

## Risks

- Legacy/absent provenance remains conservative. Whole-component evidence adds query/memory cost; no comprehensive benchmark claimed.
- Scalar evaluability does not certify classification/contract validity. Placeholder --/Und yields78 but is not a valid named partida.
- No software-caused quantity pending remains in audited MBM/mapping; no universal-model guarantee.
- Manual CSV acceptance and baseline canvas lint debt remain.

## Next milestone

Review 3K.2 and obtain model-data corrections/acceptance evidence. Do not begin another phase or close 5D automatically.

## Last checkpoint

Commit: functional 9c24abaaacf857aead81b568eca627d5f66fab40; documentation carrier: git log -1 --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-05-fase-3k2.md.
Checkpoint document: [2026-10-05-fase-3k2.md](../checkpoints/bim-core/2026-10-05-fase-3k2.md)
