const AUTH_TOKEN_KEY = "playweaverToken";
const AUTH_USER_KEY = "playweaverUser";

const ideaForm = document.getElementById("idea-form");
const ideaInput = document.getElementById("game-idea");
const weaveButton = document.getElementById("weave-button");
const loadingMessage = document.getElementById("loading-message");
const yearNode = document.getElementById("year");

const chatOverlay = document.getElementById("chat-overlay");
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatReplyInput = document.getElementById("chat-reply-input");
const chatSubmitButton = document.getElementById("chat-submit-button");
const chatCloseButton = document.getElementById("chat-close-button");
const boardGrid = document.getElementById("live-board-grid");

const authLaunchBtn = document.getElementById("auth-launch-btn");
const authShell = document.getElementById("auth-shell");
const authShellBackdrop = document.getElementById("auth-shell-backdrop");
const authCloseBtn = document.getElementById("auth-close-btn");
const authStatus = document.getElementById("auth-status");
const authLoginPanel = document.getElementById("auth-login-panel");
const authSignupPanel = document.getElementById("auth-signup-panel");
const authAccountPanel = document.getElementById("auth-account-panel");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const changePasswordForm = document.getElementById("change-password-form");
const showSignupBtn = document.getElementById("show-signup-btn");
const showLoginBtn = document.getElementById("show-login-btn");
const accountBackBtn = document.getElementById("account-back-btn");
const accountEmail = document.getElementById("account-email");

const dashboardShell = document.getElementById("dashboard-shell");
const dashboardBackdrop = document.getElementById("dashboard-backdrop");
const dashboardCloseBtn = document.getElementById("dashboard-close-btn");
const dashboardAccountBtn = document.getElementById("dashboard-account-btn");
const dashboardLogoutBtn = document.getElementById("dashboard-logout-btn");
const dashboardStatus = document.getElementById("dashboard-status");
const dashboardGrid = document.getElementById("dashboard-grid");

const liveBoardFields = [
  { key: "gameName", label: "Game Name" },
  { key: "genre", label: "Genre" },
  { key: "coreMechanic", label: "Core Mechanic" },
  { key: "artStyle", label: "Art Style" },
  { key: "setting", label: "Setting" },
  { key: "playerCharacter", label: "Player Character" },
  { key: "enemies", label: "Enemies" },
  { key: "winCondition", label: "Win Condition" },
];

const messageHistory = [];
let currentBoardState = {};
const loadingStages = [
  "Mapping mechanics, building a visual whiteboard, and preparing an HTML5 game shell.",
  "Synthesizing a first-pass gameplay loop and scene layout.",
  "Organizing the core genre, character, and win-condition details.",
];

let loadingIntervalId = null;
let thinkingIndicatorNode = null;

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

function safeJsonParse(value, fallback = null) {
  if (typeof value !== "string" || !value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getStoredToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function getStoredUser() {
  const parsed = safeJsonParse(localStorage.getItem(AUTH_USER_KEY), null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function setStoredSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || null));
  updateAuthButtonLabel();
  updateAccountEmail();
  window.dispatchEvent(
    new CustomEvent("playweaver-auth-changed", {
      detail: {
        token,
        user,
      },
    })
  );
}

function clearStoredSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  updateAuthButtonLabel();
  updateAccountEmail();
  window.dispatchEvent(
    new CustomEvent("playweaver-auth-changed", {
      detail: {
        token: "",
        user: null,
      },
    })
  );
}

function updateAuthButtonLabel() {
  if (!authLaunchBtn) {
    return;
  }

  authLaunchBtn.textContent = getStoredToken() ? "Dashboard" : "Login / Dashboard";
}

function updateAccountEmail() {
  if (!accountEmail) {
    return;
  }

  accountEmail.textContent = getStoredUser()?.email || "-";
}

