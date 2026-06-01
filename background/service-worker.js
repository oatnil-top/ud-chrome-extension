// UnderControl Web Clipper - Background Service Worker
// AGPL-3.0 License

// Track the current capture so it can be cancelled
let currentCapture = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "capture") {
    runCapture(message.tabId, message.customTitle, message.tags);
    sendResponse({ started: true });
  }
  if (message.action === "localCapture") {
    runLocalCapture(message.tabId);
    sendResponse({ started: true });
  }
  if (message.action === "bilibiliTranscript") {
    runBilibiliTranscript(message.tabId, message.customTitle, message.tags, message.local);
    sendResponse({ started: true });
  }
  if (message.action === "cancelCapture") {
    if (currentCapture) {
      currentCapture.cancelled = true;
      if (currentCapture.timeoutId) clearTimeout(currentCapture.timeoutId);
      if (currentCapture.listener) chrome.runtime.onMessage.removeListener(currentCapture.listener);
      if (currentCapture.reject) currentCapture.reject(new Error("Cancelled"));
      currentCapture = null;
    }
    chrome.storage.local.remove(["capture_status", "capture_title", "capture_error"]);
    sendResponse({ cancelled: true });
  }
});

function toDataUrl(content, mimeType) {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function setStatus(status, data = {}) {
  await chrome.storage.local.set({ capture_status: status, ...data });
}

async function runCapture(tabId, customTitle, tags) {
  currentCapture = { cancelled: false };
  try {
    await setStatus("saving");
    const result = await handleCapture(tabId, customTitle, tags);
    if (currentCapture?.cancelled) return;
    if (result.success) {
      await setStatus("success", { capture_title: result.title });
    } else {
      await setStatus("error", { capture_error: result.error });
    }
  } catch (err) {
    if (currentCapture?.cancelled) return;
    await setStatus("error", { capture_error: err.message });
  } finally {
    currentCapture = null;
  }
}

async function getConfig() {
  const data = await chrome.storage.local.get([
    "api_url", "auth_method", "api_key", "access_token", "refresh_token",
  ]);
  return {
    apiUrl: data.api_url || "https://ud.oatnil.top/api",
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

async function handleCapture(tabId, customTitle, tags) {
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
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Capture timed out"));
    }, 120000);

    const listener = (msg, sender) => {
      if (msg.action === "captureComplete" && sender.tab?.id === tabId) {
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(listener);
        const taskTitle = customTitle || msg.title;
        uploadAndCreateTask(taskTitle, msg.url, msg.html, msg.filename, markdown, tags)
          .then(result => resolve(result))
          .catch(err => resolve({ success: false, error: err.message }));
      }
      if (msg.action === "captureError" && sender.tab?.id === tabId) {
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ success: false, error: msg.error });
      }
    };

    // Register on currentCapture so cancel can clean up
    if (currentCapture) {
      currentCapture.timeoutId = timeoutId;
      currentCapture.listener = listener;
      currentCapture.reject = reject;
    }

    chrome.runtime.onMessage.addListener(listener);
    chrome.tabs.sendMessage(tabId, { action: "startCapture" }).catch(() => {});
  });
}

// --- Local capture (no login required) ---

async function runLocalCapture(tabId) {
  currentCapture = { cancelled: false };
  try {
    await setStatus("saving");
    const result = await handleLocalCapture(tabId);
    if (currentCapture?.cancelled) return;
    if (result.success) {
      await setStatus("success", { capture_title: result.title });
    } else {
      await setStatus("error", { capture_error: result.error });
    }
  } catch (err) {
    if (currentCapture?.cancelled) return;
    await setStatus("error", { capture_error: err.message });
  } finally {
    currentCapture = null;
  }
}

async function handleLocalCapture(tabId) {
  // Step 1: Extract markdown (before SingleFile modifies the DOM)
  const markdown = await extractMarkdown(tabId);

  // Step 2: Inject SingleFile and capture HTML
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

  // Step 3: Wait for capture result
  const captureResult = await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Capture timed out"));
    }, 120000);

    const listener = (msg, sender) => {
      if (msg.action === "captureComplete" && sender.tab?.id === tabId) {
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg);
      }
      if (msg.action === "captureError" && sender.tab?.id === tabId) {
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error(msg.error));
      }
    };

    // Register on currentCapture so cancel can clean up
    if (currentCapture) {
      currentCapture.timeoutId = timeoutId;
      currentCapture.listener = listener;
      currentCapture.reject = reject;
    }

    chrome.runtime.onMessage.addListener(listener);
    chrome.tabs.sendMessage(tabId, { action: "startCapture" }).catch(() => {});
  });

  // Step 4: Download HTML file (use data URL since service workers lack URL.createObjectURL)
  const htmlDataUrl = toDataUrl(captureResult.html, "text/html");
  await chrome.downloads.download({
    url: htmlDataUrl,
    filename: captureResult.filename,
    saveAs: false,
  });

  // Step 5: Download Markdown file (if extracted)
  if (markdown) {
    const mdFilename = captureResult.filename.replace(/\.html$/, ".md");
    const mdDataUrl = toDataUrl(markdown, "text/markdown");
    await chrome.downloads.download({
      url: mdDataUrl,
      filename: mdFilename,
      saveAs: false,
    });
  }

  return { success: true, title: captureResult.title };
}

// --- Server upload (requires login) ---

async function uploadAndCreateTask(title, pageUrl, htmlContent, filename, markdown, tags) {
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
      path: "/web-clipper",
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
      tags: tags && tags.length > 0 ? tags : undefined,
      resourceIds: [resourceId],
    }),
  });
  const taskData = await taskRes.json();

  return { success: true, taskId: taskData.id, title: taskData.title };
}

