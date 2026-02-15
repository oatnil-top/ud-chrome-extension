// UnderControl Web Clipper - Background Service Worker
// AGPL-3.0 License

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "capture") {
    runCapture(message.tabId, message.customTitle);
    sendResponse({ started: true }); // Ack immediately to close channel
  }
});

async function setStatus(status, data = {}) {
  await chrome.storage.local.set({ capture_status: status, ...data });
}

async function runCapture(tabId, customTitle) {
  try {
    await setStatus("saving");
    const result = await handleCapture(tabId, customTitle);
    if (result.success) {
      await setStatus("success", { capture_title: result.title });
    } else {
      await setStatus("error", { capture_error: result.error });
    }
  } catch (err) {
    await setStatus("error", { capture_error: err.message });
  }
}

async function getConfig() {
  const data = await chrome.storage.local.get(["api_url", "api_key"]);
  return {
    apiUrl: data.api_url || "http://localhost:4000",
    apiKey: data.api_key || null,
  };
}

async function apiFetch(path, options = {}) {
  const config = await getConfig();
  if (!config.apiKey) throw new Error("API key not configured");

  const url = `${config.apiUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    throw new Error("Invalid API key. Please check your settings.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `API error: ${res.status}`);
  }
  return res;
}

async function handleCapture(tabId, customTitle) {
  // Step 1: Inject SingleFile libs + capture script into the tab
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [
      "lib/chrome-browser-polyfill.js",
      "lib/single-file-hooks-frames.js",
      "lib/single-file-frames.js",
    ],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "lib/chrome-browser-polyfill.js",
      "lib/single-file-bootstrap.js",
      "lib/single-file.js",
      "content/capture.js",
    ],
  });

  // Step 2: Tell the content script to start capturing and wait for result
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Capture timed out"));
    }, 120000);

    const listener = (msg, sender) => {
      if (msg.action === "captureComplete" && sender.tab?.id === tabId) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        const taskTitle = customTitle || msg.title;
        uploadAndCreateTask(taskTitle, msg.url, msg.html, msg.filename)
          .then(result => resolve(result))
          .catch(err => resolve({ success: false, error: err.message }));
      }
      if (msg.action === "captureError" && sender.tab?.id === tabId) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ success: false, error: msg.error });
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    // Content script returns true (async) but sends results via chrome.runtime.sendMessage,
    // so we ignore the sendMessage promise — results come through the listener above.
    chrome.tabs.sendMessage(tabId, { action: "startCapture" }).catch(() => {});
  });
}

async function uploadAndCreateTask(title, pageUrl, htmlContent, filename) {
  const blob = new Blob([htmlContent], { type: "text/html" });

  // Step 1: Prepare resource upload
  const prepareRes = await apiFetch("/resources/upload", {
    method: "POST",
    body: JSON.stringify({
      originalName: filename,
      mimeType: "text/html",
      fileSize: blob.size,
      resourceType: "document",
      uploadMethod: "chrome-extension",
      path: "/",
    }),
  });
  const prepareData = await prepareRes.json();
  const resourceId = prepareData.resource.id;
  const uploadUrl = prepareData.uploadUrl;

  // Step 2: Upload file to presigned URL
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/html" },
    body: blob,
  });
  if (!uploadRes.ok) throw new Error("File upload failed");

  // Step 3: Confirm upload
  await apiFetch(`/resources/${resourceId}/confirm`, { method: "POST" });

  // Step 4: Create task with resource attached
  const taskRes = await apiFetch("/todolist", {
    method: "POST",
    body: JSON.stringify({
      title: title || "Untitled Page",
      description: pageUrl ? `Source: ${pageUrl}` : "",
      status: "todo",
      resourceIds: [resourceId],
    }),
  });
  const taskData = await taskRes.json();

  return { success: true, taskId: taskData.id, title: taskData.title };
}
