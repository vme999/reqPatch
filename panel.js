import { applyPatch, jsonDiff, parseJson } from "./lib/json.js";
import { formatRequestCopy } from "./lib/format.js";

const tabId = chrome.devtools.inspectedWindow.tabId;
const port = chrome.runtime.connect({ name: `panel:${tabId}` });
const state = { requests: new Map(), selected: null, rules: [], attached: false, urlSearch: "", responseOverrides: new Map() };
let editingRuleId = null;
let siteOrigin = "";
const $ = (id) => document.getElementById(id);

function getInspectedSiteOrigin() {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval("location.origin", (result, exceptionInfo) => {
      resolve(!exceptionInfo && typeof result === "string" && /^https?:\/\//.test(result) ? result : "unknown");
    });
  });
}

function rulesStorageKey() {
  return `reqPatch.rules.${encodeURIComponent(siteOrigin)}`;
}

async function loadRules() {
  const stored = await chrome.storage.local.get(rulesStorageKey());
  const savedRules = Array.isArray(stored[rulesStorageKey()]) ? stored[rulesStorageKey()] : [];
  const hadEnabledRules = savedRules.some((rule) => rule.enabled);
  state.rules = savedRules.map((rule) => ({ ...rule, enabled: false }));
  if (hadEnabledRules) await persistRules();
}

async function persistRules() {
  await chrome.storage.local.set({ [rulesStorageKey()]: state.rules });
}

function isHttpFetchXhr(entry) {
  const url = entry?.request?.url || "";
  const type = String(entry?._resourceType || entry?.request?.resourceType || "").toLowerCase();
  return /^https?:\/\//i.test(url) && (!type || type === "fetch" || type === "xhr");
}

function requestFromHar(entry) {
  const request = entry.request || {}, response = entry.response || {};
  const override = state.responseOverrides.get(`${request.method}:${request.url}`);
  return { id: `${request.url}:${entry.startedDateTime}:${Math.random()}`, url: request.url, method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()), requestBody: request.postData?.text || "",
    status: response.status, responseBody: override?.responseBody || entry.responseBody || "", mimeType: response.content?.mimeType || "", matchedRuleId: override?.ruleId || null, diff: override?.diff || [] };
}

function renderList() {
  const list = $("request-list"); $("count").textContent = state.requests.size;
  if (!state.requests.size) { list.className = "empty"; list.textContent = "等待请求…"; return; }
  const query = state.urlSearch.trim().toLowerCase();
  const visibleRequests = [...state.requests.values()].reverse().filter((request) => !query || request.url.toLowerCase().includes(query));
  $("count").textContent = visibleRequests.length;
  if (!visibleRequests.length) { list.className = "empty"; list.textContent = query ? "没有匹配的 URL" : "等待请求…"; renderRules(); return; }
  list.className = ""; list.innerHTML = visibleRequests.map((r, index) =>
    `<div class="request ${r.id === state.selected ? "selected" : ""}" data-index="${index}"><span class="method">${escapeHtml(r.method)}</span><span class="status">${r.status || "—"}</span><div class="url">${escapeHtml(r.url)}</div></div>`).join("");
  list.querySelectorAll(".request").forEach((node) => node.onclick = () => { state.selected = visibleRequests[Number(node.dataset.index)]?.id || null; renderList(); renderDetail(); });
  renderRules();
}

