const AUTH_TOKEN_KEY = "playweaverToken";
const AUTH_USER_KEY = "playweaverUser";

const dashboardGrid = document.getElementById("dashboard-grid");
const dashboardStatus = document.getElementById("dashboard-status");
const logoutButton = document.getElementById("dashboard-logout-btn");

function clearSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function redirectToHome() {
  window.location.href = "/index.html";
}

function setStatus(message, type = "success") {
  if (!dashboardStatus) {
    return;
  }

  if (!message) {
    dashboardStatus.textContent = "";
    dashboardStatus.classList.add("hidden");
    dashboardStatus.classList.remove("is-error", "is-success");
    return;
  }

  dashboardStatus.textContent = message;
  dashboardStatus.classList.remove("hidden", "is-error", "is-success");
  dashboardStatus.classList.add(type === "error" ? "is-error" : "is-success");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUpdatedAt(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently updated";
  }

  return date.toLocaleString();
}

function buildShareUrl(projectId) {
  const url = new URL("/editor.html", window.location.origin);
  url.searchParams.set("id", projectId);
  return url.toString();
}

function buildDashboardApiUrl(projectId = "") {
  const url = new URL("/api/dashboard", window.location.origin);

  if (projectId) {
    url.searchParams.set("id", projectId);
  }

  return url.toString();
}

async function copyShareLink(projectId) {
  const shareUrl = buildShareUrl(projectId);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(shareUrl);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = shareUrl;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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

function renderProjects(projects) {
  if (!dashboardGrid) {
    return;
  }

  if (!Array.isArray(projects) || !projects.length) {
    dashboardGrid.innerHTML =
      '<div class="dashboard-empty">You do not have any saved projects yet. Generate a game from the editor and it will appear here.</div>';
    return;
  }

  dashboardGrid.innerHTML = projects
    .map((project) => {
      const safeId = escapeHtml(project.id);
      const safeTitle = escapeHtml(project.gameName || "Untitled Game");
      const pinClass = project.pinned ? " is-pinned" : "";

      return `
        <article class="dashboard-card" data-project-id="${safeId}">
          <div class="dashboard-card__top">
            <div>
              <h2 class="dashboard-card__title">
                <a class="dashboard-card__title-link" href="editor.html?id=${encodeURIComponent(
                  project.id
                )}">${safeTitle}</a>
              </h2>
              <p class="dashboard-card__meta">Updated ${formatUpdatedAt(project.updatedAt)}</p>
            </div>
            <button
              type="button"
              class="dashboard-icon-button${pinClass}"
              data-action="pin"
              data-project-id="${safeId}"
              aria-pressed="${project.pinned ? "true" : "false"}"
            >
              ${project.pinned ? "Pinned" : "Pin"}
            </button>
          </div>
          <div class="dashboard-card__actions">
            <button
              type="button"
              class="dashboard-share-button"
              data-action="share"
              data-project-id="${safeId}"
            >
              Copy Share Link
            </button>
            <button
              type="button"
              class="dashboard-delete-button"
              data-action="delete"
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

async function fetchProjects() {
  const token = getToken();

  if (!token) {
    redirectToHome();
    return;
  }

  const apiUrl = buildDashboardApiUrl();
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (response.status === 401) {
    clearSession();
    redirectToHome();
    return;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Unable to load your projects."));
  }

  const payload = await response.json();
  renderProjects(Array.isArray(payload?.projects) ? payload.projects : []);
  setStatus("");
}

async function togglePinned(projectId) {
  const token = getToken();
  const response = await fetch("/api/dashboard", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: projectId }),
  });

  if (response.status === 401) {
    clearSession();
    redirectToHome();
    return;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Unable to update this project."));
  }
}

async function deleteProject(projectId) {
  const token = getToken();
  const response = await fetch(buildDashboardApiUrl(projectId), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    clearSession();
    redirectToHome();
    return;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Unable to delete this project."));
  }
}

async function handleGridClick(event) {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  const projectId = target.dataset.projectId;

  if (!action || !projectId) {
    return;
  }

  if (action === "share") {
    await copyShareLink(projectId);
    setStatus("Share link copied to clipboard.");
    return;
  }

  if (action === "pin") {
    await togglePinned(projectId);
    await fetchProjects();
    setStatus("Project pin updated.");
    return;
  }

  if (action === "delete") {
    await deleteProject(projectId);
    await fetchProjects();
    setStatus("Project deleted.");
  }
}

if (!getToken()) {
  redirectToHome();
} else {
  setStatus("Loading projects...");
  fetchProjects().catch((error) => {
    setStatus(
      error instanceof Error ? error.message : "Unable to load your projects.",
      "error"
    );
  });
}

if (dashboardGrid) {
  dashboardGrid.addEventListener("click", (event) => {
    handleGridClick(event).catch((error) => {
      setStatus(
        error instanceof Error ? error.message : "Unable to update this project.",
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
