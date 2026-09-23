import test from "node:test";
import assert from "node:assert/strict";
import { applyPatch, jsonDiff, parseJson } from "../lib/json.js";

test("applies add, replace and remove operations", () => {
  const original = { user: { name: "Bob", stale: true } };
  const changed = applyPatch(original, [
    { op: "replace", path: "$.user.name", value: "Alice" },
    { op: "remove", path: "$.user.stale" },
    { op: "add", path: "$.debug", value: true }
  ]);
  assert.deepEqual(changed, { user: { name: "Alice" }, debug: true });
  assert.deepEqual(original, { user: { name: "Bob", stale: true } });
  assert.equal(jsonDiff(original, changed).length, 3);
});

test("reports invalid JSON without throwing", () => {
  assert.equal(parseJson("not json").value, null);
  assert.ok(parseJson("not json").error);
});
