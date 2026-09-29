/** Pure, revision-scoped resolution. No quantities or runtime model identities. */
export type AuthoringModelContext = Readonly<{
  projectCode: string;
  modelKey: string;
  revisionId: string;
}>;

export type AuthoringEntityFact = Readonly<{
  localId: number;
  globalId?: string;
  ifcClass: string;
  name?: string;
  tag?: string;
  authoringElementId?: string;
  sourceContainer?: string;
  hasRepresentation?: boolean;
  geometryStatus: "present" | "absent" | "unknown";
  /** Optional assertion at extraction boundaries; otherwise the enclosing context applies. */
  context?: AuthoringModelContext;
}>;

export type CompositionRelationFact = Readonly<{
  relationLocalId: number;
  relationType: string;
  parentLocalId: number;
  childLocalIds: readonly number[];
  context?: AuthoringModelContext;
}>;

export type AuthoringResolutionIssue =
  | "invalid_relation_id"
  | "duplicate_relation_id"
  | "invalid_member_id"
  | "missing_entity"
  | "empty_children"
  | "duplicate_child"
  | "unsupported_relation_type"
  | "cycle"
  | "multiple_parents"
  | "invalid_root_count"
  | "missing_authoring_id"
  | "conflicting_authoring_id"
  | "missing_tag"
  | "conflicting_tag"
  | "tag_authoring_id_mismatch"
  | "missing_source_container"
  | "conflicting_source_container";

export type AuthoringCompositionEvidence = Readonly<{
  relations: readonly Readonly<{
    relationLocalId: number;
    relationType: string;
    parentLocalId: number;
    childLocalIds: readonly number[];
  }>[];
  affectedLocalIds: readonly number[];
  missingLocalIds: readonly number[];
  issues: readonly AuthoringResolutionIssue[];
  corroboration: Readonly<{
    authoringElementId?: string;
    tag?: string;
    sourceContainer?: string;
    /** Merely supporting evidence: names never decide membership. */
    commonName?: string;
  }>;
}>;

export type AuthoringElementResolution = Readonly<{
  /** Only unique together with AuthoringResolution.context. */
  identityKey: string;
  rootLocalId?: number;
  memberLocalIds: readonly number[];
  graphicalLocalIds: readonly number[];
  geometryUnknownLocalIds: readonly number[];
  authoringElementId?: string;
  sourceContainer?: string;
  resolutionMethod: "corroborated_aggregate" | "standalone" | "singleton_fallback";
  /** Confidence in common authorship, not in the existence of an IFC entity. */
  identityConfidence: "high" | "unknown";
  resolutionStatus: "resolved" | "fallback";
  compositionEvidence: AuthoringCompositionEvidence;
}>;

export type AuthoringResolution = Readonly<{
  context: AuthoringModelContext;
  resolverVersion: "authoring-v1";
  elements: readonly AuthoringElementResolution[];
  identityKeyByLocalId: Readonly<Record<number, string>>;
  /** Includes malformed relations with no existing entity to attach a fallback to. */
  diagnostics: readonly AuthoringCompositionEvidence[];
}>;

const text = (value?: string) => value?.trim() || undefined;
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
const sortedIds = (ids: Iterable<number>) => [...new Set(ids)].sort((a, b) => a - b);
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * All unannotated facts are asserted by the caller to belong to context.
 * Mixed explicit scopes, duplicate entities and invalid entity IDs throw: there
 * is no unambiguous entity:<localId> fallback for a broken identity namespace.
 * Malformed/unsupported compositions instead fall back per connected component.
 */
