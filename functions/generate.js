import OpenAI from "openai";

const SYSTEM_PROMPT =
  'You are an expert HTML5 game developer. Based on the provided JSON config, write a complete, playable 2D web game in a single HTML file using vanilla JavaScript and the HTML5 Canvas. It must be fully self-contained with inline CSS and JS. Output ONLY the raw HTML code. Do NOT wrap it in markdown blockquotes like ```html. CRITICAL: The canvas MUST dynamically resize to perfectly fit the window. Use `canvas.width = window.innerWidth` and `canvas.height = window.innerHeight` on load and on window resize. Do NOT hardcode fixed pixel dimensions for the canvas. If the game requires player movement, you MUST implement both WASD and the Arrow Keys for controls.';

function stripCodeFences(content) {
  return String(content || "")
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function onRequestPost(context) {
  try {
    const { gameConfig } = await context.request.json();

    if (!gameConfig || typeof gameConfig !== "object") {
      return new Response(JSON.stringify({ error: "gameConfig must be an object" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    const client = new OpenAI({
      apiKey: "proxy-handles-key",
      baseURL: "https://openaiproxy.ngocthienbaod.workers.dev/v1",
    });

    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano",
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