function renderRules() {
  const list = $("rule-list");
  $("rule-count").textContent = state.rules.length;
  if (!state.rules.length) { list.className = "empty"; list.textContent = "暂无规则"; return; }
  list.className = "";
  list.innerHTML = state.rules.map((rule) => `<div class="rule"><div><span class="method">${rule.method}</span>${escapeHtml(rule.url)}</div><div><small>命中 ${rule.hits || 0} 次</small><button data-edit="${rule.id}">修改</button><button data-toggle="${rule.id}">${rule.enabled ? "停用" : "启用"}</button><button data-delete="${rule.id}">删除</button></div></div>`).join("");
  list.querySelectorAll("[data-edit]").forEach((button) => button.onclick = () => {
    const rule = state.rules.find((x) => x.id === button.dataset.edit);
    if (!rule) return;
    editingRuleId = rule.id;
    $("rule-url").value = rule.url;
    $("rule-method").value = rule.method;
    $("request-query").value = rule.requestQuery ? JSON.stringify(rule.requestQuery, null, 2) : "";
    $("request-ops").value = formatOperations(rule.requestOps);
    $("response-ops").value = formatOperations(rule.responseOps);
    $("rule-dialog").showModal();
  });
  list.querySelectorAll("[data-toggle]").forEach((button) => button.onclick = async () => { const rule = state.rules.find((x) => x.id === button.dataset.toggle); rule.enabled = !rule.enabled; renderRules(); await persistRules(); });
  list.querySelectorAll("[data-delete]").forEach((button) => button.onclick = async () => { state.rules = state.rules.filter((x) => x.id !== button.dataset.delete); renderRules(); await persistRules(); });
}

function renderDetail() {
  const detail = $("detail"), empty = $("empty-detail"), r = state.requests.get(state.selected);
  if (!r) { detail.hidden = true; empty.hidden = false; return; }
  empty.hidden = true; detail.hidden = false;
  const body = r.responseBody || "";
  detail.innerHTML = `<div class="detail-head"><div><h2>${escapeHtml(r.url)}</h2><div class="section-title">${escapeHtml(r.method)} · HTTP ${r.status || "—"} · ${escapeHtml(r.mimeType)}</div></div><div class="copy-actions"><button id="copy-md">复制</button></div></div>
  <div class="payload-grid"><div class="payload-pane"><div class="payload-title"><h3>Request Payload</h3><button class="copy-icon" data-copy-payload="requestBody" title="复制 Request Payload" aria-label="复制 Request Payload">⧉</button></div>${renderJsonOrText(r.requestBody)}</div><div class="payload-pane"><div class="payload-title"><h3>Response Body</h3><button class="copy-icon" data-copy-payload="responseBody" title="复制 Response Body" aria-label="复制 Response Body">⧉</button></div>${renderJsonOrText(body)}</div></div>
  ${r.diff.length ? `<h3>命中规则 Diff</h3><pre>${r.diff.map(d => `<span class="${d.before === undefined ? "diff-add" : d.after === undefined ? "diff-remove" : ""}">${escapeHtml(d.path)}: ${escapeHtml(JSON.stringify(d.before))} → ${escapeHtml(JSON.stringify(d.after))}</span>`).join("\n")}</pre>` : ""}`;
  $("copy-md").onclick = (event) => copyWithFeedback(event.currentTarget, () => copy(formatRequestCopy(r)), "复制");
  detail.querySelectorAll("[data-copy-payload]").forEach((button) => button.onclick = () => copyWithFeedback(button, () => copyExpandedJson(r[button.dataset.copyPayload] || ""), "⧉"));
}

function copyExpandedJson(raw) {
  const text = String(raw || "");
  const parsed = parseJson(text);
  return copy(parsed.error ? text : JSON.stringify(parsed.value, null, 2));
}

async function copyWithFeedback(button, action, originalLabel) {
  await action();
}

function renderJsonOrText(raw) {
  const text = String(raw || "").trim();
  if (!text) return `<pre class="empty-body">(empty)</pre>`;
  const parsed = parseJson(text);
  return parsed.error ? `<pre>${escapeHtml(raw)}</pre>` : `<div class="json-tree">${renderJsonNode(parsed.value, "根")}</div>`;
}

function renderJsonNode(value, key) {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
    const marker = Array.isArray(value) ? `数组 [${entries.length}]` : `对象 {${entries.length}}`;
    if (!entries.length) return `<details open><summary><span class="json-key">${escapeHtml(key)}</span>: ${marker}</summary></details>`;
    return `<details open><summary><span class="json-key">${escapeHtml(key)}</span>: ${marker}</summary><div class="json-children">${entries.map(([childKey, childValue]) => renderJsonNode(childValue, childKey)).join("")}</div></details>`;
  }
  return `<div class="json-leaf"><span class="json-key">${escapeHtml(key)}</span>: <span class="json-value ${value === null ? "null" : typeof value}">${escapeHtml(JSON.stringify(value))}</span></div>`;
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c])); }
async function copy(text) { await navigator.clipboard.writeText(text); }

