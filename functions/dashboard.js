const STATE_KEY_PREFIX = "playweaver:state:";
const USER_ID_KEY_PREFIX = "playweaver:user_id:";
const SESSION_KEY_PREFIX = "playweaver:session:";
const USER_PROJECTS_KEY_PREFIX = "playweaver:user_projects:";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function getRedisConfig(context) {
  const redisUrl = context.env.UPSTASH_REDIS_REST_URL;
  const redisToken = context.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    throw new Error("Missing Upstash Redis environment variables.");
  }

  return {
    redisUrl,
    redisToken,
  };
}

async function executeRedisCommand(context, command) {
  const { redisUrl, redisToken } = getRedisConfig(context);
  const response = await fetch(redisUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const responseText = await response.text();
  let parsedBody = null;

  if (responseText) {
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      parsedBody = null;
    }
  }

  if (!response.ok) {
    throw new Error(parsedBody?.error || responseText || "Upstash request failed.");
  }

  return parsedBody;
}

function buildStateKey(id) {
  return `${STATE_KEY_PREFIX}${id}`;
}

function buildSessionKey(token) {
  return `${SESSION_KEY_PREFIX}${token}`;
}

function buildUserIdKey(userId) {
  return `${USER_ID_KEY_PREFIX}${userId}`;
}

function buildUserProjectsKey(userId) {
  return `${USER_PROJECTS_KEY_PREFIX}${userId}`;
}

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseStoredObject(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractToken(request, fallbackValue = "") {
  const authHeader = request.headers.get("Authorization");

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return typeof fallbackValue === "string" ? fallbackValue.trim() : "";
}

async function resolveSession(context, request, fallbackToken = "") {
  const token = extractToken(request, fallbackToken);

  if (!token) {
    return null;
  }

  const sessionResponse = await executeRedisCommand(context, ["GET", buildSessionKey(token)]);
  const userId = typeof sessionResponse?.result === "string" ? sessionResponse.result : "";

  if (!userId) {
    return null;
  }

  const userResponse = await executeRedisCommand(context, ["GET", buildUserIdKey(userId)]);
  const userRecord = parseStoredObject(userResponse?.result);

  if (!userRecord) {
    return null;
  }

  return {
    token,
    userId,
    user: {
      id: userRecord.id,
      email: userRecord.email,
    },
  };
}

async function getStoredProject(context, projectId) {
  const response = await executeRedisCommand(context, ["GET", buildStateKey(projectId)]);
  return parseStoredObject(response?.result);
}

function buildProjectSummary(projectId, projectRecord) {
  return {
    id: projectId,
    gameName:
      typeof projectRecord?.gameName === "string" && projectRecord.gameName.trim()
        ? projectRecord.gameName.trim()
        : typeof projectRecord?.gameConfig?.gameName === "string" && projectRecord.gameConfig.gameName.trim()
          ? projectRecord.gameConfig.gameName.trim()
          : "Untitled Game",
    pinned: Boolean(projectRecord?.pinned),
    updatedAt:
      typeof projectRecord?.updatedAt === "string" && projectRecord.updatedAt.trim()
        ? projectRecord.updatedAt
        : new Date().toISOString(),
    ownerId: typeof projectRecord?.ownerId === "string" ? projectRecord.ownerId : null,
  };
}

function parseProjectHashEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) {
    return [];
  }

  const projects = [];

  for (let index = 0; index < rawEntries.length; index += 2) {
    const projectId = normalizeId(rawEntries[index]);
    const parsedValue = parseStoredObject(rawEntries[index + 1]);

    if (!projectId || !parsedValue) {
      continue;
    }

    projects.push({
      id: projectId,
      gameName:
        typeof parsedValue.gameName === "string" && parsedValue.gameName.trim()
          ? parsedValue.gameName.trim()
          : "Untitled Game",
      pinned: Boolean(parsedValue.pinned),
      updatedAt:
        typeof parsedValue.updatedAt === "string" && parsedValue.updatedAt.trim()
          ? parsedValue.updatedAt
          : "",
      ownerId: typeof parsedValue.ownerId === "string" ? parsedValue.ownerId : null,
    });
  }

  return projects.sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }

    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
}

export async function onRequestGet(context) {
  try {
    const session = await resolveSession(context, context.request);

    if (!session) {
      return jsonResponse({ error: "Please log in to view your dashboard." }, 401);
    }

    const projectResponse = await executeRedisCommand(context, [
      "HGETALL",
      buildUserProjectsKey(session.userId),
    ]);

    return jsonResponse({
      ok: true,
      user: session.user,
      projects: parseProjectHashEntries(projectResponse?.result),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unable to load dashboard data.",
      },
      500
    );
  }
}

export async function onRequestDelete(context) {
  try {
    const requestUrl = new URL(context.request.url);
    const projectId = normalizeId(requestUrl.searchParams.get("id"));
    const session = await resolveSession(context, context.request);

    if (!session) {
      return jsonResponse({ error: "Please log in to delete a project." }, 401);
    }

    if (!projectId) {
      return jsonResponse({ error: "Project id is required." }, 400);
    }

    const projectRecord = await getStoredProject(context, projectId);

    if (!projectRecord) {
      return jsonResponse({ error: "Project not found." }, 404);
    }

    if (projectRecord.ownerId !== session.userId) {
      return jsonResponse({ error: "You do not own this project." }, 403);
    }

    await executeRedisCommand(context, ["DEL", buildStateKey(projectId)]);
    await executeRedisCommand(context, [
      "HDEL",
      buildUserProjectsKey(session.userId),
      projectId,
    ]);

    return jsonResponse({
      ok: true,
      id: projectId,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unable to delete project.",
      },
      500
    );
  }
}

export async function onRequestPatch(context) {
  try {
    const payload = await context.request.json();
    const projectId = normalizeId(payload?.id);
    const session = await resolveSession(context, context.request, payload?.token);

    if (!session) {
      return jsonResponse({ error: "Please log in to update a project." }, 401);
    }

    if (!projectId) {
      return jsonResponse({ error: "Project id is required." }, 400);
    }

    const projectRecord = await getStoredProject(context, projectId);

    if (!projectRecord) {
      return jsonResponse({ error: "Project not found." }, 404);
    }

    if (projectRecord.ownerId !== session.userId) {
      return jsonResponse({ error: "You do not own this project." }, 403);
    }

    const nextPinned =
      typeof payload?.pinned === "boolean" ? payload.pinned : !Boolean(projectRecord.pinned);
    const updatedProject = {
      ...projectRecord,
      pinned: nextPinned,
      updatedAt: new Date().toISOString(),
      gameName:
        typeof projectRecord?.gameConfig?.gameName === "string" && projectRecord.gameConfig.gameName.trim()
          ? projectRecord.gameConfig.gameName.trim()
          : buildProjectSummary(projectId, projectRecord).gameName,
    };

    await executeRedisCommand(context, [
      "SET",
      buildStateKey(projectId),
      JSON.stringify(updatedProject),
    ]);
    await executeRedisCommand(context, [
      "HSET",
      buildUserProjectsKey(session.userId),
      projectId,
      JSON.stringify(buildProjectSummary(projectId, updatedProject)),
    ]);

    return jsonResponse({
      ok: true,
      id: projectId,
      pinned: nextPinned,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unable to update project.",
      },
      500
    );
  }
}