export function resolveAuthoringElements(input: Readonly<{
  context: AuthoringModelContext;
  entities: readonly AuthoringEntityFact[];
  relations: readonly CompositionRelationFact[];
}>): AuthoringResolution {
  const context = { ...input.context };
  for (const key of ["projectCode", "modelKey", "revisionId"] as const) {
    if (!text(context[key])) throw new Error(`Missing authoring context: ${key}`);
  }
  function assertScope(scope?: AuthoringModelContext) {
    if (scope && (scope.projectCode !== context.projectCode ||
      scope.modelKey !== context.modelKey || scope.revisionId !== context.revisionId)) {
      throw new Error("Authoring facts must belong to one model/revision context");
    }
  }
  const entities = new Map<number, AuthoringEntityFact>();
  for (const entity of input.entities) {
    assertScope(entity.context);
    if (!validId(entity.localId) || entities.has(entity.localId)) {
      throw new Error(`Invalid or duplicate IFC entity localId: ${entity.localId}`);
    }
    if (!["present", "absent", "unknown"].includes(entity.geometryStatus)) {
      throw new Error(`Invalid geometryStatus for IFC entity ${entity.localId}`);
    }
    entities.set(entity.localId, entity);
  }
  const relations = input.relations.map((relation) => {
    assertScope(relation.context);
    return {
      relationLocalId: relation.relationLocalId,
      relationType: relation.relationType,
      parentLocalId: relation.parentLocalId,
      // Preserve duplicates until validation, but never caller-owned arrays.
      childLocalIds: [...relation.childLocalIds].sort((a, b) => a - b)
    };
  }).sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  const relationIdCounts = new Map<number, number>();
  const adjacency = new Map<number, Set<number>>();
  const relationIndices = new Map<number, Set<number>>();
  const orphanRelationIndices: number[] = [];
  for (const id of entities.keys()) adjacency.set(id, new Set());
  relations.forEach((relation, index) => {
    relationIdCounts.set(relation.relationLocalId,
      (relationIdCounts.get(relation.relationLocalId) ?? 0) + 1);
    const ids = sortedIds([relation.parentLocalId, ...relation.childLocalIds].filter(validId));
    if (!ids.length) orphanRelationIndices.push(index);
    // Include missing references: malformed connected compositions fail together.
    for (const id of ids) {
      if (!adjacency.has(id)) adjacency.set(id, new Set());
      if (!relationIndices.has(id)) relationIndices.set(id, new Set());
      relationIndices.get(id)!.add(index);
      adjacency.get(id)!.add(ids[0]);
      adjacency.get(ids[0])!.add(id);
    }
  });

  const elements: AuthoringElementResolution[] = [];
  const diagnostics: AuthoringCompositionEvidence[] = [];

  function resolveComponent(ids: number[], indices: number[]) {
    const facts = ids.flatMap((id) => entities.has(id) ? [entities.get(id)!] : []);
    const componentRelations = indices.map((index) => relations[index]);
    const issues = new Set<AuthoringResolutionIssue>();
    const missingLocalIds = ids.filter((id) => !entities.has(id));
    if (missingLocalIds.length) issues.add("missing_entity");
    const parents = new Map<number, Set<number>>();
    const children = new Map<number, Set<number>>();
    for (const relation of componentRelations) {
      if (!validId(relation.relationLocalId)) issues.add("invalid_relation_id");
      if ((relationIdCounts.get(relation.relationLocalId) ?? 0) > 1) issues.add("duplicate_relation_id");
      if (relation.relationType !== "IfcRelAggregates") issues.add("unsupported_relation_type");
      if (!relation.childLocalIds.length) issues.add("empty_children");
      if (new Set(relation.childLocalIds).size !== relation.childLocalIds.length) issues.add("duplicate_child");
      if (![relation.parentLocalId, ...relation.childLocalIds].every(validId)) issues.add("invalid_member_id");
      for (const child of relation.childLocalIds) {
        if (!validId(child) || !validId(relation.parentLocalId)) continue;
        if (!parents.has(child)) parents.set(child, new Set());
        parents.get(child)!.add(relation.parentLocalId);
        if (!children.has(relation.parentLocalId)) children.set(relation.parentLocalId, new Set());
        children.get(relation.parentLocalId)!.add(child);
      }
    }
    if ([...parents.values()].some((values) => values.size > 1)) issues.add("multiple_parents");
    const roots = ids.filter((id) => !parents.get(id)?.size);
    if (componentRelations.length && roots.length !== 1) issues.add("invalid_root_count");
    // Iterative topological traversal: long IFC chains cannot overflow the stack.
    const indegree = new Map(ids.map((id) => [id, parents.get(id)?.size ?? 0]));
    const queue = [...roots];
    let visited = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      visited++;
      for (const child of children.get(queue[cursor]) ?? []) {
        const remaining = indegree.get(child)! - 1;
        indegree.set(child, remaining);
        if (remaining === 0) queue.push(child);
      }
    }
    if (visited !== ids.length) issues.add("cycle");

    const corroboration: {
      authoringElementId?: string; tag?: string; sourceContainer?: string; commonName?: string;
    } = {};
    if (componentRelations.length) {
      const fields = [
        ["authoringElementId", "missing_authoring_id", "conflicting_authoring_id"],
        ["tag", "missing_tag", "conflicting_tag"],
        ["sourceContainer", "missing_source_container", "conflicting_source_container"]
      ] as const;
      for (const [field, missing, conflicting] of fields) {
        const values = facts.map((fact) => text(fact[field]));
        if (!values.length || values.some((value) => !value)) issues.add(missing);
        const unique = new Set(values.filter((value): value is string => Boolean(value)));
        if (unique.size > 1) issues.add(conflicting);
        if (values.length && unique.size === 1 && values.every(Boolean)) {
          corroboration[field] = [...unique][0];
        }
      }
      if (facts.some((fact) => text(fact.tag) && text(fact.authoringElementId) &&
        text(fact.tag) !== text(fact.authoringElementId))) issues.add("tag_authoring_id_mismatch");
    }
    const names = facts.map((fact) => text(fact.name));
    if (names.length && names.every(Boolean) && new Set(names).size === 1) corroboration.commonName = names[0];
    const evidence: AuthoringCompositionEvidence = {
      relations: componentRelations,
      affectedLocalIds: facts.map((fact) => fact.localId),
      missingLocalIds,
      issues: [...issues].sort(compareText),
      corroboration
    };
    if (issues.size) diagnostics.push(evidence);

    function emit(members: AuthoringEntityFact[], grouped: boolean) {
      const root = grouped ? roots[0] : undefined;
      elements.push({
        identityKey: grouped ? `aggregate:${root}` : `entity:${members[0].localId}`,
        ...(grouped ? { rootLocalId: root } : {}),
        memberLocalIds: members.map((fact) => fact.localId),
        graphicalLocalIds: members.filter((fact) => fact.geometryStatus === "present").map((fact) => fact.localId),
        geometryUnknownLocalIds: members.filter((fact) => fact.geometryStatus === "unknown").map((fact) => fact.localId),
        authoringElementId: grouped ? corroboration.authoringElementId : text(members[0].authoringElementId),
        sourceContainer: grouped ? corroboration.sourceContainer : text(members[0].sourceContainer),
        resolutionMethod: grouped ? "corroborated_aggregate" : componentRelations.length ? "singleton_fallback" : "standalone",
        identityConfidence: grouped ? "high" : "unknown",
        resolutionStatus: issues.size ? "fallback" : "resolved",
        compositionEvidence: evidence
      });
    }
    if (componentRelations.length && !issues.size) emit(facts, true);
    else for (const fact of facts) emit([fact], false);
  }

  const seen = new Set<number>();
  for (const id of sortedIds(adjacency.keys())) {
    if (seen.has(id)) continue;
    const component = [id];
    const indices = new Set<number>();
    seen.add(id);
    for (let cursor = 0; cursor < component.length; cursor++) {
      const current = component[cursor];
      for (const index of relationIndices.get(current) ?? []) indices.add(index);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        component.push(neighbour);
      }
    }
    resolveComponent(sortedIds(component), [...indices].sort((a, b) => a - b));
  }
  for (const index of orphanRelationIndices) resolveComponent([], [index]);
  elements.sort((a, b) => a.memberLocalIds[0] - b.memberLocalIds[0]);
  const identityKeyByLocalId: Record<number, string> = {};
  for (const element of elements) {
    for (const id of element.memberLocalIds) identityKeyByLocalId[id] = element.identityKey;
  }
  return { context, resolverVersion: "authoring-v1", elements, identityKeyByLocalId, diagnostics };
}