function showStatus(node, message, type = "success") {
  if (!node) {
    return;
  }

  if (!message) {
    node.textContent = "";
    node.classList.add("hidden");
    node.classList.remove("is-error", "is-success");
    return;
  }

  node.textContent = message;
  node.classList.remove("hidden", "is-error", "is-success");
  node.classList.add(type === "error" ? "is-error" : "is-success");
}

function setActiveAuthPanel(panelName) {
  if (!authLoginPanel || !authSignupPanel || !authAccountPanel) {
    return;
  }

  authLoginPanel.classList.toggle("hidden", panelName !== "login");
  authSignupPanel.classList.toggle("hidden", panelName !== "signup");
  authAccountPanel.classList.toggle("hidden", panelName !== "account");
}

function openAuthShell(panelName = "login") {
  if (!authShell) {
    return;
  }

  if (panelName === "account" && !getStoredToken()) {
    panelName = "login";
  }

  setActiveAuthPanel(panelName);
  updateAccountEmail();
  showStatus(authStatus, "");
  authShell.classList.remove("hidden");
  authShell.setAttribute("aria-hidden", "false");

  const focusTarget =
    panelName === "signup"
      ? document.getElementById("signup-email")
      : panelName === "account"
        ? document.getElementById("account-old-password")
        : document.getElementById("login-email");

  if (focusTarget) {
    window.setTimeout(() => focusTarget.focus(), 30);
  }
}

function closeAuthShell() {
  if (!authShell) {
    return;
  }

  authShell.classList.add("hidden");
  authShell.setAttribute("aria-hidden", "true");
  showStatus(authStatus, "");
}

function closeDashboard() {
  if (!dashboardShell) {
    return;
  }

  dashboardShell.classList.add("hidden");
  dashboardShell.setAttribute("aria-hidden", "true");
  showStatus(dashboardStatus, "");
}

function buildEditorShareUrl(projectId) {
  const url = new URL("editor.html", window.location.href);
  url.searchParams.set("id", projectId);
  return url.toString();
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function formatUpdatedAt(value) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently updated";
  }

  return date.toLocaleString();
}

function renderDashboardProjects(projects) {
  if (!dashboardGrid) {
    return;
  }

  if (!Array.isArray(projects) || !projects.length) {
    dashboardGrid.innerHTML =
      '<div class="dashboard-empty">You do not have any saved projects yet. Generate a game from the board and it will appear here.</div>';
    return;
  }

  dashboardGrid.innerHTML = projects
    .map((project) => {
      const title =
        typeof project.gameName === "string" && project.gameName.trim()
          ? project.gameName.trim()
          : "Untitled Game";
      const safeTitle = escapeHtml(title);
      const safeId = escapeHtml(project.id);
      const pinnedClass = project.pinned ? " is-pinned" : "";
      const pinLabel = project.pinned ? "Pinned" : "Pin";

      return `
        <article class="dashboard-card" data-project-id="${safeId}">
          <div class="dashboard-card__top">
            <div>
              <h3 class="dashboard-card__title">
                <a class="dashboard-card__title-link" href="editor.html?id=${encodeURIComponent(
                  project.id
                )}">${safeTitle}</a>
              </h3>
              <p class="dashboard-card__meta">Updated ${formatUpdatedAt(project.updatedAt)}</p>
            </div>
            <button
              type="button"
              class="dashboard-icon-button${pinnedClass}"
              data-dashboard-action="pin"
              data-project-id="${safeId}"
              aria-pressed="${project.pinned ? "true" : "false"}"
            >
              ${pinLabel}
            </button>
          </div>
          <div class="dashboard-card__actions">
            <button
              type="button"
              class="dashboard-share-button"
              data-dashboard-action="share"
              data-project-id="${safeId}"
            >
              Copy Share Link
            </button>
            <button
              type="button"
              class="dashboard-delete-button"
              data-dashboard-action="delete"
              data-project-id="${safeId}"
            >
              Delete
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function readErrorMessage(response, fallbackMessage) {
  const responseText = await response.text();
  const parsed = safeJsonParse(responseText, null);
  return parsed?.error || responseText || fallbackMessage;
}

async function fetchDashboardProjects() {
  const token = getStoredToken();

  if (!token) {
    throw new Error("Please log in to view your dashboard.");
  }

  const response = await fetch("/dashboard", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Unable to load your dashboard.");

    if (response.status === 401) {
      clearStoredSession();
    }

    throw new Error(message);
  }

  return response.json();
}

async function openDashboard() {
  if (!dashboardShell) {
    return;
  }

  if (!getStoredToken()) {
    openAuthShell("login");
    return;
  }

  dashboardShell.classList.remove("hidden");
  dashboardShell.setAttribute("aria-hidden", "false");
  showStatus(dashboardStatus, "Loading projects...");

  try {
    const payload = await fetchDashboardProjects();
    renderDashboardProjects(Array.isArray(payload?.projects) ? payload.projects : []);
    showStatus(dashboardStatus, "");
  } catch (error) {
    renderDashboardProjects([]);
    showStatus(
      dashboardStatus,
      error instanceof Error ? error.message : "Unable to load your dashboard.",
      "error"
    );
  }
}

async function togglePinnedProject(projectId) {
  const response = await fetch("/dashboard", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${getStoredToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: projectId }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredSession();
    }

    throw new Error(await readErrorMessage(response, "Unable to update this project."));
  }

  return response.json();
}

async function deleteProject(projectId) {
  const response = await fetch(`/dashboard?id=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${getStoredToken()}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredSession();
    }

    throw new Error(await readErrorMessage(response, "Unable to delete this project."));
  }
}

