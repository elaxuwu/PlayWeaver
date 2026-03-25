const OpenAI = require("openai");

const SYSTEM_PROMPT =
  'You are an expert game designer. Your goal is to extract exactly 8 parameters from the user: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition.\n\nIf you are missing ANY of these, respond with a friendly, conversational question to gather the missing info.\n\nIf you have ALL 8 parameters clearly defined, output ONLY a raw JSON object containing these 8 keys, plus a 9th key: "isComplete": true. Do not include markdown formatting or extra text.';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        Allow: "POST",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY");
    }

    const { messageHistory } = JSON.parse(event.body || "{}");

    if (!Array.isArray(messageHistory)) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "messageHistory must be an array" }),
      };
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messageHistory.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano-2026-03-17",
      messages,
    });

    const assistantReply = completion.choices?.[0]?.message?.content?.trim() || "";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: assistantReply,
    };
  } catch (error) {
    console.error("Netlify chat function error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Something went wrong while calling OpenAI." }),
    };
  }
};
