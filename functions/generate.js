import OpenAI from "openai";

const SYSTEM_PROMPT =
  'You are an expert HTML5 game developer. Based on the provided JSON config, write a complete, playable 2D web game in a single HTML file using vanilla JavaScript and the HTML5 Canvas. It must be fully self-contained with inline CSS and JS. Output ONLY the raw HTML code. Do NOT wrap it in markdown blockquotes like ```html. CRITICAL: The canvas MUST dynamically resize to perfectly fit the window. Use `canvas.width = window.innerWidth` and `canvas.height = window.innerHeight` on load and on window resize. Do NOT hardcode fixed pixel dimensions for the canvas.';
const DEFAULT_GENERATION_MODEL = "openai_gpt_5_4_nano";
const GENERATION_MODEL_ROUTES = {
  openai_gpt_5_4_nano: {
    apiKeyEnv: "OPENROUTER_API_KEY",
    apiKeyError: "Missing OPENROUTER_API_KEY environment variable",
    baseURL: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5.4-nano",
    defaultHeaders: {
      "HTTP-Referer": "https://playweaver.app",
      "X-Title": "PlayWeaver Game Generator",
    },
    extraRequestFields: {
      reasoning_effort: "high",
    },
  },
  qwen_qwen2_5_coder_32b_instruct: {
    apiKeyEnv: "FEATHERLESS_API_KEY",
    apiKeyError: "Missing FEATHERLESS_API_KEY environment variable",
    baseURL: "https://api.featherless.ai/v1",
    model: "Qwen/Qwen2.5-Coder-32B-Instruct",
  },
};

function stripCodeFences(content) {
  return String(content || "")
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function getGenerationRoute(selection) {
  if (typeof selection !== "string") {
    return GENERATION_MODEL_ROUTES[DEFAULT_GENERATION_MODEL];
  }

  return GENERATION_MODEL_ROUTES[selection] || GENERATION_MODEL_ROUTES[DEFAULT_GENERATION_MODEL];
}

export async function onRequestPost(context) {
  try {
    const { gameConfig, generationModel } = await context.request.json();

    if (!gameConfig || typeof gameConfig !== "object") {
      return new Response(JSON.stringify({ error: "gameConfig must be an object" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    const route = getGenerationRoute(generationModel);
    const apiKey = context.env[route.apiKeyEnv];

    if (!apiKey) {
      throw new Error(route.apiKeyError);
    }

    const client = new OpenAI({
      apiKey,
      baseURL: route.baseURL,
      ...(route.defaultHeaders ? { defaultHeaders: route.defaultHeaders } : {}),
    });

    const completion = await client.chat.completions.create({
      model: route.model,
      ...(route.extraRequestFields || {}),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Game config JSON:\n${JSON.stringify(gameConfig, null, 2)}`,
        },
      ],
    });

    const assistantReply = completion.choices?.[0]?.message?.content?.trim() || "";
    const rawHtml = stripCodeFences(assistantReply);

    return new Response(rawHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
