// UnderControl Web Clipper - Popup
// AGPL-3.0 License

const $ = (id) => document.getElementById(id);

const views = {
  setup: $("view-setup"),
  ready: $("view-ready"),
  saving: $("view-saving"),
  success: $("view-success"),
  error: $("view-error"),
  settings: $("view-settings"),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");

  const footer = $("footer");
  if (name === "setup" || name === "settings") {
    footer.classList.add("hidden");
  }
}

// Auth method tabs
$("tab-login").addEventListener("click", () => switchAuthTab("login"));
$("tab-apikey").addEventListener("click", () => switchAuthTab("apikey"));

function switchAuthTab(tab) {
  $("tab-login").classList.toggle("active", tab === "login");
  $("tab-apikey").classList.toggle("active", tab === "apikey");
  $("auth-login").classList.toggle("hidden", tab !== "login");
  $("auth-apikey").classList.toggle("hidden", tab !== "apikey");
  $("setup-status").classList.add("hidden");
}

// Test connection helper (for API key)
async function testConnection(apiUrl, apiKey, statusEl) {
  statusEl.textContent = "Testing...";
  statusEl.className = "status-msg testing";
  statusEl.classList.remove("hidden");

  try {
    const res = await fetch(`${apiUrl}/auth/profile`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 401) {
      statusEl.textContent = "Invalid API key";
      statusEl.className = "status-msg fail";
      return false;
    }

    if (!res.ok) {
      statusEl.textContent = `Server error: ${res.status}`;
      statusEl.className = "status-msg fail";
      return false;
    }

    const data = await res.json();
    statusEl.textContent = `Connected as ${data.username || data.sub || "user"}`;
    statusEl.className = "status-msg ok";
    return true;
  } catch (err) {
    statusEl.textContent = err.message?.includes("fetch")
      ? "Cannot reach server"
      : err.message || "Connection failed";
    statusEl.className = "status-msg fail";
    return false;
  }
}

// Listen for status changes from service worker
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.capture_status) {
    const status = changes.capture_status.newValue;
    const data = await chrome.storage.local.get(["auth_method", "api_key", "access_token"]);
    const isAuthenticated =
      (data.auth_method === "apikey" && data.api_key) ||
      (data.auth_method === "login" && data.access_token);

    if (status === "saving") {
      showView("saving");
      if (isAuthenticated) $("footer").classList.remove("hidden");
    } else if (status === "success") {
      const title = changes.capture_title?.newValue || "";
      $("saved-title").textContent = title;
      showView("success");
      if (isAuthenticated) $("footer").classList.remove("hidden");
      setTimeout(() => window.close(), 2000);
    } else if (status === "error") {
      const error = changes.capture_error?.newValue || "Save failed";
      $("error-message").textContent = error;
      showView("error");
      if (isAuthenticated) $("footer").classList.remove("hidden");
    }
  }
});

// Init: check if authenticated, prefill page title
async function init() {
  const data = await chrome.storage.local.get([
    "api_url", "auth_method", "api_key", "access_token", "refresh_token",
    "user_name", "capture_status",
  ]);
  const apiUrl = data.api_url || "https://ud.oatnil.top/api";

  $("api-url").value = apiUrl;
  $("settings-api-url").value = apiUrl;

  const isAuthenticated =
    (data.auth_method === "apikey" && data.api_key) ||
    (data.auth_method === "login" && data.access_token);

  if (isAuthenticated) {
    $("display-name").textContent = data.user_name || "Connected";
    $("footer").classList.remove("hidden");

    if (data.capture_status === "saving") {
      showView("saving");
    } else {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        $("task-title").value = tab?.title || "";
      } catch {}
      renderTags();
      showView("ready");
    }
  } else {
    showView("setup");
  }
}

function showStatus(elementId, text, className) {
  const el = $(elementId);
  el.textContent = text;
  el.className = `status-msg ${className}`;
  el.classList.remove("hidden");
}