function parseOperations(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [op, path, ...rest] = line.split(/\s+/); if (!["add", "replace", "remove"].includes(op) || !path) throw new Error(`无效操作: ${line}`);
    return { op, path, value: op === "remove" ? undefined : JSON.parse(rest.join(" ")) };
  });
}

function decodeBase64(text) {
  const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function formatOperations(operations = []) {
  return operations.map(({ op, path, value }) => op === "remove" ? `${op} ${path}` : `${op} ${path} ${JSON.stringify(value)}`).join("\n");
}

async function ensureDebugger() {
  if (state.attached) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  await chrome.debugger.sendCommand({ tabId }, "Network.enable");
  await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Fetch", requestStage: "Request" }, { urlPattern: "*", resourceType: "XHR", requestStage: "Request" }, { urlPattern: "*", resourceType: "Fetch", requestStage: "Response" }, { urlPattern: "*", resourceType: "XHR", requestStage: "Response" }] });
  state.attached = true; $("connection").textContent = "已连接";
}

chrome.debugger.onDetach.addListener((source) => { if (source.tabId === tabId) { state.attached = false; $("connection").textContent = "已断开"; } });
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (source.tabId !== tabId || method !== "Fetch.requestPaused") return;
  const request = params.request, rule = state.rules.find((x) => x.enabled && x.method === request.method && request.url.startsWith(x.url));
  try {
    if (!rule) return await chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId: params.requestId });
    const isResponse = params.responseStatusCode !== undefined;
    if (!isResponse) {
      rule.hits = (rule.hits || 0) + 1;
      renderRules();
      let url = request.url;
      if (rule.requestQuery) { const parsed = new URL(url); for (const [key, value] of Object.entries(rule.requestQuery)) parsed.searchParams.set(key, String(value)); url = parsed.toString(); }
      let postData = request.postData;
      if (rule.requestOps?.length && postData) { const parsed = parseJson(postData); if (!parsed.error) postData = JSON.stringify(applyPatch(parsed.value, rule.requestOps)); }
      await chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId: params.requestId, url, postData: postData || undefined });
      return;
    }
    const result = await chrome.debugger.sendCommand({ tabId }, "Fetch.getResponseBody", { requestId: params.requestId });
    const raw = result?.base64Encoded ? decodeBase64(result.body || "") : (result?.body || ""), parsed = parseJson(raw);
    if (rule.responseOps?.length && !parsed.error) { const changed = applyPatch(parsed.value, rule.responseOps), diff = jsonDiff(parsed.value, changed), responseBody = JSON.stringify(changed); rule.lastDiff = diff; state.responseOverrides.set(`${request.method}:${request.url}`, { ruleId: rule.id, responseBody, diff }); const matchedRequest = [...state.requests.values()].reverse().find((item) => item.method === request.method && item.url === request.url); if (matchedRequest) { matchedRequest.matchedRuleId = rule.id; matchedRequest.responseBody = responseBody; matchedRequest.diff = diff; if (state.selected === matchedRequest.id) renderDetail(); } await chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", { requestId: params.requestId, responseCode: params.responseStatusCode, responseHeaders: params.responseHeaders, body: btoa(unescape(encodeURIComponent(responseBody))) }); }
    else await chrome.debugger.sendCommand({ tabId }, "Fetch.continueResponse", { requestId: params.requestId });
  } catch (error) { console.warn("reqPatch", error); try { await chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId: params.requestId }); } catch (_) {} }
});

port.onMessage.addListener((message) => { if (message.type === "NETWORK_ENTRY" && isHttpFetchXhr(message.entry)) { const item = requestFromHar(message.entry); state.requests.set(item.id, item); renderList(); } if (message.type === "NAVIGATED") { state.requests.clear(); state.selected = null; renderList(); renderDetail(); } });

