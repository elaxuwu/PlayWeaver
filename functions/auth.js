const USER_KEY_PREFIX = "playweaver:user:";
const USER_ID_KEY_PREFIX = "playweaver:user_id:";
const USER_SESSIONS_KEY_PREFIX = "playweaver:user_sessions:";
const SESSION_KEY_PREFIX = "playweaver:session:";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_HASH_VERSION = 2;
const PASSWORD_HASH_ITERATIONS = 310000;
const PASSWORD_SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 8;

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

function buildUserSessionsKey(userId) {
  return `${USER_SESSIONS_KEY_PREFIX}${userId}`;
}

function buildSessionKey(token) {
  return `${SESSION_KEY_PREFIX}${token}`;
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

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  if (!normalizedValue || normalizedValue.length % 2 !== 0) {
    return new Uint8Array();
  }

  const bytes = new Uint8Array(normalizedValue.length / 2);

  for (let index = 0; index < normalizedValue.length; index += 2) {
    const nextByte = Number.parseInt(normalizedValue.slice(index, index + 2), 16);

    if (Number.isNaN(nextByte)) {
      return new Uint8Array();
    }

    bytes[index / 2] = nextByte;
  }

  return bytes;
}

function timingSafeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left || ""));
  const rightBytes = new TextEncoder().encode(String(right || ""));
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }

  return mismatch === 0;
}

