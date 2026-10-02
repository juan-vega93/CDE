import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { createVisibilityPolicy, parameterVisibilityKey } from "./visibility-policy.ts";

// Exercise the actual canvas handlers without WebGL, a browser, or production data.
const source = fs.readFileSync(new URL("../components/ifc-viewer-canvas.tsx", import.meta.url), "utf8");
function handler(name) {
  const start = source.indexOf("  async function " + name + "(");
  assert.ok(start >= 0, name);
  const rest = source.slice(start + 1);
  const next = /\n  (?:async )?function /.exec(rest);
  assert.ok(next, name + " end");
  return stripTypeScriptTypes(source.slice(start, start + 1 + next.index));
}
function harness(afterWrite = async () => {}) {
  const hidden = new Set(), colors = [], highlighted = [], opacity = [];
  const policy = createVisibilityPolicy({
    readHidden: async () => ({ model: [...hidden] }),
    setVisible: async (items, visible) => {
      for (const id of items.model) {
        if (visible) hidden.delete(id); else hidden.add(id);
      }
      await afterWrite({ ids: [...items.model], visible, hidden: new Set(hidden) });
    },
    refresh: async () => {}
  });
  let token = 0;
  const models = [{ modelId: "model", object: { visible: true }, runtimeModel: {
    setOpacity: async (ids) => opacity.push(ids),
    resetOpacity: async () => {}
  } }];
  const modules = {
    visibility: policy,
    coloring: { colorSelections: async (entries) => colors.push(entries), restoreAllColors: async () => {} },
    selection: { clearSelection: async () => {}, highlighter: {
      highlightByID: async (...args) => highlighted.push(args)
    } }
  };
  const ctx = vm.createContext({
    console, Set, Map, Object, Array, Promise, parameterVisibilityKey,
    propertySet: "Pset", propertyName: "Type", modulesRef: { current: modules },
    viewerRef: { current: { components: {} } }, modelsGroupRef: { current: {} }, models,
    beginRenderOperation: () => ++token, isRenderOperationCurrent: (t) => t === token,
    waitForNextFrame: async () => {}, requestViewerRefresh: () => {},
    setStatus: () => {}, setHasSelection: () => {}, setModels: (fn) => fn(models),
    expandModelIdMapForRendering: async (map) => map,
    resolveParameterGraphics: async (map) => map,
    takeExclusiveModelIdMap: (map) => map,
    mergeModelIdMap: (to, from) => Object.assign(to, from),
    cloneModelIdMap: (map) => map,
    countModelIdMapElements: (map) => Object.values(map).reduce((n, ids) => n + ids.size, 0),
    applyChunkedColorSelections: async (entries) => { await modules.coloring.colorSelections(entries); return true; },
    fitSelectionInView: async () => {}, fitObjectInView: async () => {},
    resetContextGhostOpacity: async () => {},
    getModelContextLocalIds: async () => [1, 2, 3],
    lastColoredSelectionRef: { current: null }, lastGhostedSelectionRef: { current: null },
    lastSectionBoxSelectionRef: { current: null },
    TREE_ACTION_HIGHLIGHT_LIMIT: 1000, CONTEXT_GHOST_MAX_DIM_IDS: 1000, MODEL_ID_MAP_RENDER_CHUNK_SIZE: 450
  });
  for (const name of ["handleApplyParameterColors", "handleSelectParameterBucket",
    "applySelectionFocusMode", "handleSelectModelIdMap", "handleSelectCost5DRow",
    "handleShowAll", "handleResetView", "handleToggleParameterBucketVisibility",
    "handleToggleBucket"]) vm.runInContext(handler(name), ctx);
  ctx.onToggleBucketVisibility = (...args) => ctx.handleToggleParameterBucketVisibility(...args);
  const bucket = { value: "A", color: "#ff0000", count: 1, modelIdMap: { model: new Set([1]) } };
  const key = parameterVisibilityKey("Pset", "Type", "A");
  return { ctx, policy, hidden, colors, highlighted, opacity, bucket, key,
    hide: () => policy.toggleBucket(key, async () => bucket.modelIdMap) };
}

for (const visible of [false, true]) {
  test(`transient: actual bucket toggle ${visible ? "shows" : "hides"} B in chunks without ever revealing A`, async () => {
    const a = [1, 2, 3];
    const b = Array.from({ length: 1001 }, (_, i) => i + 10);
    const bIds = new Set(b);
    const states = [];
    let observe = false;
    const f = harness(async (state) => {
      if (!observe) return;
      states.push(state);
      // Inspect every completed write, before the next chunk or final refresh.
      assert.ok(a.every((id) => state.hidden.has(id)), "A stays hidden throughout B's transition");
      assert.equal(state.visible, visible);
      assert.ok(state.ids.length <= 450);
      assert.ok(state.ids.every((id) => bIds.has(id)), "only B's delta may be written");
      assert.equal(state.hidden.has(2000), false, "unrelated element stays visible");
      await Promise.resolve();
    });
    const bucket = (value, ids) => ({ value, modelIdMap: { model: new Set(ids) } });
    await f.ctx.handleToggleBucket(bucket("A", a));
    assert.ok(a.every((id) => f.hidden.has(id)));
    if (visible) await f.ctx.handleToggleBucket(bucket("B", b));
    assert.equal(b.every((id) => f.hidden.has(id)), visible);
    observe = true;
    await f.ctx.handleToggleBucket(bucket("B", b));
    assert.equal(states.length, 3, "B is processed in three independently observed chunks");
    for (let chunk = 0; chunk < states.length; chunk++) {
      // The canvas catches driver errors; assert snapshots again outside its catch.
      assert.ok(a.every((id) => states[chunk].hidden.has(id)));
      assert.equal(states[chunk].visible, visible);
      assert.ok(states[chunk].ids.every((id) => bIds.has(id)));
      const processed = Math.min((chunk + 1) * 450, b.length);
      for (let index = 0; index < b.length; index++) {
        assert.equal(states[chunk].hidden.has(b[index]), index < processed ? !visible : visible);
      }
    }
    assert.ok(a.every((id) => f.hidden.has(id)));
    assert.ok(b.every((id) => f.hidden.has(id) === !visible));
    assert.equal(f.policy.getSnapshot().has(parameterVisibilityKey("Pset", "Type", "A")), true);
    assert.equal(f.policy.getSnapshot().has(parameterVisibilityKey("Pset", "Type", "B")), !visible);
  });
}