$("clear").onclick = () => { state.requests.clear(); state.selected = null; renderList(); renderDetail(); };
$("url-search").oninput = (event) => { state.urlSearch = event.target.value; renderList(); };
function setView(view) {
  const showingRules = view === "rules";
  $("requests-view").hidden = showingRules;
  $("rules-view").hidden = !showingRules;
  $("requests-tab").classList.toggle("active", !showingRules);
  $("rules-tab").classList.toggle("active", showingRules);
}
$("requests-tab").onclick = () => setView("requests");
$("rules-tab").onclick = () => setView("rules");

const splitter = $("splitter");
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  button.classList.remove("clicked");
  requestAnimationFrame(() => {
    button.classList.add("clicked");
    window.setTimeout(() => button.classList.remove("clicked"), 200);
  });
}, true);
let dragging = false;
splitter.onpointerdown = (event) => { dragging = true; splitter.setPointerCapture(event.pointerId); document.body.classList.add("resizing"); };
splitter.onpointermove = (event) => {
  if (!dragging) return;
  const minLeft = 240, minRight = 320;
  const left = Math.max(minLeft, Math.min(event.clientX, window.innerWidth - minRight));
  $("splitter").parentElement.style.gridTemplateColumns = `${left}px 5px minmax(${minRight}px, 1fr)`;
};
splitter.onpointerup = (event) => { dragging = false; splitter.releasePointerCapture(event.pointerId); document.body.classList.remove("resizing"); };
splitter.onkeydown = (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const current = splitter.getBoundingClientRect().left;
  const next = current + (event.key === "ArrowRight" ? 20 : -20);
  const left = Math.max(240, Math.min(next, window.innerWidth - 320));
  splitter.parentElement.style.gridTemplateColumns = `${left}px 5px minmax(320px, 1fr)`;
};
$("add-rule").onclick = () => {
  editingRuleId = null;
  const selectedRequest = state.requests.get(state.selected);
  const selectedUrl = selectedRequest ? (() => { const url = new URL(selectedRequest.url); url.search = ""; url.hash = ""; return url.toString(); })() : "";
  $("rule-url").value = selectedUrl;
  $("rule-method").value = selectedRequest?.method || "GET";
  $("request-query").value = "";
  $("request-ops").value = "";
  $("response-ops").value = "";
  $("rule-dialog").showModal();
};
$("cancel-rule").onclick = () => $("rule-dialog").close();
$("rule-dialog").addEventListener("cancel", (event) => { event.preventDefault(); $("rule-dialog").close(); });
$("save-rule").onclick = async (event) => { event.preventDefault(); try { const queryText = $("request-query").value.trim(); const query = queryText ? JSON.parse(queryText) : null; if (query && (typeof query !== "object" || Array.isArray(query))) throw new Error("Query 参数必须是 JSON 对象"); const requestOps = parseOperations($("request-ops").value), responseOps = parseOperations($("response-ops").value); const existingRule = state.rules.find((rule) => rule.id === editingRuleId); if (existingRule) { existingRule.url = $("rule-url").value.trim(); existingRule.method = $("rule-method").value; existingRule.requestQuery = query; existingRule.requestOps = requestOps; existingRule.responseOps = responseOps; } else { state.rules.push({ id: crypto.randomUUID(), url: $("rule-url").value.trim(), method: $("rule-method").value, requestQuery: query, requestOps, responseOps, enabled: true, hits: 0 }); } await persistRules(); editingRuleId = null; $("rule-dialog").close(); renderRules(); await ensureDebugger(); } catch (error) { alert(error.message); } };

async function initialize() {
  siteOrigin = await getInspectedSiteOrigin();
  await loadRules();
  port.postMessage({ type: "PANEL_SESSION", storageKey: rulesStorageKey() });
  renderList();
  renderRules();
  await ensureDebugger();
}

initialize().catch((error) => { $("connection").textContent = "需要 debugger 权限"; console.warn(error); });
