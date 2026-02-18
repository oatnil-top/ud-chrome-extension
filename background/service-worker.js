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
  const data = await chrome.storage.local.get([
    "api_url", "auth_method", "api_key", "access_token", "refresh_token",
  ]);
  return {
    apiUrl: data.api_url || "http://localhost:4000",
    authMethod: data.auth_method || null, // "apikey" or "login"
    apiKey: data.api_key || null,
    accessToken: data.access_token || null,
    refreshToken: data.refresh_token || null,
  };
}

function getBearerToken(config) {
  if (config.authMethod === "apikey" && config.apiKey) return config.apiKey;
  if (config.authMethod === "login" && config.accessToken) return config.accessToken;
  return null;
}

async function refreshAccessToken() {
  const config = await getConfig();
  if (!config.refreshToken) throw new Error("Session expired. Please log in again.");

  const res = await fetch(`${config.apiUrl}/auth/refresh-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: config.refreshToken }),
  });

  if (!res.ok) {
    await chrome.storage.local.remove(["access_token", "refresh_token", "user_name", "auth_method"]);
    throw new Error("Session expired. Please log in again.");
  }

  const data = await res.json();
  await chrome.storage.local.set({
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
  });
  return data.accessToken;
}

async function apiFetch(path, options = {}, _retried = false) {
  const config = await getConfig();
  const token = getBearerToken(config);
  if (!token) throw new Error("Not authenticated. Please log in or set an API key.");

  const url = `${config.apiUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });

  // On 401 with login auth, try refreshing the token once
  if (res.status === 401 && config.authMethod === "login" && !_retried) {
    await refreshAccessToken();
    return apiFetch(path, options, true);
  }

  if (res.status === 401) {
    const msg = config.authMethod === "apikey"
      ? "Invalid API key. Please check your settings."
      : "Session expired. Please log in again.";
    throw new Error(msg);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `API error: ${res.status}`);
  }
  return res;
}

async function extractMarkdown(tabId) {
  // Inject Readability + Turndown + markdown extraction script
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "lib/Readability.js",
      "lib/turndown.js",
      "lib/turndown-plugin-gfm.js",
      "content/markdown.js",
    ],
  });

  // Request markdown extraction (synchronous response from content script)
  const [response] = await chrome.tabs.sendMessage(tabId, { action: "extractMarkdown" })
    .then(r => [r])
    .catch(() => [null]);

  if (response?.success) {
    return response.markdown;
  }
  // Non-fatal: if markdown extraction fails, we still save the HTML snapshot
  console.warn("Markdown extraction failed:", response?.error || "No response");
  return null;
}

async function handleCapture(tabId, customTitle) {
  // Step 1: Inject Readability + Turndown and extract markdown first
  // (before SingleFile modifies the DOM)
  const markdown = await extractMarkdown(tabId);

  // Step 2: Inject SingleFile libs + capture script into the tab
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

  // Step 3: Tell the content script to start capturing and wait for result
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
        uploadAndCreateTask(taskTitle, msg.url, msg.html, msg.filename, markdown)
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
    chrome.tabs.sendMessage(tabId, { action: "startCapture" }).catch(() => {});
  });
}

async function uploadAndCreateTask(title, pageUrl, htmlContent, filename, markdown) {
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

  // Step 4: Build description with source URL and markdown content
  let description = "";
  if (pageUrl) description += `Source: ${pageUrl}`;
  if (markdown) {
    if (description) description += "\n\n---\n\n";
    description += markdown;
  }

  // Step 5: Create task with resource attached and markdown in description
  const taskRes = await apiFetch("/todolist", {
    method: "POST",
    body: JSON.stringify({
      title: title || "Untitled Page",
      description,
      status: "todo",
      resourceIds: [resourceId],
    }),
  });
  const taskData = await taskRes.json();

  return { success: true, taskId: taskData.id, title: taskData.title };
}
