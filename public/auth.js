const AUTH_TOKEN_KEY = "playweaverToken";
const AUTH_USER_KEY = "playweaverUser";

const authLaunchBtn = document.getElementById("auth-launch-btn");
const loginModal = document.getElementById("login-modal");
const loginModalBackdrop = document.getElementById("login-modal-backdrop");
const loginModalClose = document.getElementById("login-modal-close");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const openSignupModalBtn = document.getElementById("open-signup-modal");

const signupModal = document.getElementById("signup-modal");
const signupModalBackdrop = document.getElementById("signup-modal-backdrop");
const signupModalClose = document.getElementById("signup-modal-close");
const signupForm = document.getElementById("signup-form");
const signupStatus = document.getElementById("signup-status");
const openLoginModalBtn = document.getElementById("open-login-modal");

function storeSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || null));
}

function getStoredToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function updateLaunchButtonLabel() {
  if (!authLaunchBtn) {
    return;
  }

  authLaunchBtn.textContent = getStoredToken() ? "Go to Dashboard" : "Login / Signup";
}

function setStatus(node, message, type = "success") {
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

function openModal(modal) {
  if (!modal) {
    return;
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  if (!modal) {
    return;
  }

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function openLoginModal() {
  closeModal(signupModal);
  setStatus(signupStatus, "");
  setStatus(loginStatus, "");
  openModal(loginModal);
  document.getElementById("login-email")?.focus();
}

function openSignupModal() {
  closeModal(loginModal);
  setStatus(loginStatus, "");
  setStatus(signupStatus, "");
  openModal(signupModal);
  document.getElementById("signup-email")?.focus();
}

async function readErrorMessage(response, fallbackMessage) {
  const responseText = await response.text();

  try {
    const parsed = JSON.parse(responseText);
    return parsed?.error || responseText || fallbackMessage;
  } catch {
    return responseText || fallbackMessage;
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
  setStatus(loginStatus, "");

  try {
    const payload = await submitAuthRequest({
      action: "login",
      email: document.getElementById("login-email")?.value || "",
      password: document.getElementById("login-password")?.value || "",
    });

    if (typeof payload?.token !== "string" || !payload.token.trim()) {
      throw new Error("Login succeeded but no session token was returned.");
    }

    storeSession(payload.token, payload.user);
    window.location.href = "/dashboard.html";
  } catch (error) {
    setStatus(loginStatus, error instanceof Error ? error.message : "Unable to log in.", "error");
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  setStatus(signupStatus, "");

  try {
    const payload = await submitAuthRequest({
      action: "signup",
      email: document.getElementById("signup-email")?.value || "",
      password: document.getElementById("signup-password")?.value || "",
      passwordConfirm: document.getElementById("signup-password-confirm")?.value || "",
    });

    if (typeof payload?.token !== "string" || !payload.token.trim()) {
      throw new Error("Signup succeeded but no session token was returned.");
    }

    storeSession(payload.token, payload.user);
    window.location.href = "/dashboard.html";
  } catch (error) {
    setStatus(signupStatus, error instanceof Error ? error.message : "Unable to sign up.", "error");
  }
}

if (authLaunchBtn) {
  authLaunchBtn.addEventListener("click", () => {
    if (getStoredToken()) {
      window.location.href = "/dashboard.html";
      return;
    }

    openLoginModal();
  });
}

if (loginModalBackdrop) {
  loginModalBackdrop.addEventListener("click", () => closeModal(loginModal));
}

if (signupModalBackdrop) {
  signupModalBackdrop.addEventListener("click", () => closeModal(signupModal));
}

if (loginModalClose) {
  loginModalClose.addEventListener("click", () => closeModal(loginModal));
}

if (signupModalClose) {
  signupModalClose.addEventListener("click", () => closeModal(signupModal));
}

if (openSignupModalBtn) {
  openSignupModalBtn.addEventListener("click", openSignupModal);
}

if (openLoginModalBtn) {
  openLoginModalBtn.addEventListener("click", openLoginModal);
}

if (loginForm) {
  loginForm.addEventListener("submit", handleLoginSubmit);
}

if (signupForm) {
  signupForm.addEventListener("submit", handleSignupSubmit);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal(loginModal);
    closeModal(signupModal);
  }
});

updateLaunchButtonLabel();