async function handleDashboardGridClick(event) {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.dashboardAction;
  const projectId = target.dataset.projectId;

  if (!action || !projectId) {
    return;
  }

  if (action === "share") {
    try {
      await copyTextToClipboard(buildEditorShareUrl(projectId));
      showStatus(dashboardStatus, "Share link copied to clipboard.");
    } catch (error) {
      showStatus(
        dashboardStatus,
        error instanceof Error ? error.message : "Unable to copy the share link.",
        "error"
      );
    }

    return;
  }

  if (action === "pin") {
    try {
      await togglePinnedProject(projectId);
      await openDashboard();
      showStatus(dashboardStatus, "Project pin state updated.");
    } catch (error) {
      showStatus(
        dashboardStatus,
        error instanceof Error ? error.message : "Unable to pin this project.",
        "error"
      );
    }

    return;
  }

  if (action === "delete") {
    try {
      await deleteProject(projectId);
      await openDashboard();
      showStatus(dashboardStatus, "Project deleted.");
    } catch (error) {
      showStatus(
        dashboardStatus,
        error instanceof Error ? error.message : "Unable to delete this project.",
        "error"
      );
    }
  }
}

async function submitAuthRequest(payload) {
  const response = await fetch("/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Unable to complete this request."));
  }

  return response.json();
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  try {
    const payload = await submitAuthRequest({
      action: "login",
      email: document.getElementById("login-email")?.value || "",
      password: document.getElementById("login-password")?.value || "",
    });

    setStoredSession(payload.token, payload.user);
    if (loginForm) {
      loginForm.reset();
    }
    closeAuthShell();
    await openDashboard();
  } catch (error) {
    showStatus(authStatus, error instanceof Error ? error.message : "Unable to log in.", "error");
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();

  try {
    const payload = await submitAuthRequest({
      action: "signup",
      email: document.getElementById("signup-email")?.value || "",
      password: document.getElementById("signup-password")?.value || "",
      passwordConfirm: document.getElementById("signup-password-confirm")?.value || "",
    });

    setStoredSession(payload.token, payload.user);
    if (signupForm) {
      signupForm.reset();
    }
    closeAuthShell();
    await openDashboard();
  } catch (error) {
    showStatus(authStatus, error instanceof Error ? error.message : "Unable to sign up.", "error");
  }
}

