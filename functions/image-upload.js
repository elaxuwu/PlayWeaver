const SESSION_KEY_PREFIX = "playweaver:session:";
const USER_ID_KEY_PREFIX = "playweaver:user_id:";
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
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
    redisToken,
    redisUrl,
  };
}

async function executeRedisCommand(context, command) {
  const { redisToken, redisUrl } = getRedisConfig(context);
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

function buildSessionKey(token) {
  return `${SESSION_KEY_PREFIX}${token}`;
}

function buildUserIdKey(userId) {
  return `${USER_ID_KEY_PREFIX}${userId}`;
}

function normalizeSessionVersion(value, fallbackValue = 0) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : fallbackValue;
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

function parseSessionRecord(value) {
  const parsedRecord = parseStoredObject(value);

  if (parsedRecord && typeof parsedRecord.userId === "string" && parsedRecord.userId.trim()) {
    return {
      sessionVersion: normalizeSessionVersion(parsedRecord.sessionVersion, 0),
      userId: parsedRecord.userId.trim(),
    };
  }

  return {
    sessionVersion: 0,
    userId: typeof value === "string" ? value.trim() : "",
  };
}

function extractBearerToken(request) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authHeader.slice(7).trim();
}

async function requireAuthenticatedUser(context, request) {
  const token = extractBearerToken(request);

  if (!token) {
    return {
      error: "Please log in to upload reference images.",
      userId: "",
    };
  }

  const sessionResponse = await executeRedisCommand(context, ["GET", buildSessionKey(token)]);
  const sessionRecord = parseSessionRecord(sessionResponse?.result);

  if (!sessionRecord.userId) {
    return {
      error: "Your session has expired. Please log in again.",
      userId: "",
    };
  }

  const userResponse = await executeRedisCommand(context, ["GET", buildUserIdKey(sessionRecord.userId)]);
  const userRecord = parseStoredObject(userResponse?.result);

  if (!userRecord) {
    return {
      error: "Your session has expired. Please log in again.",
      userId: "",
    };
  }

  const currentSessionVersion = normalizeSessionVersion(userRecord.sessionVersion, 0);

  if (sessionRecord.sessionVersion !== currentSessionVersion) {
    return {
      error: "Your session has expired. Please log in again.",
      userId: "",
    };
  }

  return {
    error: "",
    userId: sessionRecord.userId,
  };
}

export async function onRequestPost(context) {
  try {
    if (!context.env.IMGBB_API_KEY) {
      throw new Error("Missing IMGBB_API_KEY environment variable.");
    }

    const session = await requireAuthenticatedUser(context, context.request);

    if (!session.userId) {
      return jsonResponse({ error: session.error }, 401);
    }

    const requestFormData = await context.request.formData();
    const image = requestFormData.get("image");

    if (!image || typeof image.arrayBuffer !== "function") {
      return jsonResponse({ error: "An image file is required." }, 400);
    }

    const imageType = typeof image.type === "string" ? image.type.trim().toLowerCase() : "";
    const imageSize = Number(image.size);

    if (!imageType.startsWith("image/")) {
      return jsonResponse({ error: "Only image uploads are supported." }, 400);
    }

    if (Number.isFinite(imageSize) && imageSize > MAX_IMAGE_UPLOAD_BYTES) {
      return jsonResponse({ error: "Images must be 8 MB or smaller." }, 400);
    }

    const upstreamFormData = new FormData();
    upstreamFormData.append(
      "image",
      image,
      typeof image.name === "string" && image.name.trim() ? image.name.trim() : "reference-image"
    );

    const upstreamResponse = await fetch(
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(context.env.IMGBB_API_KEY)}`,
      {
        method: "POST",
        body: upstreamFormData,
      }
    );
    const upstreamText = await upstreamResponse.text();
    let upstreamPayload = null;

    if (upstreamText) {
      try {
        upstreamPayload = JSON.parse(upstreamText);
      } catch {
        upstreamPayload = null;
      }
    }

    const uploadedImageUrl =
      typeof upstreamPayload?.data?.url === "string" ? upstreamPayload.data.url.trim() : "";

    if (!upstreamResponse.ok || !uploadedImageUrl) {
      return jsonResponse(
        {
          error:
            typeof upstreamPayload?.error?.message === "string" &&
            upstreamPayload.error.message.trim()
              ? upstreamPayload.error.message.trim()
              : "Image upload failed.",
        },
        502
      );
    }

    return jsonResponse({
      ok: true,
      url: uploadedImageUrl,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unable to upload the image.",
      },
      500
    );
  }
}
