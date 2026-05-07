const USER_ID_KEY_PREFIX = "playweaver:user_id:";
const SESSION_KEY_PREFIX = "playweaver:session:";

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

function normalizeSessionVersion(value, fallbackValue = 0) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : fallbackValue;
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

function buildSessionKey(token) {
  return `${SESSION_KEY_PREFIX}${token}`;
}

function buildUserIdKey(userId) {
  return `${USER_ID_KEY_PREFIX}${userId}`;
}

function extractBearerToken(request) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authHeader.slice(7).trim();
}

function getClientIp(request) {
  const forwardedIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    request.headers.get("X-Real-IP") ||
    "";

  return forwardedIp.split(",")[0].trim() || "unknown";
}

function normalizeCount(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
}

function normalizeTtl(value, fallbackValue) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.ceil(parsedValue) : fallbackValue;
}

async function resolveAuthenticatedRateLimitSubject(context, request) {
  const token = extractBearerToken(request);

  if (!token) {
    return "";
  }

  const sessionResponse = await executeRedisCommand(context, ["GET", buildSessionKey(token)]);
  const sessionRecord = parseSessionRecord(sessionResponse?.result);

  if (!sessionRecord.userId) {
    return "";
  }

  const userResponse = await executeRedisCommand(context, ["GET", buildUserIdKey(sessionRecord.userId)]);
  const userRecord = parseStoredObject(userResponse?.result);

  if (!userRecord) {
    return "";
  }

  const currentSessionVersion = normalizeSessionVersion(userRecord.sessionVersion, 0);

  if (sessionRecord.sessionVersion !== currentSessionVersion) {
    return "";
  }

  return `user:${sessionRecord.userId}`;
}

export async function resolveProjectRateLimitSubject(context, request) {
  const authenticatedSubject = await resolveAuthenticatedRateLimitSubject(context, request);

  if (authenticatedSubject) {
    return authenticatedSubject;
  }

  return `ip:${getClientIp(request)}`;
}

export function formatRetryAfter(seconds) {
  const normalizedSeconds = Math.max(1, Math.ceil(Number(seconds) || 0));
  const minutes = Math.ceil(normalizedSeconds / 60);

  return minutes <= 1 ? "about 1 minute" : `about ${minutes} minutes`;
}

export function buildRateLimitHeaders(rateLimit) {
  const retryAfterSeconds = Math.max(0, Math.ceil(rateLimit.retryAfterSeconds || 0));

  return {
    "Retry-After": String(retryAfterSeconds),
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(Date.now() / 1000) + retryAfterSeconds),
  };
}

export async function consumeFixedWindowRateLimit({
  context,
  key,
  limit,
  windowSeconds,
}) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindowSeconds = Math.max(1, Number(windowSeconds) || 1);
  const setResponse = await executeRedisCommand(context, [
    "SET",
    key,
    "1",
    "EX",
    safeWindowSeconds,
    "NX",
  ]);

  if (setResponse?.result === "OK") {
    return {
      allowed: true,
      count: 1,
      limit: safeLimit,
      remaining: Math.max(0, safeLimit - 1),
      retryAfterSeconds: safeWindowSeconds,
    };
  }

  const incrementResponse = await executeRedisCommand(context, ["INCR", key]);
  const count = normalizeCount(incrementResponse?.result);
  const ttlResponse = await executeRedisCommand(context, ["TTL", key]);
  let retryAfterSeconds = normalizeTtl(ttlResponse?.result, safeWindowSeconds);

  if (Number(ttlResponse?.result) < 0) {
    await executeRedisCommand(context, ["EXPIRE", key, safeWindowSeconds]);
    retryAfterSeconds = safeWindowSeconds;
  }

  return {
    allowed: count <= safeLimit,
    count,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - count),
    retryAfterSeconds,
  };
}