async function handleChangePasswordSubmit(event) {
  event.preventDefault();

  try {
    const payload = await submitAuthRequest({
      action: "change_password",
      token: getStoredToken(),
      oldPassword: document.getElementById("account-old-password")?.value || "",
      newPassword: document.getElementById("account-new-password")?.value || "",
      newPasswordConfirm: document.getElementById("account-new-password-confirm")?.value || "",
    });

    if (changePasswordForm) {
      changePasswordForm.reset();
    }

    if (payload?.user) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(payload.user));
      updateAccountEmail();
    }

    showStatus(authStatus, "Password changed successfully.");
  } catch (error) {
    showStatus(
      authStatus,
      error instanceof Error ? error.message : "Unable to change password.",
      "error"
    );
  }
}

function normalizeBoardValue(value) {
  if (typeof value !== "string") {
    return "None";
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : "None";
}

function createBoardStateSnapshot(boardState = {}) {
  return liveBoardFields.reduce((snapshot, field) => {
    snapshot[field.key] = normalizeBoardValue(boardState?.[field.key]);
    return snapshot;
  }, {});
}

function updateLiveBoard(boardState = {}) {
  if (!boardGrid) {
    return createBoardStateSnapshot(boardState);
  }

  const snapshot = createBoardStateSnapshot(boardState);
  boardGrid.innerHTML = "";

  liveBoardFields.forEach((field) => {
    const val = snapshot[field.key] || "None";
    const cardHtml = `<div class="board-card flex flex-col p-3 rounded-xl bg-white/5 border border-white/10 overflow-hidden"><span class="text-white/50 text-[10px] uppercase tracking-wider mb-1">${escapeHtml(
      field.label
    )}</span><span class="text-white font-medium text-sm capitalize truncate">${escapeHtml(
      val
    )}</span></div>`;

    boardGrid.insertAdjacentHTML("beforeend", cardHtml);
  });

  return snapshot;
}

function setLoadingState(isLoading, initialText = loadingStages[0]) {
  if (!loadingMessage || !weaveButton) {
    return;
  }

  if (loadingIntervalId) {
    window.clearInterval(loadingIntervalId);
    loadingIntervalId = null;
  }

  if (isLoading) {
    weaveButton.disabled = true;
    weaveButton.setAttribute("aria-busy", "true");
    document.body.classList.add("is-loading");
    loadingMessage.textContent = initialText;

    let stageIndex = 0;
    loadingIntervalId = window.setInterval(() => {
      loadingMessage.textContent = loadingStages[stageIndex % loadingStages.length];
      stageIndex += 1;
    }, 1400);
    return;
  }

  document.body.classList.remove("is-loading");
  weaveButton.disabled = false;
  weaveButton.removeAttribute("aria-busy");
  loadingMessage.textContent = loadingStages[0];
}

function showChatOverlay() {
  if (!chatOverlay) {
    return;
  }

  chatOverlay.classList.remove("hidden");
  chatOverlay.classList.add("flex");
  chatOverlay.setAttribute("aria-hidden", "false");

  if (chatReplyInput) {
    window.setTimeout(() => chatReplyInput.focus(), 50);
  }
}

function hideChatOverlay() {
  if (!chatOverlay) {
    return;
  }

  chatOverlay.classList.add("hidden");
  chatOverlay.classList.remove("flex");
  chatOverlay.setAttribute("aria-hidden", "true");
}

function setChatInputState(isEnabled) {
  if (chatReplyInput) {
    chatReplyInput.disabled = !isEnabled;
  }

  if (chatSubmitButton) {
    chatSubmitButton.disabled = !isEnabled;
    chatSubmitButton.textContent = isEnabled ? "Send Reply" : "Thinking...";
  }
}

function scrollChatToBottom() {
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function appendMessage(role, content, options = {}) {
  if (!chatMessages) {
    return null;
  }

  const row = document.createElement("div");
  row.className = `chat-message-row ${role === "user" ? "user" : "assistant"}`;

  const wrap = document.createElement("div");
  wrap.className = "chat-message-wrap";

  const meta = document.createElement("p");
  meta.className = "chat-meta";
  meta.textContent = role === "user" ? "You" : options.metaLabel || "PlayWeaver AI";

  const messageDiv = document.createElement("div");
  messageDiv.className = `chat-bubble whitespace-pre-wrap ${role === "user" ? "user" : "assistant"}${
    options.isThinking ? " thinking" : ""
  }`;

  const safeContent = String(content)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const formattedContent = safeContent.replace(
    /\*\*([\s\S]*?)\*\*/g,
    '<strong class="text-orange-400 font-bold drop-shadow-md">$1</strong>'
  );

  messageDiv.innerHTML = formattedContent;

  wrap.append(meta, messageDiv);
  row.appendChild(wrap);
  chatMessages.appendChild(row);
  scrollChatToBottom();
  return row;
}

function addThinkingIndicator() {
  removeThinkingIndicator();
  thinkingIndicatorNode = appendMessage("assistant", "Thinking...", { isThinking: true });
}

function removeThinkingIndicator() {
  if (thinkingIndicatorNode && thinkingIndicatorNode.parentNode) {
    thinkingIndicatorNode.parentNode.removeChild(thinkingIndicatorNode);
  }

  thinkingIndicatorNode = null;
}

function resetConversation() {
  messageHistory.length = 0;
  currentBoardState = {};
  removeThinkingIndicator();
  updateLiveBoard();
  hideChatOverlay();

  if (chatMessages) {
    chatMessages.innerHTML = "";
  }

  if (chatReplyInput) {
    chatReplyInput.value = "";
  }
}

function pushMessage(role, content) {
  messageHistory.push({ role, content });
}

function recordAssistantState(result) {
  if (!result || typeof result !== "object") {
    return;
  }

  pushMessage("assistant", JSON.stringify(result));
}

async function handleAIResponse(result) {
  setLoadingState(false);
  removeThinkingIndicator();
  setChatInputState(true);

  if (!result || typeof result !== "object") {
    showChatOverlay();
    appendMessage(
      "assistant",
      "I received an unexpected response. Please try answering again so I can finish your game board."
    );
    return;
  }

  if (result.boardState) {
    for (const key in result.boardState) {
      if (result.boardState[key] !== "None" && result.boardState[key] !== "") {
        currentBoardState[key] = result.boardState[key];
      }
    }

    result.boardState = currentBoardState;
  }

  updateLiveBoard(result.boardState);
  recordAssistantState(result);

  if (result.isComplete === true) {
    return;
  }

  const assistantMessage =
    typeof result.message === "string" && result.message.trim()
      ? result.message.trim()
      : "I am still shaping the board with you. **What should we define next?**";

  showChatOverlay();
  appendMessage("assistant", assistantMessage);
}

async function requestAI() {
  if (typeof window.askPlayWeaverAI !== "function") {
    throw new Error("askPlayWeaverAI is not available on window.");
  }

  return window.askPlayWeaverAI(messageHistory);
}

async function handleInitialIdeaSubmit(event) {
  event.preventDefault();

  if (!ideaInput) {
    return;
  }

  const prompt = ideaInput.value.trim();

  if (!prompt) {
    ideaInput.focus();
    return;
  }

  resetConversation();
  pushMessage("user", prompt);
  appendMessage("user", prompt);
  setLoadingState(true, `Weaving: ${prompt}`);

  try {
    const result = await requestAI();
    await handleAIResponse(result);
  } catch (error) {
    console.error("Initial PlayWeaver request failed:", error);
    setLoadingState(false);
    setChatInputState(true);
    showChatOverlay();
    appendMessage(
      "assistant",
      "Something went wrong while contacting PlayWeaver. Please try again in a moment."
    );
  }
}

async function handleChatReplySubmit(event) {
  event.preventDefault();

  if (!chatReplyInput) {
    return;
  }

  const reply = chatReplyInput.value.trim();

  if (!reply) {
    chatReplyInput.focus();
    return;
  }

  pushMessage("user", reply);
  appendMessage("user", reply);
  chatReplyInput.value = "";
  setChatInputState(false);
  addThinkingIndicator();

  try {
    const result = await requestAI();
    await handleAIResponse(result);
  } catch (error) {
    console.error("Follow-up PlayWeaver request failed:", error);
    removeThinkingIndicator();
    setChatInputState(true);
    appendMessage(
      "assistant",
      "I hit a snag while processing that answer. Please resend your reply and we can keep going."
    );
  }
}

if (ideaForm) {
  ideaForm.addEventListener("submit", handleInitialIdeaSubmit);
}

if (chatForm) {
  chatForm.addEventListener("submit", handleChatReplySubmit);
}

if (chatCloseButton) {
  chatCloseButton.addEventListener("click", hideChatOverlay);
}

if (authLaunchBtn) {
  authLaunchBtn.addEventListener("click", () => {
    if (getStoredToken()) {
      openDashboard();
      return;
    }

    openAuthShell("login");
  });
}

if (authCloseBtn) {
  authCloseBtn.addEventListener("click", closeAuthShell);
}

if (authShellBackdrop) {
  authShellBackdrop.addEventListener("click", closeAuthShell);
}

if (dashboardCloseBtn) {
  dashboardCloseBtn.addEventListener("click", closeDashboard);
}

if (dashboardBackdrop) {
  dashboardBackdrop.addEventListener("click", closeDashboard);
}

if (showSignupBtn) {
  showSignupBtn.addEventListener("click", () => openAuthShell("signup"));
}

if (showLoginBtn) {
  showLoginBtn.addEventListener("click", () => openAuthShell("login"));
}

if (accountBackBtn) {
  accountBackBtn.addEventListener("click", async () => {
    closeAuthShell();

    if (getStoredToken()) {
      await openDashboard();
    }
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", handleLoginSubmit);
}

if (signupForm) {
  signupForm.addEventListener("submit", handleSignupSubmit);
}

if (changePasswordForm) {
  changePasswordForm.addEventListener("submit", handleChangePasswordSubmit);
}

if (dashboardAccountBtn) {
  dashboardAccountBtn.addEventListener("click", () => {
    closeDashboard();
    openAuthShell("account");
  });
}

if (dashboardLogoutBtn) {
  dashboardLogoutBtn.addEventListener("click", () => {
    clearStoredSession();
    closeDashboard();
    showStatus(authStatus, "You have been logged out.");
  });
}

if (dashboardGrid) {
  dashboardGrid.addEventListener("click", (event) => {
    handleDashboardGridClick(event).catch((error) => {
      showStatus(
        dashboardStatus,
        error instanceof Error ? error.message : "Unable to update this project.",
        "error"
      );
    });
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (chatOverlay && !chatOverlay.classList.contains("hidden")) {
      hideChatOverlay();
    }

    if (authShell && !authShell.classList.contains("hidden")) {
      closeAuthShell();
    }

    if (dashboardShell && !dashboardShell.classList.contains("hidden")) {
      closeDashboard();
    }
  }
});

updateLiveBoard();
updateAuthButtonLabel();
updateAccountEmail();

window.PlayWeaverAuth = {
  getToken: getStoredToken,
  getUser: getStoredUser,
  openDashboard,
  openAuthModal: openAuthShell,
  clearSession: clearStoredSession,
};

if (document.body?.dataset?.page === "editor") {
  const editorScript = document.createElement("script");
  editorScript.src = "editor.js";
  document.body.appendChild(editorScript);
}
