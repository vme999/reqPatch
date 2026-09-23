const tabId = chrome.devtools.inspectedWindow.tabId;

chrome.devtools.panels.create("reqPatch", "", "panel.html", (panel) => {
  panel.onShown.addListener((window) => {
    window.postMessage({ type: "REQPATCH_CONTEXT", tabId }, "*");
  });
});

const port = chrome.runtime.connect({ name: `devtools:${tabId}` });
let portConnected = true;
port.onDisconnect.addListener(() => { portConnected = false; });
function sendToPanel(message) {
  if (!portConnected) return;
  try { port.postMessage(message); } catch (_) { portConnected = false; }
}

function readResponseBody(entry) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(typeof result === "string" ? result : result?.content || "");
    };
    try {
      const result = entry.getContent(finish);
      if (result && typeof result.then === "function") result.then(finish).catch(() => finish(null));
    } catch (_) { finish(null); }
  });
}
sendToPanel({ type: "DEVTOOLS_INIT", tabId });

chrome.devtools.network.onRequestFinished.addListener(async (entry) => {
  const url = entry?.request?.url || "";
  const type = entry?._resourceType || entry?.request?.resourceType;
  if (!/^https?:\/\//i.test(url) || (type && !["fetch", "xhr"].includes(String(type).toLowerCase()))) return;
  const body = await readResponseBody(entry);
  sendToPanel({ type: "NETWORK_ENTRY", entry: { ...entry, responseBody: body } });
});

chrome.devtools.network.onNavigated.addListener(() => sendToPanel({ type: "NAVIGATED" }));
