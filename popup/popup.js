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

// Test connection helper
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
chrome.storage.onChanged.addListener((changes) => {
  if (changes.capture_status) {
    const status = changes.capture_status.newValue;
    if (status === "saving") {
      showView("saving");
      $("footer").classList.remove("hidden");
    } else if (status === "success") {
      const title = changes.capture_title?.newValue || "";
      $("saved-title").textContent = title;
      showView("success");
      $("footer").classList.remove("hidden");
      setTimeout(() => window.close(), 2000);
    } else if (status === "error") {
      const error = changes.capture_error?.newValue || "Save failed";
      $("error-message").textContent = error;
      showView("error");
      $("footer").classList.remove("hidden");
    }
  }
});

// Init: check if configured, prefill page title
async function init() {
  const data = await chrome.storage.local.get(["api_url", "api_key", "capture_status"]);
  const apiUrl = data.api_url || "http://localhost:4000";

  $("api-url").value = apiUrl;
  $("settings-api-url").value = apiUrl;

  if (data.api_key) {
    try {
      const host = new URL(apiUrl).host;
      $("api-host").textContent = host;
    } catch {
      $("api-host").textContent = apiUrl;
    }
    $("footer").classList.remove("hidden");

    if (data.capture_status === "saving") {
      showView("saving");
    } else {
      // Prefill title from active tab
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        $("task-title").value = tab?.title || "";
      } catch {}
      showView("ready");
    }
  } else {
    showView("setup");
  }
}

// Setup: Test button
$("btn-test").addEventListener("click", async () => {
  const apiUrl = $("api-url").value.replace(/\/+$/, "");
  const apiKey = $("api-key").value.trim();
  if (!apiUrl || !apiKey) {
    const el = $("setup-status");
    el.textContent = "Both fields are required";
    el.className = "status-msg fail";
    el.classList.remove("hidden");
    return;
  }
  await testConnection(apiUrl, apiKey, $("setup-status"));
});

// Setup: Save button
$("btn-save").addEventListener("click", async () => {
  const apiUrl = $("api-url").value.replace(/\/+$/, "");
  const apiKey = $("api-key").value.trim();

  if (!apiUrl || !apiKey) {
    const el = $("setup-status");
    el.textContent = "Both fields are required";
    el.className = "status-msg fail";
    el.classList.remove("hidden");
    return;
  }

  if (!apiKey.startsWith("ak_")) {
    const el = $("setup-status");
    el.textContent = "API key must start with ak_";
    el.className = "status-msg fail";
    el.classList.remove("hidden");
    return;
  }

  await chrome.storage.local.set({ api_url: apiUrl, api_key: apiKey });
  init();
});

$("api-key").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-save").click();
});

// Capture: Save Page button
$("btn-capture").addEventListener("click", () => startCapture());

async function startCapture() {
  const customTitle = $("task-title").value.trim();
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
  const data = await chrome.storage.local.get(["api_url", "api_key"]);
  $("settings-api-url").value = data.api_url || "http://localhost:4000";
  $("settings-api-key").value = data.api_key || "";
  $("settings-status").classList.add("hidden");
  showView("settings");
});

$("btn-test-settings").addEventListener("click", async () => {
  const apiUrl = $("settings-api-url").value.replace(/\/+$/, "");
  const apiKey = $("settings-api-key").value.trim();
  if (!apiUrl || !apiKey) {
    const el = $("settings-status");
    el.textContent = "Both fields are required";
    el.className = "status-msg fail";
    el.classList.remove("hidden");
    return;
  }
  await testConnection(apiUrl, apiKey, $("settings-status"));
});

$("btn-save-settings").addEventListener("click", async () => {
  const apiUrl = $("settings-api-url").value.replace(/\/+$/, "");
  const apiKey = $("settings-api-key").value.trim();
  if (!apiUrl || !apiKey) return;

  await chrome.storage.local.set({ api_url: apiUrl, api_key: apiKey });
  init();
});

$("btn-back").addEventListener("click", () => init());

$("btn-clear").addEventListener("click", async () => {
  await chrome.storage.local.remove(["api_key", "capture_status", "capture_title", "capture_error"]);
  $("footer").classList.add("hidden");
  $("api-key").value = "";
  showView("setup");
});

init();
