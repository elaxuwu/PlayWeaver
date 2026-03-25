const aiModelConfig = require("./aiModelConfig");

const SYSTEM_PROMPT =
  'You are an expert game designer. You must gather 8 parameters: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition. CRITICAL: DO NOT ask for all of them at once. You must only ask for ONE missing parameter at a time in a brief, friendly, and conversational way. Wait for the user to answer before asking for the next one.\n\nIf you are missing ANY of these, respond with only one brief, friendly, conversational question for the next single missing parameter. Never ask for multiple missing parameters in the same reply.\n\nIf you have ALL 8 parameters clearly defined, output ONLY a raw JSON object containing these 8 keys, plus a 9th key: "isComplete": true. Do not include markdown formatting or extra text.';

const client = new FeatherlessAIClient({
  apiKey: process.env.FEATHERLESS_API_KEY,
  baseURL: aiModelConfig.baseURL,
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
    if (!process.env.FEATHERLESS_API_KEY) {
      throw new Error("Missing FEATHERLESS_API_KEY");
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
      model: aiModelConfig.modelName,
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
      body: JSON.stringify({ error: "Something went wrong while calling Featherless AI." }),
    };
  }
};