// --- Bilibili transcript extraction ---

async function runBilibiliTranscript(tabId, customTitle, tags, local) {
  currentCapture = { cancelled: false };
  try {
    await setStatus("saving");
    const result = await handleBilibiliTranscript(tabId, customTitle, tags, local);
    if (currentCapture?.cancelled) return;
    if (result.success) {
      await setStatus("success", { capture_title: result.title });
    } else {
      await setStatus("error", { capture_error: result.error });
    }
  } catch (err) {
    if (currentCapture?.cancelled) return;
    await setStatus("error", { capture_error: err.message });
  } finally {
    currentCapture = null;
  }
}

async function handleBilibiliTranscript(tabId, customTitle, tags, local) {
  // Step 1: Extract video info from page
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/bilibili.js"],
  });

  const response = await chrome.tabs.sendMessage(tabId, { action: "extractBilibiliInfo" })
    .catch(() => null);

  if (!response?.success) {
    throw new Error(response?.error || "Failed to extract video info from this page");
  }

  let { bvid, cid, title, author, duration } = response;
  if (!bvid) throw new Error("Cannot find video ID on this page");

  // Step 2: If cid is missing, fetch from API
  if (!cid) {
    const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    const viewData = await viewRes.json();
    if (viewData.code !== 0) throw new Error("Failed to get video info from Bilibili");
    cid = viewData.data.cid;
    if (!title) title = viewData.data.title;
    if (!author) author = viewData.data.owner?.name;
    if (!duration) duration = viewData.data.duration;
  }

  // Step 3: Get subtitle list (may need SESSDATA cookie for some videos)
  const sessdata = await getBilibiliCookie("SESSDATA");
  const playerUrl = `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`;
  const fetchOptions = {};
  if (sessdata) {
    fetchOptions.headers = { Cookie: `SESSDATA=${sessdata}` };
  }

  const playerRes = await fetch(playerUrl, fetchOptions);
  const playerData = await playerRes.json();

  if (playerData.code !== 0) {
    throw new Error(`Bilibili API error: ${playerData.message || "Unknown error"}`);
  }

  const subtitles = playerData.data?.subtitle?.subtitles;
  if (!subtitles || subtitles.length === 0) {
    throw new Error("No subtitles available for this video. Only videos with CC or AI-generated subtitles are supported.");
  }

  // Step 4: Pick the best subtitle (prefer Chinese, then any available)
  const preferredLangs = ["zh-CN", "zh-Hans", "ai-zh", "zh", "zh-TW"];
  let selectedSub = subtitles.find((s) => preferredLangs.includes(s.lan));
  if (!selectedSub) selectedSub = subtitles[0];

  // Step 5: Download subtitle JSON
  let subtitleUrl = selectedSub.subtitle_url;
  if (subtitleUrl.startsWith("//")) subtitleUrl = "https:" + subtitleUrl;

  const subRes = await fetch(subtitleUrl);
  const subData = await subRes.json();

  if (!subData.body || subData.body.length === 0) {
    throw new Error("Subtitle file is empty");
  }

  // Step 6: Format as markdown
  const videoTitle = customTitle || title || "Untitled Video";
  const subtitleType = selectedSub.ai_type ? "AI generated" : "CC subtitle";
  const lang = selectedSub.lan_doc || selectedSub.lan || "unknown";
  const markdown = formatTranscriptMarkdown(videoTitle, author, duration, bvid, subtitleType, lang, subData.body);

  // Step 7: Save (local download or upload to server)
  if (local) {
    return await saveTranscriptLocal(videoTitle, markdown);
  } else {
    return await saveTranscriptToServer(videoTitle, markdown, tags);
  }
}

async function getBilibiliCookie(name) {
  try {
    const cookie = await chrome.cookies.get({
      url: "https://www.bilibili.com",
      name: name,
    });
    return cookie?.value || null;
  } catch {
    return null;
  }
}

function formatTranscriptMarkdown(title, author, duration, bvid, subtitleType, lang, body) {
  const durationStr = duration ? formatDuration(duration) : "unknown";

  let md = `# ${title}\n\n`;
  md += `- **Author**: ${author || "unknown"}\n`;
  md += `- **Duration**: ${durationStr}\n`;
  md += `- **Source**: https://www.bilibili.com/video/${bvid}\n`;
  md += `- **Subtitle**: ${subtitleType} (${lang})\n\n`;
  md += `---\n\n`;

  for (const item of body) {
    const ts = formatTimestamp(item.from);
    md += `**[${ts}]** ${item.content}\n\n`;
  }

  return md;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimestamp(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function saveTranscriptLocal(title, markdown) {
  const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff\s_-]/g, "_").substring(0, 100);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const filename = `${safeTitle}_${timestamp}.md`;

  const mdDataUrl = toDataUrl(markdown, "text/markdown");
  await chrome.downloads.download({
    url: mdDataUrl,
    filename: filename,
    saveAs: false,
  });

  return { success: true, title };
}

async function saveTranscriptToServer(title, markdown, tags) {
  const taskTags = tags && tags.length > 0 ? tags : ["bilibili-transcript"];

  const taskRes = await apiFetch("/todolist", {
    method: "POST",
    body: JSON.stringify({
      title: title || "Untitled Video",
      description: markdown,
      status: "todo",
      tags: taskTags,
    }),
  });
  const taskData = await taskRes.json();

  return { success: true, taskId: taskData.id, title: taskData.title };
}
