// UnderControl Web Clipper - Popup
// AGPL-3.0 License

const $ = (id) => document.getElementById(id);

const views = {
  login: $("view-login"),
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

// Init: check auth state
async function init() {
  const data = await chrome.storage.local.get(["api_url", "auth_tokens"]);
  const apiUrl = data.api_url || "http://localhost:4000";

  $("api-url").value = apiUrl;
  $("settings-api-url").value = apiUrl;

  if (data.auth_tokens?.accessToken) {
    // Logged in - start capture immediately
    $("user-name").textContent = data.auth_tokens.userName || "User";
    $("footer").classList.remove("hidden");
    startCapture();
  } else {
    showView("login");
  }
}

// Login
$("btn-login").addEventListener("click", async () => {
  const apiUrl = $("api-url").value.replace(/\/+$/, "");
  const username = $("username").value.trim();
  const password = $("password").value;

  if (!apiUrl || !username || !password) {
    $("login-error").textContent = "All fields are required";
    $("login-error").classList.remove("hidden");
    return;
  }

  $("btn-login").disabled = true;
  $("login-error").classList.add("hidden");

  try {
    const res = await chrome.runtime.sendMessage({
      action: "login",
      apiUrl,
      username,
      password,
    });

    if (res.success) {
      $("user-name").textContent = res.userName || "User";
      $("footer").classList.remove("hidden");
      startCapture();
    } else {
      $("login-error").textContent = res.error || "Login failed";
      $("login-error").classList.remove("hidden");
    }
  } catch (err) {
    $("login-error").textContent = err.message || "Login failed";
    $("login-error").classList.remove("hidden");
  } finally {
    $("btn-login").disabled = false;
  }
});

// Enter key on password field triggers login
$("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-login").click();
});

// Start capture
async function startCapture() {
  showView("saving");
  $("footer").classList.remove("hidden");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    // Check if it's a capturable page
    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      throw new Error("Cannot capture browser internal pages");
    }

    const res = await chrome.runtime.sendMessage({
      action: "capture",
      tabId: tab.id,
    });

    if (res.success) {
      $("saved-title").textContent = res.title;
      showView("success");
      // Auto-close after 2 seconds
      setTimeout(() => window.close(), 2000);
    } else {
      $("error-message").textContent = res.error || "Save failed";
      showView("error");
    }
  } catch (err) {
    $("error-message").textContent = err.message || "Save failed";
    showView("error");
  }
}

// Retry
$("btn-retry").addEventListener("click", startCapture);

// Settings
$("btn-settings").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["api_url"]);
  $("settings-api-url").value = data.api_url || "http://localhost:4000";
  showView("settings");
});

$("btn-save-settings").addEventListener("click", async () => {
  const apiUrl = $("settings-api-url").value.replace(/\/+$/, "");
  if (!apiUrl) return;
  await chrome.storage.local.set({ api_url: apiUrl });
  // Go back to saving state or show success
  const data = await chrome.storage.local.get(["auth_tokens"]);
  if (data.auth_tokens?.accessToken) {
    startCapture();
  } else {
    showView("login");
    $("api-url").value = apiUrl;
  }
});

$("btn-back").addEventListener("click", () => {
  // Just re-init to get back to appropriate view
  init();
});

// Logout
$("btn-logout").addEventListener("click", async () => {
  await chrome.storage.local.remove(["auth_tokens"]);
  $("footer").classList.add("hidden");
  showView("login");
});

// Run init
init();
