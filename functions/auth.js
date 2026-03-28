const USER_KEY_PREFIX = "playweaver:user:";
const USER_ID_KEY_PREFIX = "playweaver:user_id:";
const SESSION_KEY_PREFIX = "playweaver:session:";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

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

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function buildUserKey(email) {
  return `${USER_KEY_PREFIX}${email}`;
}

function buildUserIdKey(userId) {
  return `${USER_ID_KEY_PREFIX}${userId}`;
}

function buildSessionKey(token) {
  return `${SESSION_KEY_PREFIX}${token}`;
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

async function getUserByEmail(context, email) {
  const response = await executeRedisCommand(context, ["GET", buildUserKey(email)]);
  return parseStoredObject(response?.result);
}

async function getUserById(context, userId) {
  const response = await executeRedisCommand(context, ["GET", buildUserIdKey(userId)]);
  return parseStoredObject(response?.result);
}

async function storeUser(context, userRecord) {
  const serialized = JSON.stringify(userRecord);
  await executeRedisCommand(context, ["SET", buildUserKey(userRecord.email), serialized]);
  await executeRedisCommand(context, ["SET", buildUserIdKey(userRecord.id), serialized]);
}

async function hashPassword(value) {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createSecureToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createSession(context, userId) {
  const token = createSecureToken();
  await executeRedisCommand(context, [
    "SETEX",
    buildSessionKey(token),
    SESSION_TTL_SECONDS,
    userId,
  ]);
  return token;
}

function sanitizeUser(userRecord) {
  return {
    id: userRecord.id,
    email: userRecord.email,
  };
}

async function handleSignup(context, payload) {
  const email = normalizeEmail(payload?.email);
  const password = typeof payload?.password === "string" ? payload.password : "";
  const passwordConfirm =
    typeof payload?.passwordConfirm === "string" ? payload.passwordConfirm : "";

  if (!email || !password || !passwordConfirm) {
    return jsonResponse({ error: "Email, password, and password confirmation are required." }, 400);
  }

  if (password !== passwordConfirm) {
    return jsonResponse({ error: "Passwords do not match." }, 400);
  }

  const existingUser = await getUserByEmail(context, email);

  if (existingUser) {
    return jsonResponse({ error: "An account with this email already exists." }, 409);
  }

  const userRecord = {
    id: crypto.randomUUID(),
    email,
    passwordHash: await hashPassword(password),
  };

  await storeUser(context, userRecord);
  const token = await createSession(context, userRecord.id);

  return jsonResponse({
    ok: true,
    token,
    user: sanitizeUser(userRecord),
  });
}

async function handleLogin(context, payload) {
  const email = normalizeEmail(payload?.email);
  const password = typeof payload?.password === "string" ? payload.password : "";

  if (!email || !password) {
    return jsonResponse({ error: "Email and password are required." }, 400);
  }

  const userRecord = await getUserByEmail(context, email);

  if (!userRecord) {
    return jsonResponse({ error: "Invalid email or password." }, 401);
  }

  const passwordHash = await hashPassword(password);

  if (passwordHash !== userRecord.passwordHash) {
    return jsonResponse({ error: "Invalid email or password." }, 401);
  }

  const token = await createSession(context, userRecord.id);

  return jsonResponse({
    ok: true,
    token,
    user: sanitizeUser(userRecord),
  });
}

async function handleChangePassword(context, payload) {
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  const oldPassword = typeof payload?.oldPassword === "string" ? payload.oldPassword : "";
  const newPassword = typeof payload?.newPassword === "string" ? payload.newPassword : "";
  const newPasswordConfirm =
    typeof payload?.newPasswordConfirm === "string" ? payload.newPasswordConfirm : "";

  if (!token || !oldPassword || !newPassword || !newPasswordConfirm) {
    return jsonResponse({ error: "All password fields are required." }, 400);
  }

  if (newPassword !== newPasswordConfirm) {
    return jsonResponse({ error: "New passwords do not match." }, 400);
  }

  const sessionResponse = await executeRedisCommand(context, ["GET", buildSessionKey(token)]);
  const userId = typeof sessionResponse?.result === "string" ? sessionResponse.result : "";

  if (!userId) {
    return jsonResponse({ error: "Your session has expired. Please log in again." }, 401);
  }

  const userRecord = await getUserById(context, userId);

  if (!userRecord) {
    return jsonResponse({ error: "Account not found for this session." }, 404);
  }

  const currentHash = await hashPassword(oldPassword);

  if (currentHash !== userRecord.passwordHash) {
    return jsonResponse({ error: "Current password is incorrect." }, 401);
  }

  const updatedUser = {
    ...userRecord,
    passwordHash: await hashPassword(newPassword),
  };

  await storeUser(context, updatedUser);

  return jsonResponse({
    ok: true,
    user: sanitizeUser(updatedUser),
  });
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const action = typeof payload?.action === "string" ? payload.action.trim().toLowerCase() : "";

    if (action === "signup") {
      return handleSignup(context, payload);
    }

    if (action === "login") {
      return handleLogin(context, payload);
    }

    if (action === "change_password") {
      return handleChangePassword(context, payload);
    }

    return jsonResponse({ error: "Unsupported auth action." }, 400);
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unable to complete authentication request.",
      },
      500
    );
  }
}
