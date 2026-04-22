const AUTH_TOKEN_KEY = "playweaverToken";
const AUTH_USER_KEY = "playweaverUser";

const changePasswordForm = document.getElementById("change-password-form");
const accountStatus = document.getElementById("account-status");
const logoutButton = document.getElementById("account-logout-btn");

function clearSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function storeSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || null));
}

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function redirectToHome() {
  window.location.href = "/index.html";
}

function setStatus(message, type = "success") {
  if (!accountStatus) {
    return;
  }

  if (!message) {
    accountStatus.textContent = "";
    accountStatus.classList.add("hidden");
    accountStatus.classList.remove("is-error", "is-success");
    return;
  }

  accountStatus.textContent = message;
  accountStatus.classList.remove("hidden", "is-error", "is-success");
  accountStatus.classList.add(type === "error" ? "is-error" : "is-success");
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

async function handleChangePassword(event) {
  event.preventDefault();
  setStatus("");

  const response = await fetch("/auth", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "change_password",
      oldPassword: document.getElementById("account-old-password")?.value || "",
      newPassword: document.getElementById("account-new-password")?.value || "",
      newPasswordConfirm: document.getElementById("account-new-password-confirm")?.value || "",
    }),
  });

  if (response.status === 401) {
    clearSession();
    redirectToHome();
    return;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Unable to change your password."));
  }

  const payload = await response.json();

  if (typeof payload?.token === "string" && payload.token.trim()) {
    storeSession(payload.token, payload.user);
  }

  if (changePasswordForm) {
    changePasswordForm.reset();
  }

  setStatus("Password changed successfully.");
}

if (!getToken()) {
  redirectToHome();
}

if (changePasswordForm) {
  changePasswordForm.addEventListener("submit", (event) => {
    handleChangePassword(event).catch((error) => {
      setStatus(
        error instanceof Error ? error.message : "Unable to change your password.",
        "error"
      );
    });
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    clearSession();
    redirectToHome();
  });
}
