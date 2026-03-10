/**
 * background.js - Service Worker for API Skill Generator
 *
 * Captures HTTP request/response pairs using chrome.debugger API
 * and stores them in memory for the side panel to consume.
 */

// In-memory store: key = "METHOD /path" -> request data
const capturedRequests = new Map();

// Track which tabs have debugger attached
const attachedTabs = new Set();

// Pending request bodies keyed by requestId
const pendingBodies = new Map();

// Pending request metadata keyed by requestId
const pendingRequests = new Map();

// --- Debugger-based capture ---

function getDedupeKey(method, url) {
  try {
    const u = new URL(url);
    return `${method} ${u.pathname}`;
  } catch {
    return `${method} ${url}`;
  }
}

function parseQueryParams(url) {
  try {
    const u = new URL(url);
    const params = {};
    u.searchParams.forEach((value, key) => {
      if (params[key]) {
        if (Array.isArray(params[key])) {
          params[key].push(value);
        } else {
          params[key] = [params[key], value];
        }
      } else {
        params[key] = value;
      }
    });
    return params;
  } catch {
    return {};
  }
}

function headersArrayToObject(headers) {
  const obj = {};
  if (Array.isArray(headers)) {
    headers.forEach(h => {
      obj[h.name] = h.value;
    });
  }
  return obj;
}

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
    attachedTabs.add(tabId);
    console.log(`[api2skill] Debugger attached to tab ${tabId}`);
  } catch (err) {
    console.warn(`[api2skill] Failed to attach debugger to tab ${tabId}:`, err.message);
  }
}

function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  chrome.debugger.detach({ tabId }).catch(() => {});
  attachedTabs.delete(tabId);
}

// Listen for debugger events
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;

  if (method === 'Network.requestWillBeSent') {
    const { requestId, request } = params;
    // Store request metadata
    pendingRequests.set(requestId, {
      tabId,
      url: request.url,
      method: request.method,
      headers: request.headers || {},
      postData: request.postData || null,
      timestamp: Date.now()
    });
  }

  if (method === 'Network.responseReceived') {
    const { requestId, response } = params;
    const reqMeta = pendingRequests.get(requestId);
    if (!reqMeta) return;

    // Skip non-HTTP requests and extension/chrome internal requests
    if (!response.url.startsWith('http')) return;

    // Skip known non-API content types
    const contentType = response.headers['content-type'] || response.headers['Content-Type'] || '';
    const isLikelyAPI = contentType.includes('json') ||
                        contentType.includes('xml') ||
                        contentType.includes('text/plain') ||
                        contentType.includes('text/html');

    // Store response info for body retrieval
    pendingBodies.set(requestId, {
      ...reqMeta,
      statusCode: response.status,
      responseHeaders: response.headers,
      contentType,
      isLikelyAPI
    });
  }

  if (method === 'Network.loadingFinished') {
    const { requestId } = params;
    const info = pendingBodies.get(requestId);
    if (!info) return;

    // Try to get response body
    chrome.debugger.sendCommand(
      { tabId: info.tabId },
      'Network.getResponseBody',
      { requestId }
    ).then(result => {
      const responseBody = result.body || '';
      const key = getDedupeKey(info.method, info.url);

      let requestBody = null;
      if (info.postData) {
        try {
          requestBody = JSON.parse(info.postData);
        } catch {
          requestBody = info.postData;
        }
      }

      capturedRequests.set(key, {
        url: info.url,
        method: info.method,
        request_headers: info.headers,
        query_params: parseQueryParams(info.url),
        request_body: requestBody,
        response_body: responseBody,
        status_code: info.statusCode,
        content_type: info.contentType,
        timestamp: info.timestamp
      });
    }).catch(() => {
      // Some responses can't have their body retrieved (e.g. redirects)
    }).finally(() => {
      pendingBodies.delete(requestId);
      pendingRequests.delete(requestId);
    });
  }
});

// Handle debugger detach (e.g., user closed DevTools conflict)
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    console.log(`[api2skill] Debugger detached from tab ${source.tabId}: ${reason}`);
  }
});

// Auto-attach on tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    attachDebugger(tabId);
  }
});

// Cleanup on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
  // Clean up pending data for this tab
  for (const [rid, info] of pendingRequests.entries()) {
    if (info.tabId === tabId) pendingRequests.delete(rid);
  }
  for (const [rid, info] of pendingBodies.entries()) {
    if (info.tabId === tabId) pendingBodies.delete(rid);
  }
});

// Open side panel on action click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// --- Message handling for side panel ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getRequests') {
    const list = [];
    for (const [key, data] of capturedRequests.entries()) {
      list.push({
        key,
        url: data.url,
        method: data.method,
        status_code: data.status_code,
        timestamp: data.timestamp
      });
    }
    // Sort newest first
    list.sort((a, b) => b.timestamp - a.timestamp);
    sendResponse({ requests: list });
    return true;
  }

  if (message.type === 'getRequestDetail') {
    const data = capturedRequests.get(message.key);
    sendResponse({ data: data || null });
    return true;
  }

  if (message.type === 'clearRequests') {
    capturedRequests.clear();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'startCapture') {
    // Attach debugger to the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        attachDebugger(tabs[0].id).then(() => {
          sendResponse({ success: true });
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
      } else {
        sendResponse({ success: false, error: 'No active tab' });
      }
    });
    return true;
  }
});
