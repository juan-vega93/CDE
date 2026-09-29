import assert from "node:assert/strict";
import test from "node:test";
import { createVisibilityPolicy, parameterVisibilityKey } from "./visibility-policy.ts";

const map = (...ids) => ({ model: new Set(ids) });
const key = (name) => parameterVisibilityKey("Pset", "Type", name);
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(beforeWrite = async () => {}) {
  const hidden = new Set();
  const writes = [];
  const policy = createVisibilityPolicy({
    readHidden: async () => ({ model: [...hidden] }),
    setVisible: async (items, visible) => {
      writes.push({ ids: [...items.model], visible });
      await beforeWrite(items, visible);
      for (const id of items.model) {
        if (visible) hidden.delete(id);
        else hidden.add(id);
      }
    },
    refresh: async () => {}
  });
  return { policy, hidden, writes, toggle: (name, ids) =>
    policy.toggleBucket(key(name), async () => map(...ids)) };
}

test("A: hide A writes only its delta; B and the rest remain visible", async () => {
  const f = fixture();
  await f.toggle("A", [1, 2]);
  assert.deepEqual([...f.hidden], [1, 2]);
  assert.deepEqual(f.writes, [{ ids: [1, 2], visible: false }]);
  assert.equal(f.hidden.has(3), false);
});
test("B/C: hide A then B; show A preserves B and the rest", async () => {
  const f = fixture();
  await f.toggle("A", [1, 2]);
  await f.toggle("B", [3]);
  assert.deepEqual([...f.hidden], [1, 2, 3]);
  await f.toggle("A", [1, 2]);
  assert.deepEqual([...f.hidden], [3]);
  assert.deepEqual(f.writes.at(-1), { ids: [1, 2], visible: true });
});
test("D: rapid toggles during an in-flight chunk converge to latest intent", async () => {
  const entered = deferred(), release = deferred();
  let first = true;
  const f = fixture(async () => {
    if (first) { first = false; entered.resolve(); await release.promise; }
  });
  const ids = Array.from({ length: 1200 }, (_, i) => i);
  const initial = f.toggle("A", ids);
  await entered.promise;
  const show = f.toggle("A", ids);
  const hide = f.toggle("A", ids);
  const lastShow = f.toggle("A", ids);
  release.resolve();
  await Promise.all([initial, show, hide, lastShow]);
  assert.equal(f.hidden.size, 0);
  assert.equal(f.policy.getSnapshot().has(key("A")), false);
  assert.ok(f.writes.every((write) => write.ids.length <= 450));
});
test("D: a newer bucket does not cancel the unfinished hiding of A", async () => {
  const entered = deferred(), release = deferred();
  let first = true;
  const f = fixture(async () => {
    if (first) { first = false; entered.resolve(); await release.promise; }
  });
  const a = f.toggle("A", Array.from({ length: 901 }, (_, i) => i));
  await entered.promise;
  const b = f.toggle("B", [1000]);
  release.resolve();
  await Promise.all([a, b]);
  assert.equal(f.hidden.size, 902);
});
test("late expansion cannot overwrite a newer toggle or Show All", async () => {
  const f = fixture(), expansion = deferred();
  const old = f.policy.toggleBucket(key("A"), () => expansion.promise);
  await f.policy.showAll();
  await f.toggle("A", [9]);
  expansion.resolve(map(1));
  await old;
  assert.deepEqual([...f.hidden], [9]);
});
test("G: focus/viewpoint restriction composes with parameters; clearing it restores policy", async () => {
  const f = fixture();
  await f.toggle("A", [1]);
  await f.policy.setLayer("focus", map(2, 3));
  assert.deepEqual([...f.hidden], [1, 2, 3]);
  await f.policy.clearFocus();
  assert.deepEqual([...f.hidden], [1]);
  assert.equal(f.policy.getSnapshot().has(key("A")), true);
});
test("H: Show All clears effective hiding and the subscribed UI snapshot", async () => {
  const f = fixture();
  let ui;
  const unsubscribe = f.policy.subscribe(() => { ui = f.policy.getSnapshot(); });
  await f.toggle("A", [1]);
  await f.policy.hide(map(2));
  await f.policy.setLayer("focus", map(3));
  await f.policy.showAll();
  assert.equal(f.hidden.size, 0);
  assert.equal(ui.size, 0);
  unsubscribe();
});
test("I: unsubscribe/remount preserves the same policy and UI snapshot", async () => {
  const f = fixture();
  const unsubscribe = f.policy.subscribe(() => {});
  await f.toggle("A", [1]);
  unsubscribe();
  const remountedSnapshot = f.policy.getSnapshot();
  assert.equal(remountedSnapshot.has(key("A")), true);
  assert.deepEqual([...f.hidden], [1]);
});
for (const source of ["ifc", "frag"]) {
  test("J: identical policy for " + source + " runtime models", async () => {
    const hidden = new Set();
    const modelId = source + "-ephemeral-id";
    const policy = createVisibilityPolicy({
      readHidden: async () => ({ [modelId]: [...hidden] }),
      setVisible: async (items, visible) => {
        for (const id of items[modelId]) {
          if (visible) hidden.delete(id); else hidden.add(id);
        }
      },
      refresh: async () => {}
    });
    const resolve = async () => ({ [modelId]: new Set([7, 8]) });
    await policy.toggleBucket(key("A"), resolve);
    await policy.reconcile();
    assert.deepEqual([...hidden], [7, 8]);
    await policy.toggleBucket(key("A"), resolve);
    assert.equal(hidden.size, 0);
  });
}
test("overlapping buckets and manual hiding are composed, never made visible by another layer", async () => {
  const f = fixture();
  await f.toggle("A", [1, 2]);
  await f.toggle("B", [2, 3]);
  await f.policy.hide(map(1));
  await f.toggle("A", [1, 2]);
  assert.deepEqual([...f.hidden].sort(), [1, 2, 3]);
  await f.policy.clearParameters();
  assert.deepEqual([...f.hidden], [1]);
});
test("failed expansion rolls back its UI intention", async () => {
  const f = fixture();
  await assert.rejects(f.policy.toggleBucket(key("A"), async () => { throw Error("failed"); }));
  assert.equal(f.policy.getSnapshot().has(key("A")), false);
  assert.equal(f.hidden.size, 0);
});
test("dispose prevents late asynchronous work from reaching an old viewer", async () => {
  const f = fixture(), expansion = deferred();
  const pending = f.policy.toggleBucket(key("A"), () => expansion.promise);
  f.policy.dispose();
  expansion.resolve(map(1));
  await pending;
  assert.equal(f.writes.length, 0);
});

test("model restrictions compose and clearing a model does not clear a similarly named model", async () => {
  const f = fixture();
  await f.policy.setLayer("model:a", map(1));
  await f.policy.setLayer("model:ab", map(2));
  await f.policy.clearLayer("model:a");
  assert.deepEqual([...f.hidden], [2]);
});
test("an older focus resolver cannot undo Show All or a newer focus", async () => {
  const f = fixture(), gate = deferred();
  const old = f.policy.resolveLayer("focus", () => gate.promise);
  await f.policy.showAll();
  await f.policy.setLayer("focus", map(3));
  gate.resolve(map(1));
  await old;
  assert.deepEqual([...f.hidden], [3]);
});