// --- Login auth ---
$("btn-login").addEventListener("click", () => doLogin());
$("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  const apiUrl = $("api-url").value.replace(/\/+$/, "");
  const username = $("username").value.trim();
  const password = $("password").value;

  if (!apiUrl || !username || !password) {
    showStatus("setup-status", "All fields are required", "fail");
    return;
  }

  showStatus("setup-status", "Logging in...", "testing");

  try {
    const res = await fetch(`${apiUrl}/auth/v2/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.status === 401) {
      showStatus("setup-status", "Invalid username or password", "fail");
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showStatus("setup-status", err.message || `Error: ${res.status}`, "fail");
      return;
    }

    const data = await res.json();
    await chrome.storage.local.set({
      api_url: apiUrl,
      auth_method: "login",
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
      user_name: data.userName || username,
    });
    // Clear any leftover API key
    await chrome.storage.local.remove(["api_key"]);

    init();
  } catch (err) {
    showStatus(
      "setup-status",
      err.message?.includes("fetch") ? "Cannot reach server" : err.message || "Login failed",
      "fail"
    );
  }
}

// --- API Key auth ---
$("btn-test").addEventListener("click", async () => {
  const apiUrl = $("api-url").value.replace(/\/+$/, "");
  const apiKey = $("api-key").value.trim();
  if (!apiUrl || !apiKey) {
    showStatus("setup-status", "Both fields are required", "fail");
    return;
  }
  await testConnection(apiUrl, apiKey, $("setup-status"));
});

$("btn-save-key").addEventListener("click", async () => {
  const apiUrl = $("api-url").value.replace(/\/+$/, "");
  const apiKey = $("api-key").value.trim();

  if (!apiUrl || !apiKey) {
    showStatus("setup-status", "Both fields are required", "fail");
    return;
  }

  if (!apiKey.startsWith("ak_")) {
    showStatus("setup-status", "API key must start with ak_", "fail");
    return;
  }

  // Test connection before saving
  const ok = await testConnection(apiUrl, apiKey, $("setup-status"));
  if (!ok) return;

  await chrome.storage.local.set({
    api_url: apiUrl,
    auth_method: "apikey",
    api_key: apiKey,
    user_name: $("setup-status").textContent.replace("Connected as ", ""),
  });
  // Clear any leftover JWT tokens
  await chrome.storage.local.remove(["access_token", "refresh_token"]);

  init();
});

$("api-key").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-save-key").click();
});

// --- Tags input ---
let tags = ["web-clip"];

function renderTags() {
  const container = $("tags-input");
  container.querySelectorAll(".tag-chip").forEach((el) => el.remove());
  const input = $("tag-text");
  tags.forEach((tag, i) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${tag}<button data-index="${i}">&times;</button>`;
    container.insertBefore(chip, input);
  });
}

$("tags-input").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON" && e.target.dataset.index !== undefined) {
    tags.splice(Number(e.target.dataset.index), 1);
    renderTags();
    return;
  }
  $("tag-text").focus();
});

$("tag-text").addEventListener("keydown", (e) => {
  const input = $("tag-text");
  const value = input.value.trim();
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    if (value && !tags.includes(value)) {
      tags.push(value);
      input.value = "";
      renderTags();
    }
  }
  if (e.key === "Backspace" && !value && tags.length > 0) {
    tags.pop();
    renderTags();
  }
});

function getTags() {
  // Flush any pending text in input
  const input = $("tag-text");
  const value = input.value.trim();
  if (value && !tags.includes(value)) {
    tags.push(value);
    input.value = "";
    renderTags();
  }
  return [...tags];
}

// Capture: Save Page button (upload to server)
$("btn-capture").addEventListener("click", () => startCapture());

// Local Save buttons (no login required)
$("btn-local-save").addEventListener("click", () => startLocalSave());
$("btn-local-save-ready").addEventListener("click", () => startLocalSave());

async function startCapture() {
  const customTitle = $("task-title").value.trim();
  const captureTags = getTags();
  $("saving-label").textContent = "Saving page...";
  showView("saving");
  $("footer").classList.remove("hidden");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      throw new Error("Cannot capture browser internal pages");
    }

    await chrome.storage.local.remove(["capture_status", "capture_title", "capture_error"]);
    await chrome.runtime.sendMessage({
      action: "capture",
      tabId: tab.id,
      customTitle: customTitle || undefined,
      tags: captureTags,
    }).catch(() => {});
  } catch (err) {
    $("error-message").textContent = err.message || "Save failed";
    showView("error");
  }
}

async function startLocalSave() {
  $("saving-label").textContent = "Saving to local...";
  showView("saving");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      throw new Error("Cannot capture browser internal pages");
    }

    await chrome.storage.local.remove(["capture_status", "capture_title", "capture_error"]);
    await chrome.runtime.sendMessage({
      action: "localCapture",
      tabId: tab.id,
    }).catch(() => {});
  } catch (err) {
    $("error-message").textContent = err.message || "Save failed";
    showView("error");
  }
}

// Retry goes back to ready view
$("btn-retry").addEventListener("click", () => init());

// Settings
$("btn-settings").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["api_url"]);
  $("settings-api-url").value = data.api_url || "https://ud.oatnil.top/api";
  $("settings-status").classList.add("hidden");
  showView("settings");
});

$("btn-save-settings").addEventListener("click", async () => {
  const apiUrl = $("settings-api-url").value.replace(/\/+$/, "");
  if (!apiUrl) return;

  await chrome.storage.local.set({ api_url: apiUrl });
  showStatus("settings-status", "Saved", "ok");
  setTimeout(() => init(), 500);
});

$("btn-back").addEventListener("click", () => init());

// Logout — clears all auth data regardless of method
$("btn-logout").addEventListener("click", async () => {
  await chrome.storage.local.remove([
    "auth_method", "api_key", "access_token", "refresh_token", "user_name",
    "capture_status", "capture_title", "capture_error",
  ]);
  $("password").value = "";
  $("api-key").value = "";
  $("setup-status").classList.add("hidden");
  showView("setup");
});

init();
