import type { Highlighter } from "@thatopen/components-front";
import type { ModelIdMap } from "@thatopen/components";
import type { ViewerBimContext } from "./viewer-bim-context";
import type { AuthoringSelection } from "./resolve-authoring-selection";

export type SelectionPresentation = "highlight-only" | "context";

export type LogicalSelectionIdentity = { context: ViewerBimContext; identityKey: string };

type Options = {
  highlighter: Highlighter;
  resolve: (context: ViewerBimContext, localId: number, signal: AbortSignal) => Promise<AuthoringSelection | null>;
  getContext: (runtimeModelId: string) => ViewerBimContext | undefined;
  reportError: (error: unknown) => void;
  pick: () => Promise<{ runtimeModelId: string; localId: number } | undefined>;
  onCommitted?: (presentation: SelectionPresentation) => Promise<void>;
};

/** One adapter around the existing Highlighter. It never owns visibility. */
export function attachLogicalAuthoringSelection({ highlighter, resolve, getContext, reportError, pick, onCommitted }: Options) {
  const originalHighlight = highlighter.highlightByID;
  const originalPick = highlighter.highlight;
  const originalClear = highlighter.clear;
  let generation = 0;
  let pending: AbortController | undefined;
  let primary: { runtimeModelId: string; localId: number } | undefined;
  let logical: AuthoringSelection | undefined;
  let identities: LogicalSelectionIdentity[] = [];
  let modifiedPick = false;
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let invokingOriginal = false;
  let committingPresentation = 0;
  let userPick: { token: number; simple: boolean } | undefined;

  function invalidate(clearIdentity = true) {
    generation++;
    pending?.abort();
    pending = undefined;
    if (clearIdentity) {
      primary = undefined;
      logical = undefined;
      identities = [];
    }
    return generation;
  }

  function enqueue(operation: () => Promise<void>) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function invokeHighlight(args: Parameters<Highlighter["highlightByID"]>, presentation: SelectionPresentation = "highlight-only") {
    // Highlighter calls clear synchronously before its first await. Only that
    // internal clear bypasses the queue; external clears must invalidate/serialize.
    invokingOriginal = true;
    committingPresentation++;
    try {
      return originalHighlight.apply(highlighter, args).then(() => onCommitted?.(presentation))
        .finally(() => { committingPresentation--; });
    } finally {
      invokingOriginal = false;
    }
  }

  async function expand(token: number, runtimeModelId: string, localId: number, context: ViewerBimContext, presentation: SelectionPresentation = "highlight-only") {
    const controller = new AbortController();
    pending = controller;
    let result: AuthoringSelection | null = null;
    try {
      result = await resolve(context, localId, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted && !disposed && token === generation) reportError(error);
    } finally {
      if (pending === controller) pending = undefined;
    }
    if (disposed || token !== generation) return;
    await enqueue(async () => {
      if (disposed || token !== generation) return;
      const current = getContext(runtimeModelId);
      if (!current || current.projectCode !== context.projectCode || current.modelKey !== context.modelKey || current.revisionId !== context.revisionId) return;
      // Resolve first, then publish identity and graphics together. A 404 keeps the raw picked entity.
      primary = { runtimeModelId, localId };
      logical = result ?? undefined;
      identities = result ? [{ context: result.context, identityKey: result.authoringElement.identityKey }] : [];
      const ids = result ? result.members.filter(m => m.geometryStatus === "present").map(m => m.localId) : [localId];
      await invokeHighlight(["select", { [runtimeModelId]: new Set(ids) }, true, false], presentation);
    });
  }
  // Keep the library's mouse/drag handling, raycaster and Highlighter. Capture
  // intent before awaiting the raycast so an older pick cannot arrive as new.
  highlighter.highlight = async (name, removePrevious = true, zoom = highlighter.zoomToSelection, exclude = null) => {
    if (name !== "select") return originalPick.call(highlighter, name, removePrevious, zoom, exclude);
    if (!highlighter.enabled || disposed) return;
    if (!removePrevious || modifiedPick) {
      invalidate();
      return originalPick.call(highlighter, name, removePrevious, zoom, exclude);
    }
    const token = invalidate(false);
    const simple = removePrevious && !modifiedPick;
    const hit = await pick();
    if (disposed || token !== generation) return;
    if (!hit) {
      if (removePrevious) await highlighter.clear(name);
      return;
    }
    const context = getContext(hit.runtimeModelId);
    if (context && simple) {
      void expand(token, hit.runtimeModelId, hit.localId, context);
      return;
    }
    userPick = { token, simple };
    let result: Promise<void>;
    try {
      result = highlighter.highlightByID(name, { [hit.runtimeModelId]: new Set([hit.localId]) }, removePrevious, zoom, exclude, true);
    } finally {
      userPick = undefined;
    }
    await result;
  };

  highlighter.highlightByID = (...args) => {
    const [name, map, removePrevious = true, , , isPicking = false] = args;
    if (name !== "select") return originalHighlight.apply(highlighter, args);
    const origin = userPick;
    const token = origin?.token ?? invalidate();
    args[1] = Object.fromEntries(Object.entries(map).map(([id, ids]) => [id, new Set(ids)]));
    const entries = Object.entries(map);
    const simple = origin?.simple && isPicking && removePrevious && entries.length === 1 && entries[0][1].size === 1;
    const picked = simple ? { runtimeModelId: entries[0][0], localId: [...entries[0][1]][0] } : undefined;
    const context = picked ? getContext(picked.runtimeModelId) : undefined;
    return enqueue(async () => {
      // Preserve every legacy additive write in order (rapid Ctrl picks). Only
      // logical HTTP results are discarded when superseded, not queued deltas.
      if (disposed) return;
      if (context && token === generation) primary = picked;
      await invokeHighlight(args);
      // autoToggle can turn the picked element off. Do not resolve a deselection.
      if (disposed || token !== generation) return;
      if (!picked || !context || !highlighter.selection.select[picked.runtimeModelId]?.has(picked.localId)) {
        primary = undefined;
        return;
      }
      void expand(token, picked.runtimeModelId, picked.localId, context);
    });
  };

  highlighter.clear = (...args) => {
    if (invokingOriginal || (args[0] && args[0] !== "select")) return originalClear.apply(highlighter, args);
    invalidate();
    return enqueue(async () => {
      if (!disposed) { await originalClear.apply(highlighter, args); await onCommitted?.("highlight-only"); }
    });
  };

  return {
    // Called in capture phase before the library's mouseup/raycast handler.
    // Ctrl/Shift/Meta retain legacy semantics, even if the library only uses Ctrl.
    onMouseUp(event: Pick<MouseEvent, "ctrlKey" | "shiftKey" | "metaKey" | "button">) {
      if (event.button !== 0) return;
      modifiedPick = event.ctrlKey || event.shiftKey || event.metaKey;
      invalidate(false);
    },
    getPrimaryModelIdMap(): ModelIdMap | undefined {
      return primary ? { [primary.runtimeModelId]: new Set([primary.localId]) } : undefined;
    },
    isReplacingSelection: () => invokingOriginal,
    isCommittingPresentation: () => committingPresentation > 0,
    getLogicalSelection: () => logical,
    getLogicalIdentities: () => identities.slice(),
    async inspectMember(runtimeModelId: string, localId: number) {
      const token = invalidate();
      await enqueue(async () => {
        if(disposed || token !== generation || !getContext(runtimeModelId)) return;
        primary = {runtimeModelId,localId};
        await invokeHighlight(["select",{[runtimeModelId]:new Set([localId])},true,false],"highlight-only");
      });
    },
    async selectMember(runtimeModelId: string, localId: number, presentation: SelectionPresentation = "highlight-only") {
      const context = getContext(runtimeModelId);
      if (context) await expand(invalidate(false), runtimeModelId, localId, context, presentation);
      else {
        const token = invalidate();
        await enqueue(async () => {
          if (!disposed && token === generation) await invokeHighlight(["select", { [runtimeModelId]: new Set([localId]) }, true, false], presentation);
        });
      }
    },
    async selectLogical(map: ModelIdMap, requested: LogicalSelectionIdentity[], presentation: SelectionPresentation = "highlight-only") {
      const token = invalidate();
      const snapshot = Object.fromEntries(Object.entries(map).map(([id, ids]) => [id, new Set(ids)]));
      const unique = [...new Map(requested.map(identity => [JSON.stringify([
        identity.context.projectCode, identity.context.modelKey, identity.context.revisionId, identity.identityKey
      ]), identity])).values()];
      await enqueue(async () => {
        if (disposed || token !== generation) return;
        identities = unique;
        await invokeHighlight(["select", snapshot, true, false], presentation);
      });
    },
    dispose() {
      disposed = true;
      invalidate();
      highlighter.highlightByID = originalHighlight;
      highlighter.highlight = originalPick;
      highlighter.clear = originalClear;
    }
  };
}
