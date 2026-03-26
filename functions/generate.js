import OpenAI from "openai";

const SYSTEM_PROMPT =
  'You are an expert HTML5 game developer. Based on the provided JSON config, write a complete, playable 2D web game in a single HTML file using vanilla JavaScript and the HTML5 Canvas. It must be fully self-contained with inline CSS and JS. Output ONLY the raw HTML code. Do NOT wrap it in markdown blockquotes like ```html.';

function stripCodeFences(content) {
  return String(content || "")
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function onRequestPost(context) {
  try {
    if (!context.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY environment variable");
    }

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
      apiKey: context.env.OPENAI_API_KEY,
    });

    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano-2026-03-17",
      reasoning_effort: "high",
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
