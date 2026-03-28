import OpenAI from "openai";

const BASE64_IMAGE_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=_-\s]+/gi;

const SYSTEM_PROMPT =
  'You are an expert HTML5 game developer. Based on the provided JSON config, write a complete, playable 2D web game in a single HTML file using vanilla JavaScript and the HTML5 Canvas. It must be fully self-contained with inline CSS and JS. Output ONLY the raw HTML code. Do NOT wrap it in markdown blockquotes like ```html. CRITICAL: The canvas MUST dynamically resize to perfectly fit the window. Use `canvas.width = window.innerWidth` and `canvas.height = window.innerHeight` on load and on window resize. Do NOT hardcode fixed pixel dimensions for the canvas. If the game requires player movement, you MUST implement both WASD and the Arrow Keys for controls. NEVER output raw Base64 data strings. Instead, assume a global object GAME_ASSETS exists. Use GAME_ASSETS.playerCharacter or GAME_ASSETS.enemies as your image sources (e.g., ctx.drawImage(GAME_ASSETS.playerCharacter, x, y)).';

const INCREMENTAL_SYSTEM_PROMPT =
  "You are an expert HTML5 game developer. You will be provided with the EXISTING working HTML game code and an UPDATED JSON game config. Your job is to modify the existing code to integrate the new requirements while preserving as much of the original working logic and styling as possible. CRITICAL: Review the developerNotes array in the JSON config. These are granular bug fixes, stat tweaks, or overriding instructions from the user. You MUST implement these specific notes in your updated code. NEVER output raw Base64 data strings. Instead, assume a global object GAME_ASSETS exists. Use GAME_ASSETS.playerCharacter or GAME_ASSETS.enemies as your image sources (e.g., ctx.drawImage(GAME_ASSETS.playerCharacter, x, y)). Output ONLY the complete, raw, updated HTML code without markdown fences.";

function stripCodeFences(content) {
  return String(content || "")
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function sanitizeHtmlForPrompt(content) {
  if (typeof content !== "string" || !content) {
    return "";
  }

  return content.replace(BASE64_IMAGE_PATTERN, "GAME_ASSETS.placeholder");
}

function buildPromptSafeGameConfig(gameConfig) {
  const safeConfig = gameConfig && typeof gameConfig === "object" ? { ...gameConfig } : {};

  safeConfig.imageAssets = Array.isArray(gameConfig?.imageAssets)
    ? gameConfig.imageAssets
        .map((asset) => {
          const targetCategory =
            typeof asset?.targetCategory === "string" ? asset.targetCategory.trim() : "";
          const description =
            typeof asset?.description === "string" ? asset.description.trim() : "";

          if (!targetCategory) {
            return null;
          }

          return {
            targetCategory,
            description,
            imageRef: `GAME_ASSETS.${targetCategory}`,
          };
        })
        .filter(Boolean)
    : [];

  return safeConfig;
}

function buildVisionUserContent(textPrompt, imageAssets) {
  const content = [
    {
      type: "text",
      text: `${textPrompt}\n\nThe user has provided hosted reference image URLs for specific game assets. Use those URLs only as visual reference. Assume the runtime provides matching Image objects on window.GAME_ASSETS. Draw these assets on the HTML5 canvas using ctx.drawImage(GAME_ASSETS.playerCharacter, x, y) style access or create shapes/pixel-art that closely resemble the provided images.`,
    },
  ];

  imageAssets.forEach((asset) => {
    const imageUrl = typeof asset?.imageData === "string" ? asset.imageData.trim() : "";

    if (imageUrl) {
      content.push({
        type: "image_url",
        image_url: {
          url: imageUrl,
        },
      });
    }
  });

  return content;
}

export async function onRequestPost(context) {
  try {
    const { gameConfig, currentHtml } = await context.request.json();

    if (!gameConfig || typeof gameConfig !== "object") {
      return new Response(JSON.stringify({ error: "gameConfig must be an object" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (!context.env.OPENAI_PROXY_BASE_URL) {
      throw new Error("Missing OPENAI_PROXY_BASE_URL environment variable");
    }

    const client = new OpenAI({
      apiKey: context.env.OPENAI_PROXY_API_KEY || "proxy-handles-key",
      baseURL: context.env.OPENAI_PROXY_BASE_URL,
    });

    const hasExistingHtml = typeof currentHtml === "string" && currentHtml.trim();
    const imageAssets = Array.isArray(gameConfig?.imageAssets) ? gameConfig.imageAssets : [];
    const hasImageAssets = imageAssets.length > 0;
    const promptSafeGameConfig = buildPromptSafeGameConfig(gameConfig);
    const promptSafeCurrentHtml = sanitizeHtmlForPrompt(currentHtml);
    const baseUserText = hasExistingHtml
      ? `UPDATED game config JSON:\n${JSON.stringify(promptSafeGameConfig, null, 2)}\n\nEXISTING working HTML game code:\n${promptSafeCurrentHtml}`
      : `Game config JSON:\n${JSON.stringify(promptSafeGameConfig, null, 2)}`;
    const messages = hasExistingHtml
      ? [
          { role: "system", content: INCREMENTAL_SYSTEM_PROMPT },
          {
            role: "user",
            content: hasImageAssets ? buildVisionUserContent(baseUserText, imageAssets) : baseUserText,
          },
        ]
      : [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: hasImageAssets ? buildVisionUserContent(baseUserText, imageAssets) : baseUserText,
          },
        ];

    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano",
      messages,
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