test("E: actual parameter-color handler preserves hidden elements", async () => {
  const f = harness(); await f.hide();
  await f.ctx.handleApplyParameterColors("Pset", "Type", [f.bucket]);
  assert.equal(f.colors.length, 1);
  assert.deepEqual([...f.hidden], [1]);
  assert.equal(f.policy.getSnapshot().has(f.key), true);
});

test("Sin valor: actual color handler sends yellow and toggle targets the same IDs", async () => {
  const f = harness();
  const bucket = { ...f.bucket, value: "Sin valor", color: "#ffff00" };
  await f.ctx.handleApplyParameterColors("Pset", "Type", [bucket]);
  assert.equal(f.colors[0][0].color, "#ffff00");
  assert.deepEqual([...f.colors[0][0].modelIdMap.model], [1]);
  await f.ctx.handleToggleParameterBucketVisibility("Pset", "Type", bucket);
  assert.deepEqual([...f.hidden], [1]);
  await f.ctx.handleToggleParameterBucketVisibility("Pset", "Type", bucket);
  assert.equal(f.hidden.size, 0);
});
test("F: actual selection/highlight handler preserves hiding", async () => {
  const f = harness(); await f.hide();
  await f.ctx.handleSelectParameterBucket(f.bucket);
  assert.equal(f.highlighted.length, 1);
  assert.deepEqual([...f.hidden], [1]);
});
test("G: actual 5D selection and ghost preserve prior policy during and after focus", async () => {
  const f = harness(); await f.hide();
  await f.ctx.handleSelectCost5DRow({
    itemId: "test", itemName: "test", itemUnit: "m3", quantity: 1,
    elementCount: 1, modelIdMap: { model: new Set([2]) }
  });
  assert.equal(f.highlighted.length, 1);
  assert.ok(f.opacity.length > 0);
  assert.deepEqual([...f.hidden], [1]);
  assert.equal(f.policy.getSnapshot().has(f.key), true);
});
for (const name of ["handleShowAll", "handleResetView"]) {
  test("H: actual " + name + " updates effective visibility and UI snapshot", async () => {
    const f = harness(); await f.hide();
    let ui = f.policy.getSnapshot();
    const unsubscribe = f.policy.subscribe(() => { ui = f.policy.getSnapshot(); });
    await f.ctx[name]();
    assert.equal(f.hidden.size, 0);
    assert.equal(ui.size, 0);
    unsubscribe();
  });
}

for (const sourceKind of ["ifc", "frag"]) {
  test("adapter integration: " + sourceKind + " composes model, parameter and focus visibility", async () => {
    const hidden = new Set(), writes = [];
    const fragments = {
      list: new Map([["runtime", {
        getLocalIds: async () => [1, 2, 3],
        setVisible: async (ids, visible) => {
          assert.ok(Array.isArray(ids), "no global setVisible(undefined)");
          writes.push({ ids, visible });
          for (const id of ids) {
            if (visible) hidden.delete(id); else hidden.add(id);
          }
        }
      }]]),
      core: { update: async () => {} }
    };
    const hider = { getVisibilityMap: async () => ({ runtime: [...hidden] }) };
    const ctx = vm.createContext({
      Set, Map, Object, Promise, createVisibilityPolicy,
      OBC: { Hider: "hider", FragmentsManager: "fragments" }
    });
    let code = fs.readFileSync(new URL("../modules/visibility.module.ts", import.meta.url), "utf8");
    code = code.replace(/^import .*;\r?\n/gm, "").replace("export function", "function");
    vm.runInContext(stripTypeScriptTypes(code), ctx);
    const visibility = ctx.setupVisibility({ components: {
      get: (id) => id === "hider" ? hider : fragments
    } });
    await visibility.toggleBucket(parameterVisibilityKey("Pset", "Type", "A"),
      async () => ({ runtime: new Set([1]) }));
    await visibility.setModelVisible("runtime", false);
    assert.deepEqual([...hidden].sort(), [1, 2, 3]);
    await visibility.setModelVisible("runtime", true);
    assert.deepEqual([...hidden], [1]);
    await visibility.isolate({ runtime: new Set([2]) });
    assert.deepEqual([...hidden].sort(), [1, 3]);
    await visibility.clearFocus();
    assert.deepEqual([...hidden], [1]);
    await visibility.showAll();
    assert.equal(hidden.size, 0);
    assert.ok(writes.length > 0);
  });
}
