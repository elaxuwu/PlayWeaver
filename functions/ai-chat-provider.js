import OpenAI from "openai";

const FEATHERLESS_BASE_URL = "https://api.featherless.ai/v1";
const DEFAULT_FEATHERLESS_MODEL = "deepseek-ai/DeepSeek-V3-0324";
const OLLAMA_CLOUD_CHAT_URL = "https://ollama.com/api/chat";
const DEFAULT_OLLAMA_CLOUD_MODEL = "mistral-large-3:675b-cloud";
const FALLBACK_HTTP_STATUSES = new Set([401, 402, 403, 429, 500, 502, 503, 504]);

function normalizeEnvString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function buildFeatherlessClient(context) {
  const apiKey = normalizeEnvString(context.env.FEATHERLESS_API_KEY);

  if (!apiKey) {
    throw new Error("Missing FEATHERLESS_API_KEY environment variable");
  }

  return new OpenAI({
    apiKey,
    baseURL: FEATHERLESS_BASE_URL,
  });
}

function buildFeatherlessRequest({ context, messages, responseFormat, temperature }) {
  const request = {
    model: normalizeEnvString(context.env.FEATHERLESS_CHAT_MODEL) || DEFAULT_FEATHERLESS_MODEL,
    messages,
  };

  if (responseFormat) {
    request.response_format = responseFormat;
  }

  if (typeof temperature === "number") {
    request.temperature = temperature;
  }

  return request;
}

async function requestFromFeatherless({ context, messages, responseFormat, temperature }) {
  const client = buildFeatherlessClient(context);
  const completion = await client.chat.completions.create(
    buildFeatherlessRequest({ context, messages, responseFormat, temperature })
  );
  const content = completion.choices?.[0]?.message?.content?.trim() || "";

  if (!content) {
    throw new Error("Featherless chat model returned an empty response.");
  }

  return content;
}

function buildOllamaRequestBody({ context, messages, responseFormat, temperature }) {
  const requestBody = {
    model: normalizeEnvString(context.env.OLLAMA_CLOUD_MODEL) || DEFAULT_OLLAMA_CLOUD_MODEL,
    messages,
    stream: false,
  };

  if (responseFormat?.type === "json_object") {
    requestBody.format = "json";
  }

  if (typeof temperature === "number") {
    requestBody.options = {
      temperature,
    };
  }

  return requestBody;
}

function parseJsonSafely(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildOllamaErrorMessage(payload, responseText, status) {
  const payloadError =
    typeof payload?.error === "string"
      ? payload.error.trim()
      : typeof payload?.message === "string"
        ? payload.message.trim()
        : "";

  if (payloadError) {
    return payloadError;
  }

  const trimmedResponseText = typeof responseText === "string" ? responseText.trim() : "";

  if (trimmedResponseText) {
    return trimmedResponseText;
  }

  return `Ollama Cloud request failed with status ${status}.`;
}

async function requestFromOllamaCloud({ context, messages, responseFormat, temperature }) {
  const apiKey = normalizeEnvString(context.env.OLLAMA_API_KEY);

  if (!apiKey) {
    throw new Error("Missing OLLAMA_API_KEY environment variable");
  }

  const response = await fetch(OLLAMA_CLOUD_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildOllamaRequestBody({ context, messages, responseFormat, temperature })),
  });

  const responseText = await response.text();
  const payload = parseJsonSafely(responseText);

  if (!response.ok) {
    const error = new Error(buildOllamaErrorMessage(payload, responseText, response.status));
    error.status = response.status;
    throw error;
  }

  const content = typeof payload?.message?.content === "string" ? payload.message.content.trim() : "";

  if (!content) {
    throw new Error("Ollama Cloud chat model returned an empty response.");
  }

  return content;
}

function shouldFallbackToOllama(error, hasOllamaKey) {
  if (!hasOllamaKey) {
    return false;
  }

  const status = Number(error?.status);

  if (Number.isInteger(status) && FALLBACK_HTTP_STATUSES.has(status)) {
    return true;
  }

  const normalizedMessage = typeof error?.message === "string" ? error.message.toLowerCase() : "";

  if (!normalizedMessage) {
    return false;
  }

  return [
    "missing featherless_api_key",
    "quota",
    "credit",
    "billing",
    "payment",
    "subscription",
    "rate limit",
    "temporarily unavailable",
    "overloaded",
    "timeout",
    "timed out",
    "network",
    "connection",
    "fetch failed",
  ].some((pattern) => normalizedMessage.includes(pattern));
}

export async function createChatCompletionWithFallback({
  context,
  messages,
  responseFormat,
  temperature,
}) {
  const hasOllamaKey = Boolean(normalizeEnvString(context.env.OLLAMA_API_KEY));

  try {
    return await requestFromFeatherless({ context, messages, responseFormat, temperature });
  } catch (error) {
    if (!shouldFallbackToOllama(error, hasOllamaKey)) {
      throw error;
    }

    return requestFromOllamaCloud({ context, messages, responseFormat, temperature });
  }
}