async function hashPasswordLegacy(value) {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

function createPasswordSalt() {
  const bytes = new Uint8Array(PASSWORD_SALT_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashPassword(value, saltHex, iterations = PASSWORD_HASH_ITERATIONS) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(value || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const saltBytes = hexToBytes(saltHex);

  if (!saltBytes.length) {
    throw new Error("Invalid password salt.");
  }

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: Number.isFinite(Number(iterations))
        ? Math.max(1, Number(iterations))
        : PASSWORD_HASH_ITERATIONS,
      salt: saltBytes,
    },
    passwordKey,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

async function createPasswordFields(password) {
  const passwordSalt = createPasswordSalt();

  return {
    passwordHash: await hashPassword(password, passwordSalt, PASSWORD_HASH_ITERATIONS),
    passwordHashAlgorithm: "PBKDF2-SHA256",
    passwordHashIterations: PASSWORD_HASH_ITERATIONS,
    passwordHashVersion: PASSWORD_HASH_VERSION,
    passwordSalt,
  };
}

async function verifyPassword(userRecord, password) {
  if (!userRecord || typeof userRecord !== "object") {
    return {
      needsUpgrade: false,
      valid: false,
    };
  }

  const passwordHashVersion = Number(userRecord.passwordHashVersion);
  const storedHash = typeof userRecord.passwordHash === "string" ? userRecord.passwordHash : "";
  const storedSalt = typeof userRecord.passwordSalt === "string" ? userRecord.passwordSalt : "";
  const storedIterations = Number(userRecord.passwordHashIterations);

  if (passwordHashVersion >= PASSWORD_HASH_VERSION && storedHash && storedSalt) {
    const computedHash = await hashPassword(
      password,
      storedSalt,
      Number.isFinite(storedIterations) ? storedIterations : PASSWORD_HASH_ITERATIONS
    );

    return {
      needsUpgrade: false,
      valid: timingSafeEqual(computedHash, storedHash),
    };
  }

  const legacyHash = await hashPasswordLegacy(password);
  const isLegacyMatch = timingSafeEqual(legacyHash, storedHash);

  return {
    needsUpgrade: isLegacyMatch,
    valid: isLegacyMatch,
  };
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }

  return "";
}

function createSecureToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function createSession(context, userRecord) {
  const token = createSecureToken();
  const sessionVersion = normalizeSessionVersion(userRecord?.sessionVersion, 0);
  await executeRedisCommand(context, [
    "SETEX",
    buildSessionKey(token),
    SESSION_TTL_SECONDS,
    JSON.stringify({
      sessionVersion,
      userId: userRecord.id,
    }),
  ]);
  await executeRedisCommand(context, ["SADD", buildUserSessionsKey(userRecord.id), token]);
  return token;
}

async function revokeAllUserSessions(context, userId) {
  const response = await executeRedisCommand(context, ["SMEMBERS", buildUserSessionsKey(userId)]);
  const sessionTokens = Array.isArray(response?.result)
    ? response.result
        .map((token) => (typeof token === "string" ? token.trim() : ""))
        .filter(Boolean)
    : [];

  for (const sessionToken of sessionTokens) {
    await executeRedisCommand(context, ["DEL", buildSessionKey(sessionToken)]);
  }

  await executeRedisCommand(context, ["DEL", buildUserSessionsKey(userId)]);
}

function sanitizeUser(userRecord) {
  return {
    id: userRecord.id,
    email: userRecord.email,
  };
}

function extractBearerToken(request) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authHeader.slice(7).trim();
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

  const passwordValidationError = validatePassword(password);

  if (passwordValidationError) {
    return jsonResponse({ error: passwordValidationError }, 400);
  }

  const existingUser = await getUserByEmail(context, email);

  if (existingUser) {
    return jsonResponse({ error: "An account with this email already exists." }, 409);
  }

  const userRecord = {
    id: crypto.randomUUID(),
    email,
    sessionVersion: 1,
    ...(await createPasswordFields(password)),
  };

  await storeUser(context, userRecord);
  const sessionToken = await createSession(context, userRecord);

  return jsonResponse({
    ok: true,
    token: sessionToken,
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

  const passwordCheck = await verifyPassword(userRecord, password);

  if (!passwordCheck.valid) {
    return jsonResponse({ error: "Invalid email or password." }, 401);
  }

  let authenticatedUser = {
    ...userRecord,
    sessionVersion: Math.max(1, normalizeSessionVersion(userRecord.sessionVersion, 0)),
  };
  let shouldStoreUser = authenticatedUser.sessionVersion !== userRecord.sessionVersion;

  if (passwordCheck.needsUpgrade) {
    authenticatedUser = {
      ...authenticatedUser,
      ...(await createPasswordFields(password)),
    };
    shouldStoreUser = true;
  }

  if (shouldStoreUser) {
    await storeUser(context, authenticatedUser);
  }

  const sessionToken = await createSession(context, authenticatedUser);

  return jsonResponse({
    ok: true,
    token: sessionToken,
    user: sanitizeUser(authenticatedUser),
  });
}

async function handleChangePassword(context, request, payload) {
  const token = extractBearerToken(request);
  const oldPassword = typeof payload?.oldPassword === "string" ? payload.oldPassword : "";
  const newPassword = typeof payload?.newPassword === "string" ? payload.newPassword : "";
  const newPasswordConfirm =
    typeof payload?.newPasswordConfirm === "string" ? payload.newPasswordConfirm : "";

  if (!token) {
    return jsonResponse({ error: "Your session has expired. Please log in again." }, 401);
  }

  if (!oldPassword || !newPassword || !newPasswordConfirm) {
    return jsonResponse({ error: "All password fields are required." }, 400);
  }

  if (newPassword !== newPasswordConfirm) {
    return jsonResponse({ error: "New passwords do not match." }, 400);
  }

  if (oldPassword === newPassword) {
    return jsonResponse({ error: "Choose a new password that is different from the current one." }, 400);
  }

  const passwordValidationError = validatePassword(newPassword);

  if (passwordValidationError) {
    return jsonResponse({ error: passwordValidationError }, 400);
  }

  const sessionResponse = await executeRedisCommand(context, ["GET", buildSessionKey(token)]);
  const sessionRecord = parseSessionRecord(sessionResponse?.result);

  if (!sessionRecord.userId) {
    return jsonResponse({ error: "Your session has expired. Please log in again." }, 401);
  }

  const userRecord = await getUserById(context, sessionRecord.userId);

  if (!userRecord) {
    return jsonResponse({ error: "Account not found for this session." }, 404);
  }

  const currentSessionVersion = normalizeSessionVersion(userRecord.sessionVersion, 0);

  if (sessionRecord.sessionVersion !== currentSessionVersion) {
    return jsonResponse({ error: "Your session has expired. Please log in again." }, 401);
  }

  const passwordCheck = await verifyPassword(userRecord, oldPassword);

  if (!passwordCheck.valid) {
    return jsonResponse({ error: "Current password is incorrect." }, 401);
  }

  const updatedUser = {
    ...userRecord,
    sessionVersion: Math.max(1, currentSessionVersion + 1),
    ...(await createPasswordFields(newPassword)),
  };

  await storeUser(context, updatedUser);
  await revokeAllUserSessions(context, updatedUser.id);
  const sessionToken = await createSession(context, updatedUser);

  return jsonResponse({
    ok: true,
    token: sessionToken,
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
      return handleChangePassword(context, context.request, payload);
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
