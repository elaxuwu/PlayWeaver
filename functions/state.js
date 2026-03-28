const STATE_KEY_PREFIX = "playweaver:state:";

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

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildStateKey(id) {
  return `${STATE_KEY_PREFIX}${id}`;
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

export async function onRequestPost(context) {
  try {
    const { id, html, editorState, gameConfig } = await context.request.json();
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

    await executeRedisCommand(context, [
      "SET",
      buildStateKey(safeId),
      JSON.stringify({
        html,
        editorState,
        gameConfig,
      }),
    ]);

    return jsonResponse({
      ok: true,
      id: safeId,
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

    const redisResponse = await executeRedisCommand(context, ["GET", buildStateKey(safeId)]);
    const storedValue = typeof redisResponse?.result === "string" ? redisResponse.result : null;

    if (!storedValue) {
      return jsonResponse(
        {
          error: "state not found",
          id: safeId,
        },
        404
      );
    }

    let parsedState = null;

    try {
      parsedState = JSON.parse(storedValue);
    } catch {
      parsedState = null;
    }

    if (!parsedState || typeof parsedState !== "object") {
      return jsonResponse(
        {
          error: "state payload is invalid",
          id: safeId,
        },
        500
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
