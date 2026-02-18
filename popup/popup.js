// UnderControl Web Clipper - Popup
// AGPL-3.0 License

const $ = (id) => document.getElementById(id);

const views = {
  login: $("view-login"),
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
  if (name === "login" || name === "settings") {
    footer.classList.add("hidden");
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

// Init: check if logged in, prefill page title
async function init() {
  const data = await chrome.storage.local.get([
    "api_url", "access_token", "refresh_token", "user_name", "capture_status",
  ]);
  const apiUrl = data.api_url || "http://localhost:4000";

  $("api-url").value = apiUrl;
  $("settings-api-url").value = apiUrl;

  if (data.access_token) {
    $("display-name").textContent = data.user_name || "Connected";
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
    showView("login");
  }
}

// Login
$("btn-login").addEventListener("click", () => doLogin());
$("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  const apiUrl = $("api-url").value.replace(/\/+$/, "");
  const username = $("username").value.trim();
  const password = $("password").value;

  if (!apiUrl || !username || !password) {
    showStatus("login-status", "All fields are required", "fail");
    return;
  }

  showStatus("login-status", "Logging in...", "testing");

  try {
    const res = await fetch(`${apiUrl}/auth/v2/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.status === 401) {
      showStatus("login-status", "Invalid username or password", "fail");
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showStatus("login-status", err.message || `Error: ${res.status}`, "fail");
      return;
    }

    const data = await res.json();
    await chrome.storage.local.set({
      api_url: apiUrl,
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
      user_name: data.userName || username,
    });

    init();
  } catch (err) {
    showStatus(
      "login-status",
      err.message?.includes("fetch") ? "Cannot reach server" : err.message || "Login failed",
      "fail"
    );
  }
}

function showStatus(elementId, text, className) {
  const el = $(elementId);
  el.textContent = text;
  el.className = `status-msg ${className}`;
  el.classList.remove("hidden");
}

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
  const data = await chrome.storage.local.get(["api_url"]);
  $("settings-api-url").value = data.api_url || "http://localhost:4000";
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

// Logout
$("btn-logout").addEventListener("click", async () => {
  await chrome.storage.local.remove([
    "access_token", "refresh_token", "user_name",
    "capture_status", "capture_title", "capture_error",
  ]);
  $("password").value = "";
  $("login-status").classList.add("hidden");
  showView("login");
});

init();
