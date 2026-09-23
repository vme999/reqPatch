export function parseJson(text) {
  try { return { value: JSON.parse(text), error: null }; } catch (error) { return { value: null, error: error.message }; }
}

export function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

export function jsonDiff(before, after, path = "$", result = []) {
  if (Object.is(before, after)) return result;
  const objectLike = (value) => value && typeof value === "object";
  if (!objectLike(before) || !objectLike(after) || Array.isArray(before) !== Array.isArray(after)) {
    result.push({ path, before, after }); return result;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) jsonDiff(before[key], after[key], `${path}.${key}`, result);
  return result;
}

export function applyPatch(document, operations = []) {
  const output = clone(document);
  for (const operation of operations) {
    const keys = String(operation.path || "").replace(/^\$\.?/, "").split(".").filter(Boolean);
    if (!keys.length) { if (operation.op === "replace") return clone(operation.value); continue; }
    let target = output;
    for (const key of keys.slice(0, -1)) {
      if (!target || typeof target !== "object") break;
      target = target[key];
    }
    const key = keys.at(-1);
    if (!target || typeof target !== "object") continue;
    if (operation.op === "remove") delete target[key];
    else if (["add", "replace"].includes(operation.op)) target[key] = clone(operation.value);
  }
  return output;
}
