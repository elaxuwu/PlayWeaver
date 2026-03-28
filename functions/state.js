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

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
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

async function resolveUserIdFromToken(context, token) {
  const normalizedToken = typeof token === "string" ? token.trim() : "";

  if (!normalizedToken) {
    return {
      userId: null,
      invalid: false,
    };
  }

  const sessionResponse = await executeRedisCommand(context, ["GET", buildSessionKey(normalizedToken)]);
  const userId = typeof sessionResponse?.result === "string" ? sessionResponse.result : "";

  if (!userId) {
    return {
      userId: null,
      invalid: true,
    };
  }

  const userResponse = await executeRedisCommand(context, ["GET", buildUserIdKey(userId)]);
  const userRecord = parseStoredObject(userResponse?.result);

  if (!userRecord) {
    return {
      userId: null,
      invalid: true,
    };
  }

  return {
    userId,
    invalid: false,
  };
}

async function getStoredProject(context, projectId) {
  const response = await executeRedisCommand(context, ["GET", buildStateKey(projectId)]);
  return parseStoredObject(response?.result);
}

function deriveGameName(gameConfig, fallbackValue = "Untitled Game") {
  const rawValue =
    typeof gameConfig?.gameName === "string" && gameConfig.gameName.trim()
      ? gameConfig.gameName.trim()
      : "";

  return rawValue || fallbackValue;
}

function buildProjectSummary(projectId, projectRecord) {
  return {
    id: projectId,
    gameName: deriveGameName(projectRecord?.gameConfig, projectRecord?.gameName),
    pinned: Boolean(projectRecord?.pinned),
    updatedAt:
      typeof projectRecord?.updatedAt === "string" && projectRecord.updatedAt.trim()
        ? projectRecord.updatedAt
        : new Date().toISOString(),
    ownerId: typeof projectRecord?.ownerId === "string" ? projectRecord.ownerId : null,
  };
}

export async function onRequestPost(context) {
  try {
    const { id, html, editorState, gameConfig, token } = await context.request.json();
    const safeId = normalizeId(id);

    if (!safeId) {
      return jsonResponse({ error: "id is required" }, 400);
    }

    if (typeof html !== "string") {
      return jsonResponse({ error: "html must be a string" }, 400);
    }

    if (!editorState || typeof editorState !== "object") {
      return jsonResponse({ error: "editorState must be an object" }, 400);
    }

    if (!gameConfig || typeof gameConfig !== "object") {
      return jsonResponse({ error: "gameConfig must be an object" }, 400);
    }

    const session = await resolveUserIdFromToken(context, token);

    if (session.invalid) {
      return jsonResponse({ error: "Your session is no longer valid. Please log in again." }, 401);
    }

    const existingProject = await getStoredProject(context, safeId);
    const existingOwnerId =
      typeof existingProject?.ownerId === "string" && existingProject.ownerId.trim()
        ? existingProject.ownerId.trim()
        : null;

    if (existingOwnerId && existingOwnerId !== session.userId) {
      return jsonResponse(
        {
          error:
            "This project belongs to another PlayWeaver account. Generate a new project id to fork it.",
          code: "ownership_conflict",
          forkRequired: true,
        },
        409
      );
    }

    const now = new Date().toISOString();
    const ownerId = existingOwnerId || session.userId || null;
    const nextProject = {
      id: safeId,
      html,
      editorState,
      gameConfig,
      ownerId,
      pinned: Boolean(existingProject?.pinned),
      createdAt:
        typeof existingProject?.createdAt === "string" && existingProject.createdAt.trim()
          ? existingProject.createdAt
          : now,
      updatedAt: now,
      gameName: deriveGameName(gameConfig),
    };

    await executeRedisCommand(context, [
      "SET",
      buildStateKey(safeId),
      JSON.stringify(nextProject),
    ]);

    if (ownerId) {
      await executeRedisCommand(context, [
        "HSET",
        buildUserProjectsKey(ownerId),
        safeId,
        JSON.stringify(buildProjectSummary(safeId, nextProject)),
      ]);
    }

    return jsonResponse({
      ok: true,
      id: safeId,
      ownerId,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unable to save state.",
      },
      500
    );
  }
}

export async function onRequestGet(context) {
  try {
    const requestUrl = new URL(context.request.url);
    const safeId = normalizeId(requestUrl.searchParams.get("id"));

    if (!safeId) {
      return jsonResponse({ error: "id is required" }, 400);
    }

    const parsedState = await getStoredProject(context, safeId);

    if (!parsedState) {
      return jsonResponse(
        {
          error: "state not found",
          id: safeId,
        },
        404
      );
    }

    return jsonResponse({
      id: safeId,
      html: typeof parsedState.html === "string" ? parsedState.html : "",
      editorState:
        parsedState.editorState && typeof parsedState.editorState === "object"
          ? parsedState.editorState
          : null,
      gameConfig:
        parsedState.gameConfig && typeof parsedState.gameConfig === "object"
          ? parsedState.gameConfig
          : null,
      ownerId:
        typeof parsedState.ownerId === "string" && parsedState.ownerId.trim()
          ? parsedState.ownerId
          : null,
      pinned: Boolean(parsedState.pinned),
      updatedAt:
        typeof parsedState.updatedAt === "string" && parsedState.updatedAt.trim()
          ? parsedState.updatedAt
          : null,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unable to load state.",
      },
      500
    );
  }
}
