// Kept intentionally small: DevTools pages own the inspected-tab debugger session.
const ports = new Map();

async function disableStoredRules(storageKey) {
  if (!storageKey) return;
  const stored = await chrome.storage.local.get(storageKey);
  if (!Array.isArray(stored[storageKey])) return;
  const rules = stored[storageKey].map((rule) => ({ ...rule, enabled: false }));
  await chrome.storage.local.set({ [storageKey]: rules });
}

chrome.runtime.onConnect.addListener((port) => {
  const match = /^(devtools|panel):(\d+)$/.exec(port.name);
  if (!match) return;
  const role = match[1], tabId = Number(match[2]);
  let storageKey = null;
  if (!ports.has(tabId)) ports.set(tabId, new Set());
  ports.get(tabId).add(port);
  port.onMessage.addListener((message) => {
    if (message?.type === "PANEL_SESSION" && role === "panel") storageKey = message.storageKey;
    else if (message?.type === "DEVTOOLS_INIT") port.postMessage({ type: "READY", tabId });
    else for (const peer of ports.get(tabId) || []) if (peer !== port) peer.postMessage(message);
  });
  port.onDisconnect.addListener(() => {
    ports.get(tabId)?.delete(port);
    if (role === "panel") disableStoredRules(storageKey).catch((error) => console.warn("reqPatch", error));
  });
});
