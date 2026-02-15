// UnderControl Web Clipper - Background Service Worker
// AGPL-3.0 License

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "capture") {
    handleCapture(message.tabId).then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message })
    );
    return true; // keep channel open for async response
  }

  if (message.action === "login") {
    handleLogin(message.apiUrl, message.username, message.password)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "captureResult") {
    // Content script sends captured HTML here
    handleCaptureResult(message).then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message })
    );
    return true;
  }
});

async function getConfig() {
  const data = await chrome.storage.local.get(["api_url", "auth_tokens"]);
  return {
    apiUrl: data.api_url || "http://localhost:4000",
    tokens: data.auth_tokens || null,
  };
}

async function apiFetch(path, options = {}) {
  const config = await getConfig();
  if (!config.tokens) throw new Error("Not logged in");

  const url = `${config.apiUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.tokens.accessToken}`,
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    // Try token refresh
    const refreshed = await refreshToken(config);
    if (!refreshed) throw new Error("Session expired, please login again");

    const newConfig = await getConfig();
    headers.Authorization = `Bearer ${newConfig.tokens.accessToken}`;
    const retryRes = await fetch(url, { ...options, headers });
    if (!retryRes.ok) {
      const err = await retryRes.json().catch(() => ({}));
      throw new Error(err.message || `API error: ${retryRes.status}`);
    }
    return retryRes;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `API error: ${res.status}`);
  }
  return res;
}

async function refreshToken(config) {
  try {
    const res = await fetch(`${config.apiUrl}/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: config.tokens.refreshToken }),
    });
    if (!res.ok) return false;

    const data = await res.json();
    await chrome.storage.local.set({
      auth_tokens: { ...config.tokens, accessToken: data.accessToken },
    });
    return true;
  } catch {
    return false;
  }
}

async function handleLogin(apiUrl, username, password) {
  const res = await fetch(`${apiUrl}/auth/v2/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Login failed");
  }

  const data = await res.json();
  await chrome.storage.local.set({
    api_url: apiUrl,
    auth_tokens: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      userId: data.userId,
      userName: data.userName,
    },
  });

  return { success: true, userName: data.userName };
}

async function handleCapture(tabId) {
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

  // Step 2: Tell the content script to start capturing
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Capture timed out")), 120000);

    const listener = (msg, sender) => {
      if (msg.action === "captureComplete" && sender.tab?.id === tabId) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        uploadAndCreateTask(msg.title, msg.url, msg.html, msg.filename)
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
    chrome.tabs.sendMessage(tabId, { action: "startCapture" }).catch(err => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      reject(err);
    });
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
